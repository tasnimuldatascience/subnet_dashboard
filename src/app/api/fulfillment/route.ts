import { createClient } from '@supabase/supabase-js'
import { createHash } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'

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
//  2. `allConsensus` is now bounded by CONSENSUS_ROW_LIMIT with an
//     explicit ORDER BY computed_at DESC, so we degrade gracefully to
//     "most recent N" rather than timing out as the table grows.
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
const CONSENSUS_ROW_LIMIT = 25_000
const SCORE_ROW_BATCH_SIZE = 1000
const TOP_MINER_BONUS_PCTS = [5, 3, 1.5] as const

type CachedResponse = {
  data: unknown
  etag: string
  ts: number
}

type ScoreReasonRow = {
  request_id: string
  lead_id: string
  failure_reason: string | null
  failure_detail: string | null
  scored_at: string | null
}

let cache: CachedResponse | null = null

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

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}


async function fetchScoreReasonsForRequests(
  supabase: ReturnType<typeof getSupabase>,
  requestIds: string[],
): Promise<Map<string, ScoreReasonRow>> {
  const scoreByLead = new Map<string, ScoreReasonRow>()
  for (const group of chunks(requestIds, 25)) {
    for (let offset = 0; ; offset += SCORE_ROW_BATCH_SIZE) {
      const { data, error } = await supabase
        .from('fulfillment_scores')
        .select('request_id, lead_id, failure_reason, failure_detail, scored_at')
        .in('request_id', group)
        .order('scored_at', { ascending: false })
        .range(offset, offset + SCORE_ROW_BATCH_SIZE - 1)

      if (error) {
        console.error('[Fulfillment API] score reason query failed:', error)
        break
      }

      const batch = (data ?? []) as ScoreReasonRow[]
      for (const row of batch) {
        const key = `${row.request_id}|${row.lead_id}`
        const prev = scoreByLead.get(key)
        if (!prev) {
          scoreByLead.set(key, row)
          continue
        }
        const prevHasReason = Boolean(prev.failure_reason || prev.failure_detail)
        const rowHasReason = Boolean(row.failure_reason || row.failure_detail)
        if (!prevHasReason && rowHasReason) scoreByLead.set(key, row)
      }

      if (batch.length < SCORE_ROW_BATCH_SIZE) break
    }
  }
  return scoreByLead
}

