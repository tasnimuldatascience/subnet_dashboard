import { NextRequest, NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/admin-supabase'
import {
  buildResearchLabLoopTimeline,
  type ResearchLabLoopTimeline,
  type ResearchLabTimelinePhase,
  type ResearchLabTimelineRawRow,
  type ResearchLabTimelineSourceInput,
} from '@/lib/research-lab-timeline'
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
import {
  buildResearchLabDailyComputeSpend,
  buildResearchLabFinalizedRunReconciliation,
  researchLabFinalizedRunIds,
  type ResearchLabDailyComputeSpendPoint,
  type ResearchLabFinalizedRunReconciliation,
  type ResearchLabTerminalReceiptEvent,
} from '@/lib/research-lab-compute-spend'
import { fetchGatewayPcr0Acceptance } from '@/lib/research-lab-pcr0-readiness'
import type {
  AdminLabCandidateRunDetail,
  AdminLabChampionSummary,
  AdminLabCompanyDetail,
  AdminLabDailyBenchmark,
  AdminLabErrorDetail,
  AdminLabFunnelDetail,
  AdminLabIcpDetail,
  AdminLabIntentSignalDetail,
  AdminLabRunDetail,
  AdminLabTelemetryState,
} from '@/lib/admin-research-lab-telemetry'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const LOOP_LIMIT = 250
const ACTIVE_RUN_LIMIT = 40
const COMPUTE_SPEND_DAYS = 30
const COMPUTE_SPEND_BATCH_SIZE = 1_000
const LEADPOET_NETUID = 71
const LEADPOET_GATEWAY_URL =
  process.env.LEADPOET_GATEWAY_URL?.trim() ||
  process.env.FULFILLMENT_GATEWAY_URL?.trim() ||
  'http://52.91.135.79:8000'
const PUBLIC_LOG_WINDOW_MS = 24 * 60 * 60 * 1000
const PUBLIC_LOG_LIMIT = 1_000
const FRESH_PUBLISHED_ATTESTATION_MS = 3 * 60 * 60 * 1000
const DEGRADED_PUBLISHED_ATTESTATION_MS = 6 * 60 * 60 * 1000
const FRESH_WEIGHT_SUBMISSION_MS = 3 * 60 * 60 * 1000
const DEGRADED_WEIGHT_SUBMISSION_MS = 6 * 60 * 60 * 1000
const FRESH_ARWEAVE_CHECKPOINT_MS = 6 * 60 * 60 * 1000
const DEGRADED_ARWEAVE_CHECKPOINT_MS = 12 * 60 * 60 * 1000
const STALE_ACTIVE_MS = 30 * 60 * 1000
const STALE_SCORING_MS = 15 * 60 * 1000
const FRESH_DATA_MS = 15 * 60 * 1000
const DEGRADED_DATA_MS = 60 * 60 * 1000
const SUPABASE_IN_FILTER_BATCH_SIZE = 100
const LIVE_TELEMETRY_LIMIT = 10_000
const CHAMPION_LIMIT = 10
const LIVE_BENCHMARK_STALE_MS = 15 * 60 * 1000
const LEADS_PER_ICP_NORMALIZER = 5

type AdminHealthState = 'healthy' | 'degraded' | 'critical' | 'unknown'
type AdminScoringState = 'active' | 'paused' | 'stalled' | 'blocked' | 'idle' | 'unknown'

type AdminLabLoopRow = {
  card_id: string
  ticket_id: string
  miner_hotkey: string | null
  research_area: string | null
  research_focus_summary: string | null
  topic_tags: string[] | null
  topic_signature_hash: string | null
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
  current_event_doc: Record<string, unknown> | null
  current_status?: string | null
  public_status?: string | null
  payment_state?: string | null
  execution_state?: string | null
  candidate_state?: string | null
  result_state?: string | null
  ops_reason?: string | null
  status_detail?: string | null
  ops_warnings?: unknown
  current_public_status?: string | null
  current_payment_state?: string | null
  current_execution_state?: string | null
  current_candidate_state?: string | null
  current_result_state?: string | null
  current_ops_reason?: string | null
  current_status_detail?: string | null
  current_ops_warnings?: unknown
  current_candidate_status?: string | null
  current_reason?: string | null
  current_queue_status?: string | null
  current_receipt_status?: string | null
  improvement_gate_decision?: string | null
  current_improvement_gate_decision?: string | null
  promotion_status?: string | null
  current_promotion_status?: string | null
  promotion_event_type?: string | null
  current_promotion_event_type?: string | null
  promotion_event?: string | null
  current_promotion_event?: string | null
  event_type?: string | null
  current_event_type?: string | null
  created_at: string
}

export type AdminLabLoopSummary = {
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
  outcomeBand: string
  publicStatus?: string
  paymentState?: string
  executionState?: string
  candidateState?: string
  resultState?: string
  opsReason?: string
  statusDetail?: string
  opsWarnings?: string[]
  statusKey: string
  statusLabel: string
  statusNote?: AdminLoopStatusNote
  actionNote?: AdminLoopStatusNote
  candidateCount: number
  scoredCandidateCount: number
  bestCandidatePublicSummary: string
  lastActivityAt: string
  submittedAt: string
}

export type AdminLoopStatusNote = {
  tone: ResearchLabLoopStatusNote['tone']
  label: string
  detail: string
}

export type AdminLabHealthSignal = {
  id: string
  label: string
  value: string
  state: AdminHealthState
  detail: string
  updatedAt?: string | null
}

export type AdminLabScoringSummary = {
  state: AdminScoringState
  label: string
  detail: string
  source: 'explicit' | 'inferred' | 'missing'
  paused: boolean
  pauseReason: string | null
  controlUpdatedAt: string | null
  activeRuns: number
  scoringRuns: number
  queuedRuns: number
  blockedRuns: number
  staleRuns: number
  candidatesRemaining: number
  icpsRemaining: number | null
  scoreBundlesLastHour: number
  scoreBundlesLast24h: number
  lastScoringAt: string | null
  oldestActiveRunAt: string | null
}

export type AdminLabActiveRun = {
  ticketId: string
  runId: string | null
  receiptId: string | null
  minerHotkey: string
  researchFocusSummary: string
  topicTags: string[]
  statusKey: string
  statusLabel: string
  phase: string
  candidateCount: number
  scoredCandidateCount: number
  candidatesRemaining: number
  icpTotal: number | null
  icpsScored: number | null
  icpsRemaining: number | null
  scoreBundleId: string | null
  scoreBundleStatus: string | null
  blocker: string | null
  submittedAt: string
  lastActivityAt: string
  ageMs: number
  idleMs: number
  stale: boolean
}

export type AdminLabPipelineStage = {
  id: string
  label: string
  count: number
  staleCount: number
  percent: number
}

export type AdminLabBenchmarkSummary = {
  state: AdminHealthState
  reportId: string | null
  benchmarkDate: string | null
  rollingWindowHash: string | null
  aggregateScore: number | null
  itemCount: number
  publicIcpCount: number
  privateHoldoutIcpCount: number
  currentStatusAt: string | null
  ageMs: number | null
  issueCount: number
  topIssues: Array<{ key: string; count: number }>
  detail: string
}

export type AdminLabAlertSummary = {
  state: AdminHealthState
  source: 'ops_telemetry' | 'public_transparency_log' | 'none'
  sourceAvailable: boolean
  unavailableReason: string | null
  totalLast24h: number
  criticalLast24h: number
  warningLast24h: number
  activeCount: number
  verifiedEventCount: number
  weightSubmissionCount: number
  epochAuditCount: number
  latestObservedAt: string | null
  latestCheckpointAt: string | null
  latestCheckpointUrl: string | null
  recent: AdminLabAlert[]
}

export type AdminLabAlert = {
  id: string
  severity: string
  source: string
  title: string
  fingerprint: string
  status: string
  count: number
  firstSeenAt: string | null
  lastSeenAt: string | null
}

export type AdminLabAttestationSummary = {
  state: AdminHealthState
  source: 'ops_attestation_current' | 'published_weight_bundles' | 'none'
  verificationMode: 'expected_match' | 'gateway_acceptance' | 'observation_only'
  sourceAvailable: boolean
  unavailableReason: string | null
  totalNodes: number
  matchedNodes: number
  mismatchedNodes: number
  missingNodes: number
  expectedPcr0: string | null
  latestAttestedAt: string | null
  latestEpoch: number | null
  acceptanceCheckedAt: string | null
  acceptanceDetail: string | null
  nodes: AdminLabAttestationNode[]
}

export type AdminLabAttestationNode = {
  id: string
  component: string
  nodeId: string
  hotkey: string | null
  expectedPcr0: string | null
  observedPcr0: string | null
  matched: boolean | null
  buildId: string | null
  gitSha: string | null
  attestedAt: string | null
  epoch: number | null
  transparencyEventHash: string | null
  acceptanceCheckedAt: string | null
  acceptanceDetail: string | null
}

export type AdminLabSourcingModelSummary = {
  sourceAvailable: boolean
  unavailableReason: string | null
  status: string | null
  versionId: string | null
  gitCommitSha: string | null
  imageRefHash: string | null
  buildId: string | null
  branch: string | null
  source: string | null
  actorRef: string | null
  componentRegistryVersion: string | null
  scoringAdapterVersion: string | null
  modelArtifactHash: string | null
  manifestHash: string | null
  currentPointerUri: string | null
  activatedAt: string | null
}

export type AdminLabDataFreshness = {
  state: AdminHealthState
  latestActivityAt: string | null
  ageMs: number | null
  loopCount: number
}

export type AdminLabComputeSpendSummary = {
  sourceAvailable: boolean
  unavailableReason: string | null
  days: number
  points: ResearchLabDailyComputeSpendPoint[]
  totalUsd: number
  averageDailyUsd: number
  latestDayUsd: number
  runCount: number
  reconciliation: AdminLabFinalizedRunReconciliation
}

export type AdminLabFinalizedRunReconciliation = ResearchLabFinalizedRunReconciliation & {
  sourceAvailable: boolean
  unavailableReason: string | null
}

export type AdminLabOpsSummary = {
  state: AdminHealthState
  healthSignals: AdminLabHealthSignal[]
  dataFreshness: AdminLabDataFreshness
  scoring: AdminLabScoringSummary
  activeRuns: AdminLabActiveRun[]
  pipeline: AdminLabPipelineStage[]
  benchmark: AdminLabBenchmarkSummary
  alerts: AdminLabAlertSummary
  attestation: AdminLabAttestationSummary
  sourcingModel: AdminLabSourcingModelSummary
  computeSpend: AdminLabComputeSpendSummary
  dailyBenchmark: AdminLabDailyBenchmark
  champions: AdminLabChampionSummary[]
}

export type AdminResearchLabPayload = {
  loops: AdminLabLoopSummary[]
  ops: AdminLabOpsSummary
  stats: {
    totalLoops: number
    runningLoops: number
    scoredLoops: number
    failedLoops: number
    uniqueMiners: number
  }
  fetchedAt: string
}

export type AdminResearchLabTimelinePayload = {
  loop: AdminLabLoopSummary
  timeline: ResearchLabLoopTimeline
  runDetail: AdminLabRunDetail
  fetchedAt: string
}

export async function GET(request: NextRequest) {
  let supabase
  try {
    supabase = getAdminSupabase()
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'admin supabase not configured'
    return NextResponse.json({ error: msg }, { status: 503 })
  }

  const ticketId = request.nextUrl.searchParams.get('ticketId')?.trim()
  if (ticketId) {
    let detail: AdminResearchLabTimelinePayload | null = null
    try {
      detail = await fetchAdminLabTimeline(supabase, ticketId)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown Supabase error'
      return NextResponse.json({ error: msg }, { status: 502 })
    }
    if (!detail) {
      return NextResponse.json({ error: 'Research Lab loop not found' }, { status: 404 })
    }
    return NextResponse.json(detail, { headers: { 'Cache-Control': 'no-store' } })
  }

	  let loops: AdminLabLoopSummary[] = []
	  let ops: AdminLabOpsSummary
	  try {
	    loops = await fetchAdminLabLoops(supabase)
	    ops = await fetchAdminLabOps(supabase, loops)
	  } catch (e) {
	    const msg = e instanceof Error ? e.message : 'Unknown Supabase error'
	    return NextResponse.json({ error: msg }, { status: 502 })
  }
  const miners = new Set(loops.map((loop) => loop.minerHotkey).filter(Boolean))
  return NextResponse.json(
	    {
	      loops,
	      ops,
	      stats: {
	        totalLoops: loops.length,
	        runningLoops: loops.filter((loop) => isActiveResearchLabLoopStatus(loop.statusKey)).length,
	        scoredLoops: loops.filter((loop) => isScoredResearchLabLoopStatus(loop.statusKey)).length,
	        failedLoops: loops.filter((loop) => isNoGainOrFailedResearchLabLoopStatus(loop.statusKey) || isFailedOutcome(loop.outcomeLabel, loop.outcomeBand)).length,
	        uniqueMiners: miners.size,
	      },
      fetchedAt: new Date().toISOString(),
    } satisfies AdminResearchLabPayload,
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

async function fetchAdminLabLoops(
  supabase: ReturnType<typeof getAdminSupabase>,
): Promise<AdminLabLoopSummary[]> {
  const { data, error } = await supabase
    .from('research_lab_public_loop_card_current')
    .select('*')
    .order('current_last_activity_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(LOOP_LIMIT)

  if (error) {
    throw new Error(`Supabase error: ${error.message}`)
  }

  return ((data ?? []) as AdminLabLoopRow[]).map(normalizeLoopRow)
}

async function fetchAdminLabTimeline(
  supabase: ReturnType<typeof getAdminSupabase>,
  ticketId: string,
): Promise<AdminResearchLabTimelinePayload | null> {
  const { data, error } = await supabase
    .from('research_lab_public_loop_card_current')
    .select('*')
    .eq('ticket_id', ticketId)
    .limit(1)

  if (error) {
    throw new Error(`Supabase error: ${error.message}`)
  }

  const row = ((data ?? []) as AdminLabLoopRow[])[0] ?? null
  if (!row) return null

  const loop = normalizeLoopRow(row)
  const currentRunId = row.current_run_id
  const currentReceiptId = row.current_receipt_id
  const fetches: Array<Promise<TimelineSourceResult>> = [
    fetchTimelineSourceByTicket(supabase, 'research_loop_ticket_events', 'ticket', ticketId),
    fetchTimelineSourceByTicket(supabase, 'research_loop_run_queue_events', 'queue', ticketId),
    fetchTimelineSourceByTicket(supabase, 'research_lab_auto_research_loop_events', 'auto_research', ticketId),
    fetchTimelineSourceByTicket(supabase, 'research_lab_candidate_evaluation_events', 'candidate', ticketId),
    fetchTimelineSourceByTicket(supabase, 'research_evaluation_score_bundle_events', 'scoring', ticketId),
    fetchTimelineSourceByTicket(supabase, 'research_lab_candidate_promotion_events', 'promotion', ticketId),
    fetchTimelineSourceByTicket(supabase, 'research_lab_public_loop_card_events', 'public_projection', ticketId),
  ]

  if (currentRunId) {
    fetches.push(
      fetchTimelineSourceByRun(supabase, 'research_loop_run_queue_events', 'queue', currentRunId),
      fetchTimelineSourceByRun(supabase, 'research_lab_auto_research_loop_events', 'auto_research', currentRunId),
      fetchTimelineSourceByRun(supabase, 'research_lab_candidate_evaluation_events', 'candidate', currentRunId),
      fetchTimelineSourceByRun(supabase, 'research_evaluation_score_bundle_events', 'scoring', currentRunId),
      fetchTimelineSourceByRun(supabase, 'research_lab_candidate_promotion_events', 'promotion', currentRunId),
    )
  }

  const results = await Promise.all(fetches)
  const sources = mergeTimelineSources(results)
  const timeline = buildResearchLabLoopTimeline({
    ticketId,
    currentRunId,
    currentReceiptId,
    currentLoop: {
      cardId: row.card_id,
      ticketId: row.ticket_id,
      runId: currentRunId,
      receiptId: currentReceiptId,
      minerHotkey: row.miner_hotkey,
      outcomeLabel: row.current_outcome_label,
      outcomeBand: row.current_outcome_band,
      statusLabel: row.current_status,
      submittedAt: row.created_at,
      lastActivityAt: row.current_last_activity_at,
      eventDoc: row.current_event_doc,
    },
    sources,
  })
  const runDetail = await fetchAdminLabRunDetail(supabase, loop)

  return { loop, timeline, runDetail, fetchedAt: new Date().toISOString() }
}

type TimelineSourceResult = ResearchLabTimelineSourceInput

async function fetchTimelineSourceByTicket(
  supabase: ReturnType<typeof getAdminSupabase>,
  table: string,
  phase: ResearchLabTimelinePhase,
  ticketId: string,
): Promise<TimelineSourceResult> {
  return fetchTimelineSource(supabase, table, phase, 'ticket_id', ticketId)
}

async function fetchTimelineSourceByRun(
  supabase: ReturnType<typeof getAdminSupabase>,
  table: string,
  phase: ResearchLabTimelinePhase,
  runId: string,
): Promise<TimelineSourceResult> {
  return fetchTimelineSource(supabase, table, phase, 'run_id', runId)
}

async function fetchTimelineSource(
  supabase: ReturnType<typeof getAdminSupabase>,
  table: string,
  phase: ResearchLabTimelinePhase,
  column: 'ticket_id' | 'run_id',
  value: string,
): Promise<TimelineSourceResult> {
  const { data, error } = await supabase
    .from(table)
    .select('*')
    .eq(column, value)
    .limit(1000)

  if (error) {
    if (!isExpectedOptionalTimelineSourceMiss(error.message)) {
      console.warn(`[admin:research-lab] timeline source unavailable: ${table}.${column}`, error.message)
    }
    return { source: table, phase, rows: [] }
  }

  return {
    source: table,
    phase,
    rows: (data ?? []) as ResearchLabTimelineRawRow[],
  }
}

function mergeTimelineSources(results: TimelineSourceResult[]): ResearchLabTimelineSourceInput[] {
  const bySource = new Map<string, ResearchLabTimelineSourceInput>()
  for (const result of results) {
    const key = `${result.phase}:${result.source}`
    const current = bySource.get(key) ?? {
      source: result.source,
      phase: result.phase,
      rows: [],
    }
    current.rows.push(...result.rows)
    bySource.set(key, current)
  }
  return Array.from(bySource.values())
}

type ScoreBundleMetrics = {
  byTicket: Map<string, RunScoreMetrics>
  lastScoringAt: string | null
  scoreBundlesLastHour: number
  scoreBundlesLast24h: number
}

type RunScoreMetrics = {
  scoreBundleId: string | null
  scoreBundleStatus: string | null
  icpTotal: number | null
  icpsScored: number | null
  lastScoringAt: string | null
}

type ScoringControlSummary = {
  source: 'explicit' | 'missing'
  paused: boolean
  state: string | null
  pauseReason: string | null
  updatedAt: string | null
}

async function fetchAdminLabOps(
  supabase: ReturnType<typeof getAdminSupabase>,
  loops: AdminLabLoopSummary[],
): Promise<AdminLabOpsSummary> {
  const icpMetadata = fetchIcpMetadata(supabase)
  const [
    scoreMetrics,
    scoringControl,
    benchmark,
    alerts,
    attestation,
    sourcingModel,
    computeSpend,
    dailyBenchmark,
    champions,
  ] = await Promise.all([
    fetchScoreBundleMetrics(supabase, loops),
    fetchScoringControl(supabase),
    fetchBenchmarkSummary(supabase),
    fetchAlertSummary(supabase),
    fetchAttestationSummary(supabase),
    fetchSourcingModelSummary(supabase),
    fetchComputeSpendSummary(supabase),
    fetchDailyBenchmarkTelemetry(supabase, icpMetadata),
    fetchChampionTelemetry(supabase, icpMetadata),
  ])

  const dataFreshness = buildDataFreshness(loops)
  const activeRuns = buildActiveRuns(loops, scoreMetrics.byTicket)
  const pipeline = buildPipelineStages(loops)
  const scoring = buildScoringSummary({
    loops,
    activeRuns,
    metrics: scoreMetrics,
    control: scoringControl,
  })
  const healthSignals = buildHealthSignals({
    dataFreshness,
    scoring,
    benchmark,
    alerts,
    attestation,
  })

  return {
    state: worstHealthState(healthSignals.map((signal) => signal.state)),
    healthSignals,
    dataFreshness,
    scoring,
    activeRuns,
    pipeline,
    benchmark,
    alerts,
    attestation,
    sourcingModel,
    computeSpend,
    dailyBenchmark,
    champions,
  }
}

type IcpMetadata = {
  icpRef: string
  icpHash: string | null
  industry: string | null
  subIndustry: string | null
  intentSignals: AdminLabIntentSignalDetail[]
}

type IcpMetadataSnapshot = {
  byRef: Map<string, IcpMetadata>
  latestRefs: string[]
  latestRollingWindowHash: string | null
}

type ProviderCostTelemetryRow = {
  candidate_id?: string | null
  benchmark_date?: string | null
  run_scope?: string | null
  run_type?: string | null
  runner_role?: string | null
  provider?: string | null
  endpoint?: string | null
  status_code?: number | null
  cost_usd?: number | string | null
  spent_after_usd?: number | string | null
  cap_usd?: number | string | null
  cap_state?: string | null
  icp_ref?: string | null
  icp_hash?: string | null
  created_at?: string | null
  event_doc?: Record<string, unknown> | null
}

type CompanyTelemetryRow = {
  label_id?: string | null
  candidate_id?: string | null
  run_id?: string | null
  score_bundle_id?: string | null
  context_ref?: string | null
  icp_ref?: string | null
  model_side?: string | null
  is_reference_model?: boolean | null
  final_score?: number | string | null
  company_name?: string | null
  company_website?: string | null
  company_linkedin?: string | null
  fit_passed?: boolean | null
  intent_passed?: boolean | null
  failure_reason?: string | null
  industry?: string | null
  country?: string | null
  captured_at?: string | null
  created_at?: string | null
}

type IcpCostRollup = {
  spendUsd: number
  budgetUsd: number | null
  eventCount: number
  errorCount: number
  lastActivityAt: string | null
}

async function fetchIcpMetadata(
  supabase: ReturnType<typeof getAdminSupabase>,
): Promise<IcpMetadataSnapshot> {
  const { data, error } = await supabase
    .from('research_lab_rolling_icp_windows')
    .select('rolling_window_hash, created_at, window_doc')
    .order('created_at', { ascending: false, nullsFirst: false })
    .limit(30)

  if (error) {
    console.warn('[admin:research-lab] ICP metadata unavailable', error.message)
    return { byRef: new Map(), latestRefs: [], latestRollingWindowHash: null }
  }

  const byRef = new Map<string, IcpMetadata>()
  let latestRefs: string[] = []
  let latestRollingWindowHash: string | null = null
  for (const [rowIndex, row] of ((data ?? []) as Array<Record<string, unknown>>).entries()) {
    const doc = objectRecord(row.window_doc) ?? {}
    const refsForWindow: string[] = []
    for (const set of arrayOfRecords(doc.sets) ?? []) {
      for (const icp of arrayOfRecords(set.selected_icps) ?? []) {
        const icpRef = stringOr(icp.icp_ref)
        if (!icpRef) continue
        refsForWindow.push(icpRef)
        if (!byRef.has(icpRef)) {
          byRef.set(icpRef, {
            icpRef,
            icpHash: stringOr(icp.icp_hash) ?? null,
            industry: stringOr(icp.industry) ?? null,
            subIndustry: stringOr(icp.sub_industry) ?? null,
            intentSignals: intentSignalsFromSignature(icp.intent_signal_signature),
          })
        }
      }
    }
    if (rowIndex === 0) {
      latestRefs = uniqueStrings(refsForWindow)
      latestRollingWindowHash = stringOr(row.rolling_window_hash) ?? stringOr(doc.rolling_window_hash) ?? null
    }
  }

  const setIds = uniqueStrings(
    Array.from(byRef.keys()).map((ref) => parseTelemetryIcpRef(ref).setId),
  )
  for (const batch of chunked(setIds, SUPABASE_IN_FILTER_BATCH_SIZE)) {
    const { data: setData, error: setError } = await supabase
      .from('qualification_private_icp_sets')
      .select('set_id, icps')
      .in('set_id', batch)

    if (setError) {
      console.warn('[admin:research-lab] canonical ICP intent metadata unavailable', setError.message)
      break
    }

    for (const setRow of (setData ?? []) as Array<Record<string, unknown>>) {
      const setId = String(setRow.set_id ?? '')
      for (const icp of arrayOfRecords(setRow.icps) ?? []) {
        const icpId = stringOr(icp.icp_id)
        if (!setId || !icpId) continue
        const ref = `qualification_private_icp_sets:${setId}:${icpId}`
        const current = byRef.get(ref)
        if (!current) continue
        byRef.set(ref, {
          ...current,
          industry: stringOr(icp.industry) ?? current.industry,
          subIndustry: stringOr(icp.sub_industry) ?? current.subIndustry,
          intentSignals: normalizeIcpIntentSignals(icp, current.intentSignals),
        })
      }
    }
  }
  return { byRef, latestRefs, latestRollingWindowHash }
}

function parseTelemetryIcpRef(ref: string): { setId: string; icpId: string } {
  const parts = ref.split(':')
  return {
    setId: parts.length >= 2 ? parts[1] : '',
    icpId: parts.length >= 3 ? parts[2] : parts.at(-1) ?? '',
  }
}

function intentSignalsFromSignature(value: unknown): AdminLabIntentSignalDetail[] {
  const signature = stringOr(value)
  if (!signature) return []
  return uniqueStrings(signature.split('|').map((item) => item.trim()))
    .map((text, index) => ({
      text: text.charAt(0).toUpperCase() + text.slice(1),
      category: null,
      maxAgeDays: null,
      primary: index === 0,
    }))
}

function normalizeIcpIntentSignals(
  icp: Record<string, unknown>,
  fallback: AdminLabIntentSignalDetail[],
): AdminLabIntentSignalDetail[] {
  const primaryText = stringOr(icp.intent_signal) ?? ''
  const primaryCategory = stringOr(icp.intent_category) ?? null
  const primaryMaxAgeDays = finiteNumberOrNull(icp.intent_max_age_days)
  const bonusByText = new Map<string, Record<string, unknown>>()
  for (const bonus of arrayOfRecords(icp.bonus_intents) ?? []) {
    const text = stringOr(bonus.intent_signal) ?? stringOr(bonus.text)
    if (text) bonusByText.set(text.toLowerCase(), bonus)
  }

  const rawSignals = Array.isArray(icp.intent_signals) ? icp.intent_signals : []
  const normalized: AdminLabIntentSignalDetail[] = []
  const seen = new Set<string>()
  const addSignal = (value: unknown, index: number) => {
    const record = objectRecord(value)
    const text = typeof value === 'string'
      ? stringOr(value)
      : stringOr(record?.text) ?? stringOr(record?.intent_signal)
    if (!text) return
    const key = text.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    const bonus = bonusByText.get(key)
    const primary = primaryText ? key === primaryText.toLowerCase() : index === 0
    normalized.push({
      text,
      category:
        stringOr(record?.intent_category) ??
        stringOr(record?.evidence_type) ??
        (primary ? primaryCategory : stringOr(bonus?.intent_category) ?? null),
      maxAgeDays:
        finiteNumberOrNull(record?.intent_max_age_days) ??
        finiteNumberOrNull(record?.recency_cap_days) ??
        (primary ? primaryMaxAgeDays : finiteNumberOrNull(bonus?.intent_max_age_days)),
      primary,
    })
  }

  rawSignals.forEach(addSignal)
  if (primaryText) addSignal(primaryText, 0)
  for (const bonus of bonusByText.values()) addSignal(bonus, normalized.length)
  return normalized.length > 0 ? normalized : fallback
}

async function fetchDailyBenchmarkTelemetry(
  supabase: ReturnType<typeof getAdminSupabase>,
  metadataPromise: Promise<IcpMetadataSnapshot>,
): Promise<AdminLabDailyBenchmark> {
  const { data: dispatchData, error: dispatchError } = await supabase
    .from('research_lab_scoring_dispatch_events')
    .select('dispatch_event_id, dispatch_status, dispatch_type, event_doc, benchmark_bundle_id, rolling_window_hash, worker_ref, created_at')
    .eq('dispatch_type', 'private_baseline_rebenchmark')
    .order('created_at', { ascending: false, nullsFirst: false })
    .limit(50)

  if (dispatchError) {
    console.warn('[admin:research-lab] daily benchmark dispatch unavailable', dispatchError.message)
    return emptyDailyBenchmark('Daily benchmark dispatch telemetry is unavailable.')
  }

  const dispatches = (dispatchData ?? []) as Array<Record<string, unknown>>
  const start = dispatches.find((row) => {
    const doc = objectRecord(row.event_doc)
    return (stringOr(row.dispatch_status) ?? '').toLowerCase() === 'assigned' && Boolean(stringOr(doc?.benchmark_date))
  }) ?? dispatches.find((row) => Boolean(stringOr(objectRecord(row.event_doc)?.benchmark_date)))
  if (!start) return emptyDailyBenchmark('No daily benchmark dispatch has been recorded yet.')

  const startDoc = objectRecord(start.event_doc) ?? {}
  const benchmarkDate = stringOr(startDoc.benchmark_date) ?? new Date().toISOString().slice(0, 10)
  const attempt = Math.max(0, Math.round(numberOr(startDoc.benchmark_attempt, 0)))
  const icpsTotal = Math.max(0, Math.round(numberOr(startDoc.selected_icp_count, 0)))
  const startedAt = isoStringOr(start.created_at) ?? null
  const contextPrefix = `daily-${benchmarkDate}-a${attempt}-%`

  const [costResult, companyResult, bundleResult, metadata] = await Promise.all([
    supabase
      .from('research_lab_provider_cost_events')
      .select('candidate_id, benchmark_date, run_scope, run_type, runner_role, provider, endpoint, status_code, cost_usd, spent_after_usd, cap_usd, cap_state, icp_ref, icp_hash, created_at, event_doc')
      .eq('benchmark_date', benchmarkDate)
      .eq('run_type', 'private_baseline_rebenchmark')
      .gte('created_at', startedAt ?? '1970-01-01T00:00:00Z')
      .order('created_at', { ascending: true, nullsFirst: false })
      .limit(LIVE_TELEMETRY_LIMIT),
    supabase
      .from('research_lab_company_label_examples')
      .select('label_id, candidate_id, run_id, score_bundle_id, context_ref, icp_ref, model_side, is_reference_model, final_score, company_name, company_website, company_linkedin, fit_passed, intent_passed, failure_reason, industry, country, captured_at, created_at')
      .like('context_ref', contextPrefix)
      .order('created_at', { ascending: true, nullsFirst: false })
      .limit(LIVE_TELEMETRY_LIMIT),
    supabase
      .from('research_lab_private_model_benchmark_current')
      .select('benchmark_bundle_id, benchmark_date, aggregate_score, benchmark_quality, current_benchmark_status, current_event_type, current_status_at, rolling_window_hash, score_summary_doc, created_at')
      .eq('benchmark_date', benchmarkDate)
      .order('current_status_at', { ascending: false, nullsFirst: false })
      .limit(5),
    metadataPromise,
  ])

  const costs = costResult.error ? [] : (costResult.data ?? []) as ProviderCostTelemetryRow[]
  const companies = companyResult.error ? [] : (companyResult.data ?? []) as CompanyTelemetryRow[]
  const completedBundle = bundleResult.error
    ? undefined
    : ((bundleResult.data ?? []) as Array<Record<string, unknown>>).find((row) =>
        ['completed', 'published'].includes((stringOr(row.current_benchmark_status) ?? stringOr(row.current_event_type) ?? '').toLowerCase()),
      )
  if (costResult.error) console.warn('[admin:research-lab] daily provider cost telemetry unavailable', costResult.error.message)
  if (companyResult.error) console.warn('[admin:research-lab] daily company telemetry unavailable', companyResult.error.message)
  if (bundleResult.error) console.warn('[admin:research-lab] daily completed bundle lookup unavailable', bundleResult.error.message)

  const costByIcp = rollupCostsByIcp(costs)
  const companiesByIcp = groupCompaniesByIcp(companies)
  const observedRefs = uniqueStrings([
    ...metadata.latestRefs,
    ...costs.map((row) => stringOr(row.icp_ref) ?? null),
    ...companies.map((row) => stringOr(row.icp_ref) ?? null),
  ])
  const targetRefs = icpsTotal > 0 ? observedRefs.slice(0, Math.max(icpsTotal, observedRefs.length)) : observedRefs
  const processedRefs = new Set(costs.map((row) => stringOr(row.icp_ref)).filter(Boolean) as string[])
  const scoreByIcp = new Map<string, number>()
  for (const [icpRef, rows] of companiesByIcp) {
    scoreByIcp.set(icpRef, roundTelemetry(rows.reduce((sum, row) => sum + (row.finalScore ?? 0), 0) / LEADS_PER_ICP_NORMALIZER))
  }

  const icps: AdminLabIcpDetail[] = targetRefs.map((icpRef) => {
    const meta = metadata.byRef.get(icpRef)
    const cost = costByIcp.get(icpRef) ?? emptyCostRollup()
    const companyRows = companiesByIcp.get(icpRef) ?? []
    const processed = processedRefs.has(icpRef)
    return {
      icpRef,
      icpHash: meta?.icpHash ?? costs.find((row) => row.icp_ref === icpRef)?.icp_hash ?? null,
      label: icpLabel(meta, icpRef),
      industry: meta?.industry ?? null,
      subIndustry: meta?.subIndustry ?? null,
      status: processed ? (cost.errorCount > 0 ? 'completed_with_errors' : 'completed') : 'pending',
      score: processed ? scoreByIcp.get(icpRef) ?? 0 : null,
      baseScore: null,
      delta: null,
      spendUsd: cost.spendUsd,
      budgetUsd: cost.budgetUsd,
      providerEventCount: cost.eventCount,
      errorCount: cost.errorCount,
      failureReason: processed && companyRows.length === 0 && cost.errorCount > 0 ? 'No surfaced companies; provider errors recorded.' : null,
      hardFailure: processed && companyRows.length === 0 && cost.errorCount > 0,
      funnel: null,
      intentSignals: meta?.intentSignals ?? [],
      companyScoreCount: companyRows.length,
      companies: companyRows,
    }
  })

  const icpsProcessed = Math.min(icpsTotal || processedRefs.size, processedRefs.size)
  const effectiveTotal = Math.max(icpsTotal, icps.length, icpsProcessed)
  const scoreTotal = icps.reduce((sum, icp) => sum + (icp.score ?? 0), 0)
  const lastActivityAt = latestIso(
    ...costs.map((row) => isoStringOr(row.created_at)),
    ...companies.map((row) => isoStringOr(row.created_at)),
    isoStringOr(completedBundle?.current_status_at),
  ) ?? startedAt
  const latestRelatedDispatch = dispatches.find((row) => {
    const doc = objectRecord(row.event_doc) ?? {}
    return stringOr(doc.benchmark_date) === benchmarkDate && Math.round(numberOr(doc.benchmark_attempt, 0)) === attempt
  }) ?? start
  const dispatchStatus = (stringOr(latestRelatedDispatch.dispatch_status) ?? stringOr(start.dispatch_status) ?? 'assigned').toLowerCase()
  const completionAt = isoStringOr(completedBundle?.current_status_at) ?? isoStringOr(completedBundle?.created_at) ?? null
  const isCompleted = Boolean(completedBundle && timestampOrZero(completionAt) >= timestampOrZero(startedAt))
  let state: AdminLabTelemetryState = 'active'
  if (isCompleted) state = 'completed'
  else if (dispatchStatus === 'failed') state = 'failed'
  else if (lastActivityAt && Date.now() - timestampOrZero(lastActivityAt) > LIVE_BENCHMARK_STALE_MS) state = 'stalled'

  const stateLabel = state === 'completed' ? 'Completed' : state === 'failed' ? 'Failed' : state === 'stalled' ? 'Stalled' : 'Running'
  const errors = buildProviderErrors(costs)
  const spendUsd = roundTelemetry(costs.reduce((sum, row) => sum + numberOr(row.cost_usd, 0), 0))
  const observedCap = firstFiniteNumber(costs.map((row) => row.cap_usd))
  const budgetUsd = observedCap === null || effectiveTotal <= 0 ? null : roundTelemetry(observedCap * effectiveTotal)
  const bundleScore = finiteNumberOrNull(completedBundle?.aggregate_score)

  return {
    state,
    stateLabel,
    detail: isCompleted
      ? 'The latest daily baseline bundle completed. Per-ICP cost and company telemetry remains available below.'
      : `${icpsProcessed} of ${effectiveTotal || 'unknown'} ICPs have emitted provider telemetry. Score so far treats unfinished ICPs as zero; avg processed excludes them.`,
    benchmarkDate,
    attempt,
    rollingWindowHash: stringOr(start.rolling_window_hash) ?? metadata.latestRollingWindowHash,
    workerRef: stringOr(start.worker_ref) ?? null,
    startedAt,
    lastActivityAt,
    completedAt: completionAt,
    icpsTotal: effectiveTotal,
    icpsProcessed,
    icpsRemaining: Math.max(0, effectiveTotal - icpsProcessed),
    progressPercent: effectiveTotal > 0 ? Math.min(100, Math.round((icpsProcessed / effectiveTotal) * 100)) : 0,
    provisionalScore: bundleScore ?? (effectiveTotal > 0 ? roundTelemetry(scoreTotal / effectiveTotal) : null),
    completedAverageScore: icpsProcessed > 0 ? roundTelemetry(scoreTotal / icpsProcessed) : null,
    spendUsd,
    budgetUsd,
    providerEventCount: costs.length,
    companyCount: companies.length,
    errorCount: errors.reduce((sum, item) => sum + item.count, 0),
    icps,
    errors,
  }
}

function emptyDailyBenchmark(detail: string): AdminLabDailyBenchmark {
  return {
    state: 'idle',
    stateLabel: 'Idle',
    detail,
    benchmarkDate: null,
    attempt: null,
    rollingWindowHash: null,
    workerRef: null,
    startedAt: null,
    lastActivityAt: null,
    completedAt: null,
    icpsTotal: 0,
    icpsProcessed: 0,
    icpsRemaining: 0,
    progressPercent: 0,
    provisionalScore: null,
    completedAverageScore: null,
    spendUsd: 0,
    budgetUsd: null,
    providerEventCount: 0,
    companyCount: 0,
    errorCount: 0,
    icps: [],
    errors: [],
  }
}

async function fetchChampionTelemetry(
  supabase: ReturnType<typeof getAdminSupabase>,
  metadataPromise: Promise<IcpMetadataSnapshot>,
): Promise<AdminLabChampionSummary[]> {
  const { data, error } = await supabase
    .from('research_lab_champion_reward_current')
    .select('champion_reward_id, candidate_id, ticket_id, run_id, score_bundle_id, miner_hotkey, current_reward_status, current_reason, current_status_at, improvement_points, threshold_points, created_at')
    .order('current_status_at', { ascending: false, nullsFirst: false })
    .limit(CHAMPION_LIMIT)

  if (error) {
    console.warn('[admin:research-lab] champion rewards unavailable', error.message)
    return []
  }
  const rewards = (data ?? []) as Array<Record<string, unknown>>
  const bundleIds = uniqueStrings(rewards.map((row) => stringOr(row.score_bundle_id) ?? null))
  const candidateIds = uniqueStrings(rewards.map((row) => stringOr(row.candidate_id) ?? null))
  if (bundleIds.length === 0) return []

  const [bundleResult, companyResult, costResult, metadata] = await Promise.all([
    supabase
      .from('research_evaluation_score_bundle_current')
      .select('score_bundle_id, ticket_id, run_id, candidate_artifact_hash, score_bundle_doc, current_event_status, current_reason, current_status_at, created_at')
      .in('score_bundle_id', bundleIds)
      .limit(CHAMPION_LIMIT * 2),
    candidateIds.length > 0
      ? supabase
          .from('research_lab_company_label_examples')
          .select('label_id, candidate_id, run_id, score_bundle_id, context_ref, icp_ref, model_side, is_reference_model, final_score, company_name, company_website, company_linkedin, fit_passed, intent_passed, failure_reason, industry, country, captured_at, created_at')
          .in('candidate_id', candidateIds)
          .limit(LIVE_TELEMETRY_LIMIT)
      : Promise.resolve({ data: [], error: null }),
    candidateIds.length > 0
      ? supabase
          .from('research_lab_provider_cost_events')
          .select('candidate_id, provider, endpoint, status_code, cost_usd, spent_after_usd, cap_usd, cap_state, icp_ref, icp_hash, created_at')
          .in('candidate_id', candidateIds)
          .limit(LIVE_TELEMETRY_LIMIT)
      : Promise.resolve({ data: [], error: null }),
    metadataPromise,
  ])

  const bundles = (bundleResult.data ?? []) as Array<Record<string, unknown>>
  const companies = (companyResult.data ?? []) as CompanyTelemetryRow[]
  const costs = (costResult.data ?? []) as ProviderCostTelemetryRow[]
  const bundleById = new Map(bundles.map((row) => [stringOr(row.score_bundle_id) ?? '', row]))

  return rewards.map((reward) => {
    const candidateId = stringOr(reward.candidate_id) ?? ''
    const scoreBundleId = stringOr(reward.score_bundle_id) ?? ''
    const bundle = bundleById.get(scoreBundleId)
    const candidateCompanies = companies.filter((row) => row.candidate_id === candidateId)
    const candidateCosts = costs.filter((row) => row.candidate_id === candidateId)
    const detail = buildScoreBundleIcpDetails(bundle, candidateCompanies, candidateCosts, metadata)
    const aggregates = objectRecord(objectRecord(bundle?.score_bundle_doc)?.aggregates) ?? {}
    const errors = buildProviderErrors(candidateCosts, candidateId)
    const aggregateSpend = finiteNumberOrNull(aggregates.total_cost_usd) ?? 0
    const telemetrySpend = roundTelemetry(candidateCosts.reduce((sum, row) => sum + numberOr(row.cost_usd, 0), 0))
    const spendUsd = telemetrySpend > 0 ? telemetrySpend : aggregateSpend
    const budgetUsd = totalBudget(detail.icps)
    const scoreFailures = detail.icps.filter((icp) => Boolean(icp.failureReason)).length
    return {
      championRewardId: stringOr(reward.champion_reward_id) ?? candidateId,
      candidateId,
      ticketId: stringOr(reward.ticket_id) ?? null,
      runId: stringOr(reward.run_id) ?? null,
      scoreBundleId,
      minerHotkey: stringOr(reward.miner_hotkey) ?? '',
      status: stringOr(reward.current_reward_status) ?? 'unknown',
      reason: stringOr(reward.current_reason) ?? null,
      promotedAt: isoStringOr(reward.current_status_at) ?? isoStringOr(reward.created_at) ?? null,
      improvementPoints: finiteNumberOrNull(reward.improvement_points),
      thresholdPoints: finiteNumberOrNull(reward.threshold_points),
      candidateScore: finiteNumberOrNull(aggregates.candidate_score),
      baseScore: finiteNumberOrNull(aggregates.base_score),
      meanDelta: finiteNumberOrNull(aggregates.mean_delta),
      deltaLcb: finiteNumberOrNull(aggregates.delta_lcb),
      spendUsd: roundTelemetry(spendUsd),
      budgetUsd,
      icpCount: Math.max(detail.icps.length, Math.round(numberOr(aggregates.icp_count, 0))),
      successfulIcpCount: Math.round(numberOr(aggregates.successful_icp_count, 0)),
      companyCount: candidateCompanies.length || detail.icps.reduce((sum, icp) => sum + icp.companyScoreCount, 0),
      errorCount: errors.reduce((sum, item) => sum + item.count, 0) + scoreFailures,
      icps: detail.icps,
      errors,
    }
  })
}

function buildScoreBundleIcpDetails(
  bundle: Record<string, unknown> | undefined,
  companyRows: CompanyTelemetryRow[],
  costRows: ProviderCostTelemetryRow[],
  metadata: IcpMetadataSnapshot,
): { icps: AdminLabIcpDetail[] } {
  const doc = objectRecord(bundle?.score_bundle_doc) ?? {}
  const aggregates = objectRecord(doc.aggregates) ?? {}
  const perIcp = arrayOfRecords(aggregates.per_icp_results) ?? []
  const costs = rollupCostsByIcp(costRows)
  const companies = groupCompaniesByIcp(companyRows)
  const refs = uniqueStrings([
    ...perIcp.map((row) => stringOr(row.icp_ref) ?? null),
    ...costRows.map((row) => stringOr(row.icp_ref) ?? null),
    ...companyRows.map((row) => stringOr(row.icp_ref) ?? null),
  ])
  const byRef = new Map(perIcp.map((row) => [stringOr(row.icp_ref) ?? '', row]))
  return {
    icps: refs.map((icpRef) => {
      const row = byRef.get(icpRef) ?? {}
      const meta = metadata.byRef.get(icpRef)
      const cost = costs.get(icpRef) ?? emptyCostRollup()
      const surfaced = companies.get(icpRef) ?? []
      const failureReason = stringOr(row.failure_reason) ?? null
      const candidateCompanyScores = Array.isArray(row.candidate_company_scores) ? row.candidate_company_scores : []
      return {
        icpRef,
        icpHash: stringOr(row.icp_hash) ?? meta?.icpHash ?? null,
        label: icpLabel(meta, icpRef),
        industry: meta?.industry ?? null,
        subIndustry: meta?.subIndustry ?? null,
        status: stringOr(row.status) ?? (failureReason ? 'failed' : 'observed'),
        score: finiteNumberOrNull(row.candidate_per_icp_score),
        baseScore: finiteNumberOrNull(row.base_per_icp_score),
        delta: finiteNumberOrNull(row.delta_vs_base),
        spendUsd: cost.spendUsd,
        budgetUsd: cost.budgetUsd,
        providerEventCount: cost.eventCount,
        errorCount: cost.errorCount + (failureReason ? 1 : 0),
        failureReason,
        hardFailure: booleanOr(row.hard_failure) ?? false,
        funnel: normalizeFunnel(row.funnel),
        intentSignals: meta?.intentSignals ?? [],
        companyScoreCount: Math.max(candidateCompanyScores.length, surfaced.length),
        companies: surfaced,
      }
    }),
  }
}

async function fetchAdminLabRunDetail(
  supabase: ReturnType<typeof getAdminSupabase>,
  loop: AdminLabLoopSummary,
): Promise<AdminLabRunDetail> {
  const [candidateResult, bundleResult, companyResult, dispatchResult, metadata] = await Promise.all([
    supabase
      .from('research_lab_candidate_evaluation_current')
      .select('candidate_id, ticket_id, run_id, current_candidate_status, current_reason, current_score_bundle_id, current_status_at, redacted_public_summary, created_at')
      .eq('ticket_id', loop.ticketId)
      .order('created_at', { ascending: false, nullsFirst: false })
      .limit(200),
    supabase
      .from('research_evaluation_score_bundle_current')
      .select('score_bundle_id, ticket_id, run_id, score_bundle_doc, current_event_status, current_event_type, current_reason, current_status_at, created_at')
      .eq('ticket_id', loop.ticketId)
      .order('created_at', { ascending: false, nullsFirst: false })
      .limit(200),
    supabase
      .from('research_lab_company_label_examples')
      .select('label_id, candidate_id, run_id, score_bundle_id, context_ref, icp_ref, model_side, is_reference_model, final_score, company_name, company_website, company_linkedin, fit_passed, intent_passed, failure_reason, industry, country, captured_at, created_at')
      .eq('ticket_id', loop.ticketId)
      .order('created_at', { ascending: false, nullsFirst: false })
      .limit(LIVE_TELEMETRY_LIMIT),
    supabase
      .from('research_lab_scoring_dispatch_events')
      .select('dispatch_event_id, dispatch_status, dispatch_type, candidate_id, run_id, score_bundle_id, worker_ref, event_doc, created_at')
      .eq('ticket_id', loop.ticketId)
      .order('created_at', { ascending: false, nullsFirst: false })
      .limit(500),
    fetchIcpMetadata(supabase),
  ])

  const candidateRows = (candidateResult.data ?? []) as Array<Record<string, unknown>>
  const bundleRows = (bundleResult.data ?? []) as Array<Record<string, unknown>>
  const companyRows = (companyResult.data ?? []) as CompanyTelemetryRow[]
  const dispatchRows = (dispatchResult.data ?? []) as Array<Record<string, unknown>>
  const candidateIds = uniqueStrings(candidateRows.map((row) => stringOr(row.candidate_id) ?? null))
  const costRows: ProviderCostTelemetryRow[] = []
  for (const batch of chunked(candidateIds, SUPABASE_IN_FILTER_BATCH_SIZE)) {
    const { data, error } = await supabase
      .from('research_lab_provider_cost_events')
      .select('candidate_id, provider, endpoint, status_code, cost_usd, spent_after_usd, cap_usd, cap_state, icp_ref, icp_hash, created_at')
      .in('candidate_id', batch)
      .limit(LIVE_TELEMETRY_LIMIT)
    if (error) {
      console.warn('[admin:research-lab] run provider telemetry unavailable', error.message)
      break
    }
    costRows.push(...((data ?? []) as ProviderCostTelemetryRow[]))
  }

  const bundleById = new Map(bundleRows.map((row) => [stringOr(row.score_bundle_id) ?? '', row]))
  const candidates: AdminLabCandidateRunDetail[] = candidateRows.map((candidate) => {
    const candidateId = stringOr(candidate.candidate_id) ?? ''
    const scoreBundleId = stringOr(candidate.current_score_bundle_id) ?? null
    const bundle = scoreBundleId
      ? bundleById.get(scoreBundleId)
      : bundleRows.find((row) => stringOr(row.run_id) === stringOr(candidate.run_id))
    const companies = companyRows.filter((row) => row.candidate_id === candidateId)
    const costs = costRows.filter((row) => row.candidate_id === candidateId)
    const score = buildScoreBundleIcpDetails(bundle, companies, costs, metadata)
    const aggregates = objectRecord(objectRecord(bundle?.score_bundle_doc)?.aggregates) ?? {}
    const errors = [
      ...buildProviderErrors(costs, candidateId),
      ...buildDispatchErrors(dispatchRows.filter((row) => stringOr(row.candidate_id) === candidateId)),
    ]
    return {
      candidateId,
      status: stringOr(candidate.current_candidate_status) ?? 'unknown',
      reason: stringOr(candidate.current_reason) ?? stringOr(bundle?.current_reason) ?? null,
      summary: stringOr(candidate.redacted_public_summary) ?? null,
      scoreBundleId: scoreBundleId ?? stringOr(bundle?.score_bundle_id) ?? null,
      createdAt: isoStringOr(candidate.created_at) ?? null,
      statusAt: isoStringOr(candidate.current_status_at) ?? isoStringOr(bundle?.current_status_at) ?? null,
      candidateScore: finiteNumberOrNull(aggregates.candidate_score),
      baseScore: finiteNumberOrNull(aggregates.base_score),
      meanDelta: finiteNumberOrNull(aggregates.mean_delta),
      deltaLcb: finiteNumberOrNull(aggregates.delta_lcb),
      spendUsd: roundTelemetry(costs.reduce((sum, row) => sum + numberOr(row.cost_usd, 0), 0)),
      budgetUsd: totalBudget(score.icps),
      providerEventCount: costs.length,
      companyCount: companies.length || score.icps.reduce((sum, icp) => sum + icp.companyScoreCount, 0),
      errorCount: errors.reduce((sum, item) => sum + item.count, 0),
      icps: score.icps,
      errors,
    }
  })

  const runErrors = [...buildProviderErrors(costRows), ...buildDispatchErrors(dispatchRows)]
  const totalBudgetUsd = candidates.some((candidate) => candidate.budgetUsd !== null)
    ? roundTelemetry(candidates.reduce((sum, candidate) => sum + (candidate.budgetUsd ?? 0), 0))
    : null
  return {
    ticketId: loop.ticketId,
    runId: loop.runId,
    state: telemetryStateForLoop(loop),
    phase: phaseForLoop(loop),
    totalSpendUsd: roundTelemetry(costRows.reduce((sum, row) => sum + numberOr(row.cost_usd, 0), 0)),
    totalBudgetUsd,
    providerEventCount: costRows.length,
    companyCount: companyRows.length,
    errorCount: runErrors.reduce((sum, item) => sum + item.count, 0),
    candidates,
    errors: runErrors,
    fetchedAt: new Date().toISOString(),
  }
}

function rollupCostsByIcp(rows: ProviderCostTelemetryRow[]): Map<string, IcpCostRollup> {
  const byIcp = new Map<string, IcpCostRollup>()
  for (const row of rows) {
    const icpRef = stringOr(row.icp_ref)
    if (!icpRef) continue
    const current = byIcp.get(icpRef) ?? emptyCostRollup()
    current.spendUsd += numberOr(row.cost_usd, 0)
    current.eventCount += 1
    if (numberOr(row.status_code, 0) >= 400) current.errorCount += 1
    const cap = finiteNumberOrNull(row.cap_usd)
    if (cap !== null) current.budgetUsd = Math.max(current.budgetUsd ?? 0, cap)
    current.lastActivityAt = latestIso(current.lastActivityAt, isoStringOr(row.created_at)) ?? current.lastActivityAt
    byIcp.set(icpRef, current)
  }
  for (const value of byIcp.values()) value.spendUsd = roundTelemetry(value.spendUsd)
  return byIcp
}

function emptyCostRollup(): IcpCostRollup {
  return { spendUsd: 0, budgetUsd: null, eventCount: 0, errorCount: 0, lastActivityAt: null }
}

function groupCompaniesByIcp(rows: CompanyTelemetryRow[]): Map<string, AdminLabCompanyDetail[]> {
  const byIcp = new Map<string, AdminLabCompanyDetail[]>()
  for (const row of rows) {
    const icpRef = stringOr(row.icp_ref)
    if (!icpRef) continue
    const list = byIcp.get(icpRef) ?? []
    list.push(normalizeCompany(row, list.length))
    byIcp.set(icpRef, list)
  }
  return byIcp
}

function normalizeCompany(row: CompanyTelemetryRow, index: number): AdminLabCompanyDetail {
  return {
    id: stringOr(row.label_id) ?? `${stringOr(row.icp_ref) ?? 'company'}:${index}`,
    name: stringOr(row.company_name) ?? stringOr(row.company_website) ?? `Surfaced company ${index + 1}`,
    website: stringOr(row.company_website) ?? null,
    linkedin: stringOr(row.company_linkedin) ?? null,
    finalScore: finiteNumberOrNull(row.final_score),
    modelSide: stringOr(row.model_side) ?? null,
    fitPassed: booleanOr(row.fit_passed) ?? null,
    intentPassed: booleanOr(row.intent_passed) ?? null,
    failureReason: stringOr(row.failure_reason) ?? null,
    industry: stringOr(row.industry) ?? null,
    country: stringOr(row.country) ?? null,
    capturedAt: isoStringOr(row.captured_at) ?? isoStringOr(row.created_at) ?? null,
  }
}

function buildProviderErrors(rows: ProviderCostTelemetryRow[], candidateId?: string): AdminLabErrorDetail[] {
  const grouped = new Map<string, AdminLabErrorDetail>()
  for (const row of rows) {
    const statusCode = Math.round(numberOr(row.status_code, 0))
    if (statusCode < 400) continue
    const provider = stringOr(row.provider) ?? 'provider'
    const endpoint = stringOr(row.endpoint) ?? null
    const icpRef = stringOr(row.icp_ref) ?? null
    const key = `${provider}\u0000${endpoint ?? ''}\u0000${statusCode}\u0000${icpRef ?? ''}`
    const current = grouped.get(key)
    if (current) {
      current.count += 1
      if (timestampOrZero(row.created_at) > timestampOrZero(current.occurredAt)) current.occurredAt = isoStringOr(row.created_at) ?? current.occurredAt
      continue
    }
    grouped.set(key, {
      id: `provider:${key}`,
      source: 'provider',
      title: `${provider} returned HTTP ${statusCode}`,
      detail: endpoint,
      statusCode,
      provider,
      endpoint,
      icpRef,
      candidateId: candidateId ?? stringOr(row.candidate_id) ?? null,
      runId: null,
      count: 1,
      occurredAt: isoStringOr(row.created_at) ?? null,
    })
  }
  return Array.from(grouped.values()).sort((a, b) => timestampOrZero(b.occurredAt) - timestampOrZero(a.occurredAt))
}

function buildDispatchErrors(rows: Array<Record<string, unknown>>): AdminLabErrorDetail[] {
  return rows
    .filter((row) => (stringOr(row.dispatch_status) ?? '').toLowerCase() === 'failed')
    .map((row, index) => {
      const doc = objectRecord(row.event_doc) ?? {}
      const diagnostics = doc.error_diagnostics
      return {
        id: stringOr(row.dispatch_event_id) ?? `dispatch:${index}`,
        source: 'dispatch' as const,
        title: `${stringOr(row.dispatch_type) ?? 'Scoring dispatch'} failed`,
        detail: summarizeUnknown(diagnostics) ?? stringOr(doc.error) ?? stringOr(doc.message) ?? null,
        statusCode: null,
        provider: null,
        endpoint: null,
        icpRef: stringOr(doc.icp_ref) ?? null,
        candidateId: stringOr(row.candidate_id) ?? null,
        runId: stringOr(row.run_id) ?? null,
        count: 1,
        occurredAt: isoStringOr(row.created_at) ?? null,
      }
    })
}

function normalizeFunnel(value: unknown): AdminLabFunnelDetail | null {
  const row = objectRecord(value)
  if (!row) return null
  return {
    sourced: Math.round(numberOr(row.sourced, 0)),
    fitPass: Math.round(numberOr(row.fit_pass ?? row.fitPass, 0)),
    verified: Math.round(numberOr(row.verified, 0)),
    intentValid: Math.round(numberOr(row.intent_valid ?? row.intentValid, 0)),
    scored: Math.round(numberOr(row.scored, 0)),
  }
}

function icpLabel(meta: IcpMetadata | undefined, icpRef: string): string {
  if (meta?.subIndustry) return meta.industry ? `${meta.industry} · ${meta.subIndustry}` : meta.subIndustry
  if (meta?.industry) return meta.industry
  return icpRef.split(':').at(-1) ?? icpRef
}

function totalBudget(icps: AdminLabIcpDetail[]): number | null {
  const known = icps.filter((icp) => icp.budgetUsd !== null)
  return known.length > 0 ? roundTelemetry(known.reduce((sum, icp) => sum + (icp.budgetUsd ?? 0), 0)) : null
}

function telemetryStateForLoop(loop: AdminLabLoopSummary): AdminLabTelemetryState {
  if (isActiveResearchLabLoopStatus(loop.statusKey)) return 'active'
  if (isCompletedResearchLabLoopStatus(loop.statusKey)) {
    const value = `${loop.statusKey} ${loop.outcomeLabel} ${loop.outcomeBand}`.toLowerCase()
    return value.includes('fail') || value.includes('cancel') ? 'failed' : 'completed'
  }
  if (isFailedOutcome(loop.outcomeLabel, loop.outcomeBand)) return 'failed'
  return 'unknown'
}

function summarizeUnknown(value: unknown): string | null {
  if (typeof value === 'string') return value
  const record = objectRecord(value)
  if (!record) return null
  const message = stringOr(record.message) ?? stringOr(record.error) ?? stringOr(record.detail) ?? stringOr(record.reason)
  if (message) return message
  try {
    return JSON.stringify(record).slice(0, 800)
  } catch {
    return null
  }
}

function roundTelemetry(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 1_000_000) / 1_000_000
}

async function fetchScoreBundleMetrics(
  supabase: ReturnType<typeof getAdminSupabase>,
  loops: AdminLabLoopSummary[],
): Promise<ScoreBundleMetrics> {
  const byTicket = new Map<string, RunScoreMetrics>()
  const interestingTicketIds = uniqueStrings(
    loops
      .filter((loop) =>
        isActiveResearchLabLoopStatus(loop.statusKey) ||
        isPendingOrBlockingResearchLabLoopStatus(loop.statusKey),
      )
      .map((loop) => loop.ticketId),
  )

  for (const batch of chunked(interestingTicketIds, SUPABASE_IN_FILTER_BATCH_SIZE)) {
    const { data, error } = await supabase
      .from('research_evaluation_score_bundle_current')
      .select('score_bundle_id, ticket_id, run_id, bundle_status, current_event_status, current_event_type, current_reason, current_status_at, score_bundle_doc, created_at')
      .in('ticket_id', batch)
      .order('current_status_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false, nullsFirst: false })
      .limit(5_000)

    if (error) {
      if (!isExpectedOptionalTimelineSourceMiss(error.message)) {
        console.warn('[admin:research-lab] score bundle metrics unavailable', error.message)
      }
      continue
    }

    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      const ticketId = stringOr(row.ticket_id)
      if (!ticketId) continue
      const previous = byTicket.get(ticketId)
      const currentAt = isoStringOr(row.current_status_at) ?? isoStringOr(row.created_at)
      if (previous && timestampOrZero(previous.lastScoringAt) >= timestampOrZero(currentAt)) continue
      byTicket.set(ticketId, scoreMetricsForBundleRow(row))
    }
  }

  const volume = await fetchScoreBundleVolume(supabase)
  return {
    byTicket,
    lastScoringAt: latestIso(
      volume.lastScoringAt,
      latestIso(...Array.from(byTicket.values()).map((metric) => metric.lastScoringAt)),
    ) ?? null,
    scoreBundlesLastHour: volume.scoreBundlesLastHour,
    scoreBundlesLast24h: volume.scoreBundlesLast24h,
  }
}

async function fetchScoreBundleVolume(
  supabase: ReturnType<typeof getAdminSupabase>,
): Promise<Pick<ScoreBundleMetrics, 'lastScoringAt' | 'scoreBundlesLastHour' | 'scoreBundlesLast24h'>> {
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const since1h = Date.now() - 60 * 60 * 1000
  const { data, error } = await supabase
    .from('research_evaluation_score_bundle_events')
    .select('created_at')
    .gte('created_at', since24h)
    .order('created_at', { ascending: false, nullsFirst: false })
    .limit(5_000)

  if (error) {
    if (!isExpectedOptionalTimelineSourceMiss(error.message)) {
      console.warn('[admin:research-lab] score bundle volume unavailable', error.message)
    }
    return { lastScoringAt: null, scoreBundlesLastHour: 0, scoreBundlesLast24h: 0 }
  }

  const rows = (data ?? []) as Array<Record<string, unknown>>
  const lastScoringAt = isoStringOr(rows[0]?.created_at) ?? null
  return {
    lastScoringAt,
    scoreBundlesLastHour: rows.filter((row) => timestampOrZero(row.created_at) >= since1h).length,
    scoreBundlesLast24h: rows.length,
  }
}

async function fetchComputeSpendSummary(
  supabase: ReturnType<typeof getAdminSupabase>,
): Promise<AdminLabComputeSpendSummary> {
  const now = new Date()
  const sinceMs = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  ) - (COMPUTE_SPEND_DAYS - 1) * 24 * 60 * 60 * 1000
  const events: ResearchLabTerminalReceiptEvent[] = []

  for (let offset = 0; ; offset += COMPUTE_SPEND_BATCH_SIZE) {
    const { data, error } = await supabase
      .from('research_loop_receipt_events')
      .select('receipt_id, event_type, event_doc, created_at')
      .in('event_type', ['completed', 'failed'])
      .gte('created_at', new Date(sinceMs).toISOString())
      .order('created_at', { ascending: false, nullsFirst: false })
      .range(offset, offset + COMPUTE_SPEND_BATCH_SIZE - 1)

    if (error) {
      console.warn('[admin:research-lab] compute spend unavailable', error.message)
      return emptyComputeSpendSummary(false, error.message, now)
    }

    const batch = (data ?? []) as ResearchLabTerminalReceiptEvent[]
    events.push(...batch)
    if (batch.length < COMPUTE_SPEND_BATCH_SIZE) break
  }

  const receiptIdsMissingRun = uniqueStrings(
    events
      .filter((event) => !stringOr(objectRecord(event.event_doc)?.run_id))
      .map((event) => event.receipt_id),
  )
  const receiptRunIds = new Map<string, string>()

  for (const batch of chunked(receiptIdsMissingRun, SUPABASE_IN_FILTER_BATCH_SIZE)) {
    const { data, error } = await supabase
      .from('research_loop_receipts')
      .select('receipt_id, run_id')
      .in('receipt_id', batch)

    if (error) {
      console.warn('[admin:research-lab] compute spend run lookup unavailable', error.message)
      break
    }

    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      const receiptId = stringOr(row.receipt_id)
      const runId = stringOr(row.run_id)
      if (receiptId && runId) receiptRunIds.set(receiptId, runId)
    }
  }

  const finalizedRunIds = researchLabFinalizedRunIds({
    events,
    receiptRunIds,
    days: COMPUTE_SPEND_DAYS,
    now,
  })
  const runEvidence = await fetchFinalizedRunEvidence(supabase, finalizedRunIds)
  const reconciliation: AdminLabFinalizedRunReconciliation = runEvidence.sourceAvailable
    ? {
        sourceAvailable: true,
        unavailableReason: null,
        ...buildResearchLabFinalizedRunReconciliation({
          events,
          receiptRunIds,
          candidateRunIds: runEvidence.candidateRunIds,
          scoringRunIds: runEvidence.scoringRunIds,
          days: COMPUTE_SPEND_DAYS,
          now,
        }),
      }
    : emptyFinalizedRunReconciliation(false, runEvidence.unavailableReason)

  return {
    sourceAvailable: true,
    unavailableReason: null,
    reconciliation,
    ...buildResearchLabDailyComputeSpend({
      events,
      receiptRunIds,
      days: COMPUTE_SPEND_DAYS,
      now,
    }),
  }
}

function emptyComputeSpendSummary(
  sourceAvailable: boolean,
  unavailableReason: string | null,
  now = new Date(),
): AdminLabComputeSpendSummary {
  return {
    sourceAvailable,
    unavailableReason,
    reconciliation: emptyFinalizedRunReconciliation(false, unavailableReason),
    ...buildResearchLabDailyComputeSpend({
      events: [],
      days: COMPUTE_SPEND_DAYS,
      now,
    }),
  }
}

type FinalizedRunEvidence = {
  sourceAvailable: boolean
  unavailableReason: string | null
  candidateRunIds: Set<string>
  scoringRunIds: Set<string>
}

async function fetchFinalizedRunEvidence(
  supabase: ReturnType<typeof getAdminSupabase>,
  runIds: string[],
): Promise<FinalizedRunEvidence> {
  const [candidateEvidence, scoreBundleEvidence] = await Promise.all([
    fetchCandidateRunEvidence(supabase, runIds),
    fetchScoreBundleRunEvidence(supabase, runIds),
  ])
  const unavailableReason = candidateEvidence.error ?? scoreBundleEvidence.error
  if (unavailableReason) {
    console.warn('[admin:research-lab] finalized run reconciliation unavailable', unavailableReason)
    return {
      sourceAvailable: false,
      unavailableReason,
      candidateRunIds: new Set(),
      scoringRunIds: new Set(),
    }
  }

  return {
    sourceAvailable: true,
    unavailableReason: null,
    candidateRunIds: candidateEvidence.candidateRunIds,
    scoringRunIds: new Set([
      ...candidateEvidence.scoringRunIds,
      ...scoreBundleEvidence.scoringRunIds,
    ]),
  }
}

async function fetchCandidateRunEvidence(
  supabase: ReturnType<typeof getAdminSupabase>,
  runIds: string[],
): Promise<{ candidateRunIds: Set<string>; scoringRunIds: Set<string>; error: string | null }> {
  const candidateRunIds = new Set<string>()
  const scoringRunIds = new Set<string>()
  for (const batch of chunked(runIds, SUPABASE_IN_FILTER_BATCH_SIZE)) {
    const { data, error } = await supabase
      .from('research_lab_candidate_evaluation_current')
      .select('run_id, current_candidate_status')
      .in('run_id', batch)

    if (error) {
      return { candidateRunIds, scoringRunIds, error: error.message }
    }
    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      const runId = stringOr(row.run_id)
      if (!runId) continue
      candidateRunIds.add(runId)
      if (stringOr(row.current_candidate_status) === 'scored') scoringRunIds.add(runId)
    }
  }
  return { candidateRunIds, scoringRunIds, error: null }
}

