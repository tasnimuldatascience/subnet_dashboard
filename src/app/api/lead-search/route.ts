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
  const results: SearchResult[] = []

  // Strategy: Query the most selective filter first
  if (epoch && epoch !== 'all') {
      // EPOCH FILTER: Query CONSENSUS_RESULT first (has epoch_id), then get submissions
      const epochNum = parseInt(epoch, 10)

      // Get consensus results for this epoch with batched fetching
      const BATCH_SIZE = 1000
      const consensusMap = new Map<string, { epochId: number, decision: string, repScore: number | null, rejectionReason: string | null }>()
      let offset = 0
      let hasMore = true

      while (hasMore && consensusMap.size < limit * 2) {
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
          if (!c.email_hash || consensusMap.has(c.email_hash)) continue
          const p = c.payload as { epoch_id?: number, final_decision?: string, final_rep_score?: number, primary_rejection_reason?: string }
          consensusMap.set(c.email_hash, {
            epochId: p?.epoch_id ?? epochNum,
            decision: p?.final_decision ?? '',
            repScore: p?.final_rep_score ?? null,
            rejectionReason: cleanRejectionReason(p?.primary_rejection_reason)
          })
        }

        if (consensusData.length < BATCH_SIZE) {
          hasMore = false
        } else {
          offset += BATCH_SIZE
        }
      }

      console.log(`[Lead Search API] Fetched ${consensusMap.size} consensus results for epoch ${epochNum}`)

      if (consensusMap.size === 0) {
        return []
      }

      // Get submissions for these email hashes (in batches of 50)
      const emailHashes = Array.from(consensusMap.keys())
      const submissionMap = new Map<string, { hotkey: string, leadId: string | null, ts: string }>()

      // Get target hotkey if UID filter specified
      const targetHotkey = (uid && uid !== 'all') ? uidToHotkey[parseInt(uid, 10)] : null

      for (let i = 0; i < emailHashes.length && submissionMap.size < limit; i += 50) {
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
          subQuery = subQuery.ilike('payload->>lead_id', `%${leadId.trim()}%`)
        }

        const { data: subData, error: subError } = await subQuery

        if (subError) {
          console.error('[Lead Search API] Submission batch error:', subError)
          continue
        }

        if (subData) {
          for (const sub of subData) {
            if (!sub.email_hash || submissionMap.has(sub.email_hash)) continue
            const payload = sub.payload as { lead_id?: string }
            submissionMap.set(sub.email_hash, {
              hotkey: sub.actor_hotkey,
              leadId: payload?.lead_id ?? null,
              ts: sub.ts
            })
          }
        }
      }

      // Merge results from submissionMap and consensusMap
      for (const [emailHash, sub] of submissionMap) {
        const uidVal = hotkeyToUid[sub.hotkey]
        if (uidVal === undefined) continue // Skip inactive miners

        const cons = consensusMap.get(emailHash)
        if (!cons) continue

        results.push({
          emailHash,
          minerHotkey: sub.hotkey,
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
      const seenHashes = new Set<string>()
      const allSubs: { email_hash: string, actor_hotkey: string, payload: unknown, ts: string }[] = []
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
          subQuery = subQuery.ilike('payload->>lead_id', `%${leadId.trim()}%`)
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

        // Deduplicate while collecting
        for (const sub of subData) {
          if (!sub.email_hash || seenHashes.has(sub.email_hash)) continue
          seenHashes.add(sub.email_hash)
          allSubs.push(sub)
        }

        // If we got fewer than batch size, no more data
        if (subData.length < BATCH_SIZE) {
          hasMore = false
        } else {
          offset += BATCH_SIZE
        }
      }

      console.log(`[Lead Search API] Fetched ${allSubs.length} unique submissions for UID ${uid}`)

      if (allSubs.length === 0) {
        return []
      }

      // Get consensus for these email hashes (in batches of 50 for .in() clause)
      const consensusMap = new Map<string, { epochId: number | null, decision: string, repScore: number | null, rejectionReason: string | null }>()
      const hashes = Array.from(seenHashes)

      for (let i = 0; i < hashes.length; i += 50) {
        const batch = hashes.slice(i, i + 50)
        const { data: consData } = await supabase
          .from('transparency_log')
          .select('email_hash, payload')
          .eq('event_type', 'CONSENSUS_RESULT')
          .in('email_hash', batch)

        if (consData) {
          for (const c of consData) {
            if (!c.email_hash || consensusMap.has(c.email_hash)) continue
            const p = c.payload as { epoch_id?: number, final_decision?: string, final_rep_score?: number, primary_rejection_reason?: string }
            consensusMap.set(c.email_hash, {
              epochId: p?.epoch_id ?? null,
              decision: p?.final_decision ?? '',
              repScore: p?.final_rep_score ?? null,
              rejectionReason: cleanRejectionReason(p?.primary_rejection_reason)
            })
          }
        }
      }

      // Build results
      const uidVal = parseInt(uid, 10)
      for (const sub of allSubs) {
        const cons = consensusMap.get(sub.email_hash)
        const payload = sub.payload as { lead_id?: string }

        results.push({
          emailHash: sub.email_hash,
          minerHotkey: sub.actor_hotkey,
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
      // LEAD ID SEARCH: Query SUBMISSION by lead_id with batched fetching
      const BATCH_SIZE = 1000
      const seenHashes = new Set<string>()
      const allSubs: { email_hash: string, actor_hotkey: string, payload: unknown, ts: string }[] = []
      let offset = 0
      let hasMore = true

      while (hasMore && allSubs.length < limit) {
        const { data: subData, error: subError } = await supabase
          .from('transparency_log')
          .select('email_hash, actor_hotkey, payload, ts')
          .eq('event_type', 'SUBMISSION')
          .not('email_hash', 'is', null)
          .ilike('payload->>lead_id', `%${leadId.trim()}%`)
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

        // Deduplicate while collecting
        for (const sub of subData) {
          if (!sub.email_hash || seenHashes.has(sub.email_hash)) continue
          seenHashes.add(sub.email_hash)
          allSubs.push(sub)
        }

        if (subData.length < BATCH_SIZE) {
          hasMore = false
        } else {
          offset += BATCH_SIZE
        }
      }

      if (allSubs.length === 0) {
        return []
      }

      // Get consensus for email hashes (in batches of 50)
      const hashes = Array.from(seenHashes)
      const consensusMap = new Map<string, { epochId: number | null, decision: string, repScore: number | null, rejectionReason: string | null }>()

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
            const p = c.payload as { epoch_id?: number, final_decision?: string, final_rep_score?: number, primary_rejection_reason?: string }
            consensusMap.set(c.email_hash, {
              epochId: p?.epoch_id ?? null,
              decision: p?.final_decision ?? '',
              repScore: p?.final_rep_score ?? null,
              rejectionReason: cleanRejectionReason(p?.primary_rejection_reason)
            })
          }
        }
      }

      // Build results
      for (const sub of allSubs) {
        const uidVal = hotkeyToUid[sub.actor_hotkey]
        if (uidVal === undefined) continue // Skip inactive miners

        const cons = consensusMap.get(sub.email_hash)
        const payload = sub.payload as { lead_id?: string }

        results.push({
          emailHash: sub.email_hash,
          minerHotkey: sub.actor_hotkey,
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
    const limit = Math.min(parseInt(searchParams.get('limit') || '10000', 10), 50000)

    // Need at least one filter
    if (!uid && !epoch && !leadId) {
      return NextResponse.json(
        { error: 'At least one filter (uid, epoch, or leadId) is required' },
        { status: 400 }
      )
    }

    // Create cache key from search params
    const cacheKey = `${uid || ''}-${epoch || ''}-${leadId || ''}-${limit}`

    console.log(`[Lead Search API] Searching: uid=${uid}, epoch=${epoch}, leadId=${leadId}`)

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
    const searchPromise = performSearch(uid, epoch, leadId, limit)
    inFlightSearches.set(cacheKey, searchPromise)

    try {
      const results = await searchPromise
      return NextResponse.json({
        results,
        total: results.length,
        returned: results.length,
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
