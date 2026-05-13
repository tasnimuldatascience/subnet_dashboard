/**
 * Shared data layer for the /admin surface.
 *
 * Server components AND the /api/admin/* route handlers both call
 * into this module. That removes the previous HTTP round-trip
 * (server component → fetch('/api/admin/requests') → API route)
 * which was fragile in production: it required forwarding cookies
 * and resolving the deployment's own absolute URL from headers,
 * both of which can fail in subtle ways behind Vercel / nginx /
 * any other proxy.
 *
 * Now both paths share a single async function each. The API routes
 * still exist for the CSV export and any future client-side use.
 */

import {
  getAdminSupabase,
  AdminFulfillmentRequest,
  AdminConsensusRow,
  AdminWinningLead,
  IcpDetails,
  LeadDataEntry,
} from './admin-supabase'
import { buildChainViews } from './admin-format'

// =================================================================
// listChains() — powers GET /admin and GET /api/admin/requests
// =================================================================

export interface ChainSummary {
  request_id: string
  root_request_id: string
  internal_label: string | null
  company: string | null
  status: string
  target_num_leads: number
  delivered_count: number
  cycle_count: number
  icp_summary: {
    industries: number
    sub_industries: number
    countries: string[]
    intent_signals: number
  }
  created_at: string
  last_activity_at: string
}

const LIST_LIMIT = 200

function summarizeIcp(icp: IcpDetails | null): ChainSummary['icp_summary'] {
  if (!icp) {
    return { industries: 0, sub_industries: 0, countries: [], intent_signals: 0 }
  }
  const industries = Array.isArray(icp.industry)
    ? icp.industry.length
    : icp.industry
    ? 1
    : 0
  const sub_industries = Array.isArray(icp.sub_industry)
    ? icp.sub_industry.length
    : icp.sub_industry
    ? 1
    : 0
  const countries = Array.isArray(icp.country)
    ? icp.country.filter((c) => typeof c === 'string' && c.length > 0)
    : icp.country
    ? [icp.country]
    : []
  const intent_signals = Array.isArray(icp.intent_signals)
    ? icp.intent_signals.length
    : 0
  return { industries, sub_industries, countries, intent_signals }
}

export async function listChains(): Promise<{ chains: ChainSummary[]; total: number }> {
  const supabase = getAdminSupabase()

  const { data: requestsData, error: requestsErr } = await supabase
    .from('fulfillment_requests')
    .select(
      'request_id, internal_label, company, status, num_leads, icp_details, created_at, window_start, window_end, successor_request_id',
    )
    .order('created_at', { ascending: false })
    .limit(LIST_LIMIT * 4)

  if (requestsErr) {
    throw new Error(`Supabase error: ${requestsErr.message}`)
  }

  const rows: AdminFulfillmentRequest[] = (requestsData || []).map((r) => ({
    request_id: r.request_id,
    internal_label: r.internal_label,
    company: r.company,
    status: r.status,
    num_leads: r.num_leads,
    icp_details: r.icp_details,
    created_at: r.created_at,
    window_start: r.window_start,
    window_end: r.window_end,
    successor_request_id: r.successor_request_id,
  }))

  const chains = buildChainViews(rows)
  const allChainRequestIds = chains.flatMap((c) => [
    ...c.predecessors.map((p) => p.request_id),
    c.leaf.request_id,
  ])

  let winnerCounts: Map<string, number> = new Map()
  const latestWinnerAt: Map<string, string> = new Map()

  if (allChainRequestIds.length > 0) {
    const { data: winnersData, error: winnersErr } = await supabase
      .from('fulfillment_score_consensus')
      .select('request_id, lead_id, computed_at')
      .in('request_id', allChainRequestIds)
      .eq('is_winner', true)
    if (winnersErr) {
      console.error('[admin] winners count query failed', winnersErr)
    } else {
      const reqIdToRoot = new Map<string, string>()
      for (const c of chains) {
        for (const r of c.predecessors) reqIdToRoot.set(r.request_id, c.rootId)
        reqIdToRoot.set(c.leaf.request_id, c.rootId)
      }
      const seenLeadsByRoot = new Map<string, Set<string>>()
      for (const w of winnersData || []) {
        const root = reqIdToRoot.get(w.request_id)
        if (!root) continue
        let set = seenLeadsByRoot.get(root)
        if (!set) {
          set = new Set()
          seenLeadsByRoot.set(root, set)
        }
        set.add(w.lead_id)
        const prev = latestWinnerAt.get(root)
        if (!prev || w.computed_at > prev) {
          latestWinnerAt.set(root, w.computed_at)
        }
      }
      winnerCounts = new Map(
        [...seenLeadsByRoot.entries()].map(([root, set]) => [root, set.size]),
      )
    }
  }

  const summaries: ChainSummary[] = chains.map((c) => {
    const root = c.predecessors[0] ?? c.leaf
    const leaf = c.leaf
    const delivered = winnerCounts.get(c.rootId) ?? 0
    const target = root.num_leads ?? leaf.num_leads
    const lastWinner = latestWinnerAt.get(c.rootId)
    const last = [leaf.created_at, lastWinner].filter(Boolean) as string[]
    const last_activity_at = last.reduce(
      (acc, t) => (t > acc ? t : acc),
      leaf.created_at,
    )
    return {
      request_id: leaf.request_id,
      root_request_id: c.rootId,
      internal_label: leaf.internal_label ?? root.internal_label,
      company: leaf.company ?? root.company,
      status: leaf.status,
      target_num_leads: target,
      delivered_count: Math.min(delivered, target),
      cycle_count: c.predecessors.length + 1,
      icp_summary: summarizeIcp(leaf.icp_details ?? root.icp_details ?? null),
      created_at: root.created_at,
      last_activity_at,
    }
  })

  summaries.sort((a, b) => (a.last_activity_at < b.last_activity_at ? 1 : -1))
  return { chains: summaries.slice(0, LIST_LIMIT), total: summaries.length }
}

