import { createClient } from '@supabase/supabase-js'
import { createHash } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { runSingleFlight, type SingleFlightState } from '@/lib/single-flight'
import { reshapeChainSummaries, type ChainSummaryRow } from '@/lib/chain-summaries'

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SECRET_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  return createClient(url, key, { auth: { persistSession: false } })
}

// =================================================================
//  Fulfillment API
//
//  Performance defenses worth knowing about, top-down by impact:
//
//  1. Leaderboard scan is now time-bounded (LEADERBOARD_WINDOW_DAYS)
//     and capped (LEADERBOARD_ROW_LIMIT). Previously this scanned the
//     entire `fulfillment_score_consensus` table on every cache miss.
//  2. Consensus ships as per-(request, miner) aggregates from SQL
//     (get_fulfillment_graph_summary, 25k-row window inside the RPC);
//     raw lead rows are served per request only when a dialog opens.
//  3. Response includes an ETag derived from a hash of the payload.
//     Clients sending `If-None-Match` get a 304 (no body) when nothing
//     has changed since their last poll. This is the lightweight
//     equivalent of a delta protocol and saves ~all bandwidth on polls
//     that occur within the 60s server cache window.
//  4. Module-level cache stores the JSON body AND its ETag, so 304
//     responses are free even when the cache is warm.
//
//  Long-term, the leaderboard should become a Supabase materialized
//  view (see db/migrations/) and the cosmos should consume a
//  pre-aggregated edge snapshot rather than raw consensus rows. Both
//  upgrades plug in without changing the API shape on the client.
// =================================================================

const CACHE_TTL = 60_000
const LEADERBOARD_WINDOW_DAYS = 7
const LEADERBOARD_ROW_LIMIT = 10_000
// Only the consensus columns the response mapper reads (audited end to end).
// Selecting these instead of '*' drops the four large JSONB columns
// (intent_signal_mapping, intent_details, intent_breakdown,
// attribute_verification) from every 25k-row scan on each 60s refresh.
const CONSENSUS_COLUMNS =
  'consensus_id,request_id,miner_hotkey,lead_id,consensus_final_score,' +
  'consensus_rep_score,any_fabricated,is_winner,reward_pct,computed_at,' +
  'consensus_email_verified,consensus_person_verified,consensus_company_verified'
// Detail rows for one request, cached briefly so dialog reopen/spam does not
// re-query; bounded to keep the module map small.
const DETAIL_CACHE_TTL = 30_000
const DETAIL_CACHE_MAX = 200
const detailCache = new Map<string, { leads: unknown[]; ts: number }>()
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TOP_MINER_BONUS_PCTS = [5, 3, 1.5] as const

type CachedResponse = {
  data: unknown
  etag: string
  ts: number
}

let cache: CachedResponse | null = null
// Single-flight: when the cache is cold/expired, many concurrent clients hitting
// the 60s boundary would each launch the full DB refresh (thundering herd). This
// coalesces them onto ONE in-progress refresh via the shared, tested helper.
const refreshState: SingleFlightState<CachedResponse> = { current: null }

async function getFreshBase(): Promise<CachedResponse> {
  if (cache && Date.now() - cache.ts < CACHE_TTL) return cache
  return runSingleFlight(refreshState, async () => {
    const data = await fetchFulfillmentData()
    const entry: CachedResponse = { data, etag: computeEtag(data), ts: Date.now() }
    cache = entry
    return entry
  })
}

function computeEtag(payload: unknown): string {
  // Weak ETag over a stable JSON serialization. SHA-1 is fine here
  // because we don't need cryptographic strength, just collision
  // resistance against accidental matches.
  const hash = createHash('sha1').update(JSON.stringify(payload)).digest('hex')
  return `W/"${hash.slice(0, 16)}"`
}

function currentRewardWeekStartUTC(now = new Date()): Date {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0))
  const day = start.getUTCDay()
  const daysSinceMonday = (day + 6) % 7
  start.setUTCDate(start.getUTCDate() - daysSinceMonday)
  return start
}

function pickField(row: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) {
    const v = row[k]
    if (v !== undefined && v !== null) return v
  }
  return undefined
}

