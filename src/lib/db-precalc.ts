// Pre-calculated dashboard data - fetches from dashboard_precalc table
// This is much faster than calculating on the fly from transparency_log
// Includes in-memory caching for high traffic (1000s of clients)

import { supabase } from './supabase'
import { fetchWithCache } from './cache'
import type { MetagraphData } from './types'

// Clean up rejection reason - exported for use in UI components
export function cleanRejectionReason(reason: string | null | undefined): string {
  if (!reason || reason === 'N/A') return 'N/A'

  try {
    if (reason.startsWith('{')) {
      const parsed = JSON.parse(reason)
      const failedFields: string[] = parsed.failed_fields || []
      if (failedFields.length > 0) {
        const fieldMap: Record<string, string> = {
          email: 'Invalid Email', website: 'Invalid Website', site: 'Invalid Website',
          source_url: 'Invalid Source URL', linkedin: 'Invalid LinkedIn', region: 'Invalid Region',
          role: 'Invalid Role', industry: 'Invalid Industry', phone: 'Invalid Phone',
          name: 'Invalid Name', first_name: 'Invalid Name', last_name: 'Invalid Name',
          company: 'Invalid Company', title: 'Invalid Title', address: 'Invalid Address',
          exception: 'Validation Error', llm_error: 'LLM Error', source_type: 'Invalid Source Type',
        }
        for (const field of failedFields) {
          const mapped = fieldMap[field.toLowerCase()]
          if (mapped) return mapped
        }
        return `Invalid ${failedFields[0].replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}`
      }

      const checkName = parsed.check_name || ''
      const message = parsed.message || ''

      // Handle message-only rejections (e.g., {"message": "EmailVerificationUnavailable"})
      if (!checkName && message) {
        if (message.includes('EmailVerification')) return 'Email Verification Error'
      }

      const checkNameMap: Record<string, string> = {
        check_truelist_email: 'Invalid Email', check_myemailverifier_email: 'Invalid Email',
        check_email_regex: 'Invalid Email', check_mx_record: 'Invalid Email',
        check_linkedin_gse: 'Invalid LinkedIn', check_head_request: 'Invalid Website',
        check_source_provenance: 'Invalid Source URL', check_domain_age: 'Invalid Website',
        check_dnsbl: 'Invalid Website', check_name_email_match: 'Name/Email Mismatch',
        check_free_email_domain: 'Free Email Domain', validation_error: 'Validation Error',
        deep_verification: 'Deep Verification Error',
        truelist_inline_verification: 'Invalid Email',
        truelist_batch_skipped: 'Email Verification Error',
      }
      if (checkName === 'check_stage5_unified') {
        const msgLower = message.toLowerCase()
        if (msgLower.includes('region') && msgLower.includes('failed')) return 'Invalid Region'
        if (msgLower.includes('role') && msgLower.includes('failed')) return 'Invalid Role'
        if (msgLower.includes('industry') && msgLower.includes('failed')) return 'Invalid Industry'
        return 'Role/Region/Industry Failed'
      }
      if (checkNameMap[checkName]) return checkNameMap[checkName]

      const stage = parsed.stage || ''
      if (stage.includes('Email') || stage.includes('TrueList')) return 'Invalid Email'
      if (stage.includes('LinkedIn') || stage.includes('GSE')) return 'Invalid LinkedIn'
      if (stage.includes('DNS') || stage.includes('Domain')) return 'Invalid Website'
      if (stage.includes('Source Provenance')) return 'Invalid Source URL'

      if (parsed.failed_field) {
        const fm: Record<string, string> = {
          site: 'Invalid Website', website: 'Invalid Website', email: 'Invalid Email',
          phone: 'Invalid Phone', name: 'Invalid Name', company: 'Invalid Company',
          title: 'Invalid Title', linkedin: 'Invalid LinkedIn', address: 'Invalid Address',
        }
        return fm[parsed.failed_field.toLowerCase()] || `Invalid ${parsed.failed_field}`
      }
      if (parsed.reason) return parsed.reason.substring(0, 50)
      if (parsed.error) return parsed.error.substring(0, 50)
    }
  } catch { /* Not JSON */ }

  const reasonLower = reason.toLowerCase()
  if (reasonLower.includes('duplicate')) return 'Duplicate Lead'
  if (reasonLower.includes('spam')) return 'Spam Detected'
  if (reasonLower.includes('disposable')) return 'Disposable Email'
  if (reasonLower.includes('catchall') || reasonLower.includes('catch-all')) return 'Catch-all Email'
  if (reasonLower.includes('bounced') || reasonLower.includes('bounce')) return 'Email Bounced'

  return 'Unknown Error'
}

