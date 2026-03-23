import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { fetchMetagraph } from '@/lib/metagraph'
import { cleanRejectionReason } from '@/lib/utils-rejection'

// Request coalescing: track in-flight searches to prevent duplicate DB queries
// Key = search params string, Value = promise of the search
const inFlightSearches = new Map<string, Promise<SearchResult[]>>()

interface SearchResult {
  emailHash: string
  minerHotkey: string
  coldkey: string | null
  leadId: string | null
  uid: number | null
  epochId: number | null
  decision: 'ACCEPTED' | 'REJECTED' | 'PENDING'
  repScore: number | null
  rejectionReason: string | null
  timestamp: string
}

// Normalize decision values
function normalizeDecision(decision: string | undefined): 'ACCEPTED' | 'REJECTED' | 'PENDING' {
  if (!decision) return 'PENDING'
  const lower = decision.toLowerCase()
  if (['deny', 'denied', 'reject', 'rejected'].includes(lower)) return 'REJECTED'
  if (['allow', 'allowed', 'accept', 'accepted', 'approve', 'approved'].includes(lower)) return 'ACCEPTED'
  return 'PENDING'
}

// The actual search logic - extracted to enable coalescing
async function performSearch(
  uid: string | null,
  epoch: string | null,
  leadId: string | null,
  hotkeys: string[] | null,
  limit: number
): Promise<SearchResult[]> {
  const startTime = Date.now()

  // Fetch metagraph for hotkey->uid mapping
  const metagraph = await fetchMetagraph()
  if (!metagraph) {
    throw new Error('Failed to fetch metagraph')
  }

  const hotkeyToUid = metagraph.hotkeyToUid
  const uidToHotkey = metagraph.uidToHotkey
  const hotkeyToColdkey = metagraph.hotkeyToColdkey
  const results: SearchResult[] = []

  // Strategy: Query the most selective filter first
  if (epoch && epoch !== 'all') {
      // EPOCH FILTER: Query CONSENSUS_RESULT first (has epoch_id), then get submissions
      const epochNum = parseInt(epoch, 10)

      // Get consensus results for this epoch with batched fetching
      const BATCH_SIZE = 1000
      // Build consensus maps: by lead_id (preferred) and by email_hash (fallback)
      const consensusByLeadId = new Map<string, { epochId: number, decision: string, repScore: number | null, rejectionReason: string | null }>()
      const consensusByHash = new Map<string, { epochId: number, decision: string, repScore: number | null, rejectionReason: string | null }>()
      const consensusEmailHashes = new Set<string>()
      let offset = 0
      let hasMore = true

      while (hasMore && consensusByHash.size < limit * 2) {
        const { data: consensusData, error: consError } = await supabase
          .from('transparency_log')
          .select('email_hash, payload')
          .eq('event_type', 'CONSENSUS_RESULT')
          .not('email_hash', 'is', null)
          .eq('payload->>epoch_id', epochNum.toString())
          .range(offset, offset + BATCH_SIZE - 1)

        if (consError) {
          console.error('[Lead Search API] Consensus query error:', consError)
          throw new Error('Database query failed')
        }

        if (!consensusData || consensusData.length === 0) {
          hasMore = false
          break
        }

        for (const c of consensusData) {
          if (!c.email_hash) continue
          const p = c.payload as { lead_id?: string, epoch_id?: number, final_decision?: string, final_rep_score?: number, is_icp_multiplier?: number, primary_rejection_reason?: string }
          const entry = {
            epochId: p?.epoch_id ?? epochNum,
            decision: p?.final_decision ?? '',
            repScore: p?.final_rep_score != null ? Math.max(0, p.final_rep_score + (p.is_icp_multiplier ?? 0)) : null,
            rejectionReason: cleanRejectionReason(p?.primary_rejection_reason)
          }
          if (p?.lead_id && !consensusByLeadId.has(p.lead_id)) {
            consensusByLeadId.set(p.lead_id, entry)
          }
          if (!consensusByHash.has(c.email_hash)) {
            consensusByHash.set(c.email_hash, entry)
          }
          consensusEmailHashes.add(c.email_hash)
        }

        if (consensusData.length < BATCH_SIZE) {
          hasMore = false
        } else {
          offset += BATCH_SIZE
        }
      }

      console.log(`[Lead Search API] Fetched ${consensusByHash.size} consensus results for epoch ${epochNum}`)

      if (consensusByHash.size === 0) {
        return []
      }

      // Get submissions for these email hashes (in batches of 50)
      const emailHashes = Array.from(consensusEmailHashes)
      const allSubs: { email_hash: string, hotkey: string, leadId: string | null, ts: string }[] = []
      const seenLeadIds = new Set<string>()

      // Get target hotkey if UID filter specified
      const targetHotkey = (uid && uid !== 'all') ? uidToHotkey[parseInt(uid, 10)] : null

      for (let i = 0; i < emailHashes.length && allSubs.length < limit; i += 50) {
        const batch = emailHashes.slice(i, i + 50)

        let subQuery = supabase
          .from('transparency_log')
          .select('email_hash, actor_hotkey, payload, ts')
          .eq('event_type', 'SUBMISSION')
          .not('email_hash', 'is', null)
          .in('email_hash', batch)

        if (targetHotkey) {
          subQuery = subQuery.eq('actor_hotkey', targetHotkey)
        }

        if (leadId && leadId.trim()) {
          // Search both email_hash (exact) and lead_id (partial)
          subQuery = subQuery.or(`email_hash.eq.${leadId.trim()},payload->>lead_id.ilike.%${leadId.trim()}%`)
        }

        const { data: subData, error: subError } = await subQuery

        if (subError) {
          console.error('[Lead Search API] Submission batch error:', subError)
          continue
        }

        if (subData) {
          for (const sub of subData) {
            if (!sub.email_hash) continue
            const payload = sub.payload as { lead_id?: string }
            const lid = payload?.lead_id
            const dedupKey = lid || `${sub.email_hash}:${sub.ts}`
            if (seenLeadIds.has(dedupKey)) continue
            seenLeadIds.add(dedupKey)
            allSubs.push({
              email_hash: sub.email_hash,
              hotkey: sub.actor_hotkey,
              leadId: lid ?? null,
              ts: sub.ts
            })
          }
        }
      }

      // Build results — match consensus by lead_id first
      for (const sub of allSubs) {
        const uidVal = hotkeyToUid[sub.hotkey]
        if (uidVal === undefined) continue // Skip inactive miners

        const cons = sub.leadId
          ? (consensusByLeadId.get(sub.leadId) ?? null)
          : (consensusByHash.get(sub.email_hash) ?? null)
        if (!cons) continue

        results.push({
          emailHash: sub.email_hash,
          minerHotkey: sub.hotkey,
          coldkey: hotkeyToColdkey[sub.hotkey] || null,
          leadId: sub.leadId,
          uid: uidVal,
          epochId: cons.epochId,
          decision: normalizeDecision(cons.decision),
          repScore: cons.repScore,
          rejectionReason: cons.rejectionReason,
          timestamp: sub.ts
        })

        if (results.length >= limit) break
      }

    } else if (uid && uid !== 'all') {
      // UID FILTER: Query SUBMISSION first with batched fetching to bypass 1000 limit
      const targetHotkey = uidToHotkey[parseInt(uid, 10)]
      if (!targetHotkey) {
        return []
      }

      // Fetch submissions in batches of 1000 using range() to bypass Supabase limit
      const BATCH_SIZE = 1000
      const allSubs: { email_hash: string, actor_hotkey: string, payload: unknown, ts: string }[] = []
      const seenLeadIds = new Set<string>()
      let offset = 0
      let hasMore = true

      while (hasMore && allSubs.length < limit * 2) {
        let subQuery = supabase
          .from('transparency_log')
          .select('email_hash, actor_hotkey, payload, ts')
          .eq('event_type', 'SUBMISSION')
          .eq('actor_hotkey', targetHotkey)
          .not('email_hash', 'is', null)
          .order('ts', { ascending: false })
          .range(offset, offset + BATCH_SIZE - 1)

        if (leadId && leadId.trim()) {
          // Search both email_hash (exact) and lead_id (partial)
          subQuery = subQuery.or(`email_hash.eq.${leadId.trim()},payload->>lead_id.ilike.%${leadId.trim()}%`)
        }

        const { data: subData, error: subError } = await subQuery

        if (subError) {
          console.error('[Lead Search API] Submission batch error:', subError)
          break
        }

        if (!subData || subData.length === 0) {
          hasMore = false
          break
        }

        // Keep each unique lead_id (same email_hash can have multiple submissions)
        for (const sub of subData) {
          if (!sub.email_hash) continue
          const lid = (sub.payload as { lead_id?: string })?.lead_id
          const dedupKey = lid || `${sub.email_hash}:${sub.ts}`
          if (seenLeadIds.has(dedupKey)) continue
          seenLeadIds.add(dedupKey)
          allSubs.push(sub)
        }

        // If we got fewer than batch size, no more data
        if (subData.length < BATCH_SIZE) {
          hasMore = false
        } else {
          offset += BATCH_SIZE
        }
      }

      console.log(`[Lead Search API] Fetched ${allSubs.length} submissions for UID ${uid}`)

      if (allSubs.length === 0) {
        return []
      }

      // Get consensus for these email hashes (in batches of 50 for .in() clause)
      // Index by lead_id so each submission matches its own consensus
      const consensusByLeadId = new Map<string, { epochId: number | null, decision: string, repScore: number | null, rejectionReason: string | null }>()
      const consensusByHash = new Map<string, { epochId: number | null, decision: string, repScore: number | null, rejectionReason: string | null }>()
      const uniqueHashes = new Set(allSubs.map(s => s.email_hash))
      const hashes = Array.from(uniqueHashes)

      for (let i = 0; i < hashes.length; i += 50) {
        const batch = hashes.slice(i, i + 50)
        const { data: consData } = await supabase
          .from('transparency_log')
          .select('email_hash, payload')
          .eq('event_type', 'CONSENSUS_RESULT')
          .in('email_hash', batch)

        if (consData) {
          for (const c of consData) {
            if (!c.email_hash) continue
            const p = c.payload as { lead_id?: string, epoch_id?: number, final_decision?: string, final_rep_score?: number, is_icp_multiplier?: number, primary_rejection_reason?: string }
            const entry = {
              epochId: p?.epoch_id ?? null,
              decision: p?.final_decision ?? '',
              repScore: p?.final_rep_score != null ? Math.max(0, p.final_rep_score + (p.is_icp_multiplier ?? 0)) : null,
              rejectionReason: cleanRejectionReason(p?.primary_rejection_reason)
            }
            if (p?.lead_id) {
              consensusByLeadId.set(p.lead_id, entry)
            }
            consensusByHash.set(c.email_hash, entry)
          }
        }
      }

      // Build results
      const uidVal = parseInt(uid, 10)
      for (const sub of allSubs) {
        const payload = sub.payload as { lead_id?: string }
        // If submission has a lead_id, only match consensus for that specific lead_id
        // (don't fall back to email_hash — that would pick up old rejections from prior submissions)
        const cons = payload?.lead_id
          ? consensusByLeadId.get(payload.lead_id) ?? null
          : consensusByHash.get(sub.email_hash) ?? null

        results.push({
          emailHash: sub.email_hash,
          minerHotkey: sub.actor_hotkey,
          coldkey: hotkeyToColdkey[sub.actor_hotkey] || null,
          leadId: payload?.lead_id ?? null,
          uid: uidVal,
          epochId: cons?.epochId ?? null,
          decision: cons ? normalizeDecision(cons.decision) : 'PENDING',
          repScore: cons?.repScore ?? null,
          rejectionReason: cons?.rejectionReason ?? null,
          timestamp: sub.ts
        })

        if (results.length >= limit) break
      }

    } else if (leadId && leadId.trim()) {
      // LEAD ID / EMAIL HASH SEARCH: Query SUBMISSION by lead_id OR email_hash with batched fetching
      const searchTerm = leadId.trim()
      const BATCH_SIZE = 1000
      const seenLeadIds = new Set<string>()
      const allSubs: { email_hash: string, actor_hotkey: string, payload: unknown, ts: string }[] = []

      // First, try exact email_hash match (faster)
      const { data: emailHashData, error: emailHashError } = await supabase
        .from('transparency_log')
        .select('email_hash, actor_hotkey, payload, ts')
        .eq('event_type', 'SUBMISSION')
        .eq('email_hash', searchTerm)
        .order('ts', { ascending: false })
        .limit(limit)

      if (!emailHashError && emailHashData && emailHashData.length > 0) {
        console.log(`[Lead Search API] Found ${emailHashData.length} results by email_hash`)
        for (const sub of emailHashData) {
          if (!sub.email_hash) continue
          const lid = (sub.payload as { lead_id?: string })?.lead_id
          const dedupKey = lid || `${sub.email_hash}:${sub.ts}`
          if (seenLeadIds.has(dedupKey)) continue
          seenLeadIds.add(dedupKey)
          allSubs.push(sub)
        }
      }

      // If no email_hash results or fewer than limit, also search by lead_id
      if (allSubs.length < limit) {
        const isExactUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(searchTerm)

        if (isExactUuid) {
          // Exact UUID: use JSONB containment (@>) — keep query minimal to avoid timeout
          const { data: subData, error: subError } = await supabase
            .from('transparency_log')
            .select('email_hash, actor_hotkey, payload, ts')
            .eq('event_type', 'SUBMISSION')
            .contains('payload', { lead_id: searchTerm })
            .limit(limit)

          if (subError) {
            console.error('[Lead Search API] Submission containment error:', subError)
          } else if (subData) {
            for (const sub of subData) {
              if (!sub.email_hash) continue
              const lid = (sub.payload as { lead_id?: string })?.lead_id
              const dedupKey = lid || `${sub.email_hash}:${sub.ts}`
              if (seenLeadIds.has(dedupKey)) continue
              seenLeadIds.add(dedupKey)
              allSubs.push(sub)
            }
          }
        } else {
          // Partial match: paginate with ilike
          let offset = 0
          let hasMore = true

          while (hasMore && allSubs.length < limit) {
            const { data: subData, error: subError } = await supabase
              .from('transparency_log')
              .select('email_hash, actor_hotkey, payload, ts')
              .eq('event_type', 'SUBMISSION')
              .not('email_hash', 'is', null)
              .ilike('payload->>lead_id', `%${searchTerm}%`)
              .order('ts', { ascending: false })
              .range(offset, offset + BATCH_SIZE - 1)

            if (subError) {
              console.error('[Lead Search API] Submission batch error:', subError)
              break
            }

            if (!subData || subData.length === 0) {
              hasMore = false
              break
            }

            for (const sub of subData) {
              if (!sub.email_hash) continue
              const lid = (sub.payload as { lead_id?: string })?.lead_id
              const dedupKey = lid || `${sub.email_hash}:${sub.ts}`
              if (seenLeadIds.has(dedupKey)) continue
              seenLeadIds.add(dedupKey)
              allSubs.push(sub)
            }

            if (subData.length < BATCH_SIZE) {
              hasMore = false
            } else {
              offset += BATCH_SIZE
            }
          }
        }
      }

      if (allSubs.length === 0) {
        return []
      }

      // Get consensus for email hashes (in batches of 50)
      // Use a map keyed by lead_id to match consensus to the correct submission
      const uniqueHashes = new Set(allSubs.map(s => s.email_hash))
      const hashes = Array.from(uniqueHashes)
      const consensusByLeadId = new Map<string, { epochId: number | null, decision: string, repScore: number | null, rejectionReason: string | null }>()
      const consensusByHash = new Map<string, { epochId: number | null, decision: string, repScore: number | null, rejectionReason: string | null }>()

      for (let i = 0; i < hashes.length; i += 50) {
        const batch = hashes.slice(i, i + 50)
        const { data: consData } = await supabase
          .from('transparency_log')
          .select('email_hash, payload')
          .eq('event_type', 'CONSENSUS_RESULT')
          .in('email_hash', batch)

        if (consData) {
          for (const c of consData) {
            if (!c.email_hash) continue
            const p = c.payload as { lead_id?: string, epoch_id?: number, final_decision?: string, final_rep_score?: number, is_icp_multiplier?: number, primary_rejection_reason?: string }
            const entry = {
              epochId: p?.epoch_id ?? null,
              decision: p?.final_decision ?? '',
              repScore: p?.final_rep_score != null ? Math.max(0, p.final_rep_score + (p.is_icp_multiplier ?? 0)) : null,
              rejectionReason: cleanRejectionReason(p?.primary_rejection_reason)
            }
            // Index by lead_id for precise matching
            if (p?.lead_id) {
              consensusByLeadId.set(p.lead_id, entry)
            }
            // Fallback: index by email_hash (last one wins)
            consensusByHash.set(c.email_hash, entry)
          }
        }
      }

      // Build results (don't skip inactive miners for lead_id searches — user is looking up a specific lead)
      for (const sub of allSubs) {
        const uidVal = hotkeyToUid[sub.actor_hotkey] ?? null

        const payload = sub.payload as { lead_id?: string }
        // Match consensus by lead_id first, fall back to email_hash
        // If submission has a lead_id, only match consensus for that specific lead_id
        // (don't fall back to email_hash — that would pick up old rejections from prior submissions)
        const cons = payload?.lead_id
          ? consensusByLeadId.get(payload.lead_id) ?? null
          : consensusByHash.get(sub.email_hash) ?? null

        results.push({
          emailHash: sub.email_hash,
          minerHotkey: sub.actor_hotkey,
          coldkey: hotkeyToColdkey[sub.actor_hotkey] || null,
          leadId: payload?.lead_id ?? null,
          uid: uidVal,
          epochId: cons?.epochId ?? null,
          decision: cons ? normalizeDecision(cons.decision) : 'PENDING',
          repScore: cons?.repScore ?? null,
          rejectionReason: cons?.rejectionReason ?? null,
          timestamp: sub.ts
        })

        if (results.length >= limit) break
      }
    } else if (hotkeys && hotkeys.length > 0) {
      // HOTKEYS FILTER (for coldkey search): Query by multiple hotkeys
      const BATCH_SIZE = 1000
      const allSubs: { email_hash: string, actor_hotkey: string, payload: unknown, ts: string }[] = []
      const seenLeadIds = new Set<string>()

      // Fetch submissions for each hotkey
      for (const hotkey of hotkeys) {
        if (allSubs.length >= limit * 2) break

        let offset = 0
        let hasMore = true

        while (hasMore && allSubs.length < limit * 2) {
          const { data: subData, error: subError } = await supabase
            .from('transparency_log')
            .select('email_hash, actor_hotkey, payload, ts')
            .eq('event_type', 'SUBMISSION')
            .eq('actor_hotkey', hotkey)
            .not('email_hash', 'is', null)
            .order('ts', { ascending: false })
            .range(offset, offset + BATCH_SIZE - 1)

          if (subError) {
            console.error('[Lead Search API] Submission batch error:', subError)
            break
          }

          if (!subData || subData.length === 0) {
            hasMore = false
            break
          }

          for (const sub of subData) {
            if (!sub.email_hash) continue
            const lid = (sub.payload as { lead_id?: string })?.lead_id
            const dedupKey = lid || `${sub.email_hash}:${sub.ts}`
            if (seenLeadIds.has(dedupKey)) continue
            seenLeadIds.add(dedupKey)
            allSubs.push(sub)
          }

          if (subData.length < BATCH_SIZE) {
            hasMore = false
          } else {
            offset += BATCH_SIZE
          }
        }
      }

      console.log(`[Lead Search API] Fetched ${allSubs.length} submissions for ${hotkeys.length} hotkeys`)

      if (allSubs.length === 0) {
        return []
      }

      // Get consensus for email hashes (in batches of 50)
      // Index by lead_id so each submission matches its own consensus
      const uniqueHashes = new Set(allSubs.map(s => s.email_hash))
      const hashes = Array.from(uniqueHashes)
      const consensusByLeadId = new Map<string, { epochId: number | null, decision: string, repScore: number | null, rejectionReason: string | null }>()
      const consensusByHash = new Map<string, { epochId: number | null, decision: string, repScore: number | null, rejectionReason: string | null }>()

      for (let i = 0; i < hashes.length; i += 50) {
        const batch = hashes.slice(i, i + 50)
        const { data: consData } = await supabase
          .from('transparency_log')
          .select('email_hash, payload')
          .eq('event_type', 'CONSENSUS_RESULT')
          .in('email_hash', batch)

        if (consData) {
          for (const c of consData) {
            if (!c.email_hash) continue
            const p = c.payload as { lead_id?: string, epoch_id?: number, final_decision?: string, final_rep_score?: number, is_icp_multiplier?: number, primary_rejection_reason?: string }
            const entry = {
              epochId: p?.epoch_id ?? null,
              decision: p?.final_decision ?? '',
              repScore: p?.final_rep_score != null ? Math.max(0, p.final_rep_score + (p.is_icp_multiplier ?? 0)) : null,
              rejectionReason: cleanRejectionReason(p?.primary_rejection_reason)
            }
            if (p?.lead_id) {
              consensusByLeadId.set(p.lead_id, entry)
            }
            consensusByHash.set(c.email_hash, entry)
          }
        }
      }

      // Build results (sorted by timestamp)
      allSubs.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())

      for (const sub of allSubs) {
        const uidVal = hotkeyToUid[sub.actor_hotkey]
        if (uidVal === undefined) continue // Skip inactive miners

        const payload = sub.payload as { lead_id?: string }
        // If submission has a lead_id, only match consensus for that specific lead_id
        // (don't fall back to email_hash — that would pick up old rejections from prior submissions)
        const cons = payload?.lead_id
          ? consensusByLeadId.get(payload.lead_id) ?? null
          : consensusByHash.get(sub.email_hash) ?? null

        results.push({
          emailHash: sub.email_hash,
          minerHotkey: sub.actor_hotkey,
          coldkey: hotkeyToColdkey[sub.actor_hotkey] || null,
          leadId: payload?.lead_id ?? null,
          uid: uidVal,
          epochId: cons?.epochId ?? null,
          decision: cons ? normalizeDecision(cons.decision) : 'PENDING',
          repScore: cons?.repScore ?? null,
          rejectionReason: cons?.rejectionReason ?? null,
          timestamp: sub.ts
        })

        if (results.length >= limit) break
      }
    }

  const elapsed = Date.now() - startTime
  console.log(`[Lead Search API] Found ${results.length} results in ${elapsed}ms`)

  return results
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const uid = searchParams.get('uid')
    const epoch = searchParams.get('epoch')
    const leadId = searchParams.get('leadId')
    const hotkeysParam = searchParams.get('hotkeys')
    const hotkeys = hotkeysParam ? hotkeysParam.split(',').filter(h => h.trim()) : null
    const limit = Math.min(parseInt(searchParams.get('limit') || '10000', 10), 50000)

    // Need at least one filter
    if (!uid && !epoch && !leadId && (!hotkeys || hotkeys.length === 0)) {
      return NextResponse.json(
        { error: 'At least one filter (uid, epoch, leadId, or hotkeys) is required' },
        { status: 400 }
      )
    }

    // Create cache key from search params
    const cacheKey = `${uid || ''}-${epoch || ''}-${leadId || ''}-${hotkeysParam || ''}-${limit}`

    console.log(`[Lead Search API] Searching: uid=${uid}, epoch=${epoch}, leadId=${leadId}, hotkeys=${hotkeys?.length || 0}`)

    // Check if identical search is already in-flight
    if (inFlightSearches.has(cacheKey)) {
      console.log(`[Lead Search API] Coalescing request for: ${cacheKey}`)
      const results = await inFlightSearches.get(cacheKey)!
      return NextResponse.json({
        results,
        total: results.length,
        returned: results.length,
      })
    }

    // Start new search and track it
    const searchPromise = performSearch(uid, epoch, leadId, hotkeys, limit)
    inFlightSearches.set(cacheKey, searchPromise)

    try {
      const results = await searchPromise
      const hasMore = results.length >= limit
      return NextResponse.json({
        results,
        total: results.length,
        returned: results.length,
        hasMore,
      })
    } finally {
      // Clean up after search completes (success or error)
      inFlightSearches.delete(cacheKey)
    }
  } catch (error) {
    console.error('[Lead Search API] Error:', error)
    return NextResponse.json(
      { error: 'Failed to search leads' },
      { status: 500 }
    )
  }
}