function rejectionReasonFromScore(row: ScoreReasonRow | undefined): string {
  const reason = row?.failure_reason?.trim()
  if (reason) return reason

  const detail = row?.failure_detail?.toLowerCase() ?? ''
  if (detail.includes('intent')) return 'insufficient_intent'
  if (detail.includes('geography') || detail.includes('location')) return 'geography_mismatch'
  if (detail.includes('role')) return 'role_mismatch'
  if (detail.includes('industry')) return 'industry_mismatch'
  if (detail.includes('country')) return 'country_mismatch'
  if (detail.includes('email')) return 'truelist_inline_verification'

  return 'not_selected'
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

  // Fetch consensus data + chain-side metadata for ALL active requests.
  const allRequestIds = activeRequests.map(r => r.request_id)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let consensusData: any[] = []
  if (allRequestIds.length > 0) {
    // 1) Pull consensus rows (winners and non-winners) for visible requests
    //    from `fulfillment_score_consensus`. `get_chain_winners` only returns
    //    canonical winners, which would give an artificial 100% win-rate.
    //    Capped by CONSENSUS_ROW_LIMIT with a stable ORDER BY so the response
    //    degrades to "most recent" rather than timing out at scale.
    // 2) Pull chain-side num_leads + held_count metadata in parallel.
    const [scoreConsensusResult, chainWinnersResults, rootLeadsResults, heldResults] = await Promise.all([
      supabase
        .from('fulfillment_score_consensus')
        .select('*')
        .in('request_id', allRequestIds)
        .order('computed_at', { ascending: false })
        .limit(CONSENSUS_ROW_LIMIT),
      Promise.all(allRequestIds.map(rid =>
        supabase.rpc('get_chain_winners', { fulfilled_id: rid })
      )),
      Promise.all(allRequestIds.map(rid =>
        supabase.rpc('get_chain_root_num_leads', { fulfilled_id: rid })
      )),
      Promise.all(allRequestIds.map(rid =>
        supabase.rpc('get_chain_held_count', { target_id: rid })
      )),
    ])

    if (scoreConsensusResult.error) {
      console.error('[Fulfillment API] score_consensus error:', scoreConsensusResult.error)
    }

    // Build a set of (request_id, lead_id) for chain-canonical winners; used to
    // override is_winner when the off-chain consensus disagrees with the chain.
    // Also build a lead_id -> visible request_id map so we can pull in
    // consensus rows that live under earlier/later cycles of the same chain
    // (recycled fulfillment requests share a chain but use different
    // request_ids, so a per-rid query alone misses them).
    const chainWinnerKeys = new Set<string>()
    const leadIdToVisibleRid = new Map<string, string>()
    for (let i = 0; i < chainWinnersResults.length; i++) {
      const { data, error } = chainWinnersResults[i]
      if (error) console.error(`[Fulfillment API] Chain winners error for ${allRequestIds[i]}:`, error)
      for (const row of (data || []) as Array<{ lead_id?: string }>) {
        if (!row.lead_id) continue
        chainWinnerKeys.add(`${allRequestIds[i]}|${row.lead_id}`)
        // First-claim wins. A lead_id should only attach to one visible
        // request in this response.
        if (!leadIdToVisibleRid.has(row.lead_id)) {
          leadIdToVisibleRid.set(row.lead_id, allRequestIds[i])
        }
      }
    }

    // Pull chain-canonical winners' consensus rows even when their actual
    // request_id is from another cycle in the chain. Without this the
    // dialog only shows leads scored under the visible request_id, which
    // for a recycled chain can be far fewer than the chain's num_leads.
    // Batch in groups of 100 to avoid Supabase default row limit (1000)
    // and .in() value limits.
    const chainCanonicalRows: Array<Record<string, unknown>> = []
    const allChainLeadIds = Array.from(leadIdToVisibleRid.keys())
    if (allChainLeadIds.length > 0) {
      for (let i = 0; i < allChainLeadIds.length; i += 100) {
        const batch = allChainLeadIds.slice(i, i + 100)
        const { data: chainData, error: chainErr } = await supabase
          .from('fulfillment_score_consensus')
          .select('*')
          .in('lead_id', batch)
          .eq('is_winner', true)
          .limit(1000)
        if (chainErr) {
          console.error('[Fulfillment API] chain canonical consensus error:', chainErr)
        } else {
          chainCanonicalRows.push(...((chainData || []) as Array<Record<string, unknown>>))
        }
      }
    }

    // Use score_consensus rows as the primary consensus dataset, with is_winner
    // overridden by the chain-canonical set when chain data is available.
    // Normalize column names so the client receives a stable shape regardless
    // of whether the table uses `consensus_*` or un-prefixed column names.
    const rawConsensusBase = scoreConsensusResult.data || []
    // Merge in chain-canonical winners that aren't already represented under
    // the visible request_id, rewriting their request_id to the visible rid
    // so they show up in the dialog. Dedup by (visibleRid, lead_id).
    const seenKeys = new Set<string>(
      rawConsensusBase.map((r) => `${r.request_id}|${r.lead_id}`),
    )
    const supplemental: Array<Record<string, unknown>> = []
    for (const row of chainCanonicalRows) {
      const leadId = (row.lead_id as string | undefined) ?? ''
      if (!leadId) continue
      const visibleRid = leadIdToVisibleRid.get(leadId)
      if (!visibleRid) continue
      const key = `${visibleRid}|${leadId}`
      if (seenKeys.has(key)) continue
      seenKeys.add(key)
      supplemental.push({ ...row, request_id: visibleRid })
    }
    const rawConsensus = [...rawConsensusBase, ...supplemental]
    const pick = (row: Record<string, unknown>, ...keys: string[]): unknown => {
      for (const k of keys) {
        const v = row[k]
        if (v !== undefined && v !== null) return v
      }
      return undefined
    }
    consensusData = rawConsensus.map((row: Record<string, unknown>) => {
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
        reward_pct: (pick(row, 'reward_pct') as number | null | undefined) ?? null,
        computed_at: (pick(row, 'computed_at', 'updated_at', 'created_at') as string | undefined) ?? '',
        consensus_final_score: Number(pick(row, 'consensus_final_score', 'final_score') ?? 0),
        consensus_rep_score: Number(pick(row, 'consensus_rep_score', 'rep_score') ?? 0),
        consensus_tier2_passed: Boolean(pick(row, 'consensus_tier2_passed', 'tier2_passed')),
        any_fabricated: Boolean(pick(row, 'any_fabricated', 'all_fabricated')),
        consensus_email_verified: Boolean(pick(row, 'consensus_email_verified', 'email_verified')),
        consensus_person_verified: Boolean(pick(row, 'consensus_person_verified', 'person_verified')),
        consensus_company_verified: Boolean(pick(row, 'consensus_company_verified', 'company_verified')),
      }
    })

    // Override num_leads with chain root value and add held count.
    for (let i = 0; i < allRequestIds.length; i++) {
      const req = activeRequests.find(r => r.request_id === allRequestIds[i])
      if (req) {
        if (rootLeadsResults[i].data != null) req.num_leads = rootLeadsResults[i].data
        ;(req as Record<string, unknown>).held_count = heldResults[i].data || 0
      }
    }
  }
  // Cumulative stats come from DB COUNT queries above — no row limits.

  const rejectionRequestIds = Array.from(new Set(consensusData.map(c => c.request_id)))
  const scoreByLead = await fetchScoreReasonsForRequests(supabase, rejectionRequestIds)
  const rejectionCounts: Record<string, number> = {}
  let fulfilledEvaluatedCount = 0
  let unfulfilledEvaluatedCount = 0
  for (const c of consensusData) {
    if (c.is_winner) {
      fulfilledEvaluatedCount++
    } else {
      unfulfilledEvaluatedCount++
      const reason = rejectionReasonFromScore(scoreByLead.get(`${c.request_id}|${c.lead_id}`))
      rejectionCounts[reason] = (rejectionCounts[reason] || 0) + 1
    }
  }
  const rejectionBreakdown = Object.entries(rejectionCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([reason, count]) => ({ reason, count }))

  // Fetch request details for any consensus rows whose request_id isn't in the
  // active set. This keeps the cosmos and dialogs able to resolve ICP details
  // even for older requests still referenced by recent scoring.
  const requestIds = new Set(consensusData.map(c => c.request_id))
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
    allConsensus: consensusData,
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
  const ifNoneMatch = request.headers.get('if-none-match')

  try {
    // Base data: use cache when possible. We keep the ETag alongside the data
    // so 304 responses are free when the cache is warm.
    let baseEntry: CachedResponse
    if (!minerHotkey && cache && Date.now() - cache.ts < CACHE_TTL) {
      baseEntry = cache
    } else if (!minerHotkey) {
      const data = await fetchFulfillmentData()
      baseEntry = { data, etag: computeEtag(data), ts: Date.now() }
      cache = baseEntry
    } else {
      // Miner search. Reuse cached base when fresh; otherwise refresh it.
      if (cache && Date.now() - cache.ts < CACHE_TTL) {
        baseEntry = cache
      } else {
        const data = await fetchFulfillmentData()
        baseEntry = { data, etag: computeEtag(data), ts: Date.now() }
        cache = baseEntry
      }
    }

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
      const base = baseEntry.data as { activeRequests: unknown[]; allConsensus: unknown[]; minerScores: unknown; requestMap: Record<string, unknown>; stats: unknown }
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