// Types matching the precalc table structure
interface PrecalcTotals {
  all_submissions: number
  all_accepted: number
  all_rejected: number
  all_pending: number
  unique_miners: number
  unique_epochs: number
  latest_epoch: number
}

interface PrecalcMinerStats {
  total: number
  accepted: number
  rejected: number
  pending: number
  acceptance_rate: number
  avg_rep_score: number
  epochs: Record<string, { accepted: number; rejected: number }>
  rejection_reasons_raw: Record<string, number>
}

interface PrecalcEpochStats {
  total: number
  accepted: number
  rejected: number
  acceptance_rate: number
  unique_miners: number
  avg_rep_score: number
}

interface PrecalcLeadInventory {
  date: string
  new_leads: number
  cumulative: number
}

interface PrecalcWeeklyLeadInventory {
  week_start: string
  period_end: string
  is_complete: boolean
  leads_added: number
}

interface PrecalcData {
  id: number
  miner_stats: Record<string, PrecalcMinerStats>
  epoch_stats: Record<string, PrecalcEpochStats>
  lead_inventory: PrecalcLeadInventory[]
  weekly_lead_inventory: PrecalcWeeklyLeadInventory[]
  totals: PrecalcTotals
  updated_at: string
}

// Output types (matching existing UI expectations)
export interface DashboardSummary {
  total_submissions: number
  total_accepted: number
  total_rejected: number
  total_pending: number
  acceptance_rate: number
  avg_rep_score: number
  unique_miners: number
  unique_epochs: number
  latest_epoch: number
}

export interface MinerEpochPerformance {
  epoch_id: number
  accepted: number
  rejected: number
  acceptance_rate: number
}

export interface MinerRejectionReason {
  reason: string
  count: number
  percentage: number
}

export interface MinerStats {
  miner_hotkey: string
  coldkey: string | null
  total_submissions: number
  accepted: number
  rejected: number
  pending: number
  acceptance_rate: number
  avg_rep_score: number
  last20_accepted: number
  last20_rejected: number
  current_accepted: number
  current_rejected: number
  epoch_performance: MinerEpochPerformance[]
  rejection_reasons: MinerRejectionReason[]
}

export interface EpochMinerStats {
  miner_hotkey: string
  total: number
  accepted: number
  rejected: number
  acceptance_rate: number
  avg_rep_score: number
}

export interface EpochStats {
  epochId: number
  total: number
  accepted: number
  rejected: number
  acceptanceRate: number
  avgRepScore: number
  uniqueMiners: number
  miners: EpochMinerStats[]
}

export interface DailyLeadInventory {
  date: string
  new_leads: number
  cumulative_leads: number
}

export interface WeeklyLeadInventory {
  week_start: string
  period_end: string
  is_complete: boolean
  leads_added: number
}

export interface RejectionReasonAggregated {
  reason: string
  count: number
  percentage: number
}

export interface IncentiveDataAggregated {
  miner_hotkey: string
  accepted_leads: number
  lead_share_pct: number
}

export interface LeadInventoryCount {
  accepted: number
  rejected: number
  pending: number
}

export interface AllDashboardData {
  summary: DashboardSummary
  minerStats: MinerStats[]
  epochStats: EpochStats[]
  leadInventory: DailyLeadInventory[]
  weeklyLeadInventory: WeeklyLeadInventory[]
  rejectionReasons: RejectionReasonAggregated[]
  incentiveData: IncentiveDataAggregated[]
  leadInventoryCount: LeadInventoryCount
  totalSubmissionCount: number
  updatedAt: string
}

