import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SECRET_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  return createClient(url, key, { auth: { persistSession: false } })
}

// Light cache — only stores the JSON response, expires after 60s
let cache: { data: unknown; ts: number } | null = null
const CACHE_TTL = 60_000

async function fetchFulfillmentData() {
  const supabase = getSupabase()

  const [reqResult, countResult, scoresResult] = await Promise.all([
    supabase.from('fulfillment_requests')
      .select('request_id, icp_details, num_leads, window_start, window_end, status, created_at')
      .in('status', ['pending', 'open', 'commit_closed', 'scoring', 'fulfilled'])
      .order('created_at', { ascending: false })
      .limit(100),
    supabase.from('fulfillment_requests')
      .select('status')
      .limit(1000),
    supabase.from('fulfillment_scores')
      .select('failure_reason')
      .order('scored_at', { ascending: false })
      .limit(500),
  ])

  if (reqResult.error) console.error('[Fulfillment API] Error fetching requests:', reqResult.error)

  const activeRequests = reqResult.data || []
  const allCounts = countResult.data || []
  const allScores = scoresResult.data || []

  // Fetch consensus for fulfilled requests specifically
  const fulfilledRequestIds = activeRequests.filter(r => r.status === 'fulfilled').map(r => r.request_id)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let consensusData: any[] = []
  if (fulfilledRequestIds.length > 0) {
    const { data: consData, error: consError } = await supabase
      .from('fulfillment_score_consensus')
      .select('consensus_id, request_id, miner_hotkey, lead_id, consensus_final_score, consensus_rep_score, consensus_tier2_passed, is_winner, reward_pct, computed_at, any_fabricated, consensus_email_verified, consensus_person_verified, consensus_company_verified')
      .in('request_id', fulfilledRequestIds)
      .order('consensus_final_score', { ascending: false })
      .limit(500)
    if (consError) console.error('[Fulfillment API] Error fetching consensus:', consError)
    consensusData = consData || []
  }
  const fulfilledCount = allCounts.filter(r => r.status === 'fulfilled').length
  const recycledCount = allCounts.filter(r => r.status === 'recycled').length

  const rejectionCounts: Record<string, number> = {}
  let passedCount = 0
  for (const s of allScores) {
    if (s.failure_reason) {
      rejectionCounts[s.failure_reason] = (rejectionCounts[s.failure_reason] || 0) + 1
    } else {
      passedCount++
    }
  }
  const rejectionBreakdown = Object.entries(rejectionCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([reason, count]) => ({ reason, count }))

  // Fetch request details for consensus joins
  const requestIds = new Set(consensusData.map(c => c.request_id))
  let requestMap: Record<string, { icp_details: unknown; num_leads: number; status: string }> = {}
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

  const winners = consensusData.filter(c => c.is_winner)

  return {
    activeRequests,
    winners,
    allConsensus: consensusData,
    minerScores: null,
    requestMap,
    rejectionBreakdown,
    scoreTotals: { passed: passedCount, failed: allScores.length - passedCount },
    stats: {
      activeRequestCount: activeRequests.filter(r => r.status !== 'fulfilled').length,
      totalConsensus: consensusData.length,
      totalWinners: winners.length,
      fulfilledCount,
      recycledCount,
    }
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const minerHotkey = searchParams.get('minerHotkey')

  try {
    // Use cache for base data (no miner search)
    let baseData: unknown
    if (!minerHotkey && cache && Date.now() - cache.ts < CACHE_TTL) {
      baseData = cache.data
    } else if (!minerHotkey) {
      baseData = await fetchFulfillmentData()
      cache = { data: baseData, ts: Date.now() }
    } else {
      // Miner search — fetch fresh base + miner scores
      baseData = cache && Date.now() - cache.ts < CACHE_TTL
        ? cache.data
        : await fetchFulfillmentData()
      if (!cache || Date.now() - cache.ts >= CACHE_TTL) {
        cache = { data: baseData, ts: Date.now() }
      }
    }

    const result = baseData as { activeRequests: unknown[]; winners: unknown[]; allConsensus: unknown[]; minerScores: unknown; requestMap: Record<string, unknown>; stats: unknown }

    // Fetch miner scores separately (not cached — specific to each search)
    if (minerHotkey) {
      const supabase = getSupabase()
      const { data: scores, error: scoresError } = await supabase
        .from('fulfillment_scores')
        .select('score_id, request_id, lead_id, miner_hotkey, final_score, failure_reason, tier1_passed, tier2_passed, rep_score, scored_at, all_fabricated, email_verified, person_verified, company_verified')
        .eq('miner_hotkey', minerHotkey)
        .order('scored_at', { ascending: false })
        .limit(200)

      if (scoresError) console.error('[Fulfillment API] Error fetching miner scores:', scoresError)

      // Fetch request details for miner scores
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

    return NextResponse.json({ success: true, data: result })
  } catch (error) {
    console.error('[Fulfillment API] Error:', error)
    return NextResponse.json({ success: false, error: 'Failed to fetch fulfillment data' }, { status: 500 })
  }
}
