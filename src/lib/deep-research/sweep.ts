/**
 * Background sweep for the admin-side Deep Research pass.
 *
 * Polls Supabase for fulfilled chains that haven't been QA'd yet
 * (deep_research_status IN (NULL, 'pending') AND attempts < 3) and
 * dispatches the worker for each. Also resets stranded 'in_progress'
 * rows older than the timeout so a crashed run doesn't permanently
 * block its chain.
 *
 * This is what makes the analysis kick off *automatically* the moment
 * a chain reaches fulfilled — the sweep runs every 60s via
 * instrumentation.ts, finds the freshly-fulfilled row in NULL state,
 * and queues the worker.
 *
 * Why fan-out is bounded to 2: each Sonar Deep Research call costs
 * ~$3-5 and takes 30-90s. Running 20 in parallel would burn $60-100
 * before the next sweep tick even fires. Two at a time gives a
 * reasonable backlog drain (~4/min) without runaway cost or rate-limit
 * pressure on OpenRouter.
 */

import { SupabaseClient } from '@supabase/supabase-js'
import { getAdminSupabase } from '@/lib/admin-supabase'
import { runForRequest, MAX_ATTEMPTS, STRANDED_RUN_THRESHOLD_MS } from './worker'

// Hard cap on how many parallel workers to spawn per sweep tick.
const MAX_SPAWN_PER_TICK = 2

// =================================================================
// Stranded-run recovery
// =================================================================

async function resetStrandedRuns(supabase: SupabaseClient): Promise<number> {
  const cutoff = new Date(Date.now() - STRANDED_RUN_THRESHOLD_MS).toISOString()
  const { data, error } = await supabase
    .from('fulfillment_requests')
    .select('request_id, deep_research_attempts')
    .eq('deep_research_status', 'in_progress')
    .lt('deep_research_started_at', cutoff)
  if (error) {
    console.warn('[deep_research] stranded query failed', error.message)
    return 0
  }
  let count = 0
  for (const row of (data || []) as Array<{
    request_id: string
    deep_research_attempts: number | null
  }>) {
    const attempts = row.deep_research_attempts || 0
    const nextStatus = attempts >= MAX_ATTEMPTS ? 'failed' : 'pending'
    const { error: updErr } = await supabase
      .from('fulfillment_requests')
      .update({
        deep_research_status: nextStatus,
        deep_research_error:
          `Stranded in_progress run reset by sweep (process restart or ` +
          `crash mid-call; attempts=${attempts}).`,
      })
      .eq('request_id', row.request_id)
      .eq('deep_research_status', 'in_progress')
    if (!updErr) count += 1
  }
  if (count > 0) {
    console.log(`[deep_research] reset ${count} stranded in_progress run(s)`)
  }
  return count
}

// =================================================================
// Pending row discovery
// =================================================================

interface PendingRow {
  request_id: string
  deep_research_status: string | null
}

async function findPendingRows(
  supabase: SupabaseClient,
  limit: number,
): Promise<PendingRow[]> {
  // Two-query union: NULL status (never queued) + 'pending' (failed
  // attempts awaiting retry). Supabase's PostgREST doesn't support
  // OR across IS NULL + eq cleanly without a verbose .or() filter,
  // so we run two queries and merge. Tiny overhead.
  const out: PendingRow[] = []

  const { data: nullRows, error: nullErr } = await supabase
    .from('fulfillment_requests')
    .select('request_id, deep_research_status')
    .eq('status', 'fulfilled')
    .is('deep_research_status', null)
    .order('created_at', { ascending: true })
    .limit(limit)
  if (nullErr) {
    console.warn(
      '[deep_research] null-status sweep query failed',
      nullErr.message,
    )
  } else {
    for (const r of (nullRows || []) as PendingRow[]) out.push(r)
  }

  if (out.length >= limit) return out.slice(0, limit)

  const remaining = limit - out.length
  const { data: pendingRows, error: pendingErr } = await supabase
    .from('fulfillment_requests')
    .select('request_id, deep_research_status, deep_research_attempts')
    .eq('status', 'fulfilled')
    .eq('deep_research_status', 'pending')
    .lt('deep_research_attempts', MAX_ATTEMPTS)
    .order('created_at', { ascending: true })
    .limit(remaining)
  if (pendingErr) {
    console.warn(
      '[deep_research] pending-status sweep query failed',
      pendingErr.message,
    )
  } else {
    for (const r of (pendingRows || []) as PendingRow[]) out.push(r)
  }

  return out
}

// =================================================================
// Top-level entry
// =================================================================

export interface SweepResult {
  reset_stranded: number
  spawned: number
  results: Array<{ request_id: string; status: string; error?: string }>
}

/**
 * Run one sweep iteration. Idempotent — safe to call from cron, on
 * boot, from a manual admin button, or from the periodic interval
 * started by ``instrumentation.ts``.
 */
export async function runSweep(): Promise<SweepResult> {
  const supabase = getAdminSupabase()
  const resetStranded = await resetStrandedRuns(supabase)
  const candidates = await findPendingRows(supabase, MAX_SPAWN_PER_TICK)
  if (candidates.length === 0) {
    return { reset_stranded: resetStranded, spawned: 0, results: [] }
  }

  // Run workers concurrently (up to MAX_SPAWN_PER_TICK) and gather
  // their results so we can log a summary at the end.
  const results = await Promise.all(
    candidates.map(async (c) => {
      const r = await runForRequest(supabase, c.request_id)
      return {
        request_id: c.request_id,
        status: r.status,
        error: r.error,
      }
    }),
  )

  console.log(
    `[deep_research] sweep finished: ` +
      `reset_stranded=${resetStranded} ` +
      `spawned=${results.length} ` +
      `outcomes=${results.map((r) => r.status).join(',')}`,
  )

  return {
    reset_stranded: resetStranded,
    spawned: results.length,
    results,
  }
}
