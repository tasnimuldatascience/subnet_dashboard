import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import {
  deriveResearchLabLoopStatus,
  isActiveResearchLabLoopStatus,
  isCompletedResearchLabLoopStatus,
  isNoGainOrFailedResearchLabLoopStatus,
  isPendingOrBlockingResearchLabLoopStatus,
  isPromisingResearchLabLoopStatus,
  isScoredResearchLabLoopStatus,
  type ResearchLabLoopStatusNote,
} from '@/lib/research-lab-status'

export const dynamic = 'force-dynamic'

const CACHE_TTL = 60_000
const LOOP_LIMIT = 50
const LOOP_FETCH_LIMIT = LOOP_LIMIT + 100
const HIDDEN_LOOP_MINER_PREFIXES = [
  '5FEtvB',
  '5FBhsXVWpezSHcpogXo4CjMcgTBctLcZ7VnNoKzn3oEGST44',
]

type CachedResponse = {
  data: ResearchLabPayload
  ts: number
}

type PublicBenchmarkReportRow = {
  report_id: string
  benchmark_date: string
  rolling_window_hash: string
  aggregate_score: number
  report_doc: PublicBenchmarkReportDoc | null
  current_report_status: string | null
  current_status_at: string | null
  created_at: string
}

type PublicBenchmarkReportDoc = {
  schema_version?: string
  benchmark_date?: string
  rolling_window_hash?: string
  aggregate_score?: number
  aggregate_score_band?: string
  item_count?: number
  public_icp_count?: number
  private_holdout_icp_count?: number
  zero_lead_icp_count?: number
  low_intent_fit_icp_count?: number
  low_icp_fit_count?: number
  score_band_counts?: Record<string, number>
  failure_category_counts?: Record<string, number>
  model_issue_counts?: Record<string, number>
  model_issue_public_icps?: Record<string, ModelIssueIcpEntry[]>
  visibility_split?: {
    public_count?: number
    private_count?: number
  }
  public_icps?: PublicIcpEntry[]
  icp_buckets?: unknown[]
}

type PublicIcpEntry = {
  item_rank?: number
  icp_ref?: string
  icp_hash?: string
  set_id?: number
  day_index?: number
  day_rank?: number
  score?: number
  company_count?: number
  strength_label?: string
  icp?: Record<string, unknown>
  diagnostics?: {
    failure_categories?: string[]
    avg_icp_fit?: number
    avg_intent_signal_final?: number
    // Per-stage funnel + per-signal coverage, sourced from the private
    // benchmark bundle and attached only for already-revealed public ICPs.
    sourcing_failed?: boolean
    funnel?: LeadFunnel
    per_signal?: Record<string, PerSignalStat>
    rejection_reasons?: Record<string, number>
  }
}

// Lead funnel: how many of the model's discovered companies survive each
// scoring stage. Stored per ICP in the private benchmark bundle's
// score_summary_doc.per_icp_summaries[].diagnostics.
type LeadFunnel = {
  sourced: number
  fit_pass: number
  verified: number
  intent_valid: number
  scored: number
}

type PerSignalStat = {
  signal_index: number
  evidence_type: string
  companies_submitted: number
  companies_passed: number
  signals_submitted: number
  signals_passed: number
  avg_score: number
  sum_score: number
  max_score: number
}

type EvidenceTypeStat = {
  signals?: number
  companies_passed?: number
  avg_after_decay?: number
  fresh_rate?: number
}

// Run-wide rollup of one required intent/evidence type.
// icp_count = number of benchmark ICPs (across ALL 20, incl. sourcing failures)
// that required this intent type, taken from the ICP definitions.
// expected = HEALTHY_DISCOVERY_FLOOR x icp_count; fulfilled = companies whose
// evidence of this type passed; pass_pct = fulfilled / expected.
type IntentTypeRollup = {
  evidence_type: string
  fulfilled: number
  icp_count: number
  expected: number
  pass_pct: number
  avg_score: number
}

type PrivateIcpDiagnostics = {
  sourcing_failed?: boolean
  funnel?: Partial<LeadFunnel>
  per_signal?: Record<string, PerSignalStat>
  rejection_reasons?: Record<string, number>
  evidence_types?: Record<string, EvidenceTypeStat>
}

type PrivateIcpSummary = {
  icp_ref?: string
  icp_hash?: string
  diagnostics?: PrivateIcpDiagnostics
}

type PrivateBundleRow = {
  benchmark_date: string
  created_at: string
  benchmark_quality: string | null
  score_summary_doc: { per_icp_summaries?: PrivateIcpSummary[] } | null
}

// Per-ICP discovery health: how many ICPs the model could find companies for.
// The benchmark sets no hard per-ICP quota, so HEALTHY_DISCOVERY_FLOOR is a
// labeled reporting threshold, not a contract.
const HEALTHY_DISCOVERY_FLOOR = 5

type DiscoverySummary = {
  totalIcps: number
  noCompanies: number // 0 sourced (sourcing failed / infra)
  weak: number // 1..floor-1 discovered
  healthy: number // >= floor discovered
  totalDiscovered: number // sum sourced across all ICPs
  totalScored: number // sum scored across all ICPs
  floor: number
}

