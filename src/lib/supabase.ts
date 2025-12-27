import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Types for transparency log events
export interface TransparencyLogEvent {
  id: string
  ts: string
  event_type: string
  actor_hotkey: string | null
  email_hash: string | null
  tee_sequence: number | null
  payload: EventPayload
}

export interface EventPayload {
  lead_id?: string
  lead_blob_hash?: string
  miner_hotkey?: string
  uid?: number
  epoch_id?: number
  final_decision?: string
  final_rep_score?: number
  primary_rejection_reason?: string
  validator_count?: number
  consensus_weight?: number
  mirror?: string
  verified?: boolean
  hash_match?: boolean
}

// Helper to add delay between batches
const delay = (ms: number) => new Promise(r => setTimeout(r, ms))

// Fields needed for consensus results (for matching with submissions)
const CONSENSUS_SELECT = 'id,ts,email_hash,payload'

// Fields needed for submissions
const SUBMISSION_SELECT = 'id,ts,actor_hotkey,email_hash,tee_sequence,payload'

// Fetch with retry logic and delays to avoid overwhelming Supabase
// Returns { data, failed } to distinguish between empty result and failure
async function fetchWithRetry<T>(
  queryFn: () => PromiseLike<{ data: T[] | null; error: { code?: string; message?: string } | null }>,
  maxRetries = 3,
  retryDelay = 2000
): Promise<{ data: T[]; failed: boolean }> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const { data, error } = await queryFn()

    if (!error) {
      return { data: data || [], failed: false }
    }

    // On timeout, wait and retry
    if (error.code === '57014' && attempt < maxRetries - 1) {
      console.log(`Timeout, retrying (attempt ${attempt + 2}/${maxRetries})...`)
      await delay(retryDelay * (attempt + 1)) // Exponential backoff
      continue
    }

    console.error('Query error:', error)
    return { data: [], failed: true }
  }

  return { data: [], failed: true }
}

// Fetch consensus results (no timestamp filter - filtered by UID in metagraph later)
export async function fetchConsensusResults(_hoursFilter: number = 0): Promise<TransparencyLogEvent[]> {
  const allData: TransparencyLogEvent[] = []
  let offset = 0
  const batchSize = 1000
  let consecutiveFailures = 0
  const maxConsecutiveFailures = 3

  while (consecutiveFailures < maxConsecutiveFailures) {
    const result = await fetchWithRetry(() =>
      supabase
        .from('transparency_log')
        .select(CONSENSUS_SELECT)
        .eq('event_type', 'CONSENSUS_RESULT')
        .order('ts', { ascending: false })
        .range(offset, offset + batchSize - 1)
    )

    if (result.failed) {
      consecutiveFailures++
      console.log(`[Supabase] Batch at offset ${offset} failed, skipping (${consecutiveFailures}/${maxConsecutiveFailures} consecutive failures)`)
      offset += batchSize
      continue
    }

    consecutiveFailures = 0 // Reset on success

    if (result.data.length === 0) break

    allData.push(...(result.data as TransparencyLogEvent[]))

    if (result.data.length < batchSize) break
    offset += batchSize

    // Small delay between batches to avoid overwhelming the database
    if (offset % 10000 === 0) {
      await delay(100)
    }
  }

  console.log(`[Supabase] Fetched ${allData.length} CONSENSUS_RESULT events`)
  return allData
}

// Fetch submissions (no timestamp filter - filtered by UID in metagraph later)
export async function fetchSubmissions(_hoursFilter: number = 0): Promise<TransparencyLogEvent[]> {
  const allData: TransparencyLogEvent[] = []
  let offset = 0
  const batchSize = 1000
  let consecutiveFailures = 0
  const maxConsecutiveFailures = 3

  while (consecutiveFailures < maxConsecutiveFailures) {
    const result = await fetchWithRetry(() =>
      supabase
        .from('transparency_log')
        .select(SUBMISSION_SELECT)
        .eq('event_type', 'SUBMISSION')
        .order('ts', { ascending: false })
        .range(offset, offset + batchSize - 1)
    )

    if (result.failed) {
      consecutiveFailures++
      console.log(`[Supabase] Batch at offset ${offset} failed, skipping (${consecutiveFailures}/${maxConsecutiveFailures} consecutive failures)`)
      offset += batchSize
      continue
    }

    consecutiveFailures = 0 // Reset on success

    if (result.data.length === 0) break

    allData.push(...(result.data as TransparencyLogEvent[]))

    if (result.data.length < batchSize) break
    offset += batchSize

    // Small delay between batches to avoid overwhelming the database
    if (offset % 10000 === 0) {
      await delay(100)
    }
  }

  console.log(`[Supabase] Fetched ${allData.length} SUBMISSION events`)
  return allData
}

// Fetch all consensus results for epoch stats (directly from CONSENSUS_RESULT events)
export async function fetchAllConsensusForEpochStats(): Promise<TransparencyLogEvent[]> {
  const allData: TransparencyLogEvent[] = []
  let offset = 0
  const batchSize = 1000
  let consecutiveFailures = 0
  const maxConsecutiveFailures = 3

  while (consecutiveFailures < maxConsecutiveFailures) {
    const result = await fetchWithRetry(() =>
      supabase
        .from('transparency_log')
        .select(CONSENSUS_SELECT)
        .eq('event_type', 'CONSENSUS_RESULT')
        .order('ts', { ascending: false })
        .range(offset, offset + batchSize - 1)
    )

    if (result.failed) {
      consecutiveFailures++
      console.log(`[Supabase] EpochStats batch at offset ${offset} failed, skipping (${consecutiveFailures}/${maxConsecutiveFailures} consecutive failures)`)
      offset += batchSize
      continue
    }

    consecutiveFailures = 0 // Reset on success

    if (result.data.length === 0) break

    allData.push(...(result.data as TransparencyLogEvent[]))

    if (result.data.length < batchSize) break
    offset += batchSize

    if (offset % 10000 === 0) {
      await delay(100)
    }
  }

  return allData
}

