/**
 * GET /api/admin/requests
 *
 * Lists every fulfillment request the operator can see, folded into
 * one row per CLIENT REQUEST (i.e. one row per chain, leaf-rooted).
 * Returns up to LIST_LIMIT chains, ordered by most-recent activity.
 *
 * For each chain we surface:
 *   - leaf row (current status, current num_leads target after recycles)
 *   - root row (original target the client asked for, original
 *     created_at — the "wall-clock" age of the client request)
 *   - delivered_count (number of distinct leads is_winner=TRUE across
 *     the chain — what the client actually got so far)
 *
 * Response is intentionally NOT cached: this is the admin view and
 * a 30-second stale-list is a worse outcome than one extra Supabase
 * read every page load.
 */

import { NextResponse } from 'next/server'
import {
  getAdminSupabase,
  AdminFulfillmentRequest,
  IcpDetails,
} from '@/lib/admin-supabase'
import { buildChainViews } from '@/lib/admin-format'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const LIST_LIMIT = 200

interface ChainSummary {
  // Stable identifier for the chain. Always equals the LEAF request_id
  // because the leaf is what the operator drills into.
  request_id: string
  // The root row's identifier. Same as request_id for non-recycled
  // single-cycle chains.
  root_request_id: string
  // Operator-facing fields. internal_label is what we set when we
  // created the request; company is the client's brand name. Both
  // can be null on legacy rows pre-2026-04.
  internal_label: string | null
  company: string | null
  // Latest status of the LEAF row.
  status: string
  // Original quota the client asked for (from the ROOT row). This is
  // the value the client sees; it does not decrease as the chain
  // recycles, so it is the right thing to display on the list view.
  target_num_leads: number
  // How many distinct leads we've actually delivered (is_winner=TRUE)
  // across the whole chain. Capped at target_num_leads to avoid the
  // odd "13 of 10" overshoot when a chain partially overdelivers
  // before a recycle dedup pass.
  delivered_count: number
  // Length of the chain (1 = single cycle, 2 = one recycle, etc).
  cycle_count: number
  // ICP basics surfaced for the list view (country, industry list
  // size) so the operator can scan without opening each row.
  icp_summary: {
    industries: number
    sub_industries: number
    countries: string[]
    intent_signals: number
  }
  // Original creation timestamp from the ROOT row. This is the right
  // age to show because the chain is one logical client request.
  created_at: string
  // Most recent activity on this chain (max of leaf created_at and
  // any winner computed_at). Used for sorting + the "last activity"
  // pill on the list view.
  last_activity_at: string
}

function summarizeIcp(icp: IcpDetails | null): ChainSummary['icp_summary'] {
  if (!icp) return { industries: 0, sub_industries: 0, countries: [], intent_signals: 0 }
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

export async function GET() {
  let supabase
  try {
    supabase = getAdminSupabase()
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'admin supabase not configured'
    return NextResponse.json({ error: msg }, { status: 503 })
  }

  // Pull a generous window. We bound by row count (not by date) so the
  // operator can still find a chain that started weeks ago via recycle.
  const { data: requestsData, error: requestsErr } = await supabase
    .from('fulfillment_requests')
    .select(
      'request_id, internal_label, company, status, num_leads, icp_details, created_at, window_start, window_end, successor_request_id',
    )
    .order('created_at', { ascending: false })
    .limit(LIST_LIMIT * 4) // budget for chain expansion before folding

  if (requestsErr) {
    return NextResponse.json(
      { error: `Supabase error: ${requestsErr.message}` },
      { status: 502 },
    )
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

  // Pull winner counts per chain in one go.
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
      // Map a request_id back to its chain's root, then dedupe winners
      // by lead_id within the chain (a held lead can appear in
      // multiple chain generations).
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
      // Cap so we never show "12 of 10". Overshoot can happen briefly
      // mid-cycle before dedup; the client only ever gets `target`.
      delivered_count: Math.min(delivered, target),
      cycle_count: c.predecessors.length + 1,
      icp_summary: summarizeIcp(leaf.icp_details ?? root.icp_details ?? null),
      created_at: root.created_at,
      last_activity_at,
    }
  })

  summaries.sort((a, b) => (a.last_activity_at < b.last_activity_at ? 1 : -1))
  const trimmed = summaries.slice(0, LIST_LIMIT)

  return NextResponse.json(
    { chains: trimmed, total: summaries.length },
    {
      headers: {
        'Cache-Control': 'no-store',
      },
    },
  )
}