// Shared row normalizer for both the summary refresh and the per-request detail
// endpoint: chain-canonical winner override + the stable client shape. Fields
// absent from the summary columns default (0/false/null) — only the detail
// endpoint returns them populated.
function mapConsensusRow(
  row: Record<string, unknown>,
  chainWinnerKeys: Set<string>,
) {
  const requestId = row.request_id as string
  const leadId = (row.lead_id as string | undefined) ?? ''
  const minerHotkey = (row.miner_hotkey as string | undefined) ?? ''
  const chainWinner = leadId ? chainWinnerKeys.has(`${requestId}|${leadId}`) : false
  const is_winner = chainWinnerKeys.size > 0 ? chainWinner : Boolean(row.is_winner)
  return {
    consensus_id: (row.consensus_id as string | undefined) ?? `${requestId}|${leadId}|${minerHotkey}`,
    request_id: requestId,
    miner_hotkey: minerHotkey,
    lead_id: leadId,
    is_winner,
    reward_pct: (pickField(row, 'reward_pct') as number | null | undefined) ?? null,
    computed_at: (pickField(row, 'computed_at', 'updated_at', 'created_at') as string | undefined) ?? '',
    consensus_final_score: Number(pickField(row, 'consensus_final_score', 'final_score') ?? 0),
    consensus_rep_score: Number(pickField(row, 'consensus_rep_score', 'rep_score') ?? 0),
    consensus_tier2_passed: Boolean(pickField(row, 'consensus_tier2_passed', 'tier2_passed')),
    any_fabricated: Boolean(pickField(row, 'any_fabricated', 'all_fabricated')),
    consensus_email_verified: Boolean(pickField(row, 'consensus_email_verified', 'email_verified')),
    consensus_person_verified: Boolean(pickField(row, 'consensus_person_verified', 'person_verified')),
    consensus_company_verified: Boolean(pickField(row, 'consensus_company_verified', 'company_verified')),
  }
}

// Full detail rows for ONE request, loaded when a dialog opens instead of
// shipping every request's full rows in the every-60s payload. Applies the same
// chain-canonical winner merge/override as the former inline path and returns
// rows winner-first, score-desc (the dialog's order). Briefly cached.
async function fetchRequestLeadDetail(requestId: string): Promise<unknown[]> {
  const cached = detailCache.get(requestId)
  if (cached && Date.now() - cached.ts < DETAIL_CACHE_TTL) return cached.leads

  const supabase = getSupabase()
  const [rowsResult, summaryResult] = await Promise.all([
    supabase
      .from('fulfillment_score_consensus')
      .select(CONSENSUS_COLUMNS)
      .eq('request_id', requestId)
      .order('computed_at', { ascending: false })
      .limit(2000),
    supabase.rpc('get_chain_summaries', { p_request_ids: [requestId] }),
  ])
  if (rowsResult.error) {
    console.error('[Fulfillment API] detail rows error:', rowsResult.error)
  }
  if (summaryResult.error) {
    console.error('[Fulfillment API] detail summary error:', summaryResult.error)
  }
  const base = (rowsResult.data || []) as unknown as Array<Record<string, unknown>>
  const { chainWinnerKeys, chainCanonicalRows } = reshapeChainSummaries(
    [requestId],
    (summaryResult.data || []) as ChainSummaryRow[],
  )
  const seen = new Set(base.map((r) => `${r.request_id}|${r.lead_id}`))
  const merged = [...base]
  for (const row of chainCanonicalRows) {
    const leadId = (row.lead_id as string | undefined) ?? ''
    if (!leadId || seen.has(`${requestId}|${leadId}`)) continue
    seen.add(`${requestId}|${leadId}`)
    merged.push({ ...row, request_id: requestId })
  }
  const leads = merged
    .map((row) => mapConsensusRow(row, chainWinnerKeys))
    .sort((a, b) => {
      if (a.is_winner !== b.is_winner) return a.is_winner ? -1 : 1
      return b.consensus_final_score - a.consensus_final_score
    })

  detailCache.set(requestId, { leads, ts: Date.now() })
  if (detailCache.size > DETAIL_CACHE_MAX) {
    const oldest = detailCache.keys().next().value
    if (oldest !== undefined) detailCache.delete(oldest)
  }
  return leads
}

