/**
 * Single-chain worker for the admin-side Deep Research pass.
 *
 * Flow for one chain leaf request_id:
 *   1. Atomically claim the row (status pending -> in_progress, attempts++)
 *   2. Walk the chain backwards from the leaf, collecting winning leads
 *   3. Build the QA prompt, call Perplexity Sonar Deep Research
 *   4. Parse the JSON response and persist the analysis
 *
 * All failure paths route through ``persistFailure`` so a buggy code
 * path never leaves a row stranded in 'in_progress'. The stranded-run
 * sweep (in sweep.ts) cleans up anything older than the timeout.
 */

import { SupabaseClient } from '@supabase/supabase-js'
import {
  getAdminSupabase,
  DeepResearchAnalysisPayload,
  IcpDetails,
} from '@/lib/admin-supabase'
import { buildPrompt, PromptLead, CreditedSignal } from './prompt'
import { callDeepResearch, LLM_MODEL, LLM_TIMEOUT_MS } from './openrouter'
import { parseAnalysisResponse } from './parser'

export const MAX_ATTEMPTS = 3
// After this long in 'in_progress' we assume the worker died (process
// restart, crash mid-call) and the next sweep resets to 'pending'.
// Has to be greater than LLM_TIMEOUT_MS by a margin.
export const STRANDED_RUN_THRESHOLD_MS = LLM_TIMEOUT_MS + 60_000

// Cap how many leads ship to the LLM in one call. Deep Research has a
// context budget and very long requests get truncated silently.
const MAX_LEADS_PER_ANALYSIS = 50

// =================================================================
// Chain walk + lead hydration
// =================================================================

async function walkChainIds(
  supabase: SupabaseClient,
  leafId: string,
): Promise<string[]> {
  const ids: string[] = [leafId]
  let cur = leafId
  // Bound at 50 cycles to defend against accidental data cycles.
  for (let i = 0; i < 50; i++) {
    const { data, error } = await supabase
      .from('fulfillment_requests')
      .select('request_id')
      .eq('successor_request_id', cur)
      .limit(1)
      .maybeSingle()
    if (error || !data) break
    const prev = (data as { request_id: string }).request_id
    if (ids.includes(prev)) break
    ids.push(prev)
    cur = prev
  }
  return ids
}

function creditedSignals(mapping: unknown): CreditedSignal[] {
  if (!Array.isArray(mapping)) return []
  return mapping.filter((entry) => {
    if (!entry || typeof entry !== 'object') return false
    const r = entry as Record<string, unknown>
    const score = Number(
      r.after_decay_score ?? r.raw_score ?? 0,
    )
    return Number.isFinite(score) && score > 0
  }) as CreditedSignal[]
}

interface LoadedChain {
  icp: IcpDetails
  leads: PromptLead[]
}