async function fetchScoreBundleRunEvidence(
  supabase: ReturnType<typeof getAdminSupabase>,
  runIds: string[],
): Promise<{ scoringRunIds: Set<string>; error: string | null }> {
  const scoringRunIds = new Set<string>()
  for (const batch of chunked(runIds, SUPABASE_IN_FILTER_BATCH_SIZE)) {
    const { data, error } = await supabase
      .from('research_evaluation_score_bundle_current')
      .select('run_id')
      .in('run_id', batch)

    if (error) return { scoringRunIds, error: error.message }
    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      const runId = stringOr(row.run_id)
      if (runId) scoringRunIds.add(runId)
    }
  }
  return { scoringRunIds, error: null }
}

function emptyFinalizedRunReconciliation(
  sourceAvailable: boolean,
  unavailableReason: string | null,
): AdminLabFinalizedRunReconciliation {
  return {
    sourceAvailable,
    unavailableReason,
    reachedScoringCount: 0,
    candidateNotScoredCount: 0,
    noCandidateCount: 0,
    noCandidateFailedCount: 0,
    noCandidateCompletedCount: 0,
  }
}

function scoreMetricsForBundleRow(row: Record<string, unknown>): RunScoreMetrics {
  const doc = objectRecord(row.score_bundle_doc) ?? {}
  const aggregates = objectRecord(doc.aggregates) ?? {}
  const summary = objectRecord(doc.summary) ?? objectRecord(aggregates.summary) ?? {}
  const perIcp = arrayOfRecords(aggregates.per_icp_results) ?? arrayOfRecords(doc.per_icp_results) ?? []
  const icpTotal = firstFiniteNumber([
    summary.total_icps,
    summary.icp_count,
    aggregates.total_icps,
    aggregates.icp_count,
    doc.total_icps,
    perIcp.length > 0 ? perIcp.length : null,
  ])
  const icpsScored = firstFiniteNumber([
    summary.icps_scored,
    summary.scored_icps,
    aggregates.icps_scored,
    aggregates.scored_icps,
    doc.icps_scored,
    perIcp.length > 0 ? perIcp.filter(isTerminalIcpResult).length : null,
  ])
  return {
    scoreBundleId: stringOr(row.score_bundle_id) ?? null,
    scoreBundleStatus:
      stringOr(row.current_event_status) ??
      stringOr(row.bundle_status) ??
      stringOr(row.current_event_type) ??
      null,
    icpTotal,
    icpsScored,
    lastScoringAt: isoStringOr(row.current_status_at) ?? isoStringOr(row.created_at) ?? null,
  }
}