// Fetch lead journey by email hash
export async function fetchLeadJourney(emailHash: string): Promise<TransparencyLogEvent[]> {
  const { data, error } = await supabase
    .from('transparency_log')
    .select('*')
    .eq('email_hash', emailHash)
    .order('ts', { ascending: true })

  if (error) {
    console.error('Error fetching lead journey:', error)
    return []
  }

  return data || []
}

// Lead search result type
export interface LeadSearchResult {
  emailHash: string
  minerHotkey: string
  leadId: string | null
  epochId: number | null
  decision: 'ACCEPTED' | 'REJECTED' | 'PENDING'
  repScore: number | null
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

// Search leads with filters - queries database directly
export async function searchLeads(filters: {
  minerHotkey?: string
  epochId?: number
  decision?: 'ACCEPTED' | 'REJECTED' | 'PENDING'
  emailHashPrefix?: string
  page?: number
  limit?: number
}): Promise<{ leads: LeadSearchResult[], total: number, hasMore: boolean }> {
  const page = filters.page ?? 1
  const limit = Math.min(filters.limit ?? 100, 500)  // Max 500 per request
  const offset = (page - 1) * limit

  console.log(`[DB] Searching leads with filters:`, { ...filters, page, limit })

  // Strategy: Query CONSENSUS_RESULT first (has epochId), then join with submissions
  // This is faster because we filter by epochId at database level

  // Step 1: Get consensus results (optionally filtered by epochId)
  let consensusQuery = supabase
    .from('transparency_log')
    .select('email_hash,payload,ts')
    .eq('event_type', 'CONSENSUS_RESULT')
    .order('ts', { ascending: false })

  // Filter by epochId if provided (using JSONB contains)
  if (filters.epochId !== undefined) {
    consensusQuery = consensusQuery.filter('payload->>epoch_id', 'eq', filters.epochId.toString())
  }

  // Filter by decision if provided
  if (filters.decision) {
    const decisionValue = filters.decision === 'ACCEPTED' ? 'ALLOW' :
                          filters.decision === 'REJECTED' ? 'DENY' : null
    if (decisionValue) {
      consensusQuery = consensusQuery.filter('payload->>final_decision', 'eq', decisionValue)
    }
  }

  // Filter by email hash prefix if provided
  if (filters.emailHashPrefix) {
    consensusQuery = consensusQuery.ilike('email_hash', `${filters.emailHashPrefix}%`)
  }

  // Execute with pagination
  const { data: consensusData, error: consensusError } = await consensusQuery
    .range(offset, offset + limit)

  if (consensusError) {
    console.error('[DB] Error fetching consensus results:', consensusError)
    return { leads: [], total: 0, hasMore: false }
  }

  if (!consensusData || consensusData.length === 0) {
    return { leads: [], total: 0, hasMore: false }
  }

  // Build email hash to consensus map
  const emailHashes = consensusData.map(c => c.email_hash).filter(Boolean) as string[]
  const consensusMap = new Map<string, { epochId: number | null, decision: 'ACCEPTED' | 'REJECTED' | 'PENDING', repScore: number | null, ts: string }>()

  for (const c of consensusData) {
    if (!c.email_hash) continue
    const payload = c.payload as EventPayload
    consensusMap.set(c.email_hash, {
      epochId: payload?.epoch_id ?? null,
      decision: normalizeDecision(payload?.final_decision),
      repScore: payload?.final_rep_score ?? null,
      ts: c.ts
    })
  }

  // Step 2: Get submissions for these email hashes
  let submissionsQuery = supabase
    .from('transparency_log')
    .select('actor_hotkey,email_hash,payload,ts')
    .eq('event_type', 'SUBMISSION')
    .in('email_hash', emailHashes)

  // Filter by miner if provided
  if (filters.minerHotkey) {
    submissionsQuery = submissionsQuery.eq('actor_hotkey', filters.minerHotkey)
  }

  const { data: submissionsData, error: submissionsError } = await submissionsQuery

  if (submissionsError) {
    console.error('[DB] Error fetching submissions:', submissionsError)
    return { leads: [], total: 0, hasMore: false }
  }

  // Build submission map (email_hash -> submission)
  const submissionMap = new Map<string, { minerHotkey: string, leadId: string | null, ts: string }>()
  for (const s of submissionsData || []) {
    if (!s.email_hash || !s.actor_hotkey) continue
    const payload = s.payload as EventPayload
    // Only keep if not already present or if this is newer
    if (!submissionMap.has(s.email_hash)) {
      submissionMap.set(s.email_hash, {
        minerHotkey: s.actor_hotkey,
        leadId: payload?.lead_id ?? null,
        ts: s.ts
      })
    }
  }

  // Step 3: Merge results
  const leads: LeadSearchResult[] = []
  for (const emailHash of emailHashes) {
    const consensus = consensusMap.get(emailHash)
    const submission = submissionMap.get(emailHash)

    if (!consensus) continue

    // If filtering by miner and no matching submission, skip
    if (filters.minerHotkey && !submission) continue

    leads.push({
      emailHash,
      minerHotkey: submission?.minerHotkey ?? '',
      leadId: submission?.leadId ?? null,
      epochId: consensus.epochId,
      decision: consensus.decision,
      repScore: consensus.repScore,
      timestamp: consensus.ts
    })
  }

  console.log(`[DB] Found ${leads.length} leads matching filters`)

  return {
    leads,
    total: leads.length,  // Approximate - would need separate count query for exact total
    hasMore: consensusData.length === limit + 1
  }
}