async function loadChainData(
  supabase: SupabaseClient,
  leafId: string,
): Promise<LoadedChain | null> {
  const { data: leafData, error: leafErr } = await supabase
    .from('fulfillment_requests')
    .select('request_id, icp_details')
    .eq('request_id', leafId)
    .limit(1)
    .maybeSingle()
  if (leafErr || !leafData) {
    console.warn('[deep_research] leaf fetch failed', leafId, leafErr?.message)
    return null
  }
  const icp = ((leafData as { icp_details: IcpDetails | null }).icp_details ||
    {}) as IcpDetails

  const chainIds = await walkChainIds(supabase, leafId)

  const { data: winnersData, error: winnersErr } = await supabase
    .from('fulfillment_score_consensus')
    .select(
      'consensus_id, submission_id, lead_id, consensus_final_score, ' +
        'intent_details, intent_signal_mapping',
    )
    .in('request_id', chainIds)
    .eq('is_winner', true)
    .order('consensus_final_score', { ascending: false })
  if (winnersErr) {
    console.warn(
      '[deep_research] winners fetch failed for',
      leafId,
      winnersErr.message,
    )
    return null
  }

  // Dedup by lead_id (held leads can appear in multiple chain rows
  // when they carry over across recycles); keep highest-scoring.
  type WinnerRow = {
    consensus_id: string
    submission_id: string
    lead_id: string
    consensus_final_score: number | null
    intent_details: string | null
    intent_signal_mapping: unknown
  }
  const byLead = new Map<string, WinnerRow>()
  for (const w of (winnersData || []) as unknown as WinnerRow[]) {
    if (!w.lead_id) continue
    const prev = byLead.get(w.lead_id)
    if (!prev) byLead.set(w.lead_id, w)
    else if (
      (w.consensus_final_score ?? 0) > (prev.consensus_final_score ?? 0)
    )
      byLead.set(w.lead_id, w)
  }
  let winners = Array.from(byLead.values()).sort(
    (a, b) => (b.consensus_final_score ?? 0) - (a.consensus_final_score ?? 0),
  )

  if (winners.length > MAX_LEADS_PER_ANALYSIS) {
    console.warn(
      `[deep_research] chain ${leafId.slice(0, 8)} has ${winners.length} winners; ` +
        `truncating to top ${MAX_LEADS_PER_ANALYSIS} for analysis`,
    )
    winners = winners.slice(0, MAX_LEADS_PER_ANALYSIS)
  }

  // Hydrate lead_data per (submission_id, lead_id) pair.
  const subIds = Array.from(new Set(winners.map((w) => w.submission_id)))
  const leadDataBySub = new Map<string, Array<{ lead_id: string; data?: Record<string, unknown> }>>()
  if (subIds.length > 0) {
    const { data: subs, error: subsErr } = await supabase
      .from('fulfillment_submissions')
      .select('submission_id, lead_data')
      .in('submission_id', subIds)
    if (subsErr) {
      console.warn(
        '[deep_research] lead_data hydration failed',
        subsErr.message,
      )
    } else {
      for (const s of subs || []) {
        leadDataBySub.set(
          (s as { submission_id: string }).submission_id,
          ((s as { lead_data: unknown }).lead_data || []) as Array<{
            lead_id: string
            data?: Record<string, unknown>
          }>,
        )
      }
    }
  }

  const leads: PromptLead[] = winners.map((w) => {
    const entries = leadDataBySub.get(w.submission_id) || []
    const match = entries.find((e) => e.lead_id === w.lead_id)
    return {
      lead_data: match?.data || {},
      intent_details: w.intent_details || '',
      credited_signals: creditedSignals(w.intent_signal_mapping),
    }
  })

  return { icp, leads }
}

// =================================================================
// State machine writes
// =================================================================

async function persistCompleted(
  supabase: SupabaseClient,
  requestId: string,
  analysisCore: Pick<DeepResearchAnalysisPayload, 'summary' | 'leads'>,
  icpSnapshot: IcpDetails,
  rawResponse: string,
): Promise<void> {
  const generatedAt = new Date().toISOString()
  const payload: DeepResearchAnalysisPayload = {
    summary: analysisCore.summary,
    leads: analysisCore.leads,
    model: LLM_MODEL,
    icp_snapshot: icpSnapshot,
    raw_response: rawResponse,
    generated_at: generatedAt,
  }
  await supabase
    .from('fulfillment_requests')
    .update({
      deep_research_analysis: payload,
      deep_research_status: 'completed',
      deep_research_generated_at: generatedAt,
      deep_research_error: null,
    })
    .eq('request_id', requestId)
}

async function persistFailure(
  supabase: SupabaseClient,
  requestId: string,
  attempts: number,
  error: string,
): Promise<void> {
  const nextStatus = attempts >= MAX_ATTEMPTS ? 'failed' : 'pending'
  await supabase
    .from('fulfillment_requests')
    .update({
      deep_research_status: nextStatus,
      deep_research_error: error.slice(0, 1000),
    })
    .eq('request_id', requestId)
}

// =================================================================
// Public API
// =================================================================

export interface RunResult {
  ok: boolean
  status: 'completed' | 'pending' | 'failed' | 'skipped'
  error?: string
}

/**
 * Atomically claim a row and run the QA pass for it.
 *
 * The claim is the eq-filtered update from 'pending' to 'in_progress'.
 * If the eq filter matches zero rows (another worker won the race or
 * the row was already claimed) the function returns ``status: 'skipped'``
 * without ever calling OpenRouter.
 *
 * Returns the post-call state, so the manual-rerun route handler can
 * surface the result inline in the HTTP response.
 */
