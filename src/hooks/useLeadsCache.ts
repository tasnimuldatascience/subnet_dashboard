'use client'

import { useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

export interface CachedLead {
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

interface FetchPageResult {
  data: CachedLead[]
  nextCursor: string | null
  hasMore: boolean
  totalCount?: number
}

interface UseLeadsQueryOptions {
  hotkeyToUid?: Record<string, number>
}

interface FetchOptions {
  cursor?: string | null
  uid?: string
  epochId?: string
  searchQuery?: string
  uidOptions?: Array<{ uid: number; hotkey: string }>
  includeCount?: boolean
}

interface UseLeadsQueryReturn {
  fetchPage: (options: FetchOptions) => Promise<FetchPageResult>
  fetchEpochsForUid: (hotkey: string) => Promise<number[]>
  fetchUidsForEpoch: (epochId: number, uidOptions: Array<{ uid: number; hotkey: string }>) => Promise<number[]>
  searchByLeadId: (leadId: string, hotkeyToUid: Record<string, number>) => Promise<CachedLead[]>
  isFetching: boolean
}

// Normalize decision values
function normalizeDecision(decision: string | undefined): 'ACCEPTED' | 'REJECTED' | 'PENDING' {
  if (!decision) return 'PENDING'
  const lower = decision.toLowerCase()
  if (['deny', 'denied', 'reject', 'rejected'].includes(lower)) return 'REJECTED'
  if (['allow', 'allowed', 'accept', 'accepted', 'approve', 'approved'].includes(lower)) return 'ACCEPTED'
  return 'PENDING'
}

const PAGE_SIZE = 100

export function useLeadsQuery(options: UseLeadsQueryOptions = {}): UseLeadsQueryReturn {
  const { hotkeyToUid = {} } = options
  const [isFetching, setIsFetching] = useState(false)

  const fetchPage = useCallback(async (queryOptions: FetchOptions): Promise<FetchPageResult> => {
    console.log('[LeadsQuery] fetchPage called with:', {
      uid: queryOptions.uid,
      epochId: queryOptions.epochId,
      cursor: queryOptions.cursor ? 'yes' : 'no',
      searchQuery: queryOptions.searchQuery,
      uidOptionsCount: queryOptions.uidOptions?.length,
    })
    setIsFetching(true)

    try {
      const { cursor, uid, epochId, searchQuery, uidOptions, includeCount } = queryOptions
      const hasUidFilter = uid && uid !== 'all' && uidOptions

      // Get the hotkey for UID filter
      let filterHotkey: string | null = null
      if (hasUidFilter) {
        const uidNum = parseInt(uid, 10)
        const uidOption = uidOptions!.find(o => o.uid === uidNum)
        filterHotkey = uidOption?.hotkey || null
      }

      const hasEpochFilter = epochId && epochId !== 'all'

      // Strategy depends on which filters are active:
      // - UID only: Query submissions by actor_hotkey, then get consensus
      // - UID + Epoch: Query consensus by epoch first, then filter by miner's submissions
      // - Epoch only or neither: Handled in else branch below

      if (filterHotkey) {
        // UID selected (with or without epoch) - query submissions by miner first, then filter by epoch client-side
        const epochNum = hasEpochFilter ? parseInt(epochId, 10) : null
        console.log('[LeadsQuery] Fetching with UID filter:', { filterHotkey, epochNum })

        // Get total count if requested (only when no epoch filter, since we can't count accurately with epoch)
        let totalCount: number | undefined
        if (includeCount && !cursor && epochNum === null) {
          const { count } = await supabase
            .from('transparency_log')
            .select('*', { count: 'exact', head: true })
            .eq('event_type', 'SUBMISSION')
            .eq('actor_hotkey', filterHotkey)
            .not('email_hash', 'is', null)
          totalCount = count ?? undefined
        }

        let leads: CachedLead[] = []
        let lastSubmissionTs: string | null = null

        if (epochNum !== null) {
          // With epoch filter - need to iterate through submissions to find the epoch
          const MAX_ITERATIONS = 30
          const BATCH_SIZE = 500
          let iterCursor = cursor
          let rawFetched = 0

          console.log('[LeadsQuery] Starting iterative search for UID+Epoch:', { epochNum })

          for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
            let subQuery = supabase
              .from('transparency_log')
              .select('ts, email_hash, actor_hotkey, payload')
              .eq('event_type', 'SUBMISSION')
              .eq('actor_hotkey', filterHotkey)
              .not('email_hash', 'is', null)
              .order('ts', { ascending: false })
              .limit(BATCH_SIZE)

            if (iterCursor) {
              subQuery = subQuery.lt('ts', iterCursor)
            }

            const { data: submissions, error: subError } = await subQuery

            if (subError || !submissions || submissions.length === 0) {
              console.log('[LeadsQuery] No more submissions in iteration', iter)
              break
            }

            rawFetched += submissions.length
            lastSubmissionTs = submissions[submissions.length - 1].ts

            const emailHashes = submissions.map(s => s.email_hash).filter(Boolean)

            // Get consensus results for these email_hashes
            const consensusMap = new Map<string, {
              epoch_id?: number
              final_decision?: string
              final_rep_score?: number
              primary_rejection_reason?: string
              lead_id?: string
            }>()

            // Batch the consensus queries
            const CONS_BATCH = 100
            for (let i = 0; i < emailHashes.length; i += CONS_BATCH) {
              const batch = emailHashes.slice(i, i + CONS_BATCH)
              const { data: consensusData } = await supabase
                .from('transparency_log')
                .select('email_hash, payload')
                .eq('event_type', 'CONSENSUS_RESULT')
                .in('email_hash', batch)

              if (consensusData) {
                for (const row of consensusData) {
                  if (!row.email_hash) continue
                  const p = row.payload as {
                    epoch_id?: number | string
                    final_decision?: string
                    final_rep_score?: number
                    primary_rejection_reason?: string
                    lead_id?: string
                  } | null
                  let epochIdVal: number | undefined
                  if (p?.epoch_id !== undefined && p?.epoch_id !== null) {
                    epochIdVal = typeof p.epoch_id === 'string' ? parseInt(p.epoch_id, 10) : p.epoch_id
                  }
                  consensusMap.set(row.email_hash, {
                    epoch_id: epochIdVal,
                    final_decision: p?.final_decision,
                    final_rep_score: p?.final_rep_score,
                    primary_rejection_reason: p?.primary_rejection_reason,
                    lead_id: p?.lead_id,
                  })
                }
              }
            }

            // Build and filter leads for this batch
            const batchLeads = submissions
              .map(sub => {
                const cons = consensusMap.get(sub.email_hash)
                const subPayload = sub.payload as { lead_id?: string } | null
                return {
                  emailHash: sub.email_hash,
                  minerHotkey: sub.actor_hotkey,
                  uid: hotkeyToUid[sub.actor_hotkey] ?? null,
                  leadId: cons?.lead_id || subPayload?.lead_id || null,
                  timestamp: sub.ts,
                  epochId: cons?.epoch_id ?? null,
                  decision: normalizeDecision(cons?.final_decision),
                  repScore: cons?.final_rep_score ?? null,
                  rejectionReason: cons?.primary_rejection_reason ?? null,
                }
              })
              .filter(lead => lead.epochId === epochNum)

            leads.push(...batchLeads)
            console.log('[LeadsQuery] UID+Epoch iteration', iter, ': found', batchLeads.length, 'matches, total:', leads.length, 'rawFetched:', rawFetched)

            // If we have enough results, stop
            if (leads.length >= PAGE_SIZE + 1) {
              console.log('[LeadsQuery] Found enough results for UID+Epoch')
              break
            }

            // Move cursor for next iteration
            iterCursor = lastSubmissionTs
          }

          console.log('[LeadsQuery] UID+Epoch search complete: found', leads.length, 'from', rawFetched, 'submissions')
          // Don't estimate count for epoch filtering - it's unreliable
        } else {
          // No epoch filter - simple query
          const fetchLimit = PAGE_SIZE + 1

          let subQuery = supabase
            .from('transparency_log')
            .select('ts, email_hash, actor_hotkey, payload')
            .eq('event_type', 'SUBMISSION')
            .eq('actor_hotkey', filterHotkey)
            .not('email_hash', 'is', null)
            .order('ts', { ascending: false })
            .limit(fetchLimit)

          if (cursor) {
            subQuery = subQuery.lt('ts', cursor)
          }

          const { data: submissions, error: subError } = await subQuery

          if (subError || !submissions || submissions.length === 0) {
            console.log('[LeadsQuery] No submissions found for miner')
            return { data: [], nextCursor: null, hasMore: false, totalCount }
          }

          console.log('[LeadsQuery] Found submissions:', submissions.length)
          lastSubmissionTs = submissions[submissions.length - 1].ts

          const emailHashes = submissions.map(s => s.email_hash).filter(Boolean)

          // Get consensus results for these email_hashes
          const BATCH_SIZE = 50
          const consensusMap = new Map<string, {
            epoch_id?: number
            final_decision?: string
            final_rep_score?: number
            primary_rejection_reason?: string
            lead_id?: string
          }>()

          for (let i = 0; i < emailHashes.length; i += BATCH_SIZE) {
            const batch = emailHashes.slice(i, i + BATCH_SIZE)
            const { data: consensusData } = await supabase
              .from('transparency_log')
              .select('email_hash, payload')
              .eq('event_type', 'CONSENSUS_RESULT')
              .in('email_hash', batch)

            if (consensusData) {
              for (const row of consensusData) {
                if (!row.email_hash) continue
                const p = row.payload as {
                  epoch_id?: number | string
                  final_decision?: string
                  final_rep_score?: number
                  primary_rejection_reason?: string
                  lead_id?: string
                } | null
                let epochIdVal: number | undefined
                if (p?.epoch_id !== undefined && p?.epoch_id !== null) {
                  epochIdVal = typeof p.epoch_id === 'string' ? parseInt(p.epoch_id, 10) : p.epoch_id
                }
                consensusMap.set(row.email_hash, {
                  epoch_id: epochIdVal,
                  final_decision: p?.final_decision,
                  final_rep_score: p?.final_rep_score,
                  primary_rejection_reason: p?.primary_rejection_reason,
                  lead_id: p?.lead_id,
                })
              }
            }
          }

          console.log('[LeadsQuery] Found consensus results:', consensusMap.size)

          // Build leads from submissions + consensus
          leads = submissions.map(sub => {
            const cons = consensusMap.get(sub.email_hash)
            const subPayload = sub.payload as { lead_id?: string } | null

            return {
              emailHash: sub.email_hash,
              minerHotkey: sub.actor_hotkey,
              uid: hotkeyToUid[sub.actor_hotkey] ?? null,
              leadId: cons?.lead_id || subPayload?.lead_id || null,
              timestamp: sub.ts,
              epochId: cons?.epoch_id ?? null,
              decision: normalizeDecision(cons?.final_decision),
              repScore: cons?.final_rep_score ?? null,
              rejectionReason: cons?.primary_rejection_reason ?? null,
            }
          })
        }

        // Apply search filter
        if (searchQuery) {
          const q = searchQuery.toLowerCase()
          leads = leads.filter(lead => lead.leadId?.toLowerCase().includes(q))
        }

        // Handle pagination
        const hasMore = leads.length > PAGE_SIZE
        const pageLeads = leads.slice(0, PAGE_SIZE)

        const nextCursor = hasMore && lastSubmissionTs
          ? lastSubmissionTs
          : null

        return { data: pageLeads, nextCursor, hasMore, totalCount }

      } else {
        // No UID filter - query CONSENSUS_RESULT directly
        // For epoch filter, we fetch iteratively to find older epochs
        let totalCount: number | undefined
        const hasEpochFilterHere = epochId && epochId !== 'all'
        const epochNumHere = hasEpochFilterHere ? parseInt(epochId, 10) : null

        console.log('[LeadsQuery] Fetching without UID filter:', { epochNum: epochNumHere })

        if (includeCount && !cursor && epochNumHere === null) {
          // Only count when no epoch filter (epoch filter count would be slow)
          const { count } = await supabase
            .from('transparency_log')
            .select('*', { count: 'exact', head: true })
            .eq('event_type', 'CONSENSUS_RESULT')
            .not('email_hash', 'is', null)
          totalCount = count ?? undefined
        }

        let filteredConsensus: Array<{ ts: string; email_hash: string; payload: unknown; actor_hotkey?: string }> = []

        if (epochNumHere !== null) {
          // Iterative search for epoch - search through data to find the epoch
          console.log('[LeadsQuery] Starting epoch search for epoch:', epochNumHere)

          const BATCH_SIZE = 1000
          let iterCursor = cursor
          let rawFetched = 0
          let lastBatchTs: string | null = null
          let consecutiveEmptyBatches = 0
          let iteration = 0

          while (true) {
            let iterQuery = supabase
              .from('transparency_log')
              .select('ts, email_hash, payload, actor_hotkey')
              .eq('event_type', 'CONSENSUS_RESULT')
              .not('email_hash', 'is', null)
              .order('ts', { ascending: false })
              .limit(BATCH_SIZE)

            if (iterCursor) {
              iterQuery = iterQuery.lt('ts', iterCursor)
            }

            const { data: batchData, error } = await iterQuery

            if (error) {
              console.error('[LeadsQuery] Error in batch fetch:', error)
              break
            }

            if (!batchData || batchData.length === 0) {
              console.log('[LeadsQuery] No more data in iteration', iteration)
              break
            }

            rawFetched += batchData.length
            lastBatchTs = batchData[batchData.length - 1].ts

            // Log progress every 10 iterations
            if (iteration % 10 === 0 && iteration > 0) {
              console.log('[LeadsQuery] Progress: iteration', iteration, ', rawFetched:', rawFetched, ', matches:', filteredConsensus.length)
            }

            // Filter for epoch
            const filtered = batchData.filter(c => {
              const p = c.payload as { epoch_id?: number | string } | null
              if (!p?.epoch_id) return false
              const epochVal = typeof p.epoch_id === 'string' ? parseInt(p.epoch_id, 10) : p.epoch_id
              return epochVal === epochNumHere
            })

            filteredConsensus.push(...filtered)

            if (filtered.length === 0) {
              consecutiveEmptyBatches++
              // Only stop if we found results and then had many empty batches
              if (consecutiveEmptyBatches > 15 && filteredConsensus.length > 0) {
                console.log('[LeadsQuery] No more matches after', consecutiveEmptyBatches, 'empty batches')
                break
              }
            } else {
              consecutiveEmptyBatches = 0
              console.log('[LeadsQuery] Found', filtered.length, 'matches in iteration', iteration, ', total:', filteredConsensus.length)
            }

            if (filteredConsensus.length >= PAGE_SIZE + 1) {
              console.log('[LeadsQuery] Found enough results, stopping')
              break
            }

            iterCursor = lastBatchTs
            iteration++
          }
          console.log('[LeadsQuery] Epoch search complete: found', filteredConsensus.length, 'from', rawFetched, 'raw results')
        } else {
          // No epoch filter - simple fetch
          const fetchLimit = PAGE_SIZE + 1

          let query = supabase
            .from('transparency_log')
            .select('ts, email_hash, payload')
            .eq('event_type', 'CONSENSUS_RESULT')
            .not('email_hash', 'is', null)
            .order('ts', { ascending: false })
            .limit(fetchLimit)

          if (cursor) {
            query = query.lt('ts', cursor)
          }

          const { data: consensusData, error: fetchError } = await query

          if (fetchError) {
            console.error('[LeadsQuery] Error fetching consensus:', fetchError)
            return { data: [], nextCursor: null, hasMore: false, totalCount }
          }

          console.log('[LeadsQuery] Fetched consensus results:', consensusData?.length || 0)

          if (!consensusData || consensusData.length === 0) {
            return { data: [], nextCursor: null, hasMore: false, totalCount }
          }

          filteredConsensus = consensusData
        }

        // Check if there's more data beyond the current page
        const hasMore = filteredConsensus.length > PAGE_SIZE
        const pageData = filteredConsensus.slice(0, PAGE_SIZE)
        const emailHashes = pageData.map(c => c.email_hash).filter(Boolean)

        // If no results found for the epoch, return empty
        if (emailHashes.length === 0) {
          console.log('[LeadsQuery] No results for epoch filter, returning empty')
          return { data: [], nextCursor: null, hasMore: false, totalCount: 0 }
        }

        // Fetch submissions for lead_id and actor_hotkey (miner)
        // Batch the requests to avoid hitting limits
        const submissionMap = new Map<string, { lead_id?: string; actor_hotkey?: string; ts?: string }>()
        const BATCH_SIZE = 100

        for (let i = 0; i < emailHashes.length; i += BATCH_SIZE) {
          const batch = emailHashes.slice(i, i + BATCH_SIZE)
          const { data: submissionData } = await supabase
            .from('transparency_log')
            .select('email_hash, actor_hotkey, ts, payload')
            .eq('event_type', 'SUBMISSION')
            .in('email_hash', batch)

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
        }

        console.log('[LeadsQuery] Found submissions for', submissionMap.size, 'of', emailHashes.length, 'leads')

        // Build leads
        let leads: CachedLead[] = pageData.map(cons => {
          const submission = submissionMap.get(cons.email_hash)
          const payload = cons.payload as {
            lead_id?: string
            epoch_id?: number
            final_decision?: string
            final_rep_score?: number
            primary_rejection_reason?: string
            actor_hotkey?: string
          } | null
          // Try to get hotkey from: 1) SUBMISSION event, 2) CONSENSUS_RESULT actor_hotkey, 3) payload
          const minerHotkey = submission?.actor_hotkey || cons.actor_hotkey || payload?.actor_hotkey || ''
          const uidVal = hotkeyToUid[minerHotkey] ?? null

          return {
            emailHash: cons.email_hash,
            minerHotkey,
            uid: uidVal,
            leadId: payload?.lead_id || submission?.lead_id || null,
            timestamp: submission?.ts || cons.ts,
            epochId: payload?.epoch_id ?? null,
            decision: normalizeDecision(payload?.final_decision),
            repScore: payload?.final_rep_score ?? null,
            rejectionReason: payload?.primary_rejection_reason ?? null,
          }
        })

        // Filter to only leads from active miners (those in the metagraph)
        leads = leads.filter(lead => lead.minerHotkey && lead.uid !== null)
        console.log('[LeadsQuery] Filtered to', leads.length, 'leads from active miners')

        // Apply search query filter
        if (searchQuery) {
          const q = searchQuery.toLowerCase()
          leads = leads.filter(lead => lead.leadId?.toLowerCase().includes(q))
        }

        const nextCursor = hasMore && pageData.length > 0
          ? pageData[pageData.length - 1].ts
          : null

        return { data: leads, nextCursor, hasMore, totalCount }
      }
    } catch (err) {
      console.error('[LeadsQuery] Error:', err)
      return { data: [], nextCursor: null, hasMore: false }
    } finally {
      setIsFetching(false)
    }
  }, [hotkeyToUid])

  // Fetch available epochs for a specific UID (miner hotkey)
  const fetchEpochsForUid = useCallback(async (hotkey: string): Promise<number[]> => {
    try {
      console.log('[LeadsQuery] Fetching epochs for hotkey:', hotkey)

      // Get recent submissions by this miner (limit to avoid timeout)
      const { data: submissions, error: subError } = await supabase
        .from('transparency_log')
        .select('email_hash')
        .eq('event_type', 'SUBMISSION')
        .eq('actor_hotkey', hotkey)
        .not('email_hash', 'is', null)
        .order('ts', { ascending: false })
        .limit(500) // Reduced limit to avoid timeout

      if (subError) {
        console.error('[LeadsQuery] Error fetching submissions:', subError)
        return []
      }

      console.log('[LeadsQuery] Found submissions:', submissions?.length || 0)

      if (!submissions || submissions.length === 0) return []

      const emailHashes = submissions.map(s => s.email_hash).filter(Boolean) as string[]

      // Batch the .in() queries (max 50 per batch for speed)
      const BATCH_SIZE = 50
      const epochs = new Set<number>()

      // Only check first few batches to find epochs quickly
      const maxBatches = Math.min(Math.ceil(emailHashes.length / BATCH_SIZE), 5)

      for (let i = 0; i < maxBatches; i++) {
        const batch = emailHashes.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE)

        const { data: consensusData, error: consError } = await supabase
          .from('transparency_log')
          .select('payload')
          .eq('event_type', 'CONSENSUS_RESULT')
          .in('email_hash', batch)

        if (consError) {
          console.error('[LeadsQuery] Error fetching consensus batch:', consError)
          continue
        }

        if (consensusData) {
          for (const row of consensusData) {
            const payload = row.payload as { epoch_id?: number | string } | null
            if (payload?.epoch_id !== undefined && payload?.epoch_id !== null) {
              const epochNum = typeof payload.epoch_id === 'string'
                ? parseInt(payload.epoch_id, 10)
                : payload.epoch_id
              if (!isNaN(epochNum)) {
                epochs.add(epochNum)
              }
            }
          }
        }
      }

      const result = Array.from(epochs).sort((a, b) => b - a)
      console.log('[LeadsQuery] Epochs for UID:', result)
      return result
    } catch (err) {
      console.error('[LeadsQuery] Error fetching epochs for UID:', err)
      return []
    }
  }, [])

  // Fetch available UIDs for a specific epoch
  // Since JSONB queries are slow, we return all UIDs and let client filter
  const fetchUidsForEpoch = useCallback(async (
    epochId: number,
    uidOptions: Array<{ uid: number; hotkey: string }>
  ): Promise<number[]> => {
    console.log('[LeadsQuery] Fetching UIDs for epoch:', epochId)
    // Since querying by epoch_id in JSONB is too slow (causes timeout),
    // we just return all available UIDs. The actual data will be filtered
    // when fetching leads.
    const allUids = uidOptions.map(opt => opt.uid).sort((a, b) => a - b)
    console.log('[LeadsQuery] Returning all UIDs:', allUids.length)
    return allUids
  }, [])

  // Search by lead ID directly in database
  const searchByLeadId = useCallback(async (
    leadId: string,
    hotkeyToUidMap: Record<string, number>
  ): Promise<CachedLead[]> => {
    try {
      setIsFetching(true)

      // Search in SUBMISSION events first (lead_id is in payload)
      const { data: submissions } = await supabase
        .from('transparency_log')
        .select('ts, email_hash, actor_hotkey, payload')
        .eq('event_type', 'SUBMISSION')
        .ilike('payload->>lead_id', `%${leadId}%`)
        .not('email_hash', 'is', null)
        .order('ts', { ascending: false })
        .limit(100)

      if (!submissions || submissions.length === 0) {
        return []
      }

      const emailHashes = submissions.map(s => s.email_hash).filter(Boolean)

      // Get consensus results for these
      const { data: consensusData } = await supabase
        .from('transparency_log')
        .select('email_hash, payload')
        .eq('event_type', 'CONSENSUS_RESULT')
        .in('email_hash', emailHashes)

      const consensusMap = new Map<string, {
        epoch_id?: number
        final_decision?: string
        final_rep_score?: number
        primary_rejection_reason?: string
        lead_id?: string
      }>()

      if (consensusData) {
        for (const row of consensusData) {
          if (!row.email_hash) continue
          const p = row.payload as {
            epoch_id?: number
            final_decision?: string
            final_rep_score?: number
            primary_rejection_reason?: string
            lead_id?: string
          } | null
          consensusMap.set(row.email_hash, {
            epoch_id: p?.epoch_id,
            final_decision: p?.final_decision,
            final_rep_score: p?.final_rep_score,
            primary_rejection_reason: p?.primary_rejection_reason,
            lead_id: p?.lead_id,
          })
        }
      }

      // Build leads
      const leads: CachedLead[] = submissions.map(sub => {
        const cons = consensusMap.get(sub.email_hash)
        const subPayload = sub.payload as { lead_id?: string } | null

        return {
          emailHash: sub.email_hash,
          minerHotkey: sub.actor_hotkey,
          uid: hotkeyToUidMap[sub.actor_hotkey] ?? null,
          leadId: cons?.lead_id || subPayload?.lead_id || null,
          timestamp: sub.ts,
          epochId: cons?.epoch_id ?? null,
          decision: normalizeDecision(cons?.final_decision),
          repScore: cons?.final_rep_score ?? null,
          rejectionReason: cons?.primary_rejection_reason ?? null,
        }
      })

      return leads
    } catch (err) {
      console.error('[LeadsQuery] Error searching by lead ID:', err)
      return []
    } finally {
      setIsFetching(false)
    }
  }, [])

  return { fetchPage, fetchEpochsForUid, fetchUidsForEpoch, searchByLeadId, isFetching }
}
