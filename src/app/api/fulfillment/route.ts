import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SECRET_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  return createClient(url, key, { auth: { persistSession: false } })
}

export async function GET(request: NextRequest) {
  const supabase = getSupabase()
  const { searchParams } = request.nextUrl
  const minerHotkey = searchParams.get('minerHotkey')

  try {
    // Fetch active requests (status = 'open')
    const { data: activeRequests, error: reqError } = await supabase
      .from('fulfillment_requests')
      .select('request_id, icp_details, num_leads, window_start, window_end, status, created_at')
      .in('status', ['open', 'commit_closed', 'scoring'])
      .order('created_at', { ascending: false })
      .limit(100)

    if (reqError) {
      console.error('[Fulfillment API] Error fetching requests:', reqError)
    }

    // Fetch fulfilled and recycled counts
    const { data: allRequests2 } = await supabase
      .from('fulfillment_requests')
      .select('status')
      .limit(1000)

    const fulfilledCount = (allRequests2 || []).filter(r => r.status === 'fulfilled').length
    const recycledCount = (allRequests2 || []).filter(r => r.status === 'recycled').length

    // Fetch all consensus results with request details
    const { data: consensusData, error: consError } = await supabase
      .from('fulfillment_score_consensus')
      .select('consensus_id, request_id, miner_hotkey, lead_id, consensus_final_score, consensus_rep_score, consensus_tier2_passed, is_winner, reward_pct, computed_at, any_fabricated, consensus_email_verified, consensus_person_verified, consensus_company_verified')
      .order('computed_at', { ascending: false })
      .limit(500)

    if (consError) {
      console.error('[Fulfillment API] Error fetching consensus:', consError)
    }

    // Fetch miner-specific rejection reasons if minerHotkey provided
    let minerScores = null
    if (minerHotkey) {
      const { data: scores, error: scoresError } = await supabase
        .from('fulfillment_scores')
        .select('score_id, request_id, lead_id, miner_hotkey, final_score, failure_reason, tier1_passed, tier2_passed, rep_score, scored_at, all_fabricated, email_verified, person_verified, company_verified')
        .eq('miner_hotkey', minerHotkey)
        .order('scored_at', { ascending: false })
        .limit(200)

      if (scoresError) {
        console.error('[Fulfillment API] Error fetching miner scores:', scoresError)
      }
      minerScores = scores || []
    }

    // Fetch all requests for joining with consensus
    const requestIds = new Set([
      ...(consensusData || []).map(c => c.request_id),
      ...(minerScores || []).map((s: { request_id: string }) => s.request_id),
    ])

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

    // Build response
    const winners = (consensusData || []).filter(c => c.is_winner)
    const allConsensus = (consensusData || [])

    return NextResponse.json({
      success: true,
      data: {
        activeRequests: activeRequests || [],
        winners,
        allConsensus,
        minerScores,
        requestMap,
        stats: {
          activeRequestCount: (activeRequests || []).length,
          totalConsensus: allConsensus.length,
          totalWinners: winners.length,
          fulfilledCount,
          recycledCount,
        }
      }
    })
  } catch (error) {
    console.error('[Fulfillment API] Error:', error)
    return NextResponse.json({ success: false, error: 'Failed to fetch fulfillment data' }, { status: 500 })
  }
}