// =================================================================
// getRequestDetail() — powers GET /admin/requests/[id] and the
//                     matching API route
// =================================================================

export interface RequestDetail {
  chain: {
    root: AdminFulfillmentRequest
    leaf: AdminFulfillmentRequest
    cycles: AdminFulfillmentRequest[]
  }
  icp: IcpDetails | null
  winners: AdminWinningLead[]
  target_num_leads: number
  delivered_count: number
  all_submissions_count: number
}

async function walkChain(
  supabase: ReturnType<typeof getAdminSupabase>,
  startId: string,
): Promise<AdminFulfillmentRequest[]> {
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

  // Walk backwards
  let cur: AdminFulfillmentRequest | null = startRow
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

  // Walk forwards
  cur = startRow
  for (let i = 0; cur && i < 50; i++) {
    if (!cur.successor_request_id) break
    if (collected.has(cur.successor_request_id)) break
    const next = await fetchOne(cur.successor_request_id)
    if (!next) break
    collected.set(next.request_id, next)
    cur = next
  }

  return Array.from(collected.values()).sort((a, b) =>
    a.created_at < b.created_at ? -1 : 1,
  )
}

export async function getRequestDetail(requestId: string): Promise<RequestDetail | null> {
  if (!/^[0-9a-f-]{36}$/i.test(requestId)) {
    return null
  }
  const supabase = getAdminSupabase()

  const cycles = await walkChain(supabase, requestId)
  if (cycles.length === 0) return null
  const root = cycles[0]
  const leaf = cycles[cycles.length - 1]
  const chainIds = cycles.map((c) => c.request_id)

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
    throw new Error(`Supabase error: ${winnersErr.message}`)
  }

  const winnersByLead = new Map<string, AdminConsensusRow>()
  for (const w of (winnersData || []) as unknown as AdminConsensusRow[]) {
    const prev = winnersByLead.get(w.lead_id)
    if (!prev) {
      winnersByLead.set(w.lead_id, w)
    } else if ((w.consensus_final_score ?? 0) > (prev.consensus_final_score ?? 0)) {
      winnersByLead.set(w.lead_id, w)
    }
  }
  const dedupedWinners = Array.from(winnersByLead.values()).sort(
    (a, b) => (b.consensus_final_score ?? 0) - (a.consensus_final_score ?? 0),
  )

  const winningSubIds = Array.from(new Set(dedupedWinners.map((w) => w.submission_id)))
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
        leadDataBySubmission.set(s.submission_id, (s.lead_data || []) as LeadDataEntry[])
      }
    }
  }

  const winningLeads: AdminWinningLead[] = dedupedWinners.map((w) => {
    const entries = leadDataBySubmission.get(w.submission_id) || []
    const match = entries.find((e) => e.lead_id === w.lead_id)
    return { consensus: w, lead: match?.data ?? null }
  })

  const { count: allSubsCount } = await supabase
    .from('fulfillment_submissions')
    .select('submission_id', { count: 'exact', head: true })
    .in('request_id', chainIds)

  return {
    chain: { root, leaf, cycles },
    icp: leaf.icp_details ?? root.icp_details ?? null,
    winners: winningLeads,
    target_num_leads: root.num_leads ?? leaf.num_leads,
    delivered_count: winningLeads.length,
    all_submissions_count: allSubsCount ?? 0,
  }
}