// Fetch raw precalc data from database
async function fetchPrecalcFromDB(): Promise<PrecalcData> {
  console.log('[Precalc] Fetching from database...')
  const startTime = Date.now()

  const { data, error } = await supabase
    .from('dashboard_precalc')
    .select('*')
    .eq('id', 1)
    .single()

  if (error) {
    console.error('[Precalc] Error fetching data:', error)
    throw new Error('Failed to fetch dashboard data')
  }

  console.log(`[Precalc] DB fetch completed in ${Date.now() - startTime}ms`)
  return data as PrecalcData
}

// Fetch pre-calculated dashboard data (with caching for high traffic)
export async function fetchAllDashboardData(_hours: number, metagraph: MetagraphData | null): Promise<AllDashboardData> {
  const startTime = Date.now()

  // Use cache to handle 1000s of concurrent requests
  // Only 1 request hits DB, others get cached data
  const precalc = await fetchWithCache('dashboard_precalc', fetchPrecalcFromDB)

  console.log(`[Precalc] Data ready in ${Date.now() - startTime}ms`)

  // Get active miner hotkeys from metagraph (null if metagraph is empty/failed)
  const metagraphHotkeys = metagraph ? Object.keys(metagraph.hotkeyToUid) : []
  const activeMiners = metagraphHotkeys.length > 0 ? new Set(metagraphHotkeys) : null

  // Transform miner_stats (include coldkey from metagraph)
  const hotkeyToColdkey = metagraph?.hotkeyToColdkey || {}
  const minerStats = transformMinerStats(precalc.miner_stats, precalc.totals.latest_epoch, activeMiners, hotkeyToColdkey)

  // Transform epoch_stats (include per-miner breakdown from miner_stats)
  const epochStats = transformEpochStats(precalc.epoch_stats, precalc.miner_stats, activeMiners)

  // Transform lead_inventory
  const leadInventory = transformLeadInventory(precalc.lead_inventory)

  // Weekly lead inventory (already in correct format from db)
  const weeklyLeadInventory: WeeklyLeadInventory[] = (precalc.weekly_lead_inventory || []).map(w => ({
    week_start: w.week_start,
    period_end: w.period_end,
    is_complete: w.is_complete,
    leads_added: w.leads_added,
  }))

  // Calculate rejection reasons from miner stats (use all miners, not just active)
  const rejectionReasons = calculateRejectionReasons(precalc.miner_stats, null)

  // Calculate incentive data from miner stats
  const incentiveData = calculateIncentiveData(precalc.miner_stats, activeMiners)

  // Calculate summary (filtered by active miners)
  const summary = calculateSummary(precalc.totals, minerStats)

  // Lead inventory count - use totals directly from precalc
  const leadInventoryCount: LeadInventoryCount = {
    accepted: precalc.totals.all_accepted,
    rejected: precalc.totals.all_rejected,
    pending: precalc.totals.all_pending,
  }

  const fetchTime = Date.now() - startTime
  console.log(`[Precalc] All data transformed in ${fetchTime}ms`)

  return {
    summary,
    minerStats,
    epochStats,
    leadInventory,
    weeklyLeadInventory,
    rejectionReasons,
    incentiveData,
    leadInventoryCount,
    totalSubmissionCount: precalc.totals.all_accepted + precalc.totals.all_rejected + precalc.totals.all_pending,
    updatedAt: precalc.updated_at,
  }
}