async function fetchScoringControl(
  supabase: ReturnType<typeof getAdminSupabase>,
): Promise<ScoringControlSummary> {
  const { rows, sourceAvailable, unavailableReason } = await fetchOptionalRows(
    supabase,
    'ops_scoring_control_current',
    1,
  )
  if (!sourceAvailable) {
    return {
      source: 'missing',
      paused: false,
      state: null,
      pauseReason: unavailableReason,
      updatedAt: null,
    }
  }

  const row = rows[0] ?? {}
  const state =
    stringOr(row.state) ??
    stringOr(row.status) ??
    stringOr(row.scoring_state) ??
    null
  const paused =
    booleanOr(row.paused) ??
    booleanOr(row.is_paused) ??
    (state ? ['paused', 'disabled', 'maintenance'].includes(state.toLowerCase()) : false)
  return {
    source: 'explicit',
    paused,
    state,
    pauseReason:
      stringOr(row.pause_reason) ??
      stringOr(row.reason) ??
      stringOr(row.status_detail) ??
      null,
    updatedAt:
      isoStringOr(row.updated_at) ??
      isoStringOr(row.created_at) ??
      isoStringOr(row.status_at) ??
      null,
  }
}

function buildActiveRuns(
  loops: AdminLabLoopSummary[],
  scoreMetricsByTicket: Map<string, RunScoreMetrics>,
): AdminLabActiveRun[] {
  const now = Date.now()
  return loops
    .filter((loop) => isActiveResearchLabLoopStatus(loop.statusKey))
    .map((loop) => {
      const scoreMetrics = scoreMetricsByTicket.get(loop.ticketId)
      const idleMs = Math.max(0, now - timestampOrZero(loop.lastActivityAt))
      const ageMs = Math.max(0, now - timestampOrZero(loop.submittedAt))
      const icpTotal = scoreMetrics?.icpTotal ?? null
      const icpsScored = scoreMetrics?.icpsScored ?? null
      const icpsRemaining =
        icpTotal === null
          ? null
          : Math.max(0, icpTotal - (icpsScored ?? 0))
      const candidatesRemaining = Math.max(0, loop.candidateCount - loop.scoredCandidateCount)
      const staleThreshold = loop.statusKey === 'scoring' ? STALE_SCORING_MS : STALE_ACTIVE_MS
      return {
        ticketId: loop.ticketId,
        runId: loop.runId,
        receiptId: loop.receiptId,
        minerHotkey: loop.minerHotkey,
        researchFocusSummary: loop.researchFocusSummary,
        topicTags: loop.topicTags,
        statusKey: loop.statusKey,
        statusLabel: loop.statusLabel,
        phase: phaseForLoop(loop),
        candidateCount: loop.candidateCount,
        scoredCandidateCount: loop.scoredCandidateCount,
        candidatesRemaining,
        icpTotal,
        icpsScored,
        icpsRemaining,
        scoreBundleId: scoreMetrics?.scoreBundleId ?? null,
        scoreBundleStatus: scoreMetrics?.scoreBundleStatus ?? null,
        blocker: loop.actionNote?.detail ?? loop.statusNote?.detail ?? loop.statusDetail ?? loop.opsReason ?? null,
        submittedAt: loop.submittedAt,
        lastActivityAt: loop.lastActivityAt,
        ageMs,
        idleMs,
        stale: idleMs >= staleThreshold,
      }
    })
    .sort((a, b) => {
      if (a.stale !== b.stale) return a.stale ? -1 : 1
      return b.idleMs - a.idleMs
    })
    .slice(0, ACTIVE_RUN_LIMIT)
}