export async function runForRequest(
  supabase: SupabaseClient,
  requestId: string,
): Promise<RunResult> {
  // Read current attempts so we can claim atomically with attempts++.
  // We re-read inside the claim (the supabase update is one round-trip),
  // but having the value first lets us short-circuit on missing rows.
  const { data: cur, error: curErr } = await supabase
    .from('fulfillment_requests')
    .select(
      'request_id, status, deep_research_status, deep_research_attempts',
    )
    .eq('request_id', requestId)
    .limit(1)
    .maybeSingle()
  if (curErr || !cur) {
    return { ok: false, status: 'failed', error: 'request not found' }
  }
  const row = cur as {
    request_id: string
    status: string
    deep_research_status: string | null
    deep_research_attempts: number | null
  }

  if (row.status !== 'fulfilled') {
    return {
      ok: false,
      status: 'skipped',
      error: `Chain is not fulfilled (status=${row.status}). Skipping.`,
    }
  }
  // Don't double-run a completed analysis. Manual rerun resets the
  // state machine in a separate route handler, so reaching this branch
  // with status='completed' means we'd be clobbering a fresh result.
  if (row.deep_research_status === 'completed') {
    return { ok: true, status: 'skipped' }
  }
  if (row.deep_research_status === 'in_progress') {
    return {
      ok: true,
      status: 'skipped',
      error: 'Already in progress on another worker.',
    }
  }

  const attempts = (row.deep_research_attempts || 0) + 1

  // Atomic claim. If another worker beat us to it, the eq-filter on
  // deep_research_status matches zero rows and the update is a no-op.
  // Supabase returns the updated rows in `.data`; empty array means
  // someone else won.
  const expectedStatus = row.deep_research_status ?? null
  const claimQuery = supabase
    .from('fulfillment_requests')
    .update({
      deep_research_status: 'in_progress',
      deep_research_attempts: attempts,
      deep_research_started_at: new Date().toISOString(),
    })
    .eq('request_id', requestId)
  // eq() on a NULL column doesn't match — we have to use .is().
  const claim =
    expectedStatus === null
      ? await claimQuery.is('deep_research_status', null).select()
      : await claimQuery
          .eq('deep_research_status', expectedStatus)
          .select()
  if (claim.error) {
    console.warn(
      '[deep_research] claim failed for',
      requestId,
      claim.error.message,
    )
    return {
      ok: false,
      status: 'failed',
      error: `Could not claim row: ${claim.error.message}`,
    }
  }
  if (!claim.data || claim.data.length === 0) {
    // Another worker won the race.
    return { ok: true, status: 'skipped' }
  }

  // From here on, we own the row. All failure paths must write a
  // terminal state via persistFailure so the row isn't stranded.
  try {
    const chainData = await loadChainData(supabase, requestId)
    if (!chainData || chainData.leads.length === 0) {
      const msg =
        'No winning leads found for chain — cannot run QA pass.'
      await persistFailure(supabase, requestId, attempts, msg)
      return { ok: false, status: 'failed', error: msg }
    }

    const prompt = buildPrompt(chainData.icp, chainData.leads)

    console.log(
      `[deep_research] running for ${requestId.slice(0, 8)} ` +
        `(${chainData.leads.length} leads, attempt ${attempts}/${MAX_ATTEMPTS})`,
    )

    const llmResult = await callDeepResearch(prompt)
    if (!llmResult.ok || !llmResult.content) {
      const msg = llmResult.error || 'OpenRouter call returned no content'
      await persistFailure(supabase, requestId, attempts, msg)
      return {
        ok: false,
        status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
        error: msg,
      }
    }

    const parsed = parseAnalysisResponse(llmResult.content)
    if (!parsed) {
      const msg =
        'Could not parse LLM response as structured JSON. ' +
        'Check raw response in logs.'
      await persistFailure(supabase, requestId, attempts, msg)
      return {
        ok: false,
        status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
        error: msg,
      }
    }

    await persistCompleted(
      supabase,
      requestId,
      parsed,
      chainData.icp,
      llmResult.content,
    )
    console.log(
      `[deep_research] ${requestId.slice(0, 8)} -> completed ` +
        `(${parsed.summary.total_reviewed} leads reviewed)`,
    )
    return { ok: true, status: 'completed' }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(
      `[deep_research] unexpected error for ${requestId.slice(0, 8)}: ${msg}`,
    )
    try {
      await persistFailure(supabase, requestId, attempts, `Unexpected error: ${msg}`)
    } catch {
      // Last-ditch — couldn't even write the failure row. The
      // stranded-run sweep will recover on the next loop.
    }
    return {
      ok: false,
      status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
      error: msg,
    }
  }
}

/**
 * Convenience wrapper that creates its own Supabase client.
 *
 * Used by API route handlers that don't already hold a client.
 */
export async function runForRequestWithClient(
  requestId: string,
): Promise<RunResult> {
  const supabase = getAdminSupabase()
  return runForRequest(supabase, requestId)
}
