/**
 * GET /api/admin/requests/[request_id]
 *
 * Returns the full operator view of one fulfillment chain. The
 * provided request_id can be ANY row in the chain (root, mid, or
 * leaf); we walk it both directions so the operator can paste any
 * request_id they have and get the canonical view.
 *
 * Response shape (typed in the admin client):
 *   {
 *     chain: {
 *       root_request, leaf_request, cycles[]  // every row in order
 *     },
 *     icp,                                   // from the LATEST row
 *     winners: AdminWinningLead[],           // dedup'd by lead_id
 *     all_submissions_count,                 // for the "all submissions" tab badge
 *   }
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  getAdminSupabase,
  AdminFulfillmentRequest,
  AdminConsensusRow,
  AdminWinningLead,
  LeadDataEntry,
} from '@/lib/admin-supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function walkChain(
  supabase: ReturnType<typeof getAdminSupabase>,
  startId: string,
): Promise<AdminFulfillmentRequest[]> {
  // Walk backwards (predecessor lookups) to the root, then forwards
  // along successor pointers to the leaf, accumulating every row.
  const collected = new Map<string, AdminFulfillmentRequest>()

  async function fetchOne(id: string): Promise<AdminFulfillmentRequest | null> {
    const { data, error } = await supabase
      .from('fulfillment_requests')
      .select(
        'request_id, internal_label, company, status, num_leads, icp_details, created_at, window_start, window_end, successor_request_id',
      )
      .eq('request_id', id)
      .limit(1)
      .maybeSingle()
    if (error) {
      console.error('[admin] fetchOne failed', id, error)
      return null
    }
    return data as AdminFulfillmentRequest | null
  }

  const startRow = await fetchOne(startId)
  if (!startRow) return []
  collected.set(startRow.request_id, startRow)

  // Walk backwards: who has us as their successor?
  let cur: AdminFulfillmentRequest | null = startRow
  // Hard cap chain length at 50 cycles to defend against accidental
  // cycles in the data. We've never seen a real chain past ~10.
  for (let i = 0; cur && i < 50; i++) {
    const { data: predData } = await supabase
      .from('fulfillment_requests')
      .select(
        'request_id, internal_label, company, status, num_leads, icp_details, created_at, window_start, window_end, successor_request_id',
      )
      .eq('successor_request_id', cur.request_id)
      .limit(1)
      .maybeSingle()
    const pred = predData as AdminFulfillmentRequest | null
    if (!pred || collected.has(pred.request_id)) break
    collected.set(pred.request_id, pred)
    cur = pred
  }

  // Walk forwards via successor_request_id.
  cur = startRow
  for (let i = 0; cur && i < 50; i++) {
    if (!cur.successor_request_id) break
    if (collected.has(cur.successor_request_id)) break
    const next = await fetchOne(cur.successor_request_id)
    if (!next) break
    collected.set(next.request_id, next)
    cur = next
  }

  // Sort by created_at ascending so [0] = root and [last] = leaf.
  return Array.from(collected.values()).sort((a, b) =>
    a.created_at < b.created_at ? -1 : 1,
  )
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ request_id: string }> },
) {
  const { request_id } = await ctx.params
  if (!request_id || typeof request_id !== 'string') {
    return NextResponse.json({ error: 'invalid request_id' }, { status: 400 })
  }
  // Basic UUID-ish sanity check so we don't pass arbitrary strings
  // into Supabase queries.
  if (!/^[0-9a-f-]{36}$/i.test(request_id)) {
    return NextResponse.json({ error: 'invalid request_id format' }, { status: 400 })
  }

  let supabase
  try {
    supabase = getAdminSupabase()
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'admin supabase not configured'
    return NextResponse.json({ error: msg }, { status: 503 })
  }

  const cycles = await walkChain(supabase, request_id)
  if (cycles.length === 0) {
    return NextResponse.json({ error: 'request not found' }, { status: 404 })
  }
  const root = cycles[0]
  const leaf = cycles[cycles.length - 1]
  const chainIds = cycles.map((c) => c.request_id)

  // Pull every winning consensus row across the chain.
  const { data: winnersData, error: winnersErr } = await supabase
    .from('fulfillment_score_consensus')
    .select(
      'consensus_id, request_id, submission_id, lead_id, miner_hotkey, ' +
        'consensus_final_score, consensus_intent_signal_final, consensus_rep_score, ' +
        'consensus_icp_fit, consensus_tier2_passed, consensus_email_verified, ' +
        'consensus_person_verified, consensus_company_verified, consensus_decision_maker, ' +
        'any_fabricated, is_winner, is_chain_held, reward_pct, reward_expires_epoch, ' +
        'intent_details, intent_breakdown, intent_signal_mapping, num_validators, computed_at',
    )
    .in('request_id', chainIds)
    .eq('is_winner', true)
    .order('consensus_final_score', { ascending: false })

  if (winnersErr) {
    return NextResponse.json(
      { error: `Supabase error: ${winnersErr.message}` },
      { status: 502 },
    )
  }

  // Dedup by lead_id (a held lead can appear in multiple chain rows
  // if it carried over across recycles). Keep the highest-scoring.
  const winnersByLead = new Map<string, AdminConsensusRow>()
  for (const w of (winnersData || []) as unknown as AdminConsensusRow[]) {
    const prev = winnersByLead.get(w.lead_id)
    if (!prev) {
      winnersByLead.set(w.lead_id, w)
    } else if (
      (w.consensus_final_score ?? 0) > (prev.consensus_final_score ?? 0)
    ) {
      winnersByLead.set(w.lead_id, w)
    }
  }
  const dedupedWinners = Array.from(winnersByLead.values()).sort(
    (a, b) => (b.consensus_final_score ?? 0) - (a.consensus_final_score ?? 0),
  )

  // Pull lead_data for every winning (submission_id, lead_id) pair.
  // lead_data is a JSONB array of entries; we filter to just the
  // winning lead_id per submission so we don't ship the entire batch.
  const winningSubIds = Array.from(
    new Set(dedupedWinners.map((w) => w.submission_id)),
  )
  const leadDataBySubmission = new Map<string, LeadDataEntry[]>()
  if (winningSubIds.length > 0) {
    const { data: subsData, error: subsErr } = await supabase
      .from('fulfillment_submissions')
      .select('submission_id, lead_data')
      .in('submission_id', winningSubIds)
    if (subsErr) {
      console.error('[admin] lead_data fetch failed', subsErr)
    } else {
      for (const s of subsData || []) {
        const ld = (s.lead_data || []) as LeadDataEntry[]
        leadDataBySubmission.set(s.submission_id, ld)
      }
    }
  }

  const winningLeads: AdminWinningLead[] = dedupedWinners.map((w) => {
    const entries = leadDataBySubmission.get(w.submission_id) || []
    const match = entries.find((e) => e.lead_id === w.lead_id)
    return { consensus: w, lead: match?.data ?? null }
  })

  // Count all submissions for the "All submissions" tab badge — but
  // don't fetch the actual rows on the detail endpoint. The
  // submissions tab pulls them lazily so we don't blow up payload
  // size on chains with hundreds of attempts.
  const { count: allSubsCount } = await supabase
    .from('fulfillment_submissions')
    .select('submission_id', { count: 'exact', head: true })
    .in('request_id', chainIds)

  return NextResponse.json(
    {
      chain: { root, leaf, cycles },
      icp: leaf.icp_details ?? root.icp_details ?? null,
      winners: winningLeads,
      target_num_leads: root.num_leads ?? leaf.num_leads,
      delivered_count: winningLeads.length,
      all_submissions_count: allSubsCount ?? 0,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