function buildScoringSummary({
  loops,
  activeRuns,
  metrics,
  control,
}: {
  loops: AdminLabLoopSummary[]
  activeRuns: AdminLabActiveRun[]
  metrics: ScoreBundleMetrics
  control: ScoringControlSummary
}): AdminLabScoringSummary {
  const scoringRuns = activeRuns.filter((run) => run.statusKey === 'scoring' || run.phase === 'scoring').length
  const queuedRuns = activeRuns.filter((run) => run.statusKey === 'queued' || run.phase === 'queue').length
  const blockedRuns = loops.filter((loop) => isPendingOrBlockingResearchLabLoopStatus(loop.statusKey)).length
  const staleRuns = activeRuns.filter((run) => run.stale).length
  const candidatesRemaining = activeRuns.reduce((sum, run) => sum + run.candidatesRemaining, 0)
  const knownIcpRuns = activeRuns.filter((run) => run.icpsRemaining !== null)
  const icpsRemaining = knownIcpRuns.length > 0
    ? knownIcpRuns.reduce((sum, run) => sum + (run.icpsRemaining ?? 0), 0)
    : null
  const oldestActiveRunAt = activeRuns.reduce<string | null>((oldest, run) => {
    if (!oldest) return run.submittedAt
    return timestampOrZero(run.submittedAt) < timestampOrZero(oldest) ? run.submittedAt : oldest
  }, null)

  let state: AdminScoringState = 'idle'
  let label = 'Idle'
  let detail = blockedRuns > 0
    ? `No executable Lab runs are currently visible. ${blockedRuns} loop${blockedRuns === 1 ? ' is' : 's are'} waiting on funding, credits, baseline, or recovery and excluded from current-run health.`
    : 'No active scoring runs are currently visible.'
  let source: AdminLabScoringSummary['source'] = control.source === 'explicit' ? 'explicit' : 'inferred'

  if (control.paused) {
    state = 'paused'
    label = 'Paused'
    detail = control.pauseReason || 'Scoring is explicitly paused by ops control.'
  } else if (staleRuns > 0) {
    state = 'stalled'
    label = 'Stalled'
    detail = `${staleRuns} active run${staleRuns === 1 ? '' : 's'} have not emitted progress recently.`
  } else if (activeRuns.length > 0 || metrics.scoreBundlesLastHour > 0) {
    state = 'active'
    label = 'Active'
    detail = `${activeRuns.length} active run${activeRuns.length === 1 ? '' : 's'} and ${metrics.scoreBundlesLastHour} scoring event${metrics.scoreBundlesLastHour === 1 ? '' : 's'} in the last hour.`
  } else if (control.source === 'missing' && metrics.lastScoringAt === null) {
    source = 'missing'
    state = 'unknown'
    label = 'Unknown'
    detail = 'No scoring-control telemetry table is available and no recent score-bundle events were found.'
  }

  return {
    state,
    label,
    detail,
    source,
    paused: control.paused,
    pauseReason: control.pauseReason,
    controlUpdatedAt: control.updatedAt,
    activeRuns: activeRuns.length,
    scoringRuns,
    queuedRuns,
    blockedRuns,
    staleRuns,
    candidatesRemaining,
    icpsRemaining,
    scoreBundlesLastHour: metrics.scoreBundlesLastHour,
    scoreBundlesLast24h: metrics.scoreBundlesLast24h,
    lastScoringAt: metrics.lastScoringAt,
    oldestActiveRunAt,
  }
}