type PrivateDiagnosticsBundle = {
  aggregateFunnel: LeadFunnel
  sourcingFailedCount: number
  scoredIcpCount: number
  intentTypes: IntentTypeRollup[]
  discovery: DiscoverySummary
  byRef: Map<string, PrivateIcpDiagnostics>
}

type ModelIssueIcpEntry = {
  item_rank?: number
  icp_ref?: string
  icp_hash?: string
  set_id?: number
  day_index?: number
  day_rank?: number
  industry_bucket?: string
  score?: number
  company_count?: number
}

type PublicLoopRow = {
  card_id: string
  ticket_id: string
  miner_hotkey: string
  research_area: string
  research_focus_summary: string
  topic_tags: string[] | null
  topic_signature_hash: string
  current_topic_tags: string[] | null
  current_topic_signature_hash: string | null
  current_outcome_label: string | null
  current_outcome_band: string | null
  current_candidate_count: number | null
  current_scored_candidate_count: number | null
  current_best_candidate_public_summary: string | null
  current_last_activity_at: string | null
  current_run_id: string | null
  current_receipt_id: string | null
  current_event_doc: PublicLoopEventDoc | null
  current_candidate_status?: string | null
  current_reason?: string | null
  current_queue_status?: string | null
  current_receipt_status?: string | null
  current_status?: string | null
  created_at: string
}

// Subset of the public activity event payload we rely on to derive an
// honest outcome label. `projection_reason` explains WHY a card sits at its
// current label — e.g. a "candidate_generation_complete" card whose reason is
// `stale_parent_needs_rescore` is really a rejected/stale candidate, and a
// "submitted" card whose reason is `ticket_created` with an empty queue_status
// never entered the autoresearch queue at all.
type PublicLoopEventDoc = {
  projection_reason?: string
  current_candidate_status?: string
  candidate_status?: string
  current_reason?: string
  candidate_reason?: string
  queue_status?: string
  receipt_status?: string
  score_bundle_count?: number
  candidate_status_counts?: Record<string, number>
  candidate_reason_counts?: Record<string, number>
}

type ResearchLabPayload = {
  benchmark: NormalizedBenchmark | null
  loops: NormalizedLoop[]
  topicGroups: TopicGroup[]
  labMinerSpend: LabMinerSpendRollup
  stats: {
    activeLoopCount: number
    opsPendingLoopCount: number
    scoredLoopCount: number
    promisingLoopCount: number
    totalBenchmarkIcpCount: number
  }
  fetchedAt: string
}

type LabMinerSpendRollup = {
  window: LabMinerSpendWindow
  byHotkey: Record<string, LabMinerSpendEntry>
}

type LabMinerSpendWindow = {
  latestEpoch: number | null
  epochCount: number | null
  activeScheduleCount: number
}

type LabMinerSpendEntry = {
  computeSpendUsd: number
  scheduledReimbursementUsd: number
  activeAwardCount: number
  reimbursementEpochs: number | null
}

type NormalizedBenchmark = {
  reportId: string
  benchmarkDate: string
  rollingWindowHash: string
  aggregateScore: number
  aggregateScoreBand: string
  itemCount: number
  publicIcpCount: number
  privateHoldoutIcpCount: number
  scoreBandCounts: Record<string, number>
  failureCategoryCounts: Record<string, number>
  issues: BenchmarkIssue[]
  publicIcps: PublicIcpEntry[]
  aggregateFunnel: LeadFunnel | null
  sourcingFailedCount: number
  intentTypes: IntentTypeRollup[]
  discovery: DiscoverySummary | null
  currentStatusAt: string | null
}

type BenchmarkIssue = {
  key: string
  label: string
  count: number
  severity: 'high' | 'medium' | 'low'
  description: string
  icps: ModelIssueIcpEntry[]
}

type NormalizedLoop = {
  cardId: string
  ticketId: string
  runId: string | null
  receiptId: string | null
  minerHotkey: string
  researchArea: string
  researchFocusSummary: string
  topicTags: string[]
  topicSignatureHash: string
  outcomeLabel: string
  statusKey: string
  statusLabel: string
  outcomeBand: string
  candidateCount: number
  scoredCandidateCount: number
  bestCandidatePublicSummary: string
  lastActivityAt: string
  submittedAt: string
  statusNote?: LoopStatusNote
}

type LoopStatusNote = {
  tone: ResearchLabLoopStatusNote['tone']
  label: ResearchLabLoopStatusNote['label']
  detail: ResearchLabLoopStatusNote['detail']
}

type TopicGroup = {
  topicSignatureHash: string
  topicTags: string[]
  total: number
  running: number
  completed: number
  scored: number
  promisingOrPromoted: number
  noGainOrFailed: number
  latestActivityAt: string
}

type ReimbursementScheduleRow = {
  award_id: string | null
  schedule_status: string | null
  start_epoch: number | null
  epoch_count: number | null
  total_microusd: number | string | null
}