async function fetchFulfillmentData() {
  const supabase = getSupabase()

  // Cumulative stats via DB COUNT — no row limits, always accurate.
  const [reqResult, fulfilledCountResult, recycledCountResult, totalConsensusResult, totalWinnersResult, totalDeliveredResult] = await Promise.all([
    supabase.from('fulfillment_requests')
      .select('request_id, icp_details, num_leads, window_start, window_end, status, created_at')
      .in('status', ['pending', 'open', 'continued_open', 'commit_closed', 'scoring', 'fulfilled'])
      .order('created_at', { ascending: false })
      .limit(100),
    supabase.from('fulfillment_requests')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'fulfilled'),
    supabase.from('fulfillment_requests')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'recycled'),
    supabase.from('fulfillment_score_consensus')
      .select('*', { count: 'exact', head: true }),
    supabase.from('fulfillment_score_consensus')
      .select('*', { count: 'exact', head: true })
      .eq('is_winner', true),
    supabase.from('fulfillment_score_consensus')
      .select('*', { count: 'exact', head: true })
      .or('is_winner.eq.true,is_chain_held.eq.true'),
  ])

  if (reqResult.error) console.error('[Fulfillment API] Error fetching requests:', reqResult.error)

  const activeRequests = reqResult.data || []
  const fulfilledCount = fulfilledCountResult.count ?? 0
  const recycledCount = recycledCountResult.count ?? 0
  const dbTotalConsensus = totalConsensusResult.count ?? 0
  const dbTotalWinners = totalWinnersResult.count ?? 0
  const dbTotalDelivered = totalDeliveredResult.count ?? 0

  // Fetch aggregated consensus + chain-side metadata for ALL active requests.
  const allRequestIds = activeRequests.map(r => r.request_id)
  // One row per (request, miner): every consumer of the former raw rows -- the
  // cosmos constellation, request cards, miner directory, and stat strips --
  // aggregates per (request, miner), so the database returns those aggregates
  // directly (verified byte-identical to the raw-row aggregation on live data:
  // ~10.4k raw rows -> ~715 group rows, 0 mismatches). Raw lead rows are
  // fetched only when a request dialog opens (?requestId=...).
  let consensusSummary: Array<{
    request_id: string
    miner_hotkey: string
    lead_count: number
    win_count: number
    last_computed_at: string | null
  }> = []
  if (allRequestIds.length > 0) {
    const [graphSummaryResult, chainSummariesResult] = await Promise.all([
      supabase.rpc('get_fulfillment_graph_summary', { p_request_ids: allRequestIds }),
      supabase.rpc('get_chain_summaries', { p_request_ids: allRequestIds }),
    ])

    if (graphSummaryResult.error) {
      console.error('[Fulfillment API] get_fulfillment_graph_summary error:', graphSummaryResult.error)
    }
    if (chainSummariesResult.error) {
      console.error('[Fulfillment API] get_chain_summaries error:', chainSummariesResult.error)
    }

    consensusSummary = ((graphSummaryResult.data || []) as Array<Record<string, unknown>>).map(
      (g) => ({
        request_id: String(g.request_id),
        miner_hotkey: String(g.miner_hotkey ?? ''),
        lead_count: Number(g.lead_count ?? 0),
        win_count: Number(g.win_count ?? 0),
        last_computed_at: (g.last_computed_at as string | undefined) ?? null,
      }),
    )

    // num_leads/held_count per request from the batched chain RPC.
    const { rootLeadsResults, heldResults } = reshapeChainSummaries(
      allRequestIds,
      (chainSummariesResult.data || []) as ChainSummaryRow[],
    )
    for (let i = 0; i < allRequestIds.length; i++) {
      const req = activeRequests.find(r => r.request_id === allRequestIds[i])
      if (req) {
        if (rootLeadsResults[i].data != null) req.num_leads = rootLeadsResults[i].data
        ;(req as Record<string, unknown>).held_count = heldResults[i].data || 0
      }
    }
  }
  // Cumulative stats come from DB COUNT queries above — no row limits.

  // Winner / non-winner tallies from the aggregates (no raw-row fetch).
  let fulfilledEvaluatedCount = 0
  let unfulfilledEvaluatedCount = 0
  for (const g of consensusSummary) {
    fulfilledEvaluatedCount += g.win_count
    unfulfilledEvaluatedCount += g.lead_count - g.win_count
  }
  // Rejection histogram is aggregated in SQL (get_rejection_reason_histogram)
  // instead of downloading ~12.5k fulfillment_scores rows every minute and
  // bucketing them in Node. The RPC reproduces the exact chain-winner override,
  // score-dedup, and reason-derivation -- verified byte-identical to the former
  // Node computation against live data. Falls back to the empty histogram on
  // error (the panel simply shows no breakdown, never a wrong one).
  const rejectionCounts: Record<string, number> = {}
  if (allRequestIds.length > 0) {
    const { data: histogram, error: histErr } = await supabase.rpc(
      'get_rejection_reason_histogram',
      { p_request_ids: allRequestIds },
    )
    if (histErr) {
      console.error('[Fulfillment API] get_rejection_reason_histogram error:', histErr)
    } else {
      for (const row of (histogram || []) as Array<{ reason: string; count: number }>) {
        rejectionCounts[row.reason] = Number(row.count)
      }
    }
  }
  const rejectionBreakdown = Object.entries(rejectionCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([reason, count]) => ({ reason, count }))

  // Fetch request details for any consensus rows whose request_id isn't in the
  // active set. This keeps the cosmos and dialogs able to resolve ICP details
  // even for older requests still referenced by recent scoring.
  const requestIds = new Set(consensusSummary.map(g => g.request_id))
  const requestMap: Record<string, { icp_details: unknown; num_leads: number; status: string }> = {}
  if (requestIds.size > 0) {
    const { data: allRequests } = await supabase
      .from('fulfillment_requests')
      .select('request_id, icp_details, num_leads, status')
      .in('request_id', Array.from(requestIds))
    if (allRequests) {
      for (const r of allRequests) {
        requestMap[r.request_id] = { icp_details: r.icp_details, num_leads: r.num_leads, status: r.status }
      }
    }
  }

  // Leaderboard: current reward week only. Fulfillment rewards reset every
  // Monday at 00:00 UTC, and only rows with a positive reward_pct represent
  // miners that are actually getting paid.
  const windowStart = currentRewardWeekStartUTC().toISOString()
  const { data: allWinners } = await supabase
    .from('fulfillment_score_consensus')
    .select('miner_hotkey, reward_pct, computed_at')
    .eq('is_winner', true)
    .gt('reward_pct', 0)
    .gte('computed_at', windowStart)
    .order('computed_at', { ascending: false })
    .limit(LEADERBOARD_ROW_LIMIT)

  const { data: bannedHotkeys } = await supabase
    .from('banned_hotkeys')
    .select('hotkey')

  const bannedSet = new Set((bannedHotkeys || []).map(b => b.hotkey))
  const minerStats: Record<string, { wins: number; totalRewardPct: number }> = {}
  for (const w of allWinners || []) {
    if (bannedSet.has(w.miner_hotkey)) continue
    if (!minerStats[w.miner_hotkey]) {
      minerStats[w.miner_hotkey] = { wins: 0, totalRewardPct: 0 }
    }
    minerStats[w.miner_hotkey].wins++
    minerStats[w.miner_hotkey].totalRewardPct += (w.reward_pct || 0)
  }
  const leaderboard = Object.entries(minerStats)
    .sort((a, b) => b[1].wins - a[1].wins || b[1].totalRewardPct - a[1].totalRewardPct)
    .slice(0, 5)
    .map(([hotkey, stats], idx) => ({
      rank: idx + 1,
      hotkey,
      wins: stats.wins,
      totalRewardPct: Math.round(stats.totalRewardPct * 10000) / 10000,
      bonusPct: TOP_MINER_BONUS_PCTS[idx] ?? 0,
    }))

  return {
    activeRequests,
    consensusSummary,
    minerScores: null,
    requestMap,
    rejectionBreakdown,
    leaderboard,
    scoreTotals: {
      passed: fulfilledEvaluatedCount,
      failed: unfulfilledEvaluatedCount,
    },
    stats: {
      activeRequestCount: activeRequests.filter(r => r.status !== 'fulfilled').length,
      totalSubmittedLeads: dbTotalConsensus,
      totalDeliveredLeads: dbTotalDelivered,
      totalConsensus: dbTotalConsensus,
      totalWinners: dbTotalWinners,
      fulfilledCount,
      recycledCount,
      // leaderboardWindowDays surfaces the window the API used so the
      // panel can honestly say "current reward week" instead of implying all-time.
      leaderboardWindowDays: LEADERBOARD_WINDOW_DAYS,
      leaderboardWindowStart: windowStart,
    }
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const minerHotkey = searchParams.get('minerHotkey')
  const requestId = searchParams.get('requestId')
  const ifNoneMatch = request.headers.get('if-none-match')

  // Per-request lead detail (dialog open): full rows for ONE request only.
  if (requestId) {
    if (!UUID_RE.test(requestId)) {
      return NextResponse.json({ success: false, error: 'invalid requestId' }, { status: 400 })
    }
    try {
      const leads = await fetchRequestLeadDetail(requestId)
      return NextResponse.json(
        { success: true, leads },
        { headers: { 'Cache-Control': 'private, max-age=30' } },
      )
    } catch (err) {
      console.error('[Fulfillment API] detail error:', err)
      return NextResponse.json({ success: false, error: 'detail unavailable' }, { status: 500 })
    }
  }

  try {
    // Base data: use cache when possible. We keep the ETag alongside the data
    // so 304 responses are free when the cache is warm.
    // Fresh cache serves immediately; otherwise a single shared refresh runs
    // (concurrent callers await the same in-flight promise instead of each
    // launching their own full DB refresh).
    const baseEntry: CachedResponse =
      !minerHotkey && cache && Date.now() - cache.ts < CACHE_TTL
        ? cache
        : await getFreshBase()

    // Phase 2: ETag / 304 not-modified for base data.
    // If the client already has this exact snapshot, return 304 with no body.
    // Bandwidth on a no-change poll drops from a multi-MB payload to a few
    // hundred bytes of headers.
    if (!minerHotkey && ifNoneMatch && ifNoneMatch === baseEntry.etag) {
      return new NextResponse(null, {
        status: 304,
        headers: {
          ETag: baseEntry.etag,
          'Cache-Control': 'no-cache',
        },
      })
    }

    if (minerHotkey) {
      const base = baseEntry.data as { activeRequests: unknown[]; consensusSummary: unknown[]; minerScores: unknown; requestMap: Record<string, unknown>; stats: unknown }
      const result = { ...base, requestMap: { ...base.requestMap } }
      const supabase = getSupabase()
      const { data: scores, error: scoresError } = await supabase
        .from('fulfillment_scores')
        .select('score_id, request_id, lead_id, miner_hotkey, final_score, failure_reason, failure_detail, tier1_passed, tier2_passed, rep_score, scored_at, all_fabricated, email_verified, person_verified, company_verified')
        .eq('miner_hotkey', minerHotkey)
        .order('scored_at', { ascending: false })
        .limit(200)

      if (scoresError) console.error('[Fulfillment API] Error fetching miner scores:', scoresError)

      // Fetch request details for any miner score rows referencing requests
      // we don't already know about in the base requestMap.
      const minerRequestIds = (scores || []).map((s: { request_id: string }) => s.request_id).filter(id => !result.requestMap[id])
      if (minerRequestIds.length > 0) {
        const supabase2 = getSupabase()
        const { data: extraRequests } = await supabase2
          .from('fulfillment_requests')
          .select('request_id, icp_details, num_leads, status')
          .in('request_id', minerRequestIds)
        if (extraRequests) {
          for (const r of extraRequests) {
            result.requestMap[r.request_id] = { icp_details: r.icp_details, num_leads: r.num_leads, status: r.status }
          }
        }
      }

      return NextResponse.json({
        success: true,
        data: { ...result, minerScores: scores || [] }
      })
    }

    return NextResponse.json(
      { success: true, data: baseEntry.data },
      {
        headers: {
          ETag: baseEntry.etag,
          'Cache-Control': 'no-cache',
        },
      },
    )
  } catch (error) {
    console.error('[Fulfillment API] Error:', error)
    return NextResponse.json({ success: false, error: 'Failed to fetch fulfillment data' }, { status: 500 })
  }
}