function buildPipelineStages(loops: AdminLabLoopSummary[]): AdminLabPipelineStage[] {
  const total = Math.max(loops.length, 1)
  const now = Date.now()
  const stages = [
    {
      id: 'queued',
      label: 'Queued / funded',
      loops: loops.filter((loop) =>
        ['queued', 'paid_not_started', 'waiting_for_baseline'].includes(loop.statusKey),
      ),
    },
    {
      id: 'awaiting_funding',
      label: 'Awaiting funding',
      loops: loops.filter((loop) => loop.statusKey === 'awaiting_payment'),
    },
    {
      id: 'waiting_credits',
      label: 'Waiting for credits',
      loops: loops.filter((loop) => loop.statusKey === 'blocked_for_credit'),
    },
    {
      id: 'running',
      label: 'Running',
      loops: loops.filter((loop) => isActiveResearchLabLoopStatus(loop.statusKey) && loop.statusKey !== 'scoring'),
    },
    {
      id: 'scoring',
      label: 'Scoring',
      loops: loops.filter((loop) => loop.statusKey === 'scoring'),
    },
    {
      id: 'scored',
      label: 'Scored',
      loops: loops.filter((loop) => isScoredResearchLabLoopStatus(loop.statusKey)),
    },
    {
      id: 'promoted',
      label: 'Promoted',
      loops: loops.filter((loop) => isPromisingResearchLabLoopStatus(loop.statusKey, loop.outcomeBand)),
    },
    {
      id: 'failed',
      label: 'Needs attention',
      loops: loops.filter((loop) => isNoGainOrFailedResearchLabLoopStatus(loop.statusKey) || isFailedOutcome(loop.outcomeLabel, loop.outcomeBand)),
    },
  ]

  return stages.map((stage) => ({
    id: stage.id,
    label: stage.label,
    count: stage.loops.length,
    staleCount: stage.loops.filter((loop) =>
      isActiveResearchLabLoopStatus(loop.statusKey) &&
      now - timestampOrZero(loop.lastActivityAt) >= STALE_ACTIVE_MS,
    ).length,
    percent: Math.round((stage.loops.length / total) * 100),
  }))
}