type ReimbursementAwardRow = {
  award_id: string
  miner_hotkey: string | null
  eligible_cost_microusd: number | string | null
  target_reimbursement_microusd: number | string | null
  reimbursement_epochs: number | null
}

let cache: CachedResponse | null = null

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SECRET_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) {
    throw new Error('Supabase environment variables are not configured')
  }
  return createClient(url, key, { auth: { persistSession: false } })
}

export async function GET() {
  try {
    if (cache && Date.now() - cache.ts < CACHE_TTL) {
      return NextResponse.json({ success: true, data: cache.data })
    }

    const supabase = getSupabase()
    const [benchmark, loops, labMinerSpend] = await Promise.all([
      fetchLatestBenchmark(supabase),
      fetchPublicLoops(supabase),
      fetchLabMinerSpend(supabase),
    ])
    const topicGroups = groupLoopsByTopic(loops)
    const data: ResearchLabPayload = {
      benchmark,
      loops,
      topicGroups,
      labMinerSpend,
      stats: {
        activeLoopCount: loops.filter((loop) => isActiveResearchLabLoopStatus(loop.statusKey)).length,
        opsPendingLoopCount: loops.filter((loop) =>
          isPendingOrBlockingResearchLabLoopStatus(loop.statusKey)
        ).length,
        scoredLoopCount: loops.filter((loop) =>
          isScoredResearchLabLoopStatus(loop.statusKey)
        ).length,
        promisingLoopCount: loops.filter((loop) =>
          isPromisingResearchLabLoopStatus(loop.statusKey, loop.outcomeBand)
        ).length,
        totalBenchmarkIcpCount: benchmark?.itemCount ?? 0,
      },
      fetchedAt: new Date().toISOString(),
    }
    cache = { data, ts: Date.now() }
    return NextResponse.json({ success: true, data })
  } catch (error) {
    console.error('[Research Lab API] failed:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to fetch Research Lab data' },
      { status: 500 }
    )
  }
}

