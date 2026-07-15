/**
 * GET /api/admin/requests
 *
 * Lists every fulfillment request the operator can see, folded into
 * one row per CLIENT REQUEST (i.e. one row per chain, leaf-rooted).
 * Returns a bounded page of chains, newest leaf first.
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

import { NextRequest, NextResponse } from 'next/server'
import {
  getAdminSupabase,
  AdminFulfillmentRequest,
  IcpDetails,
} from '@/lib/admin-supabase'
import { buildChainViews, statusTone } from '@/lib/admin-format'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const REQUESTS_PAGE_SIZE = 1000
const COUNT_CHUNK_SIZE = 100
const DEFAULT_PAGE_SIZE = 20
const MAX_PAGE_SIZE = 50

type FilterKey = 'all' | 'open' | 'fulfilled' | 'partial' | 'recycled'

type RequestMetadataRow = {
  request_id: string
  internal_label: string | null
  company: string | null
  status: string
  num_leads: number
  created_at: string
  successor_request_id: string | null
}

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
  // Number of individual submitted leads across every submission in
  // the chain. This counts lead IDs, not submission batches/miners.
  submitted_leads_count: number
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
  const rawCountries = icp.company_country ?? icp.country
  const countries = Array.isArray(rawCountries)
    ? rawCountries.filter((c) => typeof c === 'string' && c.length > 0)
    : rawCountries
    ? [rawCountries]
    : []
  const intent_signals = Array.isArray(icp.intent_signals)
    ? icp.intent_signals.length
    : 0
  return { industries, sub_industries, countries, intent_signals }
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

type SubmissionLeadCountRow = {
  request_id: string
  lead_hashes: Array<{ lead_id?: string | null }> | null
}

function submittedLeadCount(row: SubmissionLeadCountRow): number {
  const leadIds = new Set<string>()
  for (const entry of row.lead_hashes ?? []) {
    if (entry.lead_id) leadIds.add(entry.lead_id)
  }
  return leadIds.size
}

function numberParam(value: string | null, fallback: number, max: number): number {
  const parsed = Number.parseInt(value ?? '', 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.min(parsed, max)
}

function filterKey(value: string | null): FilterKey {
  return value === 'open' ||
    value === 'fulfilled' ||
    value === 'partial' ||
    value === 'recycled'
    ? value
    : 'all'
}

function matchesFilter(status: string, filter: FilterKey): boolean {
  if (filter === 'all') return true
  const tone = statusTone(status)
  return filter === 'open' ? tone === 'open' || tone === 'pending' : tone === filter
}

export async function GET(request: NextRequest) {
  const requestedPage = numberParam(request.nextUrl.searchParams.get('page'), 1, 10_000)
  const pageSize = numberParam(
    request.nextUrl.searchParams.get('pageSize'),
    DEFAULT_PAGE_SIZE,
    MAX_PAGE_SIZE,
  )
  const filter = filterKey(request.nextUrl.searchParams.get('status'))
  const query = (request.nextUrl.searchParams.get('q') ?? '').trim().toLowerCase()

  let supabase
  try {
    supabase = getAdminSupabase()
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'admin supabase not configured'
    return NextResponse.json({ error: msg }, { status: 503 })
  }

  // Pull the lightweight chain graph for every request, paginated past
  // PostgREST's per-query cap. Heavy ICP JSON is fetched only for the rows on
  // the requested chain page below.
  // Recycle chains run dozens of cycles deep, so a fixed "newest N
  // rows" window silently drops whole chains whose leaf falls outside
  // it (the operator then can't find requests they know exist). Row
  // shape is small and the table is bounded by real client demand, so
  // a full scan is fine here.
  const selectRequestPage = (from: number, to: number, withCount = false) =>
    supabase
      .from('fulfillment_requests')
      .select(
        'request_id, internal_label, company, status, num_leads, created_at, successor_request_id',
        withCount ? { count: 'exact' } : undefined,
      )
      .order('created_at', { ascending: false })
      .order('request_id', { ascending: false })
      .range(from, to)

  const firstPage = await selectRequestPage(0, REQUESTS_PAGE_SIZE - 1, true)
  if (firstPage.error) {
    return NextResponse.json(
      { error: `Supabase error: ${firstPage.error.message}` },
      { status: 502 },
    )
  }

  const requestRowCount = firstPage.count ?? firstPage.data?.length ?? 0
  const remainingOffsets: number[] = []
  for (let offset = REQUESTS_PAGE_SIZE; offset < requestRowCount; offset += REQUESTS_PAGE_SIZE) {
    remainingOffsets.push(offset)
  }
  const remainingPages = await Promise.all(
    remainingOffsets.map((offset) =>
      selectRequestPage(offset, offset + REQUESTS_PAGE_SIZE - 1),
    ),
  )
  const failedPage = remainingPages.find((result) => result.error)
  if (failedPage?.error) {
    return NextResponse.json(
      { error: `Supabase error: ${failedPage.error.message}` },
      { status: 502 },
    )
  }

  const requestsData = [
    ...((firstPage.data ?? []) as RequestMetadataRow[]),
    ...remainingPages.flatMap((result) => (result.data ?? []) as RequestMetadataRow[]),
  ]

  const rows: AdminFulfillmentRequest[] = (requestsData || []).map((r) => ({
    request_id: r.request_id,
    internal_label: r.internal_label,
    company: r.company,
    status: r.status,
    num_leads: r.num_leads,
    icp_details: null,
    created_at: r.created_at,
    window_start: null,
    window_end: null,
    successor_request_id: r.successor_request_id,
  }))

  const allChains = buildChainViews(rows)
  const counts: Record<FilterKey, number> = {
    all: allChains.length,
    open: 0,
    fulfilled: 0,
    partial: 0,
    recycled: 0,
  }
  let totalQuota = 0
  for (const chain of allChains) {
    const root = chain.predecessors[0] ?? chain.leaf
    totalQuota += root.num_leads ?? chain.leaf.num_leads
    const tone = statusTone(chain.leaf.status)
    if (tone === 'open' || tone === 'pending') counts.open += 1
    else if (tone === 'fulfilled') counts.fulfilled += 1
    else if (tone === 'partial') counts.partial += 1
    else if (tone === 'recycled') counts.recycled += 1
  }

  const filteredChains = allChains
    .filter((chain) => {
      const root = chain.predecessors[0] ?? chain.leaf
      if (!matchesFilter(chain.leaf.status, filter)) return false
      if (!query) return true
      return [
        chain.leaf.internal_label,
        root.internal_label,
        chain.leaf.company,
        root.company,
        chain.leaf.request_id,
        chain.rootId,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(query)
    })
    // A new recycle creates a new leaf, so leaf creation time is a stable,
    // cheap proxy for recent chain activity before page-level metrics load.
    .sort((a, b) => {
      const byCreated = b.leaf.created_at.localeCompare(a.leaf.created_at)
      return byCreated || b.leaf.request_id.localeCompare(a.leaf.request_id)
    })

  const totalFiltered = filteredChains.length
  const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize))
  const page = Math.min(requestedPage, totalPages)
  const from = (page - 1) * pageSize
  const chains = filteredChains.slice(from, from + pageSize)

  // Pull approved counts only for the visible chain page. Final fulfilled
  // chains mark winners with is_winner=true, while in-flight/partial chains
  // can already have accepted candidates via is_chain_held.
  const pageChainRequestIds = chains.flatMap((c) => [
    ...c.predecessors.map((p) => p.request_id),
    c.leaf.request_id,
  ])
  const reqIdToRoot = new Map<string, string>()
  for (const c of chains) {
    for (const r of c.predecessors) reqIdToRoot.set(r.request_id, c.rootId)
    reqIdToRoot.set(c.leaf.request_id, c.rootId)
  }

  let winnerCounts: Map<string, number> = new Map()
  const latestWinnerAt: Map<string, string> = new Map()
  if (pageChainRequestIds.length > 0) {
    type WinnerRow = {
      request_id: string
      lead_id: string
      computed_at: string
      is_winner: boolean
      is_chain_held: boolean
    }
    const winnerRows: WinnerRow[] = []
    let winnersErr: { message: string } | null = null
    // The id list now spans the whole table (thousands of request
    // rows), so the chunked .in() queries run concurrently instead of
    // serially — otherwise this loop alone would add tens of seconds.
    const winnerResults = await Promise.all(
      chunks(pageChainRequestIds, COUNT_CHUNK_SIZE).map((group) =>
        supabase
          .from('fulfillment_score_consensus')
          .select('request_id, lead_id, computed_at, is_winner, is_chain_held')
          .in('request_id', group)
          .or('is_winner.eq.true,is_chain_held.eq.true'),
      ),
    )
    for (const { data, error } of winnerResults) {
      if (error) {
        winnersErr = { message: error.message || 'winner batch failed' }
        break
      }
      winnerRows.push(...((data ?? []) as WinnerRow[]))
    }
    if (winnersErr) {
      console.error('[admin] winners count query failed', winnersErr)
    } else {
      // Map a request_id back to its chain's root, then dedupe winners
      // by lead_id within the chain (a held lead can appear in
      // multiple chain generations).
      const seenLeadsByRoot = new Map<string, Set<string>>()
      for (const w of winnerRows) {
        const approved = w.is_winner || w.is_chain_held
        if (!approved) continue
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

  const submittedLeadCounts = new Map<string, number>()
  if (pageChainRequestIds.length > 0) {
    let submissionsErr: { message: string } | null = null
    const submissionResults = await Promise.all(
      chunks(pageChainRequestIds, COUNT_CHUNK_SIZE).map((group) =>
        supabase
          .from('fulfillment_submissions')
          .select('request_id, lead_hashes')
          .in('request_id', group),
      ),
    )
    for (const { data, error } of submissionResults) {
      if (error) {
        submissionsErr = { message: error.message || 'submission batch failed' }
        break
      }
      for (const row of (data ?? []) as SubmissionLeadCountRow[]) {
        const root = reqIdToRoot.get(row.request_id)
        if (!root) continue
        submittedLeadCounts.set(
          root,
          (submittedLeadCounts.get(root) ?? 0) + submittedLeadCount(row),
        )
      }
    }
    if (submissionsErr) {
      console.error('[admin] submitted lead count query failed', submissionsErr)
    }
  }

  const detailRequestIds = Array.from(
    new Set(chains.flatMap((chain) => [chain.rootId, chain.leaf.request_id])),
  )
  const { data: detailRows, error: detailError } = detailRequestIds.length
    ? await supabase
        .from('fulfillment_requests')
        .select('request_id, icp_details')
        .in('request_id', detailRequestIds)
    : { data: [], error: null }
  if (detailError) {
    console.error('[admin] request ICP summary query failed', detailError)
  }
  const icpByRequestId = new Map(
    ((detailRows ?? []) as Array<{ request_id: string; icp_details: IcpDetails | null }>).map(
      (row) => [row.request_id, row.icp_details] as const,
    ),
  )

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
      submitted_leads_count: submittedLeadCounts.get(c.rootId) ?? 0,
      cycle_count: c.predecessors.length + 1,
      icp_summary: summarizeIcp(
        icpByRequestId.get(leaf.request_id) ?? icpByRequestId.get(root.request_id) ?? null,
      ),
      created_at: root.created_at,
      last_activity_at,
    }
  })

  return NextResponse.json(
    {
      chains: summaries,
      pagination: { page, pageSize, total: totalFiltered, totalPages },
      counts,
      totals: {
        requests: allChains.length,
        quota: totalQuota,
        inFlight: counts.open + counts.partial,
      },
    },
    {
      headers: {
        'Cache-Control': 'no-store',
      },
    },
  )
}