async function fetchBenchmarkSummary(
  supabase: ReturnType<typeof getAdminSupabase>,
): Promise<AdminLabBenchmarkSummary> {
  const { data, error } = await supabase
    .from('research_lab_public_benchmark_report_current')
    .select('report_id, benchmark_date, rolling_window_hash, aggregate_score, report_doc, current_report_status, current_status_at, created_at')
    .eq('current_report_status', 'published')
    .order('benchmark_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)

  if (error) {
    return emptyBenchmarkSummary('Could not read current benchmark report.')
  }

  const row = ((data ?? []) as Array<Record<string, unknown>>)[0]
  if (!row) return emptyBenchmarkSummary('No published benchmark report is available.')

  const doc = objectRecord(row.report_doc) ?? {}
  const currentStatusAt = isoStringOr(row.current_status_at) ?? isoStringOr(row.created_at) ?? null
  const ageMs = currentStatusAt ? Date.now() - timestampOrZero(currentStatusAt) : null
  const publicIcps = arrayOfRecords(doc.public_icps) ?? []
  const topIssues = Object.entries(objectRecord(doc.model_issue_counts) ?? {})
    .map(([key, value]) => ({ key, count: Math.max(0, Math.round(numberOr(value, 0))) }))
    .filter((issue) => issue.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)

  let state: AdminHealthState = 'healthy'
  if (ageMs === null) state = 'unknown'
  else if (ageMs > 48 * 60 * 60 * 1000) state = 'critical'
  else if (ageMs > 30 * 60 * 60 * 1000) state = 'degraded'

  const itemCount = numberOr(doc.item_count, publicIcps.length)
  const aggregateScore = nullableNumber(doc.aggregate_score ?? row.aggregate_score)
  return {
    state,
    reportId: stringOr(row.report_id) ?? null,
    benchmarkDate: stringOr(doc.benchmark_date) ?? stringOr(row.benchmark_date) ?? null,
    rollingWindowHash: stringOr(doc.rolling_window_hash) ?? stringOr(row.rolling_window_hash) ?? null,
    aggregateScore,
    itemCount,
    publicIcpCount: numberOr(doc.public_icp_count, numberOr(objectRecord(doc.visibility_split)?.public_count, publicIcps.length)),
    privateHoldoutIcpCount: numberOr(doc.private_holdout_icp_count, numberOr(objectRecord(doc.visibility_split)?.private_count, 0)),
    currentStatusAt,
    ageMs,
    issueCount: topIssues.reduce((sum, issue) => sum + issue.count, 0),
    topIssues,
    detail: state === 'healthy'
      ? 'Current published benchmark is fresh.'
      : 'Benchmark publication is stale or missing timing metadata.',
  }
}

function emptyBenchmarkSummary(detail: string): AdminLabBenchmarkSummary {
  return {
    state: 'unknown',
    reportId: null,
    benchmarkDate: null,
    rollingWindowHash: null,
    aggregateScore: null,
    itemCount: 0,
    publicIcpCount: 0,
    privateHoldoutIcpCount: 0,
    currentStatusAt: null,
    ageMs: null,
    issueCount: 0,
    topIssues: [],
    detail,
  }
}

async function fetchAlertSummary(
  supabase: ReturnType<typeof getAdminSupabase>,
): Promise<AdminLabAlertSummary> {
  const current = await fetchOptionalRows(supabase, 'ops_alert_current', 500)
  if (current.sourceAvailable && current.rows.length > 0) {
    return summarizeOpsAlerts(current.rows)
  }

  const events = await fetchOptionalRows(supabase, 'ops_alert_events', 500)
  if (events.sourceAvailable && events.rows.length > 0) {
    return summarizeOpsAlerts(events.rows)
  }

  return fetchPublicLogAlertSummary(
    supabase,
    current.unavailableReason ?? events.unavailableReason,
  )
}

function summarizeOpsAlerts(rows: Array<Record<string, unknown>>): AdminLabAlertSummary {
  const since24h = Date.now() - 24 * 60 * 60 * 1000
  const alerts = rows
    .map(normalizeAlertRow)
    .filter(Boolean) as AdminLabAlert[]
  alerts.sort((a, b) => timestampOrZero(b.lastSeenAt ?? b.firstSeenAt) - timestampOrZero(a.lastSeenAt ?? a.firstSeenAt))
  const last24h = alerts.filter((alert) => timestampOrZero(alert.lastSeenAt ?? alert.firstSeenAt) >= since24h)
  const criticalLast24h = last24h.filter((alert) => alert.severity.toLowerCase() === 'critical').length
  const warningLast24h = last24h.filter((alert) => ['warning', 'warn'].includes(alert.severity.toLowerCase())).length
  const activeCount = alerts.filter((alert) => !['resolved', 'closed', 'acked'].includes(alert.status.toLowerCase())).length
  const totalWeighted = last24h.reduce((sum, alert) => sum + Math.max(1, alert.count), 0)
  const state: AdminHealthState =
    criticalLast24h > 0 || totalWeighted >= 50
      ? 'critical'
      : warningLast24h > 0 || totalWeighted >= 10
        ? 'degraded'
        : 'healthy'

  return {
    state,
    source: 'ops_telemetry',
    sourceAvailable: true,
    unavailableReason: null,
    totalLast24h: totalWeighted,
    criticalLast24h,
    warningLast24h,
    activeCount,
    verifiedEventCount: 0,
    weightSubmissionCount: 0,
    epochAuditCount: 0,
    latestObservedAt: latestIso(...alerts.map((alert) => alert.lastSeenAt ?? alert.firstSeenAt)) ?? null,
    latestCheckpointAt: null,
    latestCheckpointUrl: null,
    recent: alerts.slice(0, 8),
  }
}

type PublicTransparencyLogRow = {
  event_type: string | null
  ts: string | null
  event_hash: string | null
  tee_sequence: number | null
  arweave_tx_id: string | null
  payload_netuid: string | null
  payload_epoch: string | null
  payload_epoch_id: string | null
  signed_event_hash: string | null
}

async function fetchPublicLogAlertSummary(
  supabase: ReturnType<typeof getAdminSupabase>,
  opsUnavailableReason: string | null,
): Promise<AdminLabAlertSummary> {
  const since = new Date(Date.now() - PUBLIC_LOG_WINDOW_MS).toISOString()
  const { data, error } = await supabase
    .from('transparency_log')
    .select(
      'event_type,ts,event_hash,tee_sequence,arweave_tx_id,payload_netuid:payload->>netuid,payload_epoch:payload->>epoch,payload_epoch_id:payload->>epoch_id,signed_event_hash:signed_log_entry->>event_hash',
    )
    .in('event_type', ['WEIGHT_SUBMISSION', 'RESEARCH_LAB_EPOCH_AUDIT', 'ARWEAVE_CHECKPOINT'])
    .gte('ts', since)
    .order('ts', { ascending: false })
    .limit(PUBLIC_LOG_LIMIT)

  if (error) {
    return emptyAlertSummary(
      [opsUnavailableReason, `transparency_log: ${error.message}`].filter(Boolean).join('; '),
    )
  }

  const rows = ((data ?? []) as PublicTransparencyLogRow[]).filter((row) =>
    row.event_type === 'ARWEAVE_CHECKPOINT' || row.payload_netuid === String(LEADPOET_NETUID),
  )
  const weightRows = rows.filter((row) => row.event_type === 'WEIGHT_SUBMISSION')
  const auditRows = rows.filter((row) => row.event_type === 'RESEARCH_LAB_EPOCH_AUDIT')
  const checkpointRows = rows.filter((row) => row.event_type === 'ARWEAVE_CHECKPOINT')
  const signedRows = [...weightRows, ...auditRows]
  const invalidSignedRows = signedRows.filter((row) =>
    !row.event_hash || !row.signed_event_hash || row.event_hash !== row.signed_event_hash,
  )
  const verifiedEventCount = signedRows.length - invalidSignedRows.length
  const latestWeightAt = latestIso(...weightRows.map((row) => row.ts)) ?? null
  const latestCheckpointAt = latestIso(...checkpointRows.map((row) => row.ts)) ?? null
  const latestObservedAt = latestIso(...rows.map((row) => row.ts)) ?? null
  const latestCheckpoint = checkpointRows.find((row) => row.ts === latestCheckpointAt) ?? null
  const auditEpochs = new Set(auditRows.map((row) => row.payload_epoch).filter(Boolean))
  const missingAuditRows = weightRows.filter((row) =>
    Boolean(row.payload_epoch_id) && !auditEpochs.has(row.payload_epoch_id),
  )
  const alerts: AdminLabAlert[] = []

  const addAlert = (input: {
    id: string
    severity: 'critical' | 'warning'
    title: string
    count?: number
    firstSeenAt?: string | null
    lastSeenAt?: string | null
  }) => {
    alerts.push({
      id: input.id,
      severity: input.severity,
      source: 'public transparency log',
      title: input.title,
      fingerprint: input.id,
      status: 'active',
      count: Math.max(1, input.count ?? 1),
      firstSeenAt: input.firstSeenAt ?? input.lastSeenAt ?? null,
      lastSeenAt: input.lastSeenAt ?? input.firstSeenAt ?? null,
    })
  }

  if (weightRows.length === 0) {
    addAlert({
      id: 'public-log:no-weight-submission',
      severity: 'critical',
      title: `No subnet ${LEADPOET_NETUID} weight submission in 24h`,
      firstSeenAt: since,
      lastSeenAt: latestObservedAt,
    })
  } else if (latestWeightAt) {
    const weightAgeMs = Date.now() - timestampOrZero(latestWeightAt)
    if (weightAgeMs > DEGRADED_WEIGHT_SUBMISSION_MS) {
      addAlert({
        id: 'public-log:weight-submission-critical-stale',
        severity: 'critical',
        title: 'Latest subnet weight submission is over 6h old',
        lastSeenAt: latestWeightAt,
      })
    } else if (weightAgeMs > FRESH_WEIGHT_SUBMISSION_MS) {
      addAlert({
        id: 'public-log:weight-submission-stale',
        severity: 'warning',
        title: 'Latest subnet weight submission is over 3h old',
        lastSeenAt: latestWeightAt,
      })
    }
  }

  if (invalidSignedRows.length > 0) {
    addAlert({
      id: 'public-log:invalid-signature-envelope',
      severity: 'critical',
      title: `${invalidSignedRows.length} public log ${invalidSignedRows.length === 1 ? 'entry has' : 'entries have'} a missing or mismatched signed event hash`,
      count: invalidSignedRows.length,
      firstSeenAt: latestIso(...invalidSignedRows.map((row) => row.ts)) ?? null,
      lastSeenAt: latestIso(...invalidSignedRows.map((row) => row.ts)) ?? null,
    })
  }

  if (missingAuditRows.length > 0) {
    const latestWeightEpoch = weightRows[0]?.payload_epoch_id ?? null
    const latestEpochMissing = missingAuditRows.some((row) => row.payload_epoch_id === latestWeightEpoch)
    addAlert({
      id: 'public-log:missing-epoch-audit',
      severity: latestEpochMissing ? 'critical' : 'warning',
      title: `${missingAuditRows.length} weight ${missingAuditRows.length === 1 ? 'epoch is' : 'epochs are'} missing a public research audit`,
      count: missingAuditRows.length,
      firstSeenAt: latestIso(...missingAuditRows.map((row) => row.ts)) ?? null,
      lastSeenAt: latestIso(...missingAuditRows.map((row) => row.ts)) ?? null,
    })
  }

  if (!latestCheckpointAt) {
    addAlert({
      id: 'public-log:no-arweave-checkpoint',
      severity: 'critical',
      title: 'No Arweave transparency checkpoint in 24h',
      firstSeenAt: since,
      lastSeenAt: latestObservedAt,
    })
  } else {
    const checkpointAgeMs = Date.now() - timestampOrZero(latestCheckpointAt)
    if (checkpointAgeMs > DEGRADED_ARWEAVE_CHECKPOINT_MS) {
      addAlert({
        id: 'public-log:arweave-checkpoint-critical-stale',
        severity: 'critical',
        title: 'Latest Arweave transparency checkpoint is over 12h old',
        lastSeenAt: latestCheckpointAt,
      })
    } else if (checkpointAgeMs > FRESH_ARWEAVE_CHECKPOINT_MS) {
      addAlert({
        id: 'public-log:arweave-checkpoint-stale',
        severity: 'warning',
        title: 'Latest Arweave transparency checkpoint is over 6h old',
        lastSeenAt: latestCheckpointAt,
      })
    }
  }

  alerts.sort((a, b) => timestampOrZero(b.lastSeenAt) - timestampOrZero(a.lastSeenAt))
  const criticalLast24h = alerts.filter((alert) => alert.severity === 'critical').length
  const warningLast24h = alerts.filter((alert) => alert.severity === 'warning').length
  const totalLast24h = alerts.reduce((sum, alert) => sum + alert.count, 0)
  const state: AdminHealthState = criticalLast24h > 0
    ? 'critical'
    : warningLast24h > 0
      ? 'degraded'
      : 'healthy'

  return {
    state,
    source: 'public_transparency_log',
    sourceAvailable: true,
    unavailableReason: null,
    totalLast24h,
    criticalLast24h,
    warningLast24h,
    activeCount: alerts.length,
    verifiedEventCount,
    weightSubmissionCount: weightRows.length,
    epochAuditCount: auditRows.length,
    latestObservedAt,
    latestCheckpointAt,
    latestCheckpointUrl: latestCheckpoint?.arweave_tx_id
      ? `https://viewblock.io/arweave/tx/${encodeURIComponent(latestCheckpoint.arweave_tx_id)}`
      : null,
    recent: alerts.slice(0, 8),
  }
}

function emptyAlertSummary(unavailableReason: string | null): AdminLabAlertSummary {
  return {
    state: 'unknown',
    source: 'none',
    sourceAvailable: false,
    unavailableReason,
    totalLast24h: 0,
    criticalLast24h: 0,
    warningLast24h: 0,
    activeCount: 0,
    verifiedEventCount: 0,
    weightSubmissionCount: 0,
    epochAuditCount: 0,
    latestObservedAt: null,
    latestCheckpointAt: null,
    latestCheckpointUrl: null,
    recent: [],
  }
}

function normalizeAlertRow(row: Record<string, unknown>): AdminLabAlert | null {
  const title = stringOr(row.title) ?? stringOr(row.message) ?? stringOr(row.alert_name) ?? stringOr(row.fingerprint)
  if (!title) return null
  return {
    id: stringOr(row.id) ?? stringOr(row.alert_id) ?? title,
    severity: stringOr(row.severity) ?? stringOr(row.level) ?? 'info',
    source: stringOr(row.source) ?? stringOr(row.component) ?? 'ops',
    title,
    fingerprint: stringOr(row.fingerprint) ?? stringOr(row.alert_key) ?? title,
    status: stringOr(row.status) ?? stringOr(row.alert_status) ?? 'active',
    count: Math.max(1, Math.round(numberOr(row.count ?? row.event_count, 1))),
    firstSeenAt: isoStringOr(row.first_seen_at) ?? isoStringOr(row.created_at) ?? null,
    lastSeenAt:
      isoStringOr(row.last_seen_at) ??
      isoStringOr(row.updated_at) ??
      isoStringOr(row.created_at) ??
      null,
  }
}

async function fetchAttestationSummary(
  supabase: ReturnType<typeof getAdminSupabase>,
): Promise<AdminLabAttestationSummary> {
  const result = await fetchOptionalRows(supabase, 'ops_attestation_current', 200)
  if (result.sourceAvailable && result.rows.length > 0) {
    return summarizeOpsAttestations(result.rows)
  }

  return fetchPublishedWeightAttestationSummary(supabase, result.unavailableReason)
}

function summarizeOpsAttestations(rows: Array<Record<string, unknown>>): AdminLabAttestationSummary {
  const nodes = rows.map(normalizeAttestationRow)
  const mismatchedNodes = nodes.filter((node) => node.matched === false).length
  const missingNodes = nodes.filter((node) => node.matched === null).length
  const matchedNodes = nodes.filter((node) => node.matched === true).length
  const latestAttestedAt = latestIso(...nodes.map((node) => node.attestedAt)) ?? null
  const expectedPcr0 = nodes.find((node) => node.expectedPcr0)?.expectedPcr0 ?? null
  const state: AdminHealthState =
    nodes.length === 0
      ? 'unknown'
      : mismatchedNodes > 0
        ? 'critical'
        : missingNodes > 0
          ? 'degraded'
          : 'healthy'

  return {
    state,
    source: 'ops_attestation_current',
    verificationMode: 'expected_match',
    sourceAvailable: true,
    unavailableReason: null,
    totalNodes: nodes.length,
    matchedNodes,
    mismatchedNodes,
    missingNodes,
    expectedPcr0,
    latestAttestedAt,
    latestEpoch: null,
    acceptanceCheckedAt: null,
    acceptanceDetail: null,
    nodes: nodes
      .sort((a, b) => {
        const aBad = a.matched === false ? 0 : a.matched === null ? 1 : 2
        const bBad = b.matched === false ? 0 : b.matched === null ? 1 : 2
        return aBad - bBad || timestampOrZero(b.attestedAt) - timestampOrZero(a.attestedAt)
      })
      .slice(0, 12),
  }
}

async function fetchPublishedWeightAttestationSummary(
  supabase: ReturnType<typeof getAdminSupabase>,
  opsUnavailableReason: string | null,
): Promise<AdminLabAttestationSummary> {
  const { data, error } = await supabase
    .from('published_weight_bundles')
    .select(
      'epoch_id,validator_hotkey,validator_enclave_pubkey,validator_pcr0,pcr0_commit_hash,weight_submission_event_hash,created_at',
    )
    .eq('netuid', LEADPOET_NETUID)
    .order('epoch_id', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(200)

  if (error) {
    return emptyAttestationSummary(
      [opsUnavailableReason, `published_weight_bundles: ${error.message}`].filter(Boolean).join('; '),
    )
  }

  const latestByValidator = new Map<string, Record<string, unknown>>()
  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    const key = stringOr(row.validator_hotkey) ?? stringOr(row.validator_enclave_pubkey) ?? 'unknown'
    if (!latestByValidator.has(key)) latestByValidator.set(key, row)
  }

  const observedNodes: AdminLabAttestationNode[] = Array.from(latestByValidator.values()).map((row) => {
    const hotkey = stringOr(row.validator_hotkey) ?? null
    const enclavePubkey = stringOr(row.validator_enclave_pubkey) ?? null
    const epoch = finiteNumberOrNull(row.epoch_id)
    const observedPcr0 = normalizePcr0(row.validator_pcr0)
    const nodeId = hotkey ?? enclavePubkey ?? 'unknown'
    return {
      id: `published-weight:${nodeId}`,
      component: 'validator',
      nodeId,
      hotkey,
      expectedPcr0: null,
      observedPcr0,
      matched: null,
      buildId: epoch === null ? null : `epoch ${Math.round(epoch)}`,
      gitSha: stringOr(row.pcr0_commit_hash) ?? null,
      attestedAt: isoStringOr(row.created_at) ?? null,
      epoch,
      transparencyEventHash: stringOr(row.weight_submission_event_hash) ?? null,
      acceptanceCheckedAt: null,
      acceptanceDetail: null,
    }
  })
  const acceptanceResults = await Promise.all(observedNodes.map((node) =>
    fetchGatewayPcr0Acceptance({
      gatewayUrl: LEADPOET_GATEWAY_URL,
      pcr0: node.observedPcr0,
      commit: node.gitSha,
    }),
  ))
  const nodes = observedNodes.map((node, index) => ({
    ...node,
    matched: acceptanceResults[index].accepted,
    acceptanceCheckedAt: acceptanceResults[index].checkedAt,
    acceptanceDetail: acceptanceResults[index].detail,
  }))
  const gatewayAcceptanceAvailable = acceptanceResults.some((result) => result.checked)
  const rawMissingNodes = nodes.filter((node) => !node.observedPcr0).length
  const matchedNodes = nodes.filter((node) => node.matched === true).length
  const mismatchedNodes = nodes.filter((node) => node.matched === false).length
  const missingNodes = gatewayAcceptanceAvailable
    ? nodes.filter((node) => node.matched === null).length
    : rawMissingNodes
  const latestAttestedAt = latestIso(...nodes.map((node) => node.attestedAt)) ?? null
  const latestEpoch = nodes.reduce<number | null>((latest, node) => {
    if (node.epoch === null) return latest
    return latest === null ? node.epoch : Math.max(latest, node.epoch)
  }, null)
  const attestationAgeMs = latestAttestedAt
    ? Date.now() - timestampOrZero(latestAttestedAt)
    : null
  const state: AdminHealthState = nodes.length === 0
    ? 'unknown'
    : mismatchedNodes > 0
      ? 'critical'
      : rawMissingNodes === nodes.length || attestationAgeMs === null || attestationAgeMs > DEGRADED_PUBLISHED_ATTESTATION_MS
        ? 'critical'
        : !gatewayAcceptanceAvailable || missingNodes > 0 || attestationAgeMs > FRESH_PUBLISHED_ATTESTATION_MS
          ? 'degraded'
          : 'healthy'

  const mismatchResult = acceptanceResults.find((result) => result.accepted === false)
  const acceptedResult = acceptanceResults.find((result) => result.accepted === true)
  const unavailableResult = acceptanceResults.find((result) => !result.checked)
  const acceptanceDetail = (mismatchResult ?? acceptedResult ?? unavailableResult)?.detail ?? null
  const acceptanceCheckedAt = latestIso(
    ...acceptanceResults.map((result) => result.checkedAt),
  ) ?? null

  return {
    state,
    source: 'published_weight_bundles',
    verificationMode: gatewayAcceptanceAvailable ? 'gateway_acceptance' : 'observation_only',
    sourceAvailable: true,
    unavailableReason: null,
    totalNodes: nodes.length,
    matchedNodes,
    mismatchedNodes,
    missingNodes,
    expectedPcr0: null,
    latestAttestedAt,
    latestEpoch,
    acceptanceCheckedAt,
    acceptanceDetail,
    nodes: nodes
      .sort((a, b) => timestampOrZero(b.attestedAt) - timestampOrZero(a.attestedAt))
      .slice(0, 12),
  }
}

function emptyAttestationSummary(unavailableReason: string | null): AdminLabAttestationSummary {
  return {
    state: 'unknown',
    source: 'none',
    verificationMode: 'observation_only',
    sourceAvailable: false,
    unavailableReason,
    totalNodes: 0,
    matchedNodes: 0,
    mismatchedNodes: 0,
    missingNodes: 0,
    expectedPcr0: null,
    latestAttestedAt: null,
    latestEpoch: null,
    acceptanceCheckedAt: null,
    acceptanceDetail: null,
    nodes: [],
  }
}

function normalizeAttestationRow(row: Record<string, unknown>): AdminLabAttestationNode {
  const expectedPcr0 = stringOr(row.expected_pcr0) ?? stringOr(row.expectedPCR0) ?? null
  const observedPcr0 =
    stringOr(row.observed_pcr0) ??
    stringOr(row.pcr0) ??
    stringOr(row.observedPCR0) ??
    null
  const explicitMatched = booleanOr(row.matched) ?? booleanOr(row.pcr0_matched)
  const matched = explicitMatched ?? (
    expectedPcr0 && observedPcr0
      ? expectedPcr0.toLowerCase() === observedPcr0.toLowerCase()
      : null
  )
  const nodeId =
    stringOr(row.node_id) ??
    stringOr(row.worker_id) ??
    stringOr(row.validator_id) ??
    stringOr(row.component_id) ??
    'unknown'
  const component = stringOr(row.component) ?? stringOr(row.service) ?? 'scoring'
  return {
    id: stringOr(row.id) ?? `${component}:${nodeId}`,
    component,
    nodeId,
    hotkey: stringOr(row.hotkey) ?? stringOr(row.miner_hotkey) ?? stringOr(row.validator_hotkey) ?? null,
    expectedPcr0,
    observedPcr0,
    matched,
    buildId: stringOr(row.build_id) ?? stringOr(row.image_digest) ?? null,
    gitSha: stringOr(row.git_sha) ?? stringOr(row.git_commit_sha) ?? null,
    attestedAt:
      isoStringOr(row.attested_at) ??
      isoStringOr(row.updated_at) ??
      isoStringOr(row.created_at) ??
      null,
    epoch: finiteNumberOrNull(row.epoch_id),
    transparencyEventHash:
      stringOr(row.transparency_event_hash) ??
      stringOr(row.weight_submission_event_hash) ??
      null,
    acceptanceCheckedAt: null,
    acceptanceDetail: null,
  }
}

async function fetchSourcingModelSummary(
  supabase: ReturnType<typeof getAdminSupabase>,
): Promise<AdminLabSourcingModelSummary> {
  const { data, error } = await supabase
    .from('research_lab_private_model_version_current')
    .select(
      'private_model_version_id,current_version_status,current_status_at,git_commit_sha,build_id,model_artifact_hash,private_model_manifest_hash,component_registry_version,scoring_adapter_version,redacted_version_doc',
    )
    .eq('current_version_status', 'active')
    .order('current_status_at', { ascending: false, nullsFirst: false })
    .limit(1)

  if (error) {
    console.warn('[admin:research-lab] active sourcing model unavailable', error.message)
    return emptySourcingModelSummary(false, error.message)
  }

  const row = ((data ?? []) as Array<Record<string, unknown>>)[0]
  if (!row) return emptySourcingModelSummary(true, null)

  const versionDoc = objectRecord(row.redacted_version_doc)
  const manifestWaitStatus = objectRecord(versionDoc?.manifest_wait_status)
  return {
    sourceAvailable: true,
    unavailableReason: null,
    status: stringOr(row.current_version_status) ?? null,
    versionId: stringOr(row.private_model_version_id) ?? null,
    gitCommitSha:
      stringOr(row.git_commit_sha) ??
      stringOr(versionDoc?.git_commit_sha) ??
      stringOr(versionDoc?.repo_main_sha) ??
      null,
    imageRefHash:
      stringOr(versionDoc?.image_ref_hash) ??
      stringOr(manifestWaitStatus?.current_json_image_ref_hash) ??
      null,
    buildId: stringOr(row.build_id) ?? null,
    branch: stringOr(versionDoc?.repo_branch) ?? null,
    source: stringOr(versionDoc?.source) ?? null,
    actorRef: stringOr(versionDoc?.actor_ref) ?? null,
    componentRegistryVersion:
      stringOr(row.component_registry_version) ??
      stringOr(versionDoc?.component_registry_version) ??
      null,
    scoringAdapterVersion:
      stringOr(row.scoring_adapter_version) ??
      stringOr(versionDoc?.scoring_adapter_version) ??
      null,
    modelArtifactHash:
      stringOr(row.model_artifact_hash) ??
      stringOr(versionDoc?.model_artifact_hash) ??
      null,
    manifestHash:
      stringOr(row.private_model_manifest_hash) ??
      stringOr(versionDoc?.private_model_manifest_hash) ??
      null,
    currentPointerUri:
      stringOr(versionDoc?.current_json_pointer_uri) ??
      stringOr(manifestWaitStatus?.manifest_uri) ??
      null,
    activatedAt: isoStringOr(row.current_status_at) ?? null,
  }
}

function emptySourcingModelSummary(
  sourceAvailable: boolean,
  unavailableReason: string | null,
): AdminLabSourcingModelSummary {
  return {
    sourceAvailable,
    unavailableReason,
    status: null,
    versionId: null,
    gitCommitSha: null,
    imageRefHash: null,
    buildId: null,
    branch: null,
    source: null,
    actorRef: null,
    componentRegistryVersion: null,
    scoringAdapterVersion: null,
    modelArtifactHash: null,
    manifestHash: null,
    currentPointerUri: null,
    activatedAt: null,
  }
}

function buildDataFreshness(loops: AdminLabLoopSummary[]): AdminLabDataFreshness {
  const latestActivityAt = latestIso(...loops.map((loop) => loop.lastActivityAt)) ?? null
  const ageMs = latestActivityAt ? Date.now() - timestampOrZero(latestActivityAt) : null
  const state: AdminHealthState =
    ageMs === null
      ? 'unknown'
      : ageMs <= FRESH_DATA_MS
        ? 'healthy'
        : ageMs <= DEGRADED_DATA_MS
          ? 'degraded'
          : 'critical'
  return {
    state,
    latestActivityAt,
    ageMs,
    loopCount: loops.length,
  }
}

function buildHealthSignals(input: {
  dataFreshness: AdminLabDataFreshness
  scoring: AdminLabScoringSummary
  benchmark: AdminLabBenchmarkSummary
  alerts: AdminLabAlertSummary
  attestation: AdminLabAttestationSummary
}): AdminLabHealthSignal[] {
  return [
    {
      id: 'scoring',
      label: 'Scoring',
      value: input.scoring.label,
      state: healthStateForScoring(input.scoring.state),
      detail: input.scoring.detail,
      updatedAt: input.scoring.lastScoringAt ?? input.scoring.controlUpdatedAt,
    },
    {
      id: 'pcr0',
      label: 'PCR0',
      value: input.attestation.sourceAvailable
        ? input.attestation.verificationMode === 'gateway_acceptance'
          ? input.attestation.mismatchedNodes > 0
            ? 'Mismatch'
            : `${input.attestation.matchedNodes}/${input.attestation.totalNodes} accepted`
          : input.attestation.verificationMode === 'observation_only'
            ? 'Unverified'
            : `${input.attestation.matchedNodes}/${input.attestation.totalNodes} matched`
        : 'Not wired',
      state: input.attestation.state,
      detail: input.attestation.sourceAvailable
        ? input.attestation.verificationMode === 'gateway_acceptance'
          ? input.attestation.mismatchedNodes > 0
            ? `${input.attestation.mismatchedNodes} validator PCR0${input.attestation.mismatchedNodes === 1 ? ' is' : 's are'} rejected by the production gateway; audited weight publication is blocked.`
            : input.attestation.acceptanceDetail ?? 'All reporting validator PCR0s are accepted by the production gateway.'
          : input.attestation.verificationMode === 'observation_only'
            ? input.attestation.acceptanceDetail ?? 'A validator PCR0 is published, but the production gateway acceptance check is unavailable.'
            : input.attestation.mismatchedNodes > 0
              ? `${input.attestation.mismatchedNodes} node${input.attestation.mismatchedNodes === 1 ? '' : 's'} report PCR0 mismatch.`
              : input.attestation.missingNodes > 0
                ? `${input.attestation.missingNodes} node${input.attestation.missingNodes === 1 ? '' : 's'} are missing PCR0 data.`
                : 'All reporting nodes match expected PCR0.'
        : 'No PCR0 source is readable from ops_attestation_current or published_weight_bundles.',
      updatedAt: input.attestation.acceptanceCheckedAt ?? input.attestation.latestAttestedAt,
    },
    {
      id: 'alerts',
      label: 'Alerts',
      value: input.alerts.sourceAvailable
        ? `${input.alerts.totalLast24h} / 24h`
        : 'Not wired',
      state: input.alerts.state,
      detail: input.alerts.sourceAvailable
        ? input.alerts.source === 'public_transparency_log'
          ? `${input.alerts.verifiedEventCount} signed events checked (${input.alerts.weightSubmissionCount} weights, ${input.alerts.epochAuditCount} audits); ${input.alerts.activeCount} derived issues.`
          : `${input.alerts.criticalLast24h} critical, ${input.alerts.warningLast24h} warning, ${input.alerts.activeCount} active.`
        : 'No alert telemetry or public transparency log is readable.',
      updatedAt: input.alerts.latestObservedAt ?? input.alerts.recent[0]?.lastSeenAt,
    },
    {
      id: 'benchmark',
      label: 'Benchmark',
      value: input.benchmark.aggregateScore === null ? 'Unknown' : input.benchmark.aggregateScore.toFixed(2),
      state: input.benchmark.state,
      detail: input.benchmark.detail,
      updatedAt: input.benchmark.currentStatusAt,
    },
    {
      id: 'freshness',
      label: 'Data',
      value: input.dataFreshness.ageMs === null ? 'No events' : `${Math.round(input.dataFreshness.ageMs / 60000)}m old`,
      state: input.dataFreshness.state,
      detail: input.dataFreshness.latestActivityAt
        ? `Latest Lab activity at ${input.dataFreshness.latestActivityAt}.`
        : 'No Lab activity rows were returned.',
      updatedAt: input.dataFreshness.latestActivityAt,
    },
  ]
}

async function fetchOptionalRows(
  supabase: ReturnType<typeof getAdminSupabase>,
  table: string,
  limit: number,
): Promise<{ rows: Array<Record<string, unknown>>; sourceAvailable: boolean; unavailableReason: string | null }> {
  const { data, error } = await supabase
    .from(table)
    .select('*')
    .limit(limit)

  if (error) {
    if (!isExpectedOptionalTimelineSourceMiss(error.message)) {
      console.warn(`[admin:research-lab] optional source unavailable: ${table}`, error.message)
    }
    return {
      rows: [],
      sourceAvailable: false,
      unavailableReason: error.message,
    }
  }

  return {
    rows: (data ?? []) as Array<Record<string, unknown>>,
    sourceAvailable: true,
    unavailableReason: null,
  }
}

function normalizeLoopRow(row: AdminLabLoopRow): AdminLabLoopSummary {
  const doc = objectRecord(row.current_event_doc) ?? {}
  const projectedOutcomeLabel = row.current_outcome_label || 'submitted'
  const projectedOutcomeBand = row.current_outcome_band || 'pending'
  const publicStatus =
    stringOr(row.public_status) ??
    stringOr(row.current_public_status) ??
    stringOr(doc.public_status) ??
    stringOr(doc.current_public_status)
  const paymentState =
    stringOr(row.payment_state) ??
    stringOr(row.current_payment_state) ??
    stringOr(doc.payment_state) ??
    stringOr(doc.current_payment_state)
  const executionState =
    stringOr(row.execution_state) ??
    stringOr(row.current_execution_state) ??
    stringOr(doc.execution_state) ??
    stringOr(doc.current_execution_state)
  const candidateState =
    stringOr(row.candidate_state) ??
    stringOr(row.current_candidate_state) ??
    stringOr(doc.candidate_state) ??
    stringOr(doc.current_candidate_state)
  const resultState =
    stringOr(row.result_state) ??
    stringOr(row.current_result_state) ??
    stringOr(doc.result_state) ??
    stringOr(doc.current_result_state)
  const opsReason =
    stringOr(row.ops_reason) ??
    stringOr(row.current_ops_reason) ??
    stringOr(doc.ops_reason) ??
    stringOr(doc.current_ops_reason)
  const statusDetail =
    stringOr(row.status_detail) ??
    stringOr(row.current_status_detail) ??
    stringOr(doc.status_detail) ??
    stringOr(doc.current_status_detail)
  const opsWarnings = warningStrings(
    row.ops_warnings ??
      row.current_ops_warnings ??
      doc.ops_warnings ??
      doc.current_ops_warnings,
  )
  const improvementGate = objectRecord(doc.improvement_gate) ?? objectRecord(doc.improvementGate)
  const promotionDoc = objectRecord(doc.promotion)
  const candidateCount = numberOr(row.current_candidate_count, 0)
  const scoredCandidateCount = numberOr(row.current_scored_candidate_count, 0)
  const displayStatus = deriveResearchLabLoopStatus({
    publicStatus,
    paymentState,
    executionState,
    candidateState,
    resultState,
    opsReason,
    statusDetail,
    opsWarnings,
    outcomeLabel: projectedOutcomeLabel,
    outcomeBand: projectedOutcomeBand,
    runId: row.current_run_id,
    receiptId: row.current_receipt_id,
    candidateCount,
    scoredCandidateCount,
    currentCandidateStatus:
      row.current_candidate_status ??
      stringOr(doc.current_candidate_status) ??
      stringOr(doc.candidate_status),
    currentReason:
      row.current_reason ??
      stringOr(doc.current_reason) ??
      stringOr(doc.candidate_reason) ??
      stringOr(doc.projection_reason),
    currentQueueStatus: row.current_queue_status ?? stringOr(doc.queue_status),
    currentReceiptStatus: row.current_receipt_status ?? stringOr(doc.receipt_status),
    currentStatus: row.current_status,
    improvementGateDecision:
      row.current_improvement_gate_decision ??
      row.improvement_gate_decision ??
      stringOr(doc.current_improvement_gate_decision) ??
      stringOr(doc.improvement_gate_decision) ??
      stringOr(improvementGate?.decision),
    promotionStatus:
      row.current_promotion_status ??
      row.promotion_status ??
      stringOr(doc.current_promotion_status) ??
      stringOr(doc.promotion_status) ??
      stringOr(promotionDoc?.status),
    promotionEventType:
      row.current_promotion_event_type ??
      row.promotion_event_type ??
      stringOr(doc.current_promotion_event_type) ??
      stringOr(doc.promotion_event_type) ??
      stringOr(promotionDoc?.event_type),
    promotionEvent:
      row.current_promotion_event ??
      row.promotion_event ??
      stringOr(doc.current_promotion_event) ??
      stringOr(doc.promotion_event) ??
      stringOr(promotionDoc?.event),
    eventType:
      row.current_event_type ??
      row.event_type ??
      stringOr(doc.current_event_type) ??
      stringOr(doc.event_type),
  })

  return {
    cardId: row.card_id,
    ticketId: row.ticket_id,
    runId: row.current_run_id,
    receiptId: row.current_receipt_id,
    minerHotkey: row.miner_hotkey ?? '',
    researchArea: row.research_area || 'generalist',
    researchFocusSummary: row.research_focus_summary || '',
    topicTags: arrayOfStrings(row.current_topic_tags ?? row.topic_tags),
    topicSignatureHash: row.current_topic_signature_hash || row.topic_signature_hash || '',
    outcomeLabel: row.current_status || displayStatus.label || projectedOutcomeLabel,
    outcomeBand: displayStatus.band || projectedOutcomeBand,
    publicStatus,
    paymentState,
    executionState,
    candidateState,
    resultState,
    opsReason,
    statusDetail,
    opsWarnings,
    statusKey: displayStatus.key,
    statusLabel: displayStatus.label,
    statusNote: displayStatus.note,
    actionNote: displayStatus.action,
    candidateCount,
    scoredCandidateCount,
    bestCandidatePublicSummary: row.current_best_candidate_public_summary || '',
    lastActivityAt: row.current_last_activity_at || row.created_at,
    submittedAt: row.created_at,
  }
}

function arrayOfStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0)
}