function transformMinerStats(
  minerStats: Record<string, PrecalcMinerStats>,
  latestEpoch: number,
  activeMiners: Set<string> | null,
  hotkeyToColdkey: Record<string, string>
): MinerStats[] {
  const result: MinerStats[] = []

  for (const [hotkey, stats] of Object.entries(minerStats)) {
    // Filter by active miners if metagraph available
    if (activeMiners && !activeMiners.has(hotkey)) continue

    // Calculate last20 and current epoch stats
    const epochs = stats.epochs || {}
    const sortedEpochIds = Object.keys(epochs).map(Number).sort((a, b) => b - a)
    const last20EpochIds = new Set(sortedEpochIds.slice(0, 20))
    const currentEpochId = sortedEpochIds[0] ?? null

    let last20Accepted = 0
    let last20Rejected = 0
    let currentAccepted = 0
    let currentRejected = 0

    for (const [epochId, epochStats] of Object.entries(epochs)) {
      const eid = parseInt(epochId)
      if (last20EpochIds.has(eid)) {
        last20Accepted += epochStats.accepted
        last20Rejected += epochStats.rejected
      }
      if (eid === currentEpochId) {
        currentAccepted = epochStats.accepted
        currentRejected = epochStats.rejected
      }
    }

    // Transform epoch performance
    const epochPerformance: MinerEpochPerformance[] = Object.entries(epochs)
      .map(([epochId, es]) => {
        const decided = es.accepted + es.rejected
        return {
          epoch_id: parseInt(epochId),
          accepted: es.accepted,
          rejected: es.rejected,
          acceptance_rate: decided > 0 ? Math.round((es.accepted / decided) * 1000) / 10 : 0,
        }
      })
      .sort((a, b) => b.epoch_id - a.epoch_id)

    // Transform rejection reasons
    const rejectionReasonsRaw = stats.rejection_reasons_raw || {}
    const totalRejections = Object.values(rejectionReasonsRaw).reduce((a, b) => a + b, 0)
    const rejectionReasons: MinerRejectionReason[] = Object.entries(rejectionReasonsRaw)
      .map(([reason, count]) => ({
        reason: cleanRejectionReason(reason),
        count,
        percentage: totalRejections > 0 ? Math.round((count / totalRejections) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.count - a.count)

    result.push({
      miner_hotkey: hotkey,
      coldkey: hotkeyToColdkey[hotkey] || null,
      total_submissions: stats.total,
      accepted: stats.accepted,
      rejected: stats.rejected,
      pending: stats.pending,
      acceptance_rate: stats.acceptance_rate,
      avg_rep_score: stats.avg_rep_score,
      last20_accepted: last20Accepted,
      last20_rejected: last20Rejected,
      current_accepted: currentAccepted,
      current_rejected: currentRejected,
      epoch_performance: epochPerformance,
      rejection_reasons: rejectionReasons,
    })
  }

  return result.sort((a, b) => b.acceptance_rate - a.acceptance_rate)
}

function transformEpochStats(
  epochStats: Record<string, PrecalcEpochStats>,
  minerStats: Record<string, PrecalcMinerStats>,
  activeMiners: Set<string> | null
): EpochStats[] {
  // Get all epoch IDs and find the last 600
  const allEpochIds = Object.keys(epochStats).map(Number).sort((a, b) => b - a)
  const maxEpoch = allEpochIds[0] || 0
  const minEpoch = maxEpoch - 599 // Last 600 epochs
  const epochIdsToInclude = new Set(allEpochIds.filter(id => id >= minEpoch))

  const result: EpochStats[] = []

  for (const [epochId, stats] of Object.entries(epochStats)) {
    const eid = parseInt(epochId)

    // Only include last 600 epochs
    if (!epochIdsToInclude.has(eid)) continue

    // Build per-miner breakdown for this epoch (derived from miner_stats.epochs)
    const miners: EpochMinerStats[] = []
    for (const [hotkey, mStats] of Object.entries(minerStats)) {
      // Filter by active miners if metagraph available
      if (activeMiners && !activeMiners.has(hotkey)) continue

      const epochData = mStats.epochs?.[epochId]
      if (!epochData) continue

      const decided = epochData.accepted + epochData.rejected
      miners.push({
        miner_hotkey: hotkey,
        total: epochData.accepted + epochData.rejected,
        accepted: epochData.accepted,
        rejected: epochData.rejected,
        acceptance_rate: decided > 0 ? Math.round((epochData.accepted / decided) * 1000) / 10 : 0,
        avg_rep_score: mStats.avg_rep_score, // Use overall miner avg
      })
    }

    // FIXED: Derive unique_miners from actual miner count instead of stored value
    // The stored unique_miners was incorrectly summed in incremental mode
    const uniqueMiners = miners.length

    result.push({
      epochId: eid,
      total: stats.total,
      accepted: stats.accepted,
      rejected: stats.rejected,
      acceptanceRate: stats.acceptance_rate,
      avgRepScore: stats.avg_rep_score || 0,
      uniqueMiners, // Use derived count
      miners: miners.sort((a, b) => b.acceptance_rate - a.acceptance_rate),
    })
  }

  return result.sort((a, b) => b.epochId - a.epochId)
}

function transformLeadInventory(inventory: PrecalcLeadInventory[]): DailyLeadInventory[] {
  if (!inventory) return []
  return inventory.map(i => ({
    date: i.date,
    new_leads: i.new_leads,
    cumulative_leads: i.cumulative,
  }))
}

function calculateRejectionReasons(
  minerStats: Record<string, PrecalcMinerStats>,
  activeMiners: Set<string> | null
): RejectionReasonAggregated[] {
  const reasonCounts = new Map<string, number>()

  for (const [hotkey, stats] of Object.entries(minerStats)) {
    if (activeMiners && !activeMiners.has(hotkey)) continue

    const reasons = stats.rejection_reasons_raw || {}
    for (const [reason, count] of Object.entries(reasons)) {
      const cleanedReason = cleanRejectionReason(reason)
      // Skip excluded reasons
      const lowerReason = cleanedReason.toLowerCase()
      if (lowerReason.includes('llm error') || lowerReason.includes('validation error') || lowerReason === 'unknown') {
        continue
      }
      reasonCounts.set(cleanedReason, (reasonCounts.get(cleanedReason) || 0) + count)
    }
  }

  const total = Array.from(reasonCounts.values()).reduce((a, b) => a + b, 0)
  return Array.from(reasonCounts.entries())
    .map(([reason, count]) => ({
      reason,
      count,
      percentage: total > 0 ? Math.round((count / total) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.count - a.count)
}

function calculateIncentiveData(
  minerStats: Record<string, PrecalcMinerStats>,
  activeMiners: Set<string> | null
): IncentiveDataAggregated[] {
  const minerAccepted: { hotkey: string; accepted: number }[] = []
  let totalAccepted = 0

  for (const [hotkey, stats] of Object.entries(minerStats)) {
    if (activeMiners && !activeMiners.has(hotkey)) continue
    minerAccepted.push({ hotkey, accepted: stats.accepted })
    totalAccepted += stats.accepted
  }

  return minerAccepted
    .map(m => ({
      miner_hotkey: m.hotkey,
      accepted_leads: m.accepted,
      lead_share_pct: totalAccepted > 0 ? Math.round((m.accepted / totalAccepted) * 10000) / 100 : 0,
    }))
    .sort((a, b) => b.lead_share_pct - a.lead_share_pct)
}

function calculateSummary(totals: PrecalcTotals, minerStats: MinerStats[]): DashboardSummary {
  // For active miners view, recalculate from filtered miner stats
  const totalSubmissions = minerStats.reduce((a, m) => a + m.total_submissions, 0)
  const totalAccepted = minerStats.reduce((a, m) => a + m.accepted, 0)
  const totalRejected = minerStats.reduce((a, m) => a + m.rejected, 0)
  const totalPending = minerStats.reduce((a, m) => a + m.pending, 0)
  const decided = totalAccepted + totalRejected

  // Calculate weighted avg rep score
  const totalRepScore = minerStats.reduce((a, m) => a + m.avg_rep_score * m.accepted, 0)
  const avgRepScore = totalAccepted > 0 ? totalRepScore / totalAccepted : 0

  return {
    total_submissions: totalSubmissions,
    total_accepted: totalAccepted,
    total_rejected: totalRejected,
    total_pending: totalPending,
    acceptance_rate: decided > 0 ? Math.round((totalAccepted / decided) * 1000) / 10 : 0,
    avg_rep_score: Math.round(avgRepScore * 10000) / 10000,
    unique_miners: minerStats.length,
    unique_epochs: totals.unique_epochs,
    latest_epoch: totals.latest_epoch,
  }
}

// For latest leads display
export interface LatestLead {
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

// Normalize decision values
function normalizeDecision(decision: string | undefined): 'ACCEPTED' | 'REJECTED' | 'PENDING' {
  if (!decision) return 'PENDING'
  const lower = decision.toLowerCase()
  if (['deny', 'denied', 'reject', 'rejected'].includes(lower)) return 'REJECTED'
  if (['allow', 'allowed', 'accept', 'accepted', 'approve', 'approved'].includes(lower)) return 'ACCEPTED'
  return 'PENDING'
}

// Fetch latest 100 leads from transparency_log
async function fetchLatestLeadsFromDB(metagraph: MetagraphData | null): Promise<LatestLead[]> {
  console.log('[Precalc] Fetching latest 100 leads...')
  const startTime = Date.now()

  // Get hotkey to UID mapping (null if metagraph is empty/failed)
  const hotkeyToUid = metagraph?.hotkeyToUid || {}
  const metagraphHotkeys = metagraph ? Object.keys(metagraph.hotkeyToUid) : []
  const activeMiners = metagraphHotkeys.length > 0 ? new Set(metagraphHotkeys) : null

  // Fetch latest CONSENSUS_RESULT events (extra to account for filtering)
  const { data: consensusData, error: consError } = await supabase
    .from('transparency_log')
    .select('ts, email_hash, payload')
    .eq('event_type', 'CONSENSUS_RESULT')
    .not('email_hash', 'is', null)
    .order('ts', { ascending: false })
    .limit(150)

  if (consError) {
    console.error('[Precalc] Error fetching latest leads:', consError)
    return []
  }

  if (!consensusData || consensusData.length === 0) {
    return []
  }

  const emailHashes = consensusData.map(c => c.email_hash).filter(Boolean)

  // Fetch submissions for lead_id and miner hotkey
  const { data: submissionData } = await supabase
    .from('transparency_log')
    .select('email_hash, actor_hotkey, ts, payload')
    .eq('event_type', 'SUBMISSION')
    .in('email_hash', emailHashes)

  // Build two submission maps: by lead_id (preferred) and by email_hash (fallback)
  const submissionByLeadId = new Map<string, { lead_id?: string; actor_hotkey?: string; ts?: string }>()
  const submissionByHash = new Map<string, { lead_id?: string; actor_hotkey?: string; ts?: string }>()
  if (submissionData) {
    for (const row of submissionData) {
      if (!row.email_hash) continue
      const payload = row.payload as { lead_id?: string } | null
      const entry = {
        lead_id: payload?.lead_id,
        actor_hotkey: row.actor_hotkey,
        ts: row.ts,
      }
      if (payload?.lead_id && !submissionByLeadId.has(payload.lead_id)) {
        submissionByLeadId.set(payload.lead_id, entry)
      }
      if (!submissionByHash.has(row.email_hash)) {
        submissionByHash.set(row.email_hash, entry)
      }
    }
  }

  // Build leads
  const leads: LatestLead[] = []
  for (const cons of consensusData) {
    if (leads.length >= 100) break

    const consPayload = cons.payload as { lead_id?: string } | null
    const submission = (consPayload?.lead_id ? submissionByLeadId.get(consPayload.lead_id) : null)
      ?? submissionByHash.get(cons.email_hash)
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

  const fetchTime = Date.now() - startTime
  console.log(`[Precalc] Fetched ${leads.length} latest leads in ${fetchTime}ms`)

  return leads
}

// Cache for latest leads - use global to persist across hot reloads
const globalForLeads = globalThis as unknown as {
  latestLeadsCache: { data: LatestLead[]; timestamp: number } | null
}

if (!globalForLeads.latestLeadsCache) {
  globalForLeads.latestLeadsCache = null
}

export async function getCachedLatestLeads(metagraph: MetagraphData | null): Promise<LatestLead[]> {
  // Always return cached data if available (background refresh keeps it fresh)
  if (globalForLeads.latestLeadsCache) {
    console.log('[Precalc] Latest leads cache HIT')
    return globalForLeads.latestLeadsCache.data
  }

  // Cache not warmed yet - fetch once (only happens on cold start before warm-up completes)
  console.log('[Precalc] Latest leads cache MISS - fetching...')
  const leads = await fetchLatestLeadsFromDB(metagraph)

  // Cache the result
  globalForLeads.latestLeadsCache = { data: leads, timestamp: Date.now() }

  return leads
}

// Warm latest leads cache (called from instrumentation.ts)
export async function warmLatestLeadsCache(metagraph: MetagraphData | null): Promise<void> {
  console.log('[Precalc] Warming latest leads cache...')
  const leads = await fetchLatestLeadsFromDB(metagraph)
  globalForLeads.latestLeadsCache = { data: leads, timestamp: Date.now() }
  console.log(`[Precalc] Latest leads cache warmed (${leads.length} leads)`)
}
