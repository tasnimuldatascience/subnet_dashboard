import { NextResponse } from 'next/server'
import { fetchMetagraph } from '@/lib/metagraph'
import { supabase } from '@/lib/supabase'
import { cleanRejectionReason } from '@/lib/utils-rejection'

// Normalize decision values
function normalizeDecision(decision: string | undefined): 'ACCEPTED' | 'REJECTED' | 'PENDING' {
  if (!decision) return 'PENDING'
  const lower = decision.toLowerCase()
  if (['deny', 'denied', 'reject', 'rejected'].includes(lower)) return 'REJECTED'
  if (['allow', 'allowed', 'accept', 'accepted', 'approve', 'approved'].includes(lower)) return 'ACCEPTED'
  return 'PENDING'
}

interface LatestLead {
  emailHash: string
  minerHotkey: string
  uid: number | null
  leadId: string | null
  timestamp: string
  epochId: number | null
  decision: 'ACCEPTED' | 'REJECTED' | 'PENDING'
  repScore: number | null
  rejectionReason: string | null
}

export async function GET() {
  try {
    console.log('[Latest Leads API] Fetching data...')

    // Fetch metagraph first (needed for UID mapping and filtering)
    const metagraph = await fetchMetagraph()
    const hotkeyToUid = metagraph?.hotkeyToUid || {}
    const activeMiners = metagraph ? new Set(Object.keys(metagraph.hotkeyToUid)) : null

    // Fetch latest 150 CONSENSUS_RESULT events (extra to account for filtering)
    const { data: consensusData, error: consError } = await supabase
      .from('transparency_log')
      .select('ts, email_hash, payload')
      .eq('event_type', 'CONSENSUS_RESULT')
      .not('email_hash', 'is', null)
      .order('ts', { ascending: false })
      .limit(150)

    if (consError) {
      console.error('[Latest Leads API] Error fetching consensus:', consError)
      return NextResponse.json({ error: 'Database query failed' }, { status: 500 })
    }

    if (!consensusData || consensusData.length === 0) {
      return NextResponse.json({ leads: [], count: 0, fetchedAt: Date.now() })
    }

    const emailHashes = consensusData.map(c => c.email_hash).filter(Boolean)

    // Fetch submissions for lead_id and miner hotkey
    const { data: submissionData } = await supabase
      .from('transparency_log')
      .select('email_hash, actor_hotkey, ts, payload')
      .eq('event_type', 'SUBMISSION')
      .in('email_hash', emailHashes)

    const submissionMap = new Map<string, { lead_id?: string; actor_hotkey?: string; ts?: string }>()
    if (submissionData) {
      for (const row of submissionData) {
        if (!row.email_hash || submissionMap.has(row.email_hash)) continue
        const payload = row.payload as { lead_id?: string } | null
        submissionMap.set(row.email_hash, {
          lead_id: payload?.lead_id,
          actor_hotkey: row.actor_hotkey,
          ts: row.ts,
        })
      }
    }

    // Build leads
    const leads: LatestLead[] = []
    for (const cons of consensusData) {
      if (leads.length >= 100) break

      const submission = submissionMap.get(cons.email_hash)
      const minerHotkey = submission?.actor_hotkey || ''

      // Filter by active miners if metagraph available
      if (activeMiners && !activeMiners.has(minerHotkey)) continue

      const payload = cons.payload as {
        lead_id?: string
        epoch_id?: number
        final_decision?: string
        final_rep_score?: number
        is_icp_multiplier?: number
        primary_rejection_reason?: string
      } | null

      leads.push({
        emailHash: cons.email_hash,
        minerHotkey,
        uid: hotkeyToUid[minerHotkey] ?? null,
        leadId: payload?.lead_id || submission?.lead_id || null,
        timestamp: submission?.ts || cons.ts,
        epochId: payload?.epoch_id ?? null,
        decision: normalizeDecision(payload?.final_decision),
        repScore: payload?.final_rep_score != null ? Math.max(0, payload.final_rep_score + (payload.is_icp_multiplier ?? 0)) : null,
        rejectionReason: payload?.primary_rejection_reason ? cleanRejectionReason(payload.primary_rejection_reason) : null,
      })
    }

    console.log(`[Latest Leads API] Fetched ${leads.length} latest leads`)

    const response = NextResponse.json({
      leads,
      count: leads.length,
      fetchedAt: Date.now(),
    })

    // Short HTTP cache
    response.headers.set(
      'Cache-Control',
      'public, max-age=60, stale-while-revalidate=30'
    )

    return response
  } catch (error) {
    console.error('[Latest Leads API] Error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch latest leads' },
      { status: 500 }
    )
  }
}