function arrayOfRecords(value: unknown): Array<Record<string, unknown>> | undefined {
  if (!Array.isArray(value)) return undefined
  const out = value.filter((item): item is Record<string, unknown> =>
    Boolean(item) && typeof item === 'object' && !Array.isArray(item),
  )
  return out.length > 0 ? out : undefined
}

function numberOr(value: unknown, fallback: number): number {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

function nullableNumber(value: unknown): number | null {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function finiteNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function normalizePcr0(value: unknown): string | null {
  const text = stringOr(value)?.replace(/^0x/i, '').toLowerCase()
  return text && /^[0-9a-f]{96}$/.test(text) ? text : null
}

function firstFiniteNumber(values: unknown[]): number | null {
  for (const value of values) {
    const numeric = nullableNumber(value)
    if (numeric !== null) return numeric
  }
  return null
}

function booleanOr(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (['true', 't', 'yes', '1', 'matched'].includes(normalized)) return true
    if (['false', 'f', 'no', '0', 'mismatch', 'missing'].includes(normalized)) return false
  }
  return undefined
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function stringOr(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function isoStringOr(value: unknown): string | undefined {
  const text = stringOr(value)
  if (!text) return undefined
  const time = new Date(text).getTime()
  return Number.isFinite(time) ? text : undefined
}

function timestampOrZero(value: unknown): number {
  const text = typeof value === 'string' ? value : undefined
  const time = text ? new Date(text).getTime() : Number(value)
  return Number.isFinite(time) ? time : 0
}

function latestIso(...values: Array<string | null | undefined>): string | undefined {
  let latest: string | undefined
  for (const value of values) {
    if (!value) continue
    if (!latest || timestampOrZero(value) > timestampOrZero(latest)) latest = value
  }
  return latest
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => typeof value === 'string' && value.length > 0)))
}