async function fetchLatestBenchmark(supabase: ReturnType<typeof getSupabase>): Promise<NormalizedBenchmark | null> {
  const { data, error } = await supabase
    .from('research_lab_public_benchmark_report_current')
    .select('report_id, benchmark_date, rolling_window_hash, aggregate_score, report_doc, current_report_status, current_status_at, created_at')
    .eq('current_report_status', 'published')
    .order('benchmark_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)

  if (error) {
    console.error('[Research Lab API] benchmark query failed:', error)
    return null
  }

  const row = (data?.[0] ?? null) as PublicBenchmarkReportRow | null
  if (!row) return null
  const doc = row.report_doc ?? {}
  const benchmarkDate = String(doc.benchmark_date || row.benchmark_date)
  // Pull per-stage funnel + per-signal coverage from the private bundle and
  // attach it ONLY to the already-revealed public ICPs (no holdout leak).
  const privateDiag = await fetchPrivateDiagnostics(supabase, benchmarkDate)
  const publicIcps = attachPrivateDiagnostics(
    stripInternalIcpFields(Array.isArray(doc.public_icps) ? doc.public_icps : []),
    privateDiag,
  )
  const publicIcpCount = numberOr(
    doc.public_icp_count,
    numberOr(doc.visibility_split?.public_count, publicIcps.length)
  )
  const privateHoldoutIcpCount = numberOr(
    doc.private_holdout_icp_count,
    numberOr(doc.visibility_split?.private_count, 0)
  )
  const itemCount = numberOr(doc.item_count, publicIcpCount + privateHoldoutIcpCount)

  return {
    reportId: row.report_id,
    benchmarkDate: String(doc.benchmark_date || row.benchmark_date),
    rollingWindowHash: String(doc.rolling_window_hash || row.rolling_window_hash),
    aggregateScore: numberOr(doc.aggregate_score, row.aggregate_score),
    aggregateScoreBand: String(doc.aggregate_score_band || scoreBand(numberOr(doc.aggregate_score, row.aggregate_score))),
    itemCount,
    publicIcpCount,
    privateHoldoutIcpCount,
    scoreBandCounts: doc.score_band_counts ?? {},
    failureCategoryCounts: doc.failure_category_counts ?? {},
    issues: buildBenchmarkIssues(doc),
    publicIcps,
    aggregateFunnel: privateDiag?.aggregateFunnel ?? null,
    sourcingFailedCount: privateDiag?.sourcingFailedCount ?? 0,
    intentTypes: privateDiag?.intentTypes ?? [],
    discovery: privateDiag?.discovery ?? null,
    currentStatusAt: row.current_status_at || row.created_at,
  }
}

// Read the matching private benchmark bundle (service-role only) and reduce it
// to: an anonymized aggregate funnel across ALL ICPs, a sourcing-failure count,
// and a per-ICP diagnostics map keyed by icp_ref (consumed only for revealed
// public ICPs). Returns null if unavailable — the rest of the report still works.
async function fetchPrivateDiagnostics(
  supabase: ReturnType<typeof getSupabase>,
  benchmarkDate: string,
): Promise<PrivateDiagnosticsBundle | null> {
  let query = supabase
    .from('research_lab_private_model_benchmark_current')
    .select('benchmark_date, created_at, benchmark_quality, score_summary_doc')
    .eq('benchmark_quality', 'passed')
    .order('created_at', { ascending: false })
    .limit(1)
  if (benchmarkDate) query = query.eq('benchmark_date', benchmarkDate)

  const { data, error } = await query
  if (error) {
    console.error('[Research Lab API] private bundle query failed:', error)
    return null
  }
  const row = (data?.[0] ?? null) as PrivateBundleRow | null
  if (!row?.score_summary_doc) return null

  const summaries = Array.isArray(row.score_summary_doc.per_icp_summaries)
    ? row.score_summary_doc.per_icp_summaries
    : []

  const aggregateFunnel: LeadFunnel = { sourced: 0, fit_pass: 0, verified: 0, intent_valid: 0, scored: 0 }
  let sourcingFailedCount = 0
  let scoredIcpCount = 0
  const byRef = new Map<string, PrivateIcpDiagnostics>()
  // Companies that PASSED each intent type (numerator), from per_signal.
  const fulfilledAcc = new Map<string, { fulfilled: number; signalsPassed: number; scoreSum: number }>()

  const discovery: DiscoverySummary = {
    totalIcps: 0, noCompanies: 0, weak: 0, healthy: 0,
    totalDiscovered: 0, totalScored: 0, floor: HEALTHY_DISCOVERY_FLOOR,
  }

  for (const summary of summaries) {
    const diag = summary?.diagnostics
    if (!diag) continue
    const ref = summary.icp_ref ? String(summary.icp_ref) : ''
    if (ref) byRef.set(ref, diag)

    // Discovery health counts every ICP, including sourcing failures.
    discovery.totalIcps += 1
    const srcCount = diag.sourcing_failed ? 0 : numberOr(diag.funnel?.sourced, 0)
    discovery.totalDiscovered += srcCount
    discovery.totalScored += diag.sourcing_failed ? 0 : numberOr(diag.funnel?.scored, 0)
    if (srcCount <= 0) discovery.noCompanies += 1
    else if (srcCount < HEALTHY_DISCOVERY_FLOOR) discovery.weak += 1
    else discovery.healthy += 1

    if (diag.sourcing_failed) {
      sourcingFailedCount += 1
      continue
    }
    scoredIcpCount += 1
    const f = diag.funnel ?? {}
    aggregateFunnel.sourced += numberOr(f.sourced, 0)
    aggregateFunnel.fit_pass += numberOr(f.fit_pass, 0)
    aggregateFunnel.verified += numberOr(f.verified, 0)
    aggregateFunnel.intent_valid += numberOr(f.intent_valid, 0)
    aggregateFunnel.scored += numberOr(f.scored, 0)

    for (const stat of Object.values(diag.per_signal ?? {})) {
      const type = (stat.evidence_type || 'UNSPECIFIED').toUpperCase()
      const entry = fulfilledAcc.get(type) ?? { fulfilled: 0, signalsPassed: 0, scoreSum: 0 }
      entry.fulfilled += numberOr(stat.companies_passed, 0)
      entry.signalsPassed += numberOr(stat.signals_passed, 0)
      entry.scoreSum += numberOr(stat.sum_score, 0)
      fulfilledAcc.set(type, entry)
    }
  }

  // Denominator: how many of ALL benchmark ICPs (incl. sourcing failures)
  // required each intent type — taken from the ICP definitions, so types the
  // model never passed (or only had in failed ICPs) still appear at their true %.
  const requiredByType = await fetchRequiredIntentCounts(
    supabase,
    summaries.map((s) => (s?.icp_ref ? String(s.icp_ref) : '')).filter(Boolean),
  )

  const allTypes = new Set<string>([...requiredByType.keys(), ...fulfilledAcc.keys()])
  const intentTypes: IntentTypeRollup[] = Array.from(allTypes)
    .map((evidence_type) => {
      const icpCount = requiredByType.get(evidence_type) ?? 0
      const f = fulfilledAcc.get(evidence_type) ?? { fulfilled: 0, signalsPassed: 0, scoreSum: 0 }
      const expected = HEALTHY_DISCOVERY_FLOOR * icpCount
      return {
        evidence_type,
        fulfilled: f.fulfilled,
        icp_count: icpCount,
        expected,
        pass_pct: expected > 0 ? Math.round((f.fulfilled / expected) * 100) : 0,
        avg_score: f.signalsPassed > 0 ? Math.round((f.scoreSum / f.signalsPassed) * 10) / 10 : 0,
      }
    })
    .sort((a, b) => b.pass_pct - a.pass_pct || b.icp_count - a.icp_count)

  return { aggregateFunnel, sourcingFailedCount, scoredIcpCount, intentTypes, discovery, byRef }
}

// Count, per intent/evidence type, how many benchmark ICPs required it — read
// from the ICP definitions (intent_category + bonus_intents) for ALL ICPs in
// the run, so the pass-rate denominator reflects every ICP, not just scored ones.
async function fetchRequiredIntentCounts(
  supabase: ReturnType<typeof getSupabase>,
  icpRefs: string[],
): Promise<Map<string, number>> {
  const setIds = new Set<string>()
  const refToIcpId = new Map<string, string>()
  for (const ref of icpRefs) {
    const parts = ref.split(':') // qualification_private_icp_sets:<set_id>:<icp_id>
    if (parts.length >= 3) {
      setIds.add(parts[1])
      refToIcpId.set(ref, parts[2])
    }
  }
  const counts = new Map<string, number>()
  if (setIds.size === 0) return counts

  const { data, error } = await supabase
    .from('qualification_private_icp_sets')
    .select('set_id, icps')
    .in('set_id', Array.from(setIds))
  if (error) {
    console.error('[Research Lab API] icp set query failed:', error)
    return counts
  }

  type RawIcp = { icp_id?: string; intent_category?: string; bonus_intents?: { intent_category?: string }[] }
  const icpIdToTypes = new Map<string, Set<string>>()
  for (const row of (data ?? []) as { icps?: RawIcp[] }[]) {
    for (const icp of row.icps ?? []) {
      const id = String(icp.icp_id || '')
      if (!id) continue
      const types = new Set<string>()
      const primary = String(icp.intent_category || '').toUpperCase().trim()
      if (primary) types.add(primary)
      for (const bonus of icp.bonus_intents ?? []) {
        const bc = String(bonus?.intent_category || '').toUpperCase().trim()
        if (bc) types.add(bc)
      }
      icpIdToTypes.set(id, types)
    }
  }

  // Each ICP contributes +1 to every distinct intent type it requires.
  for (const icpId of refToIcpId.values()) {
    for (const type of icpIdToTypes.get(icpId) ?? []) {
      counts.set(type, (counts.get(type) ?? 0) + 1)
    }
  }
  return counts
}

function attachPrivateDiagnostics(
  icps: PublicIcpEntry[],
  privateDiag: PrivateDiagnosticsBundle | null,
): PublicIcpEntry[] {
  if (!privateDiag) return icps
  return icps.map((icp) => {
    const ref = icp.icp_ref ? String(icp.icp_ref) : ''
    const diag = ref ? privateDiag.byRef.get(ref) : undefined
    if (!diag) return icp
    return {
      ...icp,
      diagnostics: {
        ...icp.diagnostics,
        sourcing_failed: diag.sourcing_failed,
        funnel: normalizeFunnel(diag.funnel),
        per_signal: normalizePerSignal(diag.per_signal),
        rejection_reasons: normalizeReasons(diag.rejection_reasons),
      },
    }
  })
}

// Apply numeric defaults so the UI never renders "undefined" if the stored
// per-signal blob is missing fields (mirrors normalizeFunnel for funnel).
function normalizePerSignal(
  per: Record<string, PerSignalStat> | undefined,
): Record<string, PerSignalStat> | undefined {
  if (!per) return undefined
  const out: Record<string, PerSignalStat> = {}
  for (const [key, stat] of Object.entries(per)) {
    out[key] = {
      signal_index: numberOr(stat?.signal_index, Number(key) || 0),
      evidence_type: String(stat?.evidence_type || 'UNSPECIFIED'),
      companies_submitted: numberOr(stat?.companies_submitted, 0),
      companies_passed: numberOr(stat?.companies_passed, 0),
      signals_submitted: numberOr(stat?.signals_submitted, 0),
      signals_passed: numberOr(stat?.signals_passed, 0),
      avg_score: numberOr(stat?.avg_score, 0),
      sum_score: numberOr(stat?.sum_score, 0),
      max_score: numberOr(stat?.max_score, 0),
    }
  }
  return out
}

function normalizeReasons(
  reasons: Record<string, number> | undefined,
): Record<string, number> | undefined {
  if (!reasons) return undefined
  const out: Record<string, number> = {}
  for (const [key, value] of Object.entries(reasons)) out[key] = numberOr(value, 0)
  return out
}

function normalizeFunnel(funnel: Partial<LeadFunnel> | undefined): LeadFunnel | undefined {
  if (!funnel) return undefined
  return {
    sourced: numberOr(funnel.sourced, 0),
    fit_pass: numberOr(funnel.fit_pass, 0),
    verified: numberOr(funnel.verified, 0),
    intent_valid: numberOr(funnel.intent_valid, 0),
    scored: numberOr(funnel.scored, 0),
  }
}

function buildBenchmarkIssues(doc: PublicBenchmarkReportDoc): BenchmarkIssue[] {
  const counts = new Map<string, number>()
  const icpsByIssue = new Map<string, ModelIssueIcpEntry[]>()

  const explicitIssueCounts = doc.model_issue_counts
  if (!explicitIssueCounts || Object.keys(explicitIssueCounts).length === 0) {
    return []
  }
  for (const [key, count] of Object.entries(explicitIssueCounts)) {
    addIssueCount(counts, key, count)
    const rows = Array.isArray(doc.model_issue_public_icps?.[key])
      ? doc.model_issue_public_icps[key]
      : []
    for (const row of rows) {
      appendIssueIcp(icpsByIssue, key, issueIcpEntry(row))
    }
  }

  return Array.from(counts.entries())
    .map(([key, count]) => issueForKey(key, count, icpsByIssue.get(key) ?? []))
    .filter((issue) => issue.count > 0)
    .sort((a, b) => b.count - a.count || severityRank(a.severity) - severityRank(b.severity) || a.label.localeCompare(b.label))
    .slice(0, 8)
}

function addIssueCount(counts: Map<string, number>, key: string, value: unknown) {
  const count = Math.max(0, Math.round(numberOr(value, 0)))
  if (!key || count <= 0) return
  counts.set(key, (counts.get(key) ?? 0) + count)
}

function appendIssueIcp(
  icpsByIssue: Map<string, ModelIssueIcpEntry[]>,
  key: string,
  row: ModelIssueIcpEntry
) {
  const rows = icpsByIssue.get(key) ?? []
  const rowKey = row.icp_ref || row.icp_hash || String(row.item_rank ?? '')
  if (
    !rowKey ||
    rows.some((existing) => (existing.icp_ref || existing.icp_hash || String(existing.item_rank ?? '')) === rowKey)
  ) {
    icpsByIssue.set(key, rows)
    return
  }
  rows.push(row)
  rows.sort((a, b) => numberOr(a.item_rank, 0) - numberOr(b.item_rank, 0))
  icpsByIssue.set(key, rows)
}

function issueIcpEntry(value: ModelIssueIcpEntry): ModelIssueIcpEntry {
  return {
    item_rank: numberOr(value.item_rank, 0),
    icp_ref: value.icp_ref ? String(value.icp_ref) : '',
    icp_hash: value.icp_hash ? String(value.icp_hash) : '',
    set_id: value.set_id === undefined ? undefined : numberOr(value.set_id, 0),
    day_index: value.day_index === undefined ? undefined : numberOr(value.day_index, 0),
    day_rank: value.day_rank === undefined ? undefined : numberOr(value.day_rank, 0),
    industry_bucket: value.industry_bucket ? String(value.industry_bucket) : undefined,
    score: value.score === undefined ? undefined : numberOr(value.score, 0),
    company_count: value.company_count === undefined ? undefined : numberOr(value.company_count, 0),
  }
}

function issueForKey(key: string, count: number, icps: ModelIssueIcpEntry[]): BenchmarkIssue {
  const normalized = key.toLowerCase()
  if (normalized.includes('hallucinated') || normalized.includes('generic_intent')) {
    return {
      key,
      count,
      label: 'Generic or hallucinated intent',
      severity: 'high',
      description: 'Intent evidence looked fabricated, generic, hardcoded, or not tied closely enough to the ICP.',
      icps,
    }
  }
  if (normalized.includes('stale') || normalized.includes('date') || normalized.includes('freshness')) {
    return {
      key,
      count,
      label: 'Stale or invalid timing',
      severity: 'high',
      description: 'Intent evidence did not appear recent enough or had invalid/future-dated timing.',
      icps,
    }
  }
  if (normalized.includes('low_intent')) {
    return {
      key,
      count,
      label: 'Weak intent match',
      severity: 'medium',
      description: 'The model found companies, but the buying-intent signal was too weak or indirect.',
      icps,
    }
  }
  if (normalized.includes('low_icp') || normalized.includes('icp_or_geo')) {
    return {
      key,
      count,
      label: 'ICP mismatch',
      severity: 'medium',
      description: 'The returned company did not match the target industry, geography, company size, or role profile closely enough.',
      icps,
    }
  }
  if (normalized.includes('zero')) {
    return {
      key,
      count,
      label: 'No companies returned',
      severity: 'medium',
      description: 'The model returned no usable companies for that ICP.',
      icps,
    }
  }
  if (normalized.includes('company_verification')) {
    return {
      key,
      count,
      label: 'Company verification failed',
      severity: 'medium',
      description: 'The company identity or website could not be verified reliably.',
      icps,
    }
  }
  if (normalized.includes('source') || normalized.includes('url') || normalized.includes('fetch')) {
    return {
      key,
      count,
      label: 'Source fetch failed',
      severity: 'low',
      description: 'The model relied on a source that could not be fetched or verified cleanly.',
      icps,
    }
  }
  if (normalized.includes('parser') || normalized.includes('json') || normalized.includes('llm')) {
    return {
      key,
      count,
      label: 'Scoring format issue',
      severity: 'low',
      description: 'The response could not be parsed or scored cleanly.',
      icps,
    }
  }
  return {
    key,
    count,
    label: readableIssueLabel(key),
    severity: 'low',
    description: 'A sanitized benchmark issue was recorded for this model run.',
    icps,
  }
}

function severityRank(severity: BenchmarkIssue['severity']): number {
  if (severity === 'high') return 0
  if (severity === 'medium') return 1
  return 2
}

function readableIssueLabel(value: string): string {
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function stripInternalIcpFields(icps: PublicIcpEntry[]): PublicIcpEntry[] {
  return icps.map((icp) => {
    const publicIcp = { ...icp }
    delete publicIcp.strength_label
    return publicIcp
  })
}

async function fetchLabMinerSpend(supabase: ReturnType<typeof getSupabase>): Promise<LabMinerSpendRollup> {
  const empty = emptyLabMinerSpend()
  const { data: scheduleData, error: scheduleError } = await supabase
    .from('research_reimbursement_schedules')
    .select('award_id, schedule_status, start_epoch, epoch_count, total_microusd')
    .eq('schedule_status', 'scheduled')
    .order('start_epoch', { ascending: false, nullsFirst: false })
    .limit(1000)

  if (scheduleError) {
    console.error('[Research Lab API] reimbursement schedule query failed:', scheduleError)
    return empty
  }

  const schedules = ((scheduleData ?? []) as ReimbursementScheduleRow[])
    .filter((row) => row.award_id && Number.isFinite(Number(row.start_epoch)))
  if (schedules.length === 0) return empty

  const latestEpoch = Math.max(...schedules.map((row) => numberOr(row.start_epoch, 0)))
  const activeSchedules = schedules.filter((row) => {
    const startEpoch = numberOr(row.start_epoch, 0)
    const epochCount = Math.max(1, Math.round(numberOr(row.epoch_count, 1)))
    return startEpoch <= latestEpoch && latestEpoch <= startEpoch + epochCount - 1
  })
  if (activeSchedules.length === 0) {
    return {
      window: { latestEpoch, epochCount: null, activeScheduleCount: 0 },
      byHotkey: {},
    }
  }

  const awardIds = Array.from(new Set(activeSchedules.map((row) => row.award_id).filter(Boolean))) as string[]
  const awardRows: ReimbursementAwardRow[] = []
  for (let i = 0; i < awardIds.length; i += 100) {
    const batch = awardIds.slice(i, i + 100)
    const { data: awardData, error: awardError } = await supabase
      .from('research_reimbursement_award_current')
      .select('award_id, miner_hotkey, eligible_cost_microusd, target_reimbursement_microusd, reimbursement_epochs')
      .in('award_id', batch)

    if (awardError) {
      console.error('[Research Lab API] reimbursement award query failed:', awardError)
      return {
        window: spendWindowForSchedules(latestEpoch, activeSchedules),
        byHotkey: {},
      }
    }
    awardRows.push(...((awardData ?? []) as ReimbursementAwardRow[]))
  }

  const awardsById = new Map(awardRows.map((award) => [award.award_id, award]))
  const byHotkey: Record<string, LabMinerSpendEntry> = {}
  for (const schedule of activeSchedules) {
    if (!schedule.award_id) continue
    const award = awardsById.get(schedule.award_id)
    if (!award) continue
    const hotkey = award.miner_hotkey ? String(award.miner_hotkey) : ''
    if (!hotkey) continue

    const current = byHotkey[hotkey] ?? {
      computeSpendUsd: 0,
      scheduledReimbursementUsd: 0,
      activeAwardCount: 0,
      reimbursementEpochs: null,
    }
    current.computeSpendUsd += microusdToUsd(award.eligible_cost_microusd)
    current.scheduledReimbursementUsd += microusdToUsd(
      award.target_reimbursement_microusd ?? schedule.total_microusd
    )
    current.activeAwardCount += 1
    current.reimbursementEpochs = Math.max(
      current.reimbursementEpochs ?? 0,
      Math.round(numberOr(award.reimbursement_epochs ?? schedule.epoch_count, 0))
    ) || current.reimbursementEpochs
    byHotkey[hotkey] = current
  }

  return {
    window: spendWindowForSchedules(latestEpoch, activeSchedules),
    byHotkey: Object.fromEntries(
      Object.entries(byHotkey).map(([hotkey, entry]) => [
        hotkey,
        {
          ...entry,
          computeSpendUsd: roundUsd(entry.computeSpendUsd),
          scheduledReimbursementUsd: roundUsd(entry.scheduledReimbursementUsd),
        },
      ])
    ),
  }
}

async function fetchPublicLoops(supabase: ReturnType<typeof getSupabase>): Promise<NormalizedLoop[]> {
  const { data, error } = await supabase
    .from('research_lab_public_loop_card_current')
    .select('*')
    .order('current_last_activity_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(LOOP_FETCH_LIMIT)

  if (error) {
    console.error('[Research Lab API] public loop query failed:', error)
    return []
  }

  return ((data ?? []) as PublicLoopRow[])
    .filter(isVisiblePublicLoop)
    .slice(0, LOOP_LIMIT)
    .map((row) => {
      const projectedOutcomeLabel = row.current_outcome_label || 'submitted'
      const projectedOutcomeBand = row.current_outcome_band || 'pending'
      const doc = row.current_event_doc ?? {}
      const lastActivityAt = row.current_last_activity_at || row.created_at
      const candidateCount = numberOr(row.current_candidate_count, 0)
      const scoredCandidateCount = numberOr(row.current_scored_candidate_count, 0)
      const displayStatus = deriveResearchLabLoopStatus({
        outcomeLabel: projectedOutcomeLabel,
        outcomeBand: projectedOutcomeBand,
        runId: row.current_run_id,
        receiptId: row.current_receipt_id,
        candidateCount,
        scoredCandidateCount,
        currentCandidateStatus:
          row.current_candidate_status ??
          stringOr(doc.current_candidate_status) ??
          stringOr(doc.candidate_status) ??
          dominantCountKey(doc.candidate_status_counts),
        currentReason:
          row.current_reason ??
          stringOr(doc.current_reason) ??
          stringOr(doc.candidate_reason) ??
          dominantCountKey(doc.candidate_reason_counts) ??
          doc.projection_reason,
        currentQueueStatus: row.current_queue_status ?? doc.queue_status,
        currentReceiptStatus: row.current_receipt_status ?? doc.receipt_status,
        currentStatus: row.current_status,
      })
      return {
        cardId: row.card_id,
        ticketId: row.ticket_id,
        runId: row.current_run_id,
        receiptId: row.current_receipt_id,
        minerHotkey: row.miner_hotkey,
        researchArea: row.research_area || 'generalist',
        researchFocusSummary: row.research_focus_summary || '',
        topicTags: arrayOfStrings(row.current_topic_tags ?? row.topic_tags),
        topicSignatureHash: row.current_topic_signature_hash || row.topic_signature_hash,
        outcomeLabel: projectedOutcomeLabel,
        statusKey: displayStatus.key,
        statusLabel: displayStatus.label,
        outcomeBand: displayStatus.band,
        candidateCount,
        scoredCandidateCount,
        bestCandidatePublicSummary: row.current_best_candidate_public_summary || '',
        lastActivityAt,
        submittedAt: row.created_at,
        statusNote: displayStatus.note,
      }
    })
}

function isVisiblePublicLoop(row: PublicLoopRow): boolean {
  return !HIDDEN_LOOP_MINER_PREFIXES.some((prefix) => row.miner_hotkey.startsWith(prefix))
}

function groupLoopsByTopic(loops: NormalizedLoop[]): TopicGroup[] {
  const groups = new Map<string, TopicGroup>()
  for (const loop of loops) {
    const key = loop.topicSignatureHash || loop.topicTags.join('|') || 'unknown'
    const group = groups.get(key) ?? {
      topicSignatureHash: key,
      topicTags: loop.topicTags.length ? loop.topicTags : ['unknown'],
      total: 0,
      running: 0,
      completed: 0,
      scored: 0,
      promisingOrPromoted: 0,
      noGainOrFailed: 0,
      latestActivityAt: loop.lastActivityAt,
    }
    group.total += 1
    if (isActiveResearchLabLoopStatus(loop.statusKey)) group.running += 1
    if (isCompletedResearchLabLoopStatus(loop.statusKey)) {
      group.completed += 1
    }
    if (isScoredResearchLabLoopStatus(loop.statusKey)) group.scored += 1
    if (isPromisingResearchLabLoopStatus(loop.statusKey, loop.outcomeBand)) group.promisingOrPromoted += 1
    if (isNoGainOrFailedResearchLabLoopStatus(loop.statusKey)) group.noGainOrFailed += 1
    if (new Date(loop.lastActivityAt).getTime() > new Date(group.latestActivityAt).getTime()) {
      group.latestActivityAt = loop.lastActivityAt
    }
    groups.set(key, group)
  }
  return Array.from(groups.values()).sort(
    (a, b) => new Date(b.latestActivityAt).getTime() - new Date(a.latestActivityAt).getTime()
  )
}

function emptyLabMinerSpend(): LabMinerSpendRollup {
  return {
    window: {
      latestEpoch: null,
      epochCount: null,
      activeScheduleCount: 0,
    },
    byHotkey: {},
  }
}

function spendWindowForSchedules(
  latestEpoch: number,
  schedules: ReimbursementScheduleRow[],
): LabMinerSpendWindow {
  const epochCounts = schedules
    .map((row) => Math.max(1, Math.round(numberOr(row.epoch_count, 0))))
    .filter((value) => value > 0)
  return {
    latestEpoch,
    epochCount: epochCounts.length > 0 ? Math.max(...epochCounts) : null,
    activeScheduleCount: schedules.length,
  }
}

function microusdToUsd(value: unknown): number {
  return Math.max(0, numberOr(value, 0) / 1_000_000)
}

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}

function numberOr(value: unknown, fallback: number): number {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

function arrayOfStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0)
}

function stringOr(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function dominantCountKey(counts: Record<string, number> | undefined): string | undefined {
  if (!counts) return undefined
  let bestKey = ''
  let bestCount = 0
  for (const [key, value] of Object.entries(counts)) {
    const count = numberOr(value, 0)
    if (key && count > bestCount) {
      bestKey = key
      bestCount = count
    }
  }
  return bestKey || undefined
}

function scoreBand(score: number): string {
  if (score >= 80) return '80_plus'
  if (score >= 60) return '60_79'
  if (score >= 40) return '40_59'
  if (score > 0) return '1_39'
  return 'zero'
}