function chunked<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size))
  }
  return chunks
}

function warningStrings(value: unknown): string[] | undefined {
  if (!value) return undefined
  if (Array.isArray(value)) {
    const out = value
      .map((item) => {
        if (typeof item === 'string') return item
        const record = objectRecord(item)
        return stringOr(record?.message) ?? stringOr(record?.detail) ?? stringOr(record?.reason)
      })
      .filter((item): item is string => Boolean(item))
    return out.length > 0 ? out : undefined
  }
  if (typeof value === 'string') return value.trim() ? [value.trim()] : undefined
  const record = objectRecord(value)
  if (!record) return undefined
  const out = Object.values(record)
    .map((item) => (typeof item === 'string' ? item : undefined))
    .filter((item): item is string => Boolean(item))
  return out.length > 0 ? out : undefined
}

function isTerminalIcpResult(row: Record<string, unknown>): boolean {
  const status = `${row.status ?? ''} ${row.result_status ?? ''} ${row.failure_reason ?? ''}`.toLowerCase()
  if (status.includes('pending') || status.includes('running') || status.includes('queued')) return false
  return Boolean(
    status.includes('scored') ||
      status.includes('pass') ||
      status.includes('fail') ||
      status.includes('reject') ||
      Number.isFinite(Number(row.final_score ?? row.score)),
  )
}

function phaseForLoop(loop: AdminLabLoopSummary): string {
  const status = loop.statusKey.toLowerCase()
  const text = [
    status,
    loop.publicStatus,
    loop.executionState,
    loop.candidateState,
    loop.resultState,
  ].filter(Boolean).join(' ').toLowerCase()
  if (status.includes('scoring') || text.includes('scoring') || text.includes('evaluation')) return 'scoring'
  if (status.includes('queued') || status.includes('payment') || status.includes('baseline') || text.includes('queued')) return 'queue'
  if (text.includes('candidate')) return 'candidate'
  if (isCompletedResearchLabLoopStatus(status)) return 'complete'
  if (isActiveResearchLabLoopStatus(status)) return 'auto research'
  return status || 'unknown'
}

function healthStateForScoring(state: AdminScoringState): AdminHealthState {
  if (state === 'active' || state === 'idle') return 'healthy'
  if (state === 'paused' || state === 'stalled' || state === 'blocked') return 'degraded'
  return 'unknown'
}

function worstHealthState(states: AdminHealthState[]): AdminHealthState {
  if (states.includes('critical')) return 'critical'
  if (states.includes('degraded')) return 'degraded'
  if (states.includes('healthy')) return 'healthy'
  return 'unknown'
}

function isFailedOutcome(label: string, band: string): boolean {
  const value = `${label} ${band}`.toLowerCase()
  return value.includes('failed') || value.includes('cancelled')
}

function isExpectedOptionalTimelineSourceMiss(message: string | undefined): boolean {
  const normalized = (message ?? '').toLowerCase()
  return normalized.includes('does not exist') || normalized.includes('could not find')
}
