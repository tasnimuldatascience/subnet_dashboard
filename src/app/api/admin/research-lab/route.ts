import { NextRequest, NextResponse } from 'next/server'
import { decodeAddress } from '@polkadot/util-crypto'
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
  filterResearchLabActivityLoops,
  isActiveResearchLabLoopStatus,
  isCompletedResearchLabLoopStatus,
  isNoGainOrFailedResearchLabLoopStatus,
  isPendingOrBlockingResearchLabLoopStatus,
  isPromisingResearchLabLoopStatus,
  isScoredResearchLabLoopStatus,
  RESEARCH_LAB_STATUS_FILTER_OPTIONS,
  researchLabStatusFilterOptionsWithCounts,
  type ResearchLabLoopStatusNote,
  type ResearchLabStatusFilterOption,
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
import {
  fetchGatewayDeployment,
  parseGatewayCommitComparison,
  type GatewayCommitComparison,
  type GatewayCommitFreshness,
} from '@/lib/gateway-deployment'
import { fetchMetagraph } from '@/lib/metagraph'
import {
  buildResearchLabAlertFingerprint,
  evaluateResearchLabAlerts,
  shouldSuppressResearchLabExecutionAlert,
  type ResearchLabAlertObservations,
  type ResearchLabAlertResolution,
  type ResearchLabEvaluatedAlert,
  type ResearchLabValidatorAlertObservation,
} from '@/lib/research-lab-alerts'
import { parseResearchLabAlertDeliveryConfig } from '@/lib/research-lab-alert-delivery'
import { getRuntimeSecretEnvironment } from '@/lib/runtime-secret-environment'
import {
  normalizeAdminLabCompanyIntent,
  normalizeAdminLabGatewayControl,
  parseAdminLabScoreBundleDiagnostics,
  type AdminLabCandidateArtifactDetail,
  type AdminLabCandidateRunDetail,
  type AdminLabBenchmarkRunSummary,
  type AdminLabChampionSummary,
  type AdminLabCompanyDetail,
  type AdminLabDailyBenchmark,
  type AdminLabErrorDetail,
  type AdminLabFunnelDetail,
  type AdminLabIcpDetail,
  type AdminLabIntentSignalDetail,
  type AdminLabRunDetail,
  type AdminLabScoreBundleDiagnostics,
  type AdminLabTelemetryState,
  type AdminLabWorkflowControlSummary,
} from '@/lib/admin-research-lab-telemetry'
import {
  canonicalizeResearchLabTelemetryRows,
  correlateResearchLabBenchmarkRun,
  groupResearchLabScoringRuns,
  normalizeResearchLabScoringExecution,
  type ResearchLabBenchmarkBundleRow,
  type ResearchLabScoringExecutionSummary,
  type ResearchLabScoringRunRow,
  type ResearchLabScoringTelemetryRow,
} from '@/lib/research-lab-scoring-telemetry'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const LOOP_LIMIT = 50
const LOOP_INDEX_BATCH_SIZE = 1_000
const ACTIVE_RUN_LIMIT = 40
const ALERT_RESOLUTION_RUN_LIMIT = 100
const ALERT_RESOLUTION_LOOKBACK_MS = 24 * 60 * 60 * 1_000
const COMPUTE_SPEND_DAYS = 30
const COMPUTE_SPEND_BATCH_SIZE = 1_000
const LEADPOET_NETUID = 71
const SOURCING_MODEL_REPOSITORY_URL =
  process.env.SOURCING_MODEL_REPOSITORY_URL?.trim() ||
  'https://github.com/tasnimuldatascience/Sourcing_model'
const LEADPOET_REPOSITORY_OWNER = 'leadpoet'
const LEADPOET_REPOSITORY_NAME = 'leadpoet'
const LEADPOET_REPOSITORY_BRANCH = 'main'
const LEADPOET_REPOSITORY_URL =
  `https://github.com/${LEADPOET_REPOSITORY_OWNER}/${LEADPOET_REPOSITORY_NAME}`
const LEADPOET_REPOSITORY_API_URL =
  `https://api.github.com/repos/${LEADPOET_REPOSITORY_OWNER}/${LEADPOET_REPOSITORY_NAME}/commits/${LEADPOET_REPOSITORY_BRANCH}`
const LEADPOET_REPOSITORY_COMPARE_API_URL =
  `https://api.github.com/repos/${LEADPOET_REPOSITORY_OWNER}/${LEADPOET_REPOSITORY_NAME}/compare`
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
const TELEMETRY_PAGE_SIZE = 1_000
const BENCHMARK_HISTORY_LIMIT = 20
const CHAMPION_LIMIT = 10
const COMPANY_TELEMETRY_SELECT = [
  'label_id',
  'candidate_id',
  'run_id',
  'score_bundle_id',
  'context_ref',
  'icp_ref',
  'model_side',
  'is_reference_model',
  'final_score',
  'company_name',
  'company_website',
  'company_linkedin',
  'fit_passed',
  'intent_passed',
  'intent_signal',
  'intent_claimed_signal',
  'intent_source',
  'intent_evidence_url',
  'intent_evidence_date',
  'failure_reason',
  'industry',
  'country',
  'captured_at',
  'created_at',
].join(',')
const LIVE_BENCHMARK_STALE_MS = 15 * 60 * 1000
const ALERT_MONITOR_ID = 'research-lab-alerts:v1'
const DEFAULT_ALERT_MONITOR_INTERVAL_MS = 60_000
const ADMIN_LAB_OVERVIEW_CACHE_MS = 45_000
const ADMIN_LAB_OVERVIEW_STALE_MS = 5 * 60_000
const ADMIN_LAB_ACTIVE_DETAIL_CACHE_MS = 5_000
const ADMIN_LAB_TERMINAL_DETAIL_CACHE_MS = 30_000
const ADMIN_LAB_DETAIL_CACHE_LIMIT = 200
const ADMIN_LAB_REFRESH_RECENT_LOOP_LIMIT = 25
const ADMIN_LAB_LOOP_INDEX_CACHE_MS = 10_000

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

export type AdminLabWorkflowControls = {
  scoring: AdminLabWorkflowControlSummary
  loops: AdminLabWorkflowControlSummary
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
  source: 'ops_telemetry' | 'public_transparency_log' | 'canonical_evaluator' | 'combined' | 'none'
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
  operations: AdminLabAlertOperationsSummary
  recent: AdminLabAlert[]
}

export type AdminLabAlertOperationsSummary = {
  state: AdminHealthState
  sourceAvailable: boolean
  unavailableReason: string | null
  monitorEnabled: boolean
  monitorIntervalMs: number
  monitoredValidatorCount: number
  validators: AdminLabMonitoredValidator[]
  emailConfigured: boolean
  discordConfigured: boolean
  deliveryReady: boolean
  configurationBlockers: string[]
  lastStartedAt: string | null
  lastCompletedAt: string | null
  lastErrorAt: string | null
  lastError: string | null
  heartbeatAgeMs: number | null
  leaseActive: boolean
  pendingDeliveryCount: number
  overdueDeliveryCount: number
  succeededDeliveryCount24h: number
  failedDeliveryCount24h: number
  latestDeliveryAt: string | null
  oldestPendingAt: string | null
  detail: string
}

export type AdminLabMonitoredValidator = {
  hotkey: string
  label: string | null
  source: 'database' | 'environment'
  enabled: boolean
  monitorPcr0: boolean
  monitorOffchainWeights: boolean
  monitorOnchainWeights: boolean
  expectedPcr0: string | null
  updatedAt: string | null
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
  detail?: string | null
  signal?: string | null
  scope?: string | null
  entityId?: string | null
  validatorId?: string | null
  ageMs?: number | null
  ageBlocks?: number | null
  sources?: string[]
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
  commitFreshness: 'latest' | 'behind' | 'unknown'
  commitComparisonAvailable: boolean
  commitComparisonReason: string | null
  latestKnownCommitSha: string | null
  latestKnownCommitAt: string | null
  latestKnownCommitSource: string | null
  comparisonBranch: string | null
  comparisonCheckedAt: string | null
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
  repositoryUrl: string | null
}

export type AdminLabRepositorySummary = {
  sourceAvailable: boolean
  unavailableReason: string | null
  owner: string
  name: string
  branch: string
  repositoryUrl: string
  commitSha: string | null
  commitUrl: string | null
  committedAt: string | null
  commitMessage: string | null
  authorLogin: string | null
  checkedAt: string
  gatewaySourceAvailable: boolean
  gatewayUnavailableReason: string | null
  gatewayCommitSha: string | null
  gatewayBranch: string | null
  gatewayBuildId: string | null
  gatewayBuiltAt: string | null
  gatewayLoadedAt: string | null
  gatewayCommitSource: string | null
  gatewayCheckedAt: string | null
  commitFreshness: GatewayCommitFreshness
  commitsBehind: number | null
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

export type AdminLabImprovementAnalysis = {
  eventKey: string
  sourceId: string
  status: 'pending_analysis' | 'analyzing' | 'pending_delivery' | 'delivered'
  occurredAt: string
  analyzedAt: string | null
  deliveredAt: string | null
  candidateId: string | null
  minerHotkey: string | null
  improvementPoints: number | null
  model: string | null
  reasoningEffort: string | null
  summary: string | null
  minerDirection: string | null
  improvementMade: string | null
  helpedIcps: Array<{
    icpRef: string
    icpLabel: string
    deltaVsBase: number | null
    whyItHelped: string
  }>
  genuineImprovement: 'genuine' | 'likely' | 'uncertain' | 'not_genuine' | null
  genuineAssessment: string | null
  caveats: string[]
  lastError: string | null
}

export type AdminLabFinalizedRunReconciliation = ResearchLabFinalizedRunReconciliation & {
  sourceAvailable: boolean
  unavailableReason: string | null
}

export type AdminLabOpsSummary = {
  state: AdminHealthState
  healthSignals: AdminLabHealthSignal[]
  dataFreshness: AdminLabDataFreshness
  controls: AdminLabWorkflowControls
  scoring: AdminLabScoringSummary
  activeRuns: AdminLabActiveRun[]
  pipeline: AdminLabPipelineStage[]
  benchmark: AdminLabBenchmarkSummary
  alerts: AdminLabAlertSummary
  /** Raw canonical evaluator output for the independent durable monitor. */
  evaluatedAlerts: ResearchLabEvaluatedAlert[]
  /** Terminal outcomes used to close prior incidents without implying success. */
  alertResolutions: ResearchLabAlertResolution[]
  attestation: AdminLabAttestationSummary
  sourcingModel: AdminLabSourcingModelSummary
  leadpoetRepository: AdminLabRepositorySummary
  computeSpend: AdminLabComputeSpendSummary
  dailyBenchmark: AdminLabDailyBenchmark
  benchmarkRuns: AdminLabBenchmarkRunSummary[]
  champions: AdminLabChampionSummary[]
  improvementAnalyses: AdminLabImprovementAnalysis[]
}

export type AdminResearchLabPayload = {
  loops: AdminLabLoopSummary[]
  loopPagination: AdminLabLoopPagination
  loopStatusOptions: ResearchLabStatusFilterOption[]
  ops: AdminLabOpsSummary
  stats: {
    totalLoops: number
    runningLoops: number
    scoredLoops: number
    failedLoops: number
    uniqueMiners: number
    modelImprovementLoops: number
  }
  fetchedAt: string
}

export type AdminLabLoopPagination = {
  page: number
  pageSize: number
  total: number
  totalPages: number
  status: string
  query: string
}

export type AdminLabLoopRefresh = Pick<
  AdminLabLoopSummary,
  | 'ticketId'
  | 'runId'
  | 'receiptId'
  | 'outcomeLabel'
  | 'outcomeBand'
  | 'publicStatus'
  | 'paymentState'
  | 'executionState'
  | 'candidateState'
  | 'resultState'
  | 'opsReason'
  | 'statusDetail'
  | 'opsWarnings'
  | 'statusKey'
  | 'statusLabel'
  | 'statusNote'
  | 'actionNote'
  | 'candidateCount'
  | 'scoredCandidateCount'
  | 'lastActivityAt'
>

export type AdminResearchLabRefreshPayload = {
  recentLoops: AdminLabLoopSummary[]
  loopStates: AdminLabLoopRefresh[]
  loopPagination: AdminLabLoopPagination
  loopStatusOptions: ResearchLabStatusFilterOption[]
  ops: Omit<AdminLabOpsSummary, 'champions' | 'benchmarkRuns' | 'evaluatedAlerts'>
  stats: AdminResearchLabPayload['stats']
  fetchedAt: string
}

export type AdminResearchLabTimelinePayload = {
  loop: AdminLabLoopSummary
  timeline: ResearchLabLoopTimeline
  runDetail: AdminLabRunDetail
  fetchedAt: string
}

type AdminLabCacheStatus = 'hit' | 'miss' | 'shared' | 'stale'

let adminLabOverviewCache: {
  payload: AdminResearchLabPayload
  freshUntil: number
  staleUntil: number
} | null = null
let adminLabOverviewInFlight: Promise<AdminResearchLabPayload> | null = null
let adminLabLoopIndexCache: {
  loops: AdminLabLoopSummary[]
  expiresAt: number
} | null = null
let adminLabLoopIndexInFlight: Promise<AdminLabLoopSummary[]> | null = null
const adminLabTimelineCache = new Map<string, {
  payload: AdminResearchLabTimelinePayload | null
  expiresAt: number
}>()
const adminLabTimelineInFlight = new Map<string, Promise<AdminResearchLabTimelinePayload | null>>()

export async function GET(request: NextRequest) {
  let supabase
  try {
    supabase = getAdminSupabase()
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'admin supabase not configured'
    return NextResponse.json({ error: msg }, { status: 503 })
  }

  const mode = request.nextUrl.searchParams.get('mode')
  if (mode === 'loops') {
    const requestedPage = Number(request.nextUrl.searchParams.get('page') ?? 1)
    const page = Number.isSafeInteger(requestedPage) ? Math.max(1, requestedPage) : 1
    const query = request.nextUrl.searchParams.get('query')?.trim() ?? ''
    const requestedStatus = request.nextUrl.searchParams.get('status')?.trim() ?? 'all'
    const status = RESEARCH_LAB_STATUS_FILTER_OPTIONS.some(
      (option) => option.value === requestedStatus,
    ) ? requestedStatus : 'all'
    try {
      const loops = await getCachedAdminLabLoopIndex(supabase)
      const result = buildAdminLabLoopPage(loops, { page, query, status })
      return NextResponse.json(
        { ...result, fetchedAt: new Date().toISOString() },
        { headers: { 'Cache-Control': 'private, no-store' } },
      )
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown Supabase error'
      return NextResponse.json({ error: msg }, { status: 502 })
    }
  }

  const ticketId = request.nextUrl.searchParams.get('ticketId')?.trim()
  if (ticketId) {
    const runId = request.nextUrl.searchParams.get('runId')?.trim() || null
    let detail: AdminResearchLabTimelinePayload | null = null
    let cacheStatus: AdminLabCacheStatus = 'miss'
    try {
      const cached = await getCachedAdminLabTimeline(supabase, ticketId, runId)
      detail = cached.payload
      cacheStatus = cached.status
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown Supabase error'
      return NextResponse.json({ error: msg }, { status: 502 })
    }
    if (!detail) {
      return NextResponse.json({ error: 'Research Lab loop or requested run not found' }, { status: 404 })
    }
    return NextResponse.json(detail, {
      headers: {
        'Cache-Control': 'private, no-store',
        'X-Admin-Lab-Cache': cacheStatus,
      },
    })
  }

  let overview: AdminResearchLabPayload
  let cacheStatus: AdminLabCacheStatus = 'miss'
  try {
    const cached = await getCachedAdminLabOverview(supabase)
    overview = cached.payload
    cacheStatus = cached.status
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown Supabase error'
    return NextResponse.json({ error: msg }, { status: 502 })
  }
  const refreshView = mode === 'refresh'
  return NextResponse.json(
    refreshView ? buildAdminLabRefreshPayload(overview) : overview,
    {
      headers: {
        'Cache-Control': 'private, no-store',
        'X-Admin-Lab-Cache': cacheStatus,
        'X-Admin-Lab-View': refreshView ? 'refresh' : 'full',
      },
    },
  )
}

function buildAdminLabRefreshPayload(
  overview: AdminResearchLabPayload,
): AdminResearchLabRefreshPayload {
  const ops = { ...overview.ops } as Partial<AdminLabOpsSummary>
  delete ops.champions
  delete ops.benchmarkRuns
  delete ops.evaluatedAlerts
  return {
    recentLoops: overview.loops.slice(0, ADMIN_LAB_REFRESH_RECENT_LOOP_LIMIT),
    loopStates: overview.loops.map((loop) => ({
      ticketId: loop.ticketId,
      runId: loop.runId,
      receiptId: loop.receiptId,
      outcomeLabel: loop.outcomeLabel,
      outcomeBand: loop.outcomeBand,
      publicStatus: loop.publicStatus,
      paymentState: loop.paymentState,
      executionState: loop.executionState,
      candidateState: loop.candidateState,
      resultState: loop.resultState,
      opsReason: loop.opsReason,
      statusDetail: loop.statusDetail,
      opsWarnings: loop.opsWarnings,
      statusKey: loop.statusKey,
      statusLabel: loop.statusLabel,
      statusNote: loop.statusNote,
      actionNote: loop.actionNote,
      candidateCount: loop.candidateCount,
      scoredCandidateCount: loop.scoredCandidateCount,
      lastActivityAt: loop.lastActivityAt,
    })),
    loopPagination: overview.loopPagination,
    loopStatusOptions: overview.loopStatusOptions,
    ops: ops as AdminResearchLabRefreshPayload['ops'],
    stats: overview.stats,
    fetchedAt: overview.fetchedAt,
  }
}

async function getCachedAdminLabOverview(
  supabase: ReturnType<typeof getAdminSupabase>,
): Promise<{ payload: AdminResearchLabPayload; status: AdminLabCacheStatus }> {
  const now = Date.now()
  if (adminLabOverviewCache && adminLabOverviewCache.freshUntil > now) {
    return { payload: adminLabOverviewCache.payload, status: 'hit' }
  }
  if (adminLabOverviewCache && adminLabOverviewCache.staleUntil > now) {
    if (!adminLabOverviewInFlight) {
      adminLabOverviewInFlight = buildAdminLabOverview(supabase)
      void adminLabOverviewInFlight
        .then((payload) => {
          const refreshedAt = Date.now()
          adminLabOverviewCache = {
            payload,
            freshUntil: refreshedAt + adminLabOverviewFreshMs(payload),
            staleUntil: refreshedAt + ADMIN_LAB_OVERVIEW_STALE_MS,
          }
        })
        .catch((error) => {
          console.warn('[admin:research-lab] background overview refresh failed', error)
        })
        .finally(() => {
          adminLabOverviewInFlight = null
        })
    }
    return { payload: adminLabOverviewCache.payload, status: 'stale' }
  }
  if (adminLabOverviewInFlight) {
    return { payload: await adminLabOverviewInFlight, status: 'shared' }
  }

  adminLabOverviewInFlight = buildAdminLabOverview(supabase)
  try {
    const payload = await adminLabOverviewInFlight
    adminLabOverviewCache = {
      payload,
      freshUntil: Date.now() + adminLabOverviewFreshMs(payload),
      staleUntil: Date.now() + ADMIN_LAB_OVERVIEW_STALE_MS,
    }
    return { payload, status: 'miss' }
  } finally {
    adminLabOverviewInFlight = null
  }
}

async function buildAdminLabOverview(
  supabase: ReturnType<typeof getAdminSupabase>,
): Promise<AdminResearchLabPayload> {
  const allLoops = await getCachedAdminLabLoopIndex(supabase)
  const loopPage = buildAdminLabLoopPage(allLoops, { page: 1, query: '', status: 'all' })
  const loops = loopPage.loops
  const ops = await fetchAdminLabOps(supabase, loops)
  return {
    loops,
    loopPagination: loopPage.loopPagination,
    loopStatusOptions: loopPage.loopStatusOptions,
    ops,
    stats: buildAdminLabAllTimeStats(allLoops),
    fetchedAt: new Date().toISOString(),
  }
}

async function getCachedAdminLabTimeline(
  supabase: ReturnType<typeof getAdminSupabase>,
  ticketId: string,
  runId: string | null,
): Promise<{ payload: AdminResearchLabTimelinePayload | null; status: AdminLabCacheStatus }> {
  const key = `${ticketId}\u0000${runId ?? 'current'}`
  const now = Date.now()
  const cached = adminLabTimelineCache.get(key)
  if (cached && cached.expiresAt > now) return { payload: cached.payload, status: 'hit' }
  const inFlight = adminLabTimelineInFlight.get(key)
  if (inFlight) return { payload: await inFlight, status: 'shared' }

  const request = fetchAdminLabTimeline(supabase, ticketId, runId)
  adminLabTimelineInFlight.set(key, request)
  try {
    const payload = await request
    const terminal = payload?.runDetail.state === 'completed' || payload?.runDetail.state === 'failed'
    adminLabTimelineCache.set(key, {
      payload,
      expiresAt: Date.now() + (terminal ? ADMIN_LAB_TERMINAL_DETAIL_CACHE_MS : ADMIN_LAB_ACTIVE_DETAIL_CACHE_MS),
    })
    pruneAdminLabTimelineCache()
    return { payload, status: 'miss' }
  } finally {
    adminLabTimelineInFlight.delete(key)
  }
}

function adminLabOverviewFreshMs(payload: AdminResearchLabPayload): number {
  return payload.ops.dailyBenchmark.state === 'active'
    ? Math.min(10_000, ADMIN_LAB_OVERVIEW_CACHE_MS)
    : ADMIN_LAB_OVERVIEW_CACHE_MS
}

function pruneAdminLabTimelineCache(): void {
  const now = Date.now()
  for (const [key, value] of adminLabTimelineCache) {
    if (value.expiresAt <= now) adminLabTimelineCache.delete(key)
  }
  while (adminLabTimelineCache.size > ADMIN_LAB_DETAIL_CACHE_LIMIT) {
    const oldestKey = adminLabTimelineCache.keys().next().value as string | undefined
    if (!oldestKey) break
    adminLabTimelineCache.delete(oldestKey)
  }
}

function invalidateAdminLabOverviewCache(): void {
  adminLabOverviewCache = null
  adminLabLoopIndexCache = null
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin')
  if (origin && origin !== request.nextUrl.origin) {
    return NextResponse.json({ error: 'Cross-origin validator registry writes are not allowed.' }, { status: 403 })
  }

  let supabase
  try {
    supabase = getAdminSupabase()
  } catch (error) {
    const message = error instanceof Error ? error.message : 'admin supabase not configured'
    return NextResponse.json({ error: message }, { status: 503 })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json() as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 })
  }

  const action = stringOr(body.action)
  const hotkey = stringOr(body.hotkey)
  if (!hotkey || !isValidValidatorHotkey(hotkey)) {
    return NextResponse.json({ error: 'A valid Bittensor validator hotkey is required.' }, { status: 400 })
  }

  if (action === 'remove_validator_monitor') {
    const { error } = await supabase
      .from('ops_validator_registry')
      .delete()
      .eq('validator_hotkey', hotkey)
    if (error) return NextResponse.json({ error: error.message }, { status: 502 })
    invalidateAdminLabOverviewCache()
    return NextResponse.json({ ok: true, hotkey }, { headers: { 'Cache-Control': 'no-store' } })
  }

  if (action !== 'upsert_validator_monitor') {
    return NextResponse.json({ error: 'Unsupported validator registry action.' }, { status: 400 })
  }

  const label = stringOr(body.label)?.slice(0, 80) ?? null
  const rawExpectedPcr0 = stringOr(body.expectedPcr0)
  const expectedPcr0 = rawExpectedPcr0 ? normalizePcr0(rawExpectedPcr0) : null
  if (rawExpectedPcr0 && !expectedPcr0) {
    return NextResponse.json({ error: 'Expected PCR0 must be a 96-character hexadecimal value.' }, { status: 400 })
  }
  const row = {
    validator_hotkey: hotkey,
    label,
    enabled: booleanOr(body.enabled) ?? true,
    monitor_pcr0: booleanOr(body.monitorPcr0) ?? true,
    monitor_offchain_weights: booleanOr(body.monitorOffchainWeights) ?? true,
    monitor_onchain_weights: booleanOr(body.monitorOnchainWeights) ?? true,
    expected_pcr0: expectedPcr0,
    created_by: 'admin_dashboard',
    updated_at: new Date().toISOString(),
  }
  const { data, error } = await supabase
    .from('ops_validator_registry')
    .upsert(row, { onConflict: 'validator_hotkey' })
    .select('*')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 502 })
  invalidateAdminLabOverviewCache()

  return NextResponse.json(
    {
      ok: true,
      validator: {
        hotkey: data.validator_hotkey,
        label: data.label,
        source: 'database',
        enabled: data.enabled,
        monitorPcr0: data.monitor_pcr0,
        monitorOffchainWeights: data.monitor_offchain_weights,
        monitorOnchainWeights: data.monitor_onchain_weights,
        expectedPcr0: data.expected_pcr0,
        updatedAt: data.updated_at,
      } satisfies AdminLabMonitoredValidator,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

function isValidValidatorHotkey(value: string): boolean {
  if (!/^[1-9A-HJ-NP-Za-km-z]{40,64}$/.test(value)) return false
  try {
    return decodeAddress(value).length === 32
  } catch {
    return false
  }
}

async function getCachedAdminLabLoopIndex(
  supabase: ReturnType<typeof getAdminSupabase>,
): Promise<AdminLabLoopSummary[]> {
  const now = Date.now()
  if (adminLabLoopIndexCache && adminLabLoopIndexCache.expiresAt > now) {
    return adminLabLoopIndexCache.loops
  }
  if (adminLabLoopIndexInFlight) return adminLabLoopIndexInFlight

  adminLabLoopIndexInFlight = fetchAdminLabLoopIndex(supabase)
  try {
    const loops = await adminLabLoopIndexInFlight
    adminLabLoopIndexCache = {
      loops,
      expiresAt: Date.now() + ADMIN_LAB_LOOP_INDEX_CACHE_MS,
    }
    return loops
  } finally {
    adminLabLoopIndexInFlight = null
  }
}

async function fetchAdminLabLoopIndex(
  supabase: ReturnType<typeof getAdminSupabase>,
): Promise<AdminLabLoopSummary[]> {
  const loops: AdminLabLoopSummary[] = []
  let offset = 0

  while (true) {
    const { data, error } = await supabase
      .from('research_lab_public_loop_card_current')
      .select('*')
      .order('current_last_activity_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .order('card_id', { ascending: false })
      .range(offset, offset + LOOP_INDEX_BATCH_SIZE - 1)

    if (error) {
      throw new Error(`Supabase error fetching the Lab ticket index: ${error.message}`)
    }

    const rows = (data ?? []) as AdminLabLoopRow[]
    loops.push(...rows.map(normalizeLoopRow))
    if (rows.length < LOOP_INDEX_BATCH_SIZE) break
    offset += LOOP_INDEX_BATCH_SIZE
  }

  return loops
}

function buildAdminLabLoopPage(
  loops: AdminLabLoopSummary[],
  { page, query, status }: { page: number; query: string; status: string },
): {
  loops: AdminLabLoopSummary[]
  loopPagination: AdminLabLoopPagination
  loopStatusOptions: ResearchLabStatusFilterOption[]
} {
  const normalizedQuery = query.trim().toLowerCase()
  const searchMatchedLoops = normalizedQuery
    ? loops.filter((loop) => adminLabLoopSearchValues(loop).some(
      (value) => value.toLowerCase().includes(normalizedQuery),
    ))
    : loops
  const loopStatusOptions = researchLabStatusFilterOptionsWithCounts(searchMatchedLoops)
  const filteredLoops = filterResearchLabActivityLoops(searchMatchedLoops, { status })
  const total = filteredLoops.length
  const totalPages = Math.max(1, Math.ceil(total / LOOP_LIMIT))
  const resolvedPage = Math.min(page, totalPages)
  const offset = (resolvedPage - 1) * LOOP_LIMIT

  return {
    loops: filteredLoops.slice(offset, offset + LOOP_LIMIT),
    loopPagination: {
      page: resolvedPage,
      pageSize: LOOP_LIMIT,
      total,
      totalPages,
      status,
      query: query.trim(),
    },
    loopStatusOptions,
  }
}

function adminLabLoopSearchValues(loop: AdminLabLoopSummary): string[] {
  return [
    loop.ticketId,
    loop.runId ?? '',
    loop.receiptId ?? '',
    loop.minerHotkey,
    loop.researchArea,
    loop.researchFocusSummary,
    loop.outcomeLabel,
    loop.statusKey,
    loop.statusLabel,
    loop.opsReason ?? '',
    loop.statusDetail ?? '',
    ...loop.topicTags,
  ]
}

function buildAdminLabAllTimeStats(
  loops: AdminLabLoopSummary[],
): AdminResearchLabPayload['stats'] {
  const stats: AdminResearchLabPayload['stats'] = {
    totalLoops: 0,
    runningLoops: 0,
    scoredLoops: 0,
    failedLoops: 0,
    uniqueMiners: 0,
    modelImprovementLoops: 0,
  }
  const miners = new Set<string>()

  for (const loop of loops) {
    stats.totalLoops += 1
    if (isActiveResearchLabLoopStatus(loop.statusKey)) stats.runningLoops += 1
    if (isScoredResearchLabLoopStatus(loop.statusKey)) stats.scoredLoops += 1
    if (
      isNoGainOrFailedResearchLabLoopStatus(loop.statusKey) ||
      isFailedOutcome(loop.outcomeLabel, loop.outcomeBand)
    ) stats.failedLoops += 1
    if (loop.statusKey === 'promoted') stats.modelImprovementLoops += 1
    if (loop.minerHotkey) miners.add(loop.minerHotkey)
  }

  stats.uniqueMiners = miners.size
  return stats
}

async function fetchAdminLabTimeline(
  supabase: ReturnType<typeof getAdminSupabase>,
  ticketId: string,
  requestedRunId: string | null,
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
  if (requestedRunId && !timeline.runs.some((run) => run.runId === requestedRunId)) {
    return null
  }
  const selectedRunId = requestedRunId ?? currentRunId ?? null
  const runDetail = await fetchAdminLabRunDetail(supabase, loop, selectedRunId)

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

async function fetchAdminLabOps(
  supabase: ReturnType<typeof getAdminSupabase>,
  loops: AdminLabLoopSummary[],
): Promise<AdminLabOpsSummary> {
  const icpMetadata = fetchIcpMetadata(supabase)
  const [
    scoreMetrics,
    controls,
    benchmark,
    baseAlerts,
    attestation,
    sourcingModel,
    leadpoetRepository,
    computeSpend,
    benchmarkTelemetry,
    champions,
    improvementAnalyses,
    metagraph,
  ] = await Promise.all([
    fetchScoreBundleMetrics(supabase, loops),
    fetchGatewayWorkflowControls(supabase),
    fetchBenchmarkSummary(supabase),
    fetchAlertSummary(supabase),
    fetchAttestationSummary(supabase),
    fetchSourcingModelSummary(supabase),
    fetchLeadpoetRepositorySummary(),
    fetchComputeSpendSummary(supabase),
    fetchBenchmarkTelemetryOverview(supabase, icpMetadata),
    fetchChampionTelemetry(supabase, icpMetadata),
    fetchImprovementAnalyses(supabase),
    fetchMetagraph(),
  ])

  const dataFreshness = buildDataFreshness(loops)
  const { dailyBenchmark, benchmarkRuns } = benchmarkTelemetry
  const activeRuns = buildActiveRuns(loops, scoreMetrics.byTicket)
  const alertNow = Date.now()
  const pipeline = buildPipelineStages(loops)
  const scoring = buildScoringSummary({
    loops,
    activeRuns,
    metrics: scoreMetrics,
    control: controls.scoring,
  })
  const evaluatedAlerts = evaluateResearchLabAlerts(
    buildCanonicalAlertObservations({
      loops,
      activeRuns,
      benchmark: dailyBenchmark,
      baseAlerts,
      attestation,
      dataFreshness,
      metagraph,
      controls,
      now: alertNow,
    }),
    { now: alertNow },
  )
  const alertResolutions = buildRunAlertResolutions(loops, alertNow)
  const alerts = mergeEvaluatedAlertSummary(baseAlerts, evaluatedAlerts)
  const healthSignals = buildHealthSignals({
    dataFreshness,
    benchmark,
    alerts,
    attestation,
  })

  return {
    state: worstHealthState(healthSignals.map((signal) => signal.state)),
    healthSignals,
    dataFreshness,
    controls,
    scoring,
    activeRuns,
    pipeline,
    benchmark,
    alerts,
    evaluatedAlerts,
    alertResolutions,
    attestation,
    sourcingModel,
    leadpoetRepository,
    computeSpend,
    dailyBenchmark,
    benchmarkRuns,
    champions,
    improvementAnalyses,
  }
}

async function fetchImprovementAnalyses(
  supabase: ReturnType<typeof getAdminSupabase>,
): Promise<AdminLabImprovementAnalysis[]> {
  const { data, error } = await supabase
    .from('ops_research_lab_event_notifications')
    .select('event_key, source_id, status, occurred_at, payload_doc, analysis_doc, model, reasoning_effort, analyzed_at, delivered_at, last_error')
    .eq('event_type', 'improvement_analysis')
    .order('occurred_at', { ascending: false })
    .limit(20)
  if (error) {
    if (error.code !== '42P01' && error.code !== 'PGRST205') {
      console.warn('[admin:research-lab] improvement analyses unavailable', error.message)
    }
    return []
  }

  return ((data ?? []) as Array<Record<string, unknown>>).flatMap((row) => {
    const eventKey = stringOr(row.event_key)
    const sourceId = stringOr(row.source_id)
    const occurredAt = isoStringOr(row.occurred_at)
    const status = stringOr(row.status)
    if (
      !eventKey || !sourceId || !occurredAt ||
      !['pending_analysis', 'analyzing', 'pending_delivery', 'delivered'].includes(status ?? '')
    ) return []
    const payload = objectRecord(row.payload_doc) ?? {}
    const analysis = objectRecord(row.analysis_doc) ?? {}
    const helpedIcps = (arrayOfRecords(analysis.helpedIcps) ?? []).flatMap((icp) => {
      const icpRef = stringOr(icp.icpRef)
      const icpLabel = stringOr(icp.icpLabel)
      const whyItHelped = stringOr(icp.whyItHelped)
      if (!icpRef || !icpLabel || !whyItHelped) return []
      return [{
        icpRef,
        icpLabel,
        deltaVsBase: finiteNumberOrNull(icp.deltaVsBase),
        whyItHelped,
      }]
    })
    const verdict = stringOr(analysis.genuineImprovement)
    return [{
      eventKey,
      sourceId,
      status: status as AdminLabImprovementAnalysis['status'],
      occurredAt,
      analyzedAt: isoStringOr(row.analyzed_at) ?? null,
      deliveredAt: isoStringOr(row.delivered_at) ?? null,
      candidateId: stringOr(payload.candidate_id) ?? null,
      minerHotkey: stringOr(payload.miner_hotkey) ?? null,
      improvementPoints: finiteNumberOrNull(payload.improvement_points),
      model: stringOr(row.model) ?? null,
      reasoningEffort: stringOr(row.reasoning_effort) ?? null,
      summary: stringOr(analysis.summary) ?? null,
      minerDirection: stringOr(analysis.minerDirection) ?? null,
      improvementMade: stringOr(analysis.improvementMade) ?? null,
      helpedIcps,
      genuineImprovement: ['genuine', 'likely', 'uncertain', 'not_genuine'].includes(verdict ?? '')
        ? verdict as AdminLabImprovementAnalysis['genuineImprovement']
        : null,
      genuineAssessment: stringOr(analysis.genuineAssessment) ?? null,
      caveats: uniqueStrings(Array.isArray(analysis.caveats) ? analysis.caveats.map(stringOr) : []),
      lastError: stringOr(row.last_error) ?? null,
    }]
  })
}

function buildCanonicalAlertObservations(input: {
  loops: AdminLabLoopSummary[]
  activeRuns: AdminLabActiveRun[]
  benchmark: AdminLabDailyBenchmark
  baseAlerts: AdminLabAlertSummary
  attestation: AdminLabAttestationSummary
  dataFreshness: AdminLabDataFreshness
  metagraph: Awaited<ReturnType<typeof fetchMetagraph>>
  controls: AdminLabWorkflowControls
  now: number
}): ResearchLabAlertObservations {
  const configuredValidators = input.baseAlerts.operations.validators.filter((validator) => validator.enabled)
  const configured = configuredValidators.map((validator) => validator.hotkey)
  const configuredSet = new Set(configured)
  const configuredByHotkey = new Map(configuredValidators.map((validator) => [validator.hotkey, validator]))
  const nodeByValidator = new Map<string, AdminLabAttestationNode>()
  for (const node of input.attestation.nodes) {
    const validatorId = node.hotkey ?? node.nodeId
    if (!validatorId) continue
    const current = nodeByValidator.get(validatorId)
    if (!current || timestampOrZero(node.attestedAt) > timestampOrZero(current.attestedAt)) {
      nodeByValidator.set(validatorId, node)
    }
  }

  const validatorIds = uniqueStrings([
    ...configured,
    ...nodeByValidator.keys(),
  ])
  const metagraphAvailable = !input.metagraph.error
  const validators: ResearchLabValidatorAlertObservation[] = validatorIds.map((validatorId) => {
    const node = nodeByValidator.get(validatorId)
    const expected = configuredSet.has(validatorId)
    const monitor = configuredByHotkey.get(validatorId)
    const source = expected ? 'configured validator telemetry' : 'observed validator telemetry'
    const monitorPcr0 = monitor ? monitor.monitorPcr0 : Boolean(node)
    const monitorOffchainWeights = monitor
      ? monitor.monitorOffchainWeights
      : Boolean(node && input.attestation.source === 'published_weight_bundles')
    const monitorOnchainWeights = monitor ? monitor.monitorOnchainWeights : Boolean(node)
    return {
      validatorId,
      source,
      pcr0: monitorPcr0
        ? {
            observedPcr0: node?.observedPcr0 ?? null,
            expectedPcr0: monitor?.expectedPcr0 ?? node?.expectedPcr0 ?? input.attestation.expectedPcr0,
            matched: node?.matched ?? null,
            observedAt: node?.attestedAt ?? null,
          }
        : undefined,
      offchainWeightBundle:
        monitorOffchainWeights
          ? {
              publishedAt: node?.attestedAt ?? null,
              bundleId: node?.transparencyEventHash ?? null,
            }
          : undefined,
      onchainUpdate: metagraphAvailable && monitorOnchainWeights
        ? {
            lastUpdateBlock: input.metagraph.lastUpdates[validatorId] ?? null,
            currentBlock: input.metagraph.currentBlock,
          }
        : undefined,
    }
  })

  const suppressBenchmarkAlert = input.benchmark.state !== 'failed' &&
    shouldSuppressResearchLabExecutionAlert({
      now: input.now,
      controls: [input.controls.scoring],
      status: input.benchmark.state,
      detail: input.benchmark.detail,
    })
  const benchmarks: ResearchLabAlertObservations['benchmarks'] =
    !suppressBenchmarkAlert && (input.benchmark.benchmarkDate || input.benchmark.startedAt)
      ? [{
          benchmarkId: input.benchmark.benchmarkDate
            ? `${input.benchmark.benchmarkDate}:attempt:${input.benchmark.attempt ?? 0}`
            : input.benchmark.rollingWindowHash ?? 'daily-benchmark',
          source: 'daily benchmark telemetry',
          status: input.benchmark.state === 'stalled' ? 'running' : input.benchmark.state,
          startedAt: input.benchmark.startedAt,
          lastActivityAt: input.benchmark.lastActivityAt,
          failedAt: input.benchmark.state === 'failed' ? input.benchmark.completedAt : null,
          error: input.benchmark.state === 'failed' ? input.benchmark.detail : null,
        }]
      : []

  const activeRuns: Array<NonNullable<ResearchLabAlertObservations['activeRuns']>[number]> = input.activeRuns
    .filter((run) => !shouldSuppressRunAlert(run.phase, run.statusKey, run.blocker, input))
    .map((run) => ({
      runId: run.runId ?? run.ticketId,
      validatorId: run.minerHotkey || null,
      source: 'research lab run telemetry',
      status: run.statusKey,
      startedAt: run.submittedAt,
      lastActivityAt: run.lastActivityAt,
      blocked: Boolean(run.blocker && /(?:block|wait|pause|stale|rescore)/i.test(`${run.statusKey} ${run.blocker}`)),
      blockedAt: run.blocker ? run.lastActivityAt : null,
      blocker: run.blocker,
    }))
  const representedRuns = new Set(activeRuns.map((run) => run.runId))
  for (const loop of input.loops) {
    const runId = loop.runId ?? loop.ticketId
    if (representedRuns.has(runId)) continue
    if (!/(?:blocked|waiting_for_baseline|needs_rescore|recovery|paused|stalled)/i.test(loop.statusKey)) continue
    const blocker = loop.actionNote?.detail ?? loop.statusNote?.detail ?? loop.statusDetail ?? loop.opsReason ?? null
    if (shouldSuppressRunAlert(phaseForLoop(loop), loop.statusKey, blocker, input)) continue
    activeRuns.push({
      runId,
      validatorId: loop.minerHotkey || null,
      source: 'research lab blocked-loop telemetry',
      status: loop.statusKey,
      startedAt: loop.submittedAt,
      lastActivityAt: loop.lastActivityAt,
      blocked: true,
      blockedAt: loop.lastActivityAt,
      blocker,
    })
  }

  const transparencyCheckpoints: ResearchLabAlertObservations['transparencyCheckpoints'] =
    input.baseAlerts.source === 'public_transparency_log' || input.baseAlerts.source === 'combined'
      ? [{
          checkpointId: `subnet-${LEADPOET_NETUID}`,
          source: 'public transparency log',
          checkpointAt: input.baseAlerts.latestCheckpointAt,
        }]
      : []

  const maintenanceComponents = [
    { componentId: 'autoresearch', label: 'Auto-research loop', control: input.controls.loops },
    { componentId: 'scoring', label: 'Scoring worker', control: input.controls.scoring },
  ].filter((component) => component.control.state === 'paused')

  return {
    validators,
    benchmarks,
    activeRuns,
    transparencyCheckpoints,
    dataFreshness: [{
      sourceId: 'research-lab-activity',
      source: 'research lab public loop projection',
      observedAt: input.dataFreshness.latestActivityAt,
    }],
    maintenancePauses: maintenanceComponents.length > 0
      ? [{
          maintenanceId: 'gateway-workflows',
          source: 'gateway maintenance controls',
          components: maintenanceComponents.map((component) => ({
            componentId: component.componentId,
            label: component.label,
            pausedAt: component.control.updatedAt,
            reason: component.control.reason,
            actor: component.control.actorRef,
          })),
        }]
      : [],
  }
}

function shouldSuppressRunAlert(
  phase: string,
  status: string,
  detail: string | null,
  input: Pick<Parameters<typeof buildCanonicalAlertObservations>[0], 'controls' | 'now'>,
): boolean {
  const controls = phase === 'scoring'
    ? [input.controls.loops, input.controls.scoring]
    : [input.controls.loops]
  return shouldSuppressResearchLabExecutionAlert({
    now: input.now,
    controls,
    status,
    detail,
  })
}

function buildRunAlertResolutions(
  loops: AdminLabLoopSummary[],
  now: number,
): ResearchLabAlertResolution[] {
  const resolutions: ResearchLabAlertResolution[] = []
  let includedRuns = 0
  for (const loop of loops) {
    if (!loop.runId || !isCompletedResearchLabLoopStatus(loop.statusKey)) continue
    if (now - timestampOrZero(loop.lastActivityAt) > ALERT_RESOLUTION_LOOKBACK_MS) continue
    if (includedRuns >= ALERT_RESOLUTION_RUN_LIMIT) break
    includedRuns += 1
    const normalizedStatus = loop.statusKey.toLowerCase()
    const outcome = /cancel/.test(normalizedStatus)
      ? 'cancelled'
      : isNoGainOrFailedResearchLabLoopStatus(loop.statusKey) || loop.outcomeBand === 'failed'
        ? 'failed'
        : 'completed'
    const outcomeLabel = loop.statusLabel || loop.outcomeLabel || loop.statusKey
    const reason = loop.statusDetail ?? loop.opsReason ?? loop.statusNote?.detail ?? null
    const terminalDetail = outcome === 'completed'
      ? `The run completed as “${outcomeLabel}.” The prior alert condition is closed.`
      : `The run ended as “${outcomeLabel}”${reason ? `: ${reason}` : '.'} ` +
        'The prior alert condition is closed because the run is terminal; this is not a successful recovery.'

    for (const signal of ['active_run_stale', 'active_run_blocked'] as const) {
      resolutions.push({
        fingerprint: buildResearchLabAlertFingerprint(signal, 'run', loop.runId),
        title: `Run ${loop.runId} ended: ${outcomeLabel}`,
        detail: terminalDetail,
        observedAt: loop.lastActivityAt,
        metadata: {
          kind: 'terminal',
          outcome,
          label: outcomeLabel,
        },
      })
    }
  }
  return resolutions
}

function configuredValidatorHotkeys(): string[] {
  return uniqueStrings([
    ...splitEnvList(process.env.OPS_MONITORED_VALIDATOR_HOTKEYS),
    ...splitEnvList(process.env.OPS_OWN_VALIDATOR_HOTKEYS),
    ...splitEnvList(process.env.OPS_VALIDATOR_HOTKEYS),
  ])
}

function splitEnvList(value: string | undefined): string[] {
  return (value ?? '')
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function mergeEvaluatedAlertSummary(
  base: AdminLabAlertSummary,
  evaluated: ResearchLabEvaluatedAlert[],
): AdminLabAlertSummary {
  if (evaluated.length === 0) return base
  const detectedAt = new Date().toISOString()
  const alerts = new Map<string, AdminLabAlert>()
  for (const alert of base.recent) alerts.set(alert.fingerprint || alert.id, alert)

  for (const alert of evaluated) {
    const canonical: AdminLabAlert = {
      id: alert.fingerprint,
      severity: alert.severity,
      source: alert.sources.join(', '),
      title: alert.title,
      fingerprint: alert.fingerprint,
      status: 'active',
      count: Math.max(1, alert.occurrences),
      firstSeenAt: alert.observedAt ?? detectedAt,
      lastSeenAt: detectedAt,
      detail: alert.detail,
      signal: alert.signal,
      scope: alert.scope,
      entityId: alert.entityId,
      validatorId: alert.validatorId,
      ageMs: alert.ageMs,
      ageBlocks: alert.ageBlocks,
      sources: alert.sources,
    }
    const current = alerts.get(alert.fingerprint)
    alerts.set(alert.fingerprint, current ? mergeAdminAlert(current, canonical) : canonical)
  }

  const recent = Array.from(alerts.values()).sort(
    (a, b) => alertSeverityRank(b.severity) - alertSeverityRank(a.severity) ||
      timestampOrZero(b.lastSeenAt ?? b.firstSeenAt) - timestampOrZero(a.lastSeenAt ?? a.firstSeenAt),
  )
  const criticalLast24h = recent.filter((alert) => alert.severity.toLowerCase() === 'critical').length
  const warningLast24h = recent.filter((alert) => ['warning', 'warn'].includes(alert.severity.toLowerCase())).length
  const totalLast24h = recent.reduce((sum, alert) => sum + Math.max(1, alert.count), 0)
  return {
    ...base,
    state: criticalLast24h > 0 ? 'critical' : warningLast24h > 0 ? 'degraded' : 'healthy',
    source: base.sourceAvailable && base.source !== 'none' ? 'combined' : 'canonical_evaluator',
    sourceAvailable: true,
    totalLast24h,
    criticalLast24h,
    warningLast24h,
    activeCount: recent.filter((alert) => !['resolved', 'closed'].includes(alert.status.toLowerCase())).length,
    latestObservedAt: latestIso(base.latestObservedAt, detectedAt) ?? detectedAt,
    recent: recent.slice(0, 24),
  }
}

function mergeAdminAlert(existing: AdminLabAlert, canonical: AdminLabAlert): AdminLabAlert {
  return {
    ...existing,
    ...canonical,
    severity: alertSeverityRank(canonical.severity) >= alertSeverityRank(existing.severity)
      ? canonical.severity
      : existing.severity,
    source: uniqueStrings([existing.source, canonical.source]).join(', '),
    count: Math.max(existing.count, canonical.count),
    firstSeenAt: earliestIso(existing.firstSeenAt, canonical.firstSeenAt) ?? null,
    lastSeenAt: latestIso(existing.lastSeenAt, canonical.lastSeenAt) ?? null,
    sources: uniqueStrings([...(existing.sources ?? []), ...(canonical.sources ?? [])]),
  }
}

function alertSeverityRank(value: string): number {
  if (value.toLowerCase() === 'critical') return 2
  if (['warning', 'warn'].includes(value.toLowerCase())) return 1
  return 0
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
  scoring_id?: string | null
  scoring_run_id?: string | null
  icp_execution_id?: string | null
  candidate_id?: string | null
  benchmark_date?: string | null
  run_scope?: string | null
  run_type?: string | null
  runner_role?: string | null
  provider?: string | null
  endpoint?: string | null
  request_fingerprint?: string | null
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
  intent_signal?: number | string | null
  intent_claimed_signal?: string | null
  intent_source?: string | null
  intent_evidence_url?: string | null
  intent_evidence_date?: string | null
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
  firstActivityAt: string | null
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

type BenchmarkReportLinkRow = {
  report_id?: string | null
  benchmark_bundle_id?: string | null
  benchmark_date?: string | null
  aggregate_score?: number | string | null
  current_report_status?: string | null
  current_status_at?: string | null
  created_at?: string | null
}

type BenchmarkTelemetryOverview = {
  dailyBenchmark: AdminLabDailyBenchmark
  benchmarkRuns: AdminLabBenchmarkRunSummary[]
}

async function fetchBenchmarkTelemetryOverview(
  supabase: ReturnType<typeof getAdminSupabase>,
  metadataPromise: Promise<IcpMetadataSnapshot>,
): Promise<BenchmarkTelemetryOverview> {
  const [runResult, bundleResult, reportResult, metadata] = await Promise.all([
    supabase
      .from('research_lab_scoring_run_current')
      .select('scoring_run_id, scoring_id, run_type, run_attempt, source_run_id, ticket_id, candidate_id, benchmark_id, benchmark_date, rolling_window_hash, reference_artifact_hash, expected_icp_count, scheduler_type, worker_ref, current_run_status, current_status_at, current_retryable, current_failure_category, current_telemetry_degraded, benchmark_bundle_id, assigned_at, started_at, last_heartbeat_at, finished_at, observed_runtime_seconds, created_at')
      .eq('run_type', 'private_baseline_rebenchmark')
      .order('created_at', { ascending: false, nullsFirst: false })
      .limit(BENCHMARK_HISTORY_LIMIT * 10),
    supabase
      .from('research_lab_private_model_benchmark_current')
      .select('benchmark_bundle_id, benchmark_date, private_model_artifact_hash, rolling_window_hash, aggregate_score, current_benchmark_status, current_event_type, current_status_at, created_at')
      .order('benchmark_date', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false, nullsFirst: false })
      .limit(BENCHMARK_HISTORY_LIMIT * 5),
    supabase
      .from('research_lab_public_benchmark_report_current')
      .select('report_id, benchmark_bundle_id, benchmark_date, aggregate_score, current_report_status, current_status_at, created_at')
      .eq('current_report_status', 'published')
      .order('benchmark_date', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false, nullsFirst: false })
      .limit(BENCHMARK_HISTORY_LIMIT * 5),
    metadataPromise,
  ])

  if (runResult.error) {
    console.warn('[admin:research-lab] V2 benchmark runs unavailable', runResult.error.message)
  }
  if (bundleResult.error) {
    console.warn('[admin:research-lab] benchmark bundles unavailable', bundleResult.error.message)
  }
  if (reportResult.error) {
    console.warn('[admin:research-lab] benchmark reports unavailable', reportResult.error.message)
  }

  const runRows = runResult.error ? [] : (runResult.data ?? []) as ResearchLabScoringRunRow[]
  const runGroups = groupResearchLabScoringRuns(runRows).slice(0, BENCHMARK_HISTORY_LIMIT)
  const runIds = uniqueStrings(runGroups.flatMap((group) =>
    group.map((row) => stringOr(row.scoring_run_id) ?? null),
  ))
  let bundles = bundleResult.error
    ? []
    : (bundleResult.data ?? []) as ResearchLabBenchmarkBundleRow[]
  let reports = reportResult.error
    ? []
    : (reportResult.data ?? []) as BenchmarkReportLinkRow[]
  const [telemetryRows, bundleLinks] = await Promise.all([
    fetchBenchmarkTelemetryForRunIds(supabase, runIds),
    fetchBenchmarkBundleLinks(supabase, runIds),
  ])

  const missingBundleIds = uniqueStrings([...bundleLinks.values()])
    .filter((bundleId) => !bundles.some((row) => stringOr(row.benchmark_bundle_id) === bundleId))
  if (missingBundleIds.length > 0) {
    bundles = [...bundles, ...await fetchBenchmarkBundlesByIds(supabase, missingBundleIds)]
  }
  const reportBundleIds = uniqueStrings([
    ...bundles.map((row) => stringOr(row.benchmark_bundle_id) ?? null),
    ...bundleLinks.values(),
  ])
  const missingReportBundleIds = reportBundleIds.filter((bundleId) =>
    !reports.some((row) => stringOr(row.benchmark_bundle_id) === bundleId),
  )
  if (missingReportBundleIds.length > 0) {
    reports = [...reports, ...await fetchBenchmarkReportsByBundleIds(supabase, missingReportBundleIds)]
  }

  const benchmarkRuns = buildHistoricalBenchmarkRuns(
    runGroups,
    telemetryRows,
    bundles,
    reports,
    bundleLinks,
  )
  const latestPublishedReport = [...reports]
    .filter((row) => (stringOr(row.current_report_status) ?? '').toLowerCase() === 'published')
    .sort((a, b) => timestampOrZero(b.created_at) - timestampOrZero(a.created_at))[0] ?? null
  const latestRunGroup = runGroups[0] ?? []
  let latestExecution = normalizeResearchLabScoringExecution(latestRunGroup, telemetryRows)
  let selectedTelemetryRows = telemetryRowsForExecution(telemetryRows, latestExecution)

  if (!latestExecution && latestPublishedReport?.benchmark_bundle_id) {
    const legacyScoringId = `legacy:baseline:${latestPublishedReport.benchmark_bundle_id}`
    const legacyRows = await fetchBenchmarkTelemetryByScoringId(supabase, legacyScoringId)
    if (legacyRows.length > 0) {
      const expectedUnits = firstFiniteNumber(legacyRows.map((row) => row.expected_units))
      latestExecution = normalizeResearchLabScoringExecution([{
        scoring_id: legacyScoringId,
        run_type: 'private_baseline_rebenchmark',
        benchmark_date: latestPublishedReport.benchmark_date,
        expected_icp_count: expectedUnits,
        current_telemetry_degraded: true,
        finished_at: latestPublishedReport.current_status_at ?? latestPublishedReport.created_at,
      }], legacyRows)
      selectedTelemetryRows = canonicalizeResearchLabTelemetryRows(legacyRows)
    }
  }

  const dailyBenchmark = await buildDailyBenchmarkTelemetry({
    supabase,
    metadata,
    runGroup: latestRunGroup,
    execution: latestExecution,
    telemetryRows: selectedTelemetryRows,
    bundles,
    reports,
    bundleLinks,
    latestPublishedReport,
  })
  return { dailyBenchmark, benchmarkRuns }
}

async function fetchBenchmarkTelemetryForRunIds(
  supabase: ReturnType<typeof getAdminSupabase>,
  runIds: string[],
): Promise<ResearchLabScoringTelemetryRow[]> {
  const rows: ResearchLabScoringTelemetryRow[] = []
  for (const runIdBatch of chunked(runIds, SUPABASE_IN_FILTER_BATCH_SIZE)) {
    if (runIdBatch.length === 0) continue
    try {
      rows.push(...await fetchPagedTelemetryRows<ResearchLabScoringTelemetryRow>(
        'benchmark V2 ICP telemetry',
        (from, to) => supabase
          .from('research_lab_private_benchmark_dashboard_telemetry')
          .select('telemetry_mode, scoring_id, scoring_run_id, icp_execution_id, icp_ref, model_role, phase, execution_kind, retry_round, status, score, sourced_company_count, scored_company_count, cumulative_spend_usd, cap_usd, failure_category, retryable, telemetry_degraded, started_at, last_heartbeat_at, finished_at, observed_runtime_seconds, checkpoint_ref, expected_units')
          .in('scoring_run_id', runIdBatch)
          .order('scoring_run_id', { ascending: true })
          .order('icp_ordinal', { ascending: true })
          .order('icp_execution_id', { ascending: true })
          .range(from, to),
      ))
    } catch (error) {
      console.warn('[admin:research-lab] benchmark V2 ICP telemetry unavailable', error)
      return []
    }
  }
  return rows
}

async function fetchBenchmarkTelemetryByScoringId(
  supabase: ReturnType<typeof getAdminSupabase>,
  scoringId: string,
): Promise<ResearchLabScoringTelemetryRow[]> {
  try {
    return await fetchPagedTelemetryRows<ResearchLabScoringTelemetryRow>(
      'legacy benchmark ICP telemetry',
      (from, to) => supabase
        .from('research_lab_private_benchmark_dashboard_telemetry')
        .select('telemetry_mode, scoring_id, scoring_run_id, icp_execution_id, icp_ref, model_role, phase, execution_kind, retry_round, status, score, sourced_company_count, scored_company_count, cumulative_spend_usd, cap_usd, failure_category, retryable, telemetry_degraded, started_at, last_heartbeat_at, finished_at, observed_runtime_seconds, checkpoint_ref, expected_units')
        .eq('scoring_id', scoringId)
        .order('icp_ordinal', { ascending: true })
        .order('icp_ref', { ascending: true })
        .range(from, to),
    )
  } catch (error) {
    console.warn('[admin:research-lab] legacy benchmark telemetry unavailable', error)
    return []
  }
}

function buildHistoricalBenchmarkRuns(
  runGroups: ResearchLabScoringRunRow[][],
  telemetryRows: ResearchLabScoringTelemetryRow[],
  bundles: ResearchLabBenchmarkBundleRow[],
  reports: BenchmarkReportLinkRow[],
  bundleLinks: ReadonlyMap<string, string>,
): AdminLabBenchmarkRunSummary[] {
  return runGroups.flatMap((runGroup) => {
    const latestRun = [...runGroup].sort(compareScoringRunRowsNewestFirst)[0]
    const execution = normalizeResearchLabScoringExecution(runGroup, telemetryRows)
    const scoringId = stringOr(latestRun?.scoring_id)
    const scoringRunId = stringOr(latestRun?.scoring_run_id)
    if (!latestRun || !execution || !scoringId || !scoringRunId) return []
    const linked = correlateResearchLabBenchmarkRun(runGroup, bundles, bundleLinks)
    const benchmarkBundleId = stringOr(linked.bundle?.benchmark_bundle_id) ?? null
    const report = benchmarkBundleId
      ? reports.find((row) => stringOr(row.benchmark_bundle_id) === benchmarkBundleId)
      : undefined
    const publicationStatus = stringOr(report?.current_report_status)
      ?? stringOr(linked.bundle?.current_benchmark_status)
      ?? stringOr(linked.bundle?.current_event_type)
      ?? 'unavailable'
    return [{
      scoringId,
      scoringRunId,
      benchmarkDate: stringOr(latestRun.benchmark_date) ?? null,
      runAttempt: Math.max(0, Math.round(numberOr(latestRun.run_attempt, 0))),
      publicationStatus,
      executionStatus: execution.executionStatus,
      correlation: linked.correlation,
      benchmarkBundleId,
      reportId: stringOr(report?.report_id) ?? null,
      canonicalPublishedScore:
        (stringOr(report?.current_report_status) ?? '').toLowerCase() === 'published'
          ? finiteNumberOrNull(report?.aggregate_score)
          : null,
      expectedUnits: execution.expectedUnits,
      resolvedUnits: execution.resolvedUnits,
      completedUnits: execution.completedUnits,
      skippedUnits: execution.skippedUnits,
      failedUnits: execution.failedUnits,
      cancelledUnits: execution.cancelledUnits,
      progressPercent: execution.progressPercent,
      spendUsd: execution.spendUsd,
      capUsd: execution.capUsd,
      failureCategory: execution.failureCategory,
      retryable: execution.retryable,
      telemetryMode: execution.telemetryMode,
      telemetryDegraded: execution.telemetryDegraded,
      workerRef: execution.workerRef,
      startedAt: execution.startedAt,
      completedAt: execution.completedAt,
      durationSeconds: execution.durationSeconds,
    }]
  })
}

async function buildDailyBenchmarkTelemetry(input: {
  supabase: ReturnType<typeof getAdminSupabase>
  metadata: IcpMetadataSnapshot
  runGroup: ResearchLabScoringRunRow[]
  execution: ResearchLabScoringExecutionSummary | null
  telemetryRows: ResearchLabScoringTelemetryRow[]
  bundles: ResearchLabBenchmarkBundleRow[]
  reports: BenchmarkReportLinkRow[]
  bundleLinks: ReadonlyMap<string, string>
  latestPublishedReport: BenchmarkReportLinkRow | null
}): Promise<AdminLabDailyBenchmark> {
  const latestRun = [...input.runGroup].sort(compareScoringRunRowsNewestFirst)[0]
  const execution = input.execution
  const latestPublishedReport = input.latestPublishedReport
  const linked = latestRun
    ? correlateResearchLabBenchmarkRun(input.runGroup, input.bundles, input.bundleLinks)
    : { correlation: 'unlinked' as const, bundle: null }
  if (!execution && !latestPublishedReport) {
    return emptyDailyBenchmark('No V2 benchmark execution or canonical publication is available yet.')
  }

  const publishedBundleId = stringOr(latestPublishedReport?.benchmark_bundle_id) ?? null
  const publishedBundle = publishedBundleId
    ? input.bundles.find((row) => stringOr(row.benchmark_bundle_id) === publishedBundleId)
    : undefined
  const publicationStatus = stringOr(latestPublishedReport?.current_report_status)
    ?? stringOr(publishedBundle?.current_benchmark_status)
    ?? stringOr(publishedBundle?.current_event_type)
    ?? 'unavailable'
  const benchmarkDate = stringOr(latestRun?.benchmark_date)
    ?? stringOr(latestPublishedReport?.benchmark_date)
    ?? null
  const attempt = latestRun
    ? Math.max(0, Math.round(numberOr(latestRun.run_attempt, 0)))
    : null
  const [providerRows, companyRows] = await Promise.all([
    execution?.relatedScoringRunIds.length
      ? fetchBenchmarkProviderEnrichment(input.supabase, execution.relatedScoringRunIds)
      : Promise.resolve([]),
    benchmarkDate && attempt !== null
      ? fetchBenchmarkCompanyEnrichment(input.supabase, benchmarkDate, attempt)
      : Promise.resolve([]),
  ])
  const providerByIcp = rollupCostsByIcp(providerRows)
  const companiesByIcp = groupCompaniesByIcp(companyRows)
  const canonicalRows = canonicalizeResearchLabTelemetryRows(input.telemetryRows)
  const icps = canonicalRows.map((row, index): AdminLabIcpDetail => {
    const icpRef = stringOr(row.icp_ref) ?? `telemetry-unit-${index + 1}`
    const metadata = input.metadata.byRef.get(icpRef)
    const provider = providerByIcp.get(icpRef) ?? emptyCostRollup()
    const companies = companiesByIcp.get(icpRef) ?? []
    const status = (stringOr(row.status) ?? 'unknown').toLowerCase()
    const runtimeStartedAt = isoStringOr(row.started_at) ?? null
    const runtimeEndedAt = isoStringOr(row.finished_at) ?? null
    const runtimeSeconds = finiteNumberOrNull(row.observed_runtime_seconds)
    return {
      icpRef,
      icpHash: null,
      label: icpLabel(metadata, icpRef),
      industry: metadata?.industry ?? null,
      subIndustry: metadata?.subIndustry ?? null,
      status,
      score: finiteNumberOrNull(row.score),
      baseScore: null,
      delta: null,
      spendUsd: finiteNumberOrNull(row.cumulative_spend_usd) ?? 0,
      budgetUsd: finiteNumberOrNull(row.cap_usd),
      providerEventCount: provider.eventCount,
      errorCount: provider.errorCount + (['failed', 'cancelled'].includes(status) ? 1 : 0),
      runtimeStartedAt,
      runtimeEndedAt,
      lastActivityAt:
        isoStringOr(row.finished_at)
        ?? isoStringOr(row.last_heartbeat_at)
        ?? runtimeStartedAt,
      runtimeMs: runtimeSeconds === null ? null : Math.max(0, Math.round(runtimeSeconds * 1_000)),
      isInProgress: ['held', 'queued', 'started', 'heartbeat', 'sourcing_completed', 'scoring_started'].includes(status),
      failureReason: stringOr(row.failure_category) ?? null,
      hardFailure: ['failed', 'cancelled'].includes(status),
      funnel: null,
      intentSignals: metadata?.intentSignals ?? [],
      companyScoreCount:
        finiteNumberOrNull(row.scored_company_count)
        ?? companies.length,
      companies,
    }
  })
  const stateInfo = benchmarkExecutionState(execution, publicationStatus)
  const expectedUnits = execution?.expectedUnits ?? null
  const resolvedUnits = execution?.resolvedUnits ?? null
  const errors = buildProviderErrors(providerRows)
  const lastActivityAt = execution?.completedAt
    ?? execution?.lastHeartbeatAt
    ?? isoStringOr(latestRun?.current_status_at)
    ?? null
  const executionBundleId = stringOr(linked.bundle?.benchmark_bundle_id) ?? null
  const publicationCorrelation = publishedBundleId && executionBundleId === publishedBundleId
    ? linked.correlation
    : 'unlinked'

  return {
    state: stateInfo.state,
    stateLabel: stateInfo.label,
    detail: benchmarkTelemetryDetail({
      publicationStatus,
      publishedScore: finiteNumberOrNull(latestPublishedReport?.aggregate_score),
      execution,
      correlation: publicationCorrelation,
    }),
    publicationStatus,
    executionStatus: execution?.executionStatus ?? null,
    correlation: publicationCorrelation,
    telemetryMode: execution?.telemetryMode ?? 'missing',
    telemetryDegraded: execution?.telemetryDegraded ?? true,
    scoringId: execution?.scoringId ?? null,
    scoringRunId: execution?.scoringRunId ?? null,
    publishedBenchmarkBundleId: publishedBundleId,
    executionBenchmarkBundleId: executionBundleId,
    reportId: stringOr(latestPublishedReport?.report_id) ?? null,
    benchmarkDate,
    attempt,
    rollingWindowHash:
      stringOr(latestRun?.rolling_window_hash)
      ?? stringOr(publishedBundle?.rolling_window_hash)
      ?? null,
    workerRef: execution?.workerRef ?? null,
    startedAt: execution?.startedAt ?? null,
    lastActivityAt,
    completedAt: execution?.completedAt ?? null,
    durationSeconds: execution?.durationSeconds ?? null,
    icpsTotal: expectedUnits,
    icpsProcessed: resolvedUnits,
    icpsRemaining:
      expectedUnits === null || resolvedUnits === null
        ? null
        : Math.max(0, expectedUnits - resolvedUnits),
    completedIcpCount: execution?.completedUnits ?? null,
    skippedIcpCount: execution?.skippedUnits ?? null,
    failedIcpCount: execution?.failedUnits ?? null,
    cancelledIcpCount: execution?.cancelledUnits ?? null,
    progressPercent: execution?.progressPercent ?? null,
    publishedScore: finiteNumberOrNull(latestPublishedReport?.aggregate_score),
    spendUsd: execution?.spendUsd ?? null,
    budgetUsd: execution?.capUsd ?? null,
    providerEventCount: providerRows.length,
    companyCount: companyRows.length,
    errorCount: errors.reduce((sum, item) => sum + item.count, 0)
      + (execution?.failedUnits ?? 0)
      + (execution?.cancelledUnits ?? 0),
    icps,
    errors,
  }
}

function benchmarkExecutionState(
  execution: ResearchLabScoringExecutionSummary | null,
  publicationStatus: string,
): { state: AdminLabTelemetryState; label: string } {
  const status = (execution?.executionStatus ?? '').toLowerCase()
  const terminalProgressIncomplete = status === 'completed'
    && execution?.expectedUnits !== null
    && execution?.resolvedUnits !== null
    && execution?.expectedUnits !== undefined
    && execution?.resolvedUnits !== undefined
    && execution.resolvedUnits < execution.expectedUnits
  if (terminalProgressIncomplete || (execution && execution.telemetryMode === 'missing')) {
    return { state: 'unknown', label: 'Telemetry degraded' }
  }
  if (status === 'completed') return { state: 'completed', label: 'Execution completed' }
  if (status === 'failed') return { state: 'failed', label: 'Execution failed' }
  if (status === 'cancelled') return { state: 'failed', label: 'Execution cancelled' }
  if (['assigned', 'started', 'heartbeat', 'paused', 'resumed', 'restarted'].includes(status)) {
    const heartbeat = execution?.lastHeartbeatAt ?? execution?.startedAt
    if (heartbeat && Date.now() - timestampOrZero(heartbeat) > LIVE_BENCHMARK_STALE_MS) {
      return { state: 'stalled', label: 'Execution stalled' }
    }
    return { state: 'active', label: status === 'paused' ? 'Execution paused' : 'Execution running' }
  }
  if (publicationStatus.toLowerCase() === 'published') {
    return { state: 'completed', label: 'Published · execution unavailable' }
  }
  return { state: 'idle', label: 'Execution unavailable' }
}

function benchmarkTelemetryDetail(input: {
  publicationStatus: string
  publishedScore: number | null
  execution: ResearchLabScoringExecutionSummary | null
  correlation: ReturnType<typeof correlateResearchLabBenchmarkRun>['correlation']
}): string {
  const parts: string[] = []
  const execution = input.execution
  if (input.publicationStatus.toLowerCase() === 'published' && input.publishedScore !== null) {
    parts.push(`Published ${input.publishedScore.toFixed(2)}`)
  } else {
    parts.push(`Publication ${input.publicationStatus}`)
  }
  if (execution && execution.resolvedUnits !== null && execution.expectedUnits !== null) {
    parts[0] += ` · ${execution.resolvedUnits}/${execution.expectedUnits} resolved`
  }
  if (execution?.executionStatus) {
    const failure = execution.failureCategory ? `: ${execution.failureCategory}` : ''
    parts.push(`Latest execution ${execution.executionStatus}${failure}`)
  } else {
    parts.push('Execution telemetry unavailable')
  }
  if (input.correlation === 'unlinked' && execution) {
    parts.push('Execution is unlinked to the displayed publication; no timestamp-only match was inferred')
  }
  if (execution?.telemetryDegraded) {
    parts.push(`${execution.telemetryMode} telemetry is degraded`)
  }
  return `${parts.join('. ')}.`
}

function telemetryRowsForExecution(
  rows: ResearchLabScoringTelemetryRow[],
  execution: ResearchLabScoringExecutionSummary | null,
): ResearchLabScoringTelemetryRow[] {
  if (!execution?.scoringId) return []
  const runIds = new Set(execution.relatedScoringRunIds)
  return canonicalizeResearchLabTelemetryRows(rows.filter((row) =>
    stringOr(row.scoring_id) === execution.scoringId
    && (
      runIds.size === 0
      || Boolean(stringOr(row.scoring_run_id) && runIds.has(stringOr(row.scoring_run_id) as string))
    ),
  ))
}

async function fetchBenchmarkBundleLinks(
  supabase: ReturnType<typeof getAdminSupabase>,
  runIds: string[],
): Promise<Map<string, string>> {
  const links = new Map<string, string>()
  for (const runIdBatch of chunked(runIds, SUPABASE_IN_FILTER_BATCH_SIZE)) {
    if (runIdBatch.length === 0) continue
    let rows: Array<Record<string, unknown>> = []
    try {
      rows = await fetchPagedTelemetryRows<Record<string, unknown>>(
        'benchmark bundle link events',
        (from, to) => supabase
          .from('research_lab_scoring_run_events')
          .select('scoring_run_id, benchmark_bundle_id, occurred_at, event_id')
          .in('scoring_run_id', runIdBatch)
          .not('benchmark_bundle_id', 'is', null)
          .order('scoring_run_id', { ascending: true })
          .order('occurred_at', { ascending: false })
          .order('event_id', { ascending: false })
          .range(from, to),
      )
    } catch (error) {
      console.warn('[admin:research-lab] benchmark bundle link events unavailable', error)
      continue
    }
    for (const row of rows) {
      const runId = stringOr(row.scoring_run_id)
      const bundleId = stringOr(row.benchmark_bundle_id)
      if (runId && bundleId && !links.has(runId)) links.set(runId, bundleId)
    }
  }
  return links
}

async function fetchBenchmarkBundlesByIds(
  supabase: ReturnType<typeof getAdminSupabase>,
  bundleIds: string[],
): Promise<ResearchLabBenchmarkBundleRow[]> {
  const rows: ResearchLabBenchmarkBundleRow[] = []
  for (const batch of chunked(bundleIds, SUPABASE_IN_FILTER_BATCH_SIZE)) {
    const { data, error } = await supabase
      .from('research_lab_private_model_benchmark_current')
      .select('benchmark_bundle_id, benchmark_date, private_model_artifact_hash, rolling_window_hash, aggregate_score, current_benchmark_status, current_event_type, current_status_at, created_at')
      .in('benchmark_bundle_id', batch)
    if (error) {
      console.warn('[admin:research-lab] exact benchmark bundle lookup unavailable', error.message)
      continue
    }
    rows.push(...((data ?? []) as ResearchLabBenchmarkBundleRow[]))
  }
  return rows
}

async function fetchBenchmarkReportsByBundleIds(
  supabase: ReturnType<typeof getAdminSupabase>,
  bundleIds: string[],
): Promise<BenchmarkReportLinkRow[]> {
  const rows: BenchmarkReportLinkRow[] = []
  for (const batch of chunked(bundleIds, SUPABASE_IN_FILTER_BATCH_SIZE)) {
    const { data, error } = await supabase
      .from('research_lab_public_benchmark_report_current')
      .select('report_id, benchmark_bundle_id, benchmark_date, aggregate_score, current_report_status, current_status_at, created_at')
      .in('benchmark_bundle_id', batch)
      .eq('current_report_status', 'published')
    if (error) {
      console.warn('[admin:research-lab] exact benchmark report lookup unavailable', error.message)
      continue
    }
    rows.push(...((data ?? []) as BenchmarkReportLinkRow[]))
  }
  return rows
}

async function fetchBenchmarkProviderEnrichment(
  supabase: ReturnType<typeof getAdminSupabase>,
  runIds: string[],
): Promise<ProviderCostTelemetryRow[]> {
  const rows: ProviderCostTelemetryRow[] = []
  for (const batch of chunked(runIds, SUPABASE_IN_FILTER_BATCH_SIZE)) {
    try {
      rows.push(...await fetchPagedTelemetryRows<ProviderCostTelemetryRow>(
        'benchmark provider enrichment',
        (from, to) => supabase
          .from('research_lab_provider_cost_events')
          .select('scoring_id, scoring_run_id, icp_execution_id, candidate_id, benchmark_date, run_scope, run_type, runner_role, provider, endpoint, request_fingerprint, status_code, cost_usd, spent_after_usd, cap_usd, cap_state, icp_ref, icp_hash, created_at, event_doc')
          .in('scoring_run_id', batch)
          .order('created_at', { ascending: true, nullsFirst: false })
          .order('request_fingerprint', { ascending: true })
          .range(from, to),
      ))
    } catch (error) {
      console.warn('[admin:research-lab] benchmark provider enrichment unavailable', error)
    }
  }
  return rows
}

async function fetchBenchmarkCompanyEnrichment(
  supabase: ReturnType<typeof getAdminSupabase>,
  benchmarkDate: string,
  attempt: number,
): Promise<CompanyTelemetryRow[]> {
  const contextPrefix = `daily-${benchmarkDate}-a${attempt}-%`
  try {
    return await fetchPagedTelemetryRows<CompanyTelemetryRow>(
      'benchmark company enrichment',
      (from, to) => supabase
        .from('research_lab_company_label_examples')
        .select(COMPANY_TELEMETRY_SELECT)
        .like('context_ref', contextPrefix)
        .order('created_at', { ascending: true, nullsFirst: false })
        .order('label_id', { ascending: true })
        .range(from, to),
    )
  } catch (error) {
    console.warn('[admin:research-lab] benchmark company enrichment unavailable', error)
    return []
  }
}

async function fetchPagedTelemetryRows<T>(
  label: string,
  fetchPage: (from: number, to: number) => PromiseLike<unknown>,
): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += TELEMETRY_PAGE_SIZE) {
    const result = await fetchPage(from, from + TELEMETRY_PAGE_SIZE - 1) as {
      data: unknown[] | null
      error: { message?: string } | null
    }
    if (result.error) throw new Error(`${label} failure — ${result.error.message ?? 'unknown error'}`)
    const page = (result.data ?? []) as T[]
    rows.push(...page)
    if (page.length < TELEMETRY_PAGE_SIZE) break
  }
  return rows
}

function compareScoringRunRowsNewestFirst(
  a: ResearchLabScoringRunRow,
  b: ResearchLabScoringRunRow,
): number {
  const attemptDiff = numberOr(b.run_attempt, 0) - numberOr(a.run_attempt, 0)
  if (attemptDiff !== 0) return attemptDiff
  return timestampOrZero(b.current_status_at ?? b.created_at)
    - timestampOrZero(a.current_status_at ?? a.created_at)
}

function emptyDailyBenchmark(detail: string): AdminLabDailyBenchmark {
  return {
    state: 'idle',
    stateLabel: 'Idle',
    detail,
    publicationStatus: 'unavailable',
    executionStatus: null,
    correlation: 'unlinked',
    telemetryMode: 'missing',
    telemetryDegraded: true,
    scoringId: null,
    scoringRunId: null,
    publishedBenchmarkBundleId: null,
    executionBenchmarkBundleId: null,
    reportId: null,
    benchmarkDate: null,
    attempt: null,
    rollingWindowHash: null,
    workerRef: null,
    startedAt: null,
    lastActivityAt: null,
    completedAt: null,
    durationSeconds: null,
    icpsTotal: null,
    icpsProcessed: null,
    icpsRemaining: null,
    completedIcpCount: null,
    skippedIcpCount: null,
    failedIcpCount: null,
    cancelledIcpCount: null,
    progressPercent: null,
    publishedScore: null,
    spendUsd: null,
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

  const [bundleResult, companies, costs, metadata] = await Promise.all([
    supabase
      .from('research_evaluation_score_bundle_current')
      .select('score_bundle_id, ticket_id, run_id, candidate_artifact_hash, score_bundle_doc, current_event_status, current_reason, current_status_at, created_at')
      .in('score_bundle_id', bundleIds)
      .limit(CHAMPION_LIMIT * 2),
    candidateIds.length > 0
      ? fetchPagedTelemetryRows<CompanyTelemetryRow>(
          'champion company telemetry',
          (from, to) => supabase
            .from('research_lab_company_label_examples')
            .select(COMPANY_TELEMETRY_SELECT)
            .in('candidate_id', candidateIds)
            .order('created_at', { ascending: true, nullsFirst: false })
            .order('label_id', { ascending: true })
            .range(from, to),
        )
      : Promise.resolve([]),
    candidateIds.length > 0
      ? fetchPagedTelemetryRows<ProviderCostTelemetryRow>(
          'champion provider telemetry',
          (from, to) => supabase
            .from('research_lab_provider_cost_events')
            .select('candidate_id, provider, endpoint, request_fingerprint, status_code, cost_usd, spent_after_usd, cap_usd, cap_state, icp_ref, icp_hash, created_at, event_doc')
            .in('candidate_id', candidateIds)
            .order('created_at', { ascending: true, nullsFirst: false })
            .order('request_fingerprint', { ascending: true })
            .range(from, to),
        )
      : Promise.resolve([]),
    metadataPromise,
  ])

  const bundles = (bundleResult.data ?? []) as Array<Record<string, unknown>>
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
      const status = stringOr(row.status) ?? (failureReason ? 'failed' : 'observed')
      const companyActivity = surfaced.map((company) => company.capturedAt).filter(Boolean) as string[]
      const runtimeStartedAt =
        isoStringOr(row.started_at) ??
        earliestIso(cost.firstActivityAt, ...companyActivity) ??
        null
      const runtimeLastActivityAt = latestIso(
        cost.lastActivityAt,
        ...companyActivity,
        isoStringOr(row.completed_at),
        isoStringOr(row.finished_at),
      ) ?? null
      const isInProgress = /(?:^|_)(?:running|processing|in_progress)(?:$|_)/i.test(status)
      const runtimeEndedAt = isInProgress ? null : runtimeLastActivityAt
      const runtimeMs = runtimeStartedAt
        ? Math.max(
            0,
            (isInProgress ? Date.now() : timestampOrZero(runtimeEndedAt ?? runtimeStartedAt)) - timestampOrZero(runtimeStartedAt),
          )
        : null
      return {
        icpRef,
        icpHash: stringOr(row.icp_hash) ?? meta?.icpHash ?? null,
        label: icpLabel(meta, icpRef),
        industry: meta?.industry ?? null,
        subIndustry: meta?.subIndustry ?? null,
        status,
        score: finiteNumberOrNull(row.candidate_per_icp_score),
        baseScore: finiteNumberOrNull(row.base_per_icp_score),
        delta: finiteNumberOrNull(row.delta_vs_base),
        spendUsd: cost.spendUsd,
        budgetUsd: cost.budgetUsd,
        providerEventCount: cost.eventCount,
        errorCount: cost.errorCount + (failureReason ? 1 : 0),
        runtimeStartedAt,
        runtimeEndedAt,
        lastActivityAt: runtimeLastActivityAt,
        runtimeMs,
        isInProgress,
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
  runId: string | null,
): Promise<AdminLabRunDetail> {
  let candidateQuery = supabase
    .from('research_lab_candidate_evaluation_current')
    .select('candidate_id, ticket_id, run_id, candidate_kind, candidate_artifact_hash, candidate_patch_hash, candidate_model_manifest_hash, candidate_source_diff_hash, candidate_patch_manifest, hypothesis_doc, candidate_build_doc, current_candidate_status, current_reason, current_score_bundle_id, current_event_hash, current_status_at, redacted_public_summary, created_at')
    .eq('ticket_id', loop.ticketId)
    .order('created_at', { ascending: false, nullsFirst: false })
    .limit(200)
  let bundleQuery = supabase
    .from('research_evaluation_score_bundle_current')
    .select('score_bundle_id, ticket_id, run_id, score_bundle_doc, current_event_status, current_event_type, current_reason, current_status_at, created_at')
    .eq('ticket_id', loop.ticketId)
    .order('created_at', { ascending: false, nullsFirst: false })
    .limit(200)
  let dispatchQuery = supabase
    .from('research_lab_scoring_dispatch_events')
    .select('dispatch_event_id, dispatch_status, dispatch_type, candidate_id, run_id, score_bundle_id, worker_ref, event_doc, created_at')
    .eq('ticket_id', loop.ticketId)
    .order('created_at', { ascending: false, nullsFirst: false })
    .limit(500)

  // A ticket can be retried many times. Keep the inspector honest by
  // applying the selected run to every source that can carry run_id before
  // costs and errors are joined through that run's candidate IDs.
  if (runId) {
    candidateQuery = candidateQuery.eq('run_id', runId)
    bundleQuery = bundleQuery.eq('run_id', runId)
    dispatchQuery = dispatchQuery.eq('run_id', runId)
  }

  const [candidateResult, bundleResult, companyRows, dispatchResult, metadata] = await Promise.all([
    candidateQuery,
    bundleQuery,
    fetchRunCompanyTelemetry(supabase, loop.ticketId, runId),
    dispatchQuery,
    fetchIcpMetadata(supabase),
  ])

  const sourceErrors = [
    ['candidates', candidateResult.error],
    ['score bundles', bundleResult.error],
    ['dispatch events', dispatchResult.error],
  ] as const
  const unavailableSources = sourceErrors
    .filter((entry) => Boolean(entry[1]))
    .map(([source, sourceError]) => `${source}: ${sourceError?.message ?? 'unavailable'}`)
  if (unavailableSources.length > 0) {
    throw new Error(`Run telemetry source failure — ${unavailableSources.join('; ')}`)
  }

  const candidateRows = (candidateResult.data ?? []) as Array<Record<string, unknown>>
  const bundleRows = (bundleResult.data ?? []) as Array<Record<string, unknown>>
  const dispatchRows = (dispatchResult.data ?? []) as Array<Record<string, unknown>>
  const candidateIds = uniqueStrings(candidateRows.map((row) => stringOr(row.candidate_id) ?? null))
  const costRows: ProviderCostTelemetryRow[] = []
  for (const batch of chunked(candidateIds, SUPABASE_IN_FILTER_BATCH_SIZE)) {
    costRows.push(...await fetchPagedTelemetryRows<ProviderCostTelemetryRow>(
      'run provider telemetry',
      (from, to) => supabase
        .from('research_lab_provider_cost_events')
        .select('scoring_id, scoring_run_id, icp_execution_id, candidate_id, provider, endpoint, request_fingerprint, status_code, cost_usd, spent_after_usd, cap_usd, cap_state, icp_ref, icp_hash, created_at, event_doc')
        .in('candidate_id', batch)
        .order('created_at', { ascending: true, nullsFirst: false })
        .order('request_fingerprint', { ascending: true })
        .range(from, to),
    ))
  }

  const scoringTelemetry = await fetchCandidateScoringTelemetry(
    supabase,
    runId,
    candidateIds,
  )

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
    const diagnostics = parseAdminLabScoreBundleDiagnostics(bundle?.score_bundle_doc)
    const execution = scoringTelemetry.byCandidate.get(candidateId) ?? null
    const errors = [
      ...buildProviderErrors(costs, candidateId),
      ...buildDispatchErrors(dispatchRows.filter((row) => stringOr(row.candidate_id) === candidateId)),
      ...buildCandidateStatusErrors(candidate, candidateId),
      ...buildScoreBundleDiagnosticErrors(diagnostics, bundle, candidateId),
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
      spendUsd: execution?.spendUsd
        ?? roundTelemetry(costs.reduce((sum, row) => sum + numberOr(row.cost_usd, 0), 0)),
      budgetUsd: execution?.capUsd ?? totalBudget(score.icps),
      providerEventCount: costs.length,
      companyCount: companies.length || score.icps.reduce((sum, icp) => sum + icp.companyScoreCount, 0),
      errorCount: errors.reduce((sum, item) => sum + item.count, 0),
      execution,
      diagnostics,
      artifact: parseCandidateArtifactDetail(candidate),
      icps: score.icps,
      errors,
    }
  })

  const runErrors = dedupeAdminErrors([
    ...buildProviderErrors(costRows),
    ...buildDispatchErrors(dispatchRows),
    ...candidates.flatMap((candidate) => candidate.errors.filter((error) => error.source === 'candidate' || error.source === 'score_bundle')),
  ])
  const totalBudgetUsd = candidates.some((candidate) => candidate.budgetUsd !== null)
    ? roundTelemetry(candidates.reduce((sum, candidate) => sum + (candidate.budgetUsd ?? 0), 0))
    : null
  return {
    ticketId: loop.ticketId,
    runId,
    state: telemetryStateForRun(loop, runId, candidateRows, bundleRows, dispatchRows),
    phase: phaseForRun(loop, runId, candidateRows, bundleRows, dispatchRows),
    totalSpendUsd: scoringTelemetry.summaries.some((summary) => summary.spendUsd !== null)
      ? roundTelemetry(scoringTelemetry.summaries.reduce((sum, summary) => sum + (summary.spendUsd ?? 0), 0))
      : roundTelemetry(costRows.reduce((sum, row) => sum + numberOr(row.cost_usd, 0), 0)),
    totalBudgetUsd,
    providerEventCount: costRows.length,
    companyCount: companyRows.length,
    errorCount: runErrors.reduce((sum, item) => sum + item.count, 0),
    scoringExecutions: scoringTelemetry.summaries,
    candidates,
    errors: runErrors,
    fetchedAt: new Date().toISOString(),
  }
}

async function fetchRunCompanyTelemetry(
  supabase: ReturnType<typeof getAdminSupabase>,
  ticketId: string,
  runId: string | null,
): Promise<CompanyTelemetryRow[]> {
  return fetchPagedTelemetryRows<CompanyTelemetryRow>(
    'run company telemetry',
    (from, to) => {
      let query = supabase
        .from('research_lab_company_label_examples')
        .select(COMPANY_TELEMETRY_SELECT)
        .eq('ticket_id', ticketId)
      if (runId) query = query.eq('run_id', runId)
      return query
        .order('created_at', { ascending: false, nullsFirst: false })
        .order('label_id', { ascending: false })
        .range(from, to)
    },
  )
}

async function fetchCandidateScoringTelemetry(
  supabase: ReturnType<typeof getAdminSupabase>,
  sourceRunId: string | null,
  candidateIds: string[],
): Promise<{
  byCandidate: Map<string, ResearchLabScoringExecutionSummary>
  summaries: ResearchLabScoringExecutionSummary[]
}> {
  if (candidateIds.length === 0) return { byCandidate: new Map(), summaries: [] }
  const runRows: ResearchLabScoringRunRow[] = []
  const runRowById = new Map<string, ResearchLabScoringRunRow>()
  const addRunRows = (rows: ResearchLabScoringRunRow[]) => {
    for (const row of rows) {
      const runId = stringOr(row.scoring_run_id)
      if (runId) runRowById.set(runId, row)
    }
  }
  if (sourceRunId && isUuid(sourceRunId)) {
    const { data, error } = await supabase
      .from('research_lab_scoring_run_current')
      .select('scoring_run_id, scoring_id, run_type, run_attempt, source_run_id, ticket_id, candidate_id, expected_icp_count, scheduler_type, worker_ref, current_run_status, current_status_at, current_retryable, current_failure_category, current_telemetry_degraded, started_at, last_heartbeat_at, finished_at, observed_runtime_seconds, created_at')
      .eq('run_type', 'candidate_scoring')
      .eq('source_run_id', sourceRunId)
      .order('created_at', { ascending: false, nullsFirst: false })
      .limit(500)
    if (error) console.warn('[admin:research-lab] candidate scoring runs by source unavailable', error.message)
    else addRunRows((data ?? []) as ResearchLabScoringRunRow[])
  }
  for (const batch of chunked(candidateIds, SUPABASE_IN_FILTER_BATCH_SIZE)) {
    const { data, error } = await supabase
      .from('research_lab_scoring_run_current')
      .select('scoring_run_id, scoring_id, run_type, run_attempt, source_run_id, ticket_id, candidate_id, expected_icp_count, scheduler_type, worker_ref, current_run_status, current_status_at, current_retryable, current_failure_category, current_telemetry_degraded, started_at, last_heartbeat_at, finished_at, observed_runtime_seconds, created_at')
      .eq('run_type', 'candidate_scoring')
      .in('candidate_id', batch)
      .order('created_at', { ascending: false, nullsFirst: false })
      .limit(500)
    if (error) {
      console.warn('[admin:research-lab] candidate scoring runs by candidate unavailable', error.message)
      continue
    }
    addRunRows((data ?? []) as ResearchLabScoringRunRow[])
  }
  const candidateIdSet = new Set(candidateIds)
  runRows.push(...[...runRowById.values()].filter((row) => {
    const candidateId = stringOr(row.candidate_id)
    const matchesCandidate = Boolean(candidateId && candidateIdSet.has(candidateId))
    const matchesSource = !sourceRunId || stringOr(row.source_run_id) === sourceRunId
    return matchesCandidate && matchesSource
  }))
  const scoringRunIds = uniqueStrings(runRows.map((row) => stringOr(row.scoring_run_id) ?? null))
  const telemetryRows = await fetchCandidateTelemetryForRunIds(supabase, scoringRunIds)
  const groupedRuns = groupResearchLabScoringRuns(runRows)
  const byCandidate = new Map<string, ResearchLabScoringExecutionSummary>()
  for (const group of groupedRuns) {
    const summary = normalizeResearchLabScoringExecution(group, telemetryRows)
    if (!summary?.candidateId || byCandidate.has(summary.candidateId)) continue
    byCandidate.set(summary.candidateId, summary)
  }

  const candidatesMissingTelemetry = candidateIds.filter((candidateId) => !byCandidate.has(candidateId))
  const legacyRows = await fetchLegacyCandidateTelemetry(
    supabase,
    sourceRunId,
    candidatesMissingTelemetry,
  )
  const legacyByScoringId = new Map<string, ResearchLabScoringTelemetryRow[]>()
  for (const row of legacyRows) {
    const scoringId = stringOr(row.scoring_id)
    if (!scoringId) continue
    const group = legacyByScoringId.get(scoringId) ?? []
    group.push(row)
    legacyByScoringId.set(scoringId, group)
  }
  for (const [scoringId, rows] of legacyByScoringId) {
    const candidateId = stringOr(rows[0]?.candidate_id)
    if (!candidateId || byCandidate.has(candidateId)) continue
    const expectedUnits = firstFiniteNumber(rows.map((row) => row.expected_units))
    const summary = normalizeResearchLabScoringExecution([{
      scoring_id: scoringId,
      source_run_id: sourceRunId,
      candidate_id: candidateId,
      expected_icp_count: expectedUnits,
      current_telemetry_degraded: true,
    }], rows)
    if (summary) byCandidate.set(candidateId, summary)
  }
  return { byCandidate, summaries: [...byCandidate.values()] }
}

async function fetchCandidateTelemetryForRunIds(
  supabase: ReturnType<typeof getAdminSupabase>,
  runIds: string[],
): Promise<ResearchLabScoringTelemetryRow[]> {
  const rows: ResearchLabScoringTelemetryRow[] = []
  for (const batch of chunked(runIds, SUPABASE_IN_FILTER_BATCH_SIZE)) {
    if (batch.length === 0) continue
    try {
      rows.push(...await fetchPagedTelemetryRows<ResearchLabScoringTelemetryRow>(
        'candidate V2 ICP telemetry',
        (from, to) => supabase
          .from('research_lab_scoring_dashboard_telemetry')
          .select('telemetry_mode, scoring_id, scoring_run_id, source_run_id, candidate_id, icp_execution_id, icp_ref, model_role, phase, execution_kind, retry_round, status, score, sourced_company_count, scored_company_count, cumulative_spend_usd, cap_usd, failure_category, retryable, telemetry_degraded, started_at, last_heartbeat_at, finished_at, observed_runtime_seconds, checkpoint_ref, expected_units')
          .in('scoring_run_id', batch)
          .order('scoring_run_id', { ascending: true })
          .order('icp_ordinal', { ascending: true })
          .order('icp_execution_id', { ascending: true })
          .range(from, to),
      ))
    } catch (error) {
      console.warn('[admin:research-lab] candidate V2 ICP telemetry unavailable', error)
      return []
    }
  }
  return rows
}

async function fetchLegacyCandidateTelemetry(
  supabase: ReturnType<typeof getAdminSupabase>,
  sourceRunId: string | null,
  candidateIds: string[],
): Promise<ResearchLabScoringTelemetryRow[]> {
  if (candidateIds.length === 0) return []
  const rows: ResearchLabScoringTelemetryRow[] = []
  for (const batch of chunked(candidateIds, SUPABASE_IN_FILTER_BATCH_SIZE)) {
    try {
      rows.push(...await fetchPagedTelemetryRows<ResearchLabScoringTelemetryRow>(
        'legacy candidate ICP telemetry',
        (from, to) => {
          let query = supabase
            .from('research_lab_scoring_dashboard_telemetry')
            .select('telemetry_mode, scoring_id, scoring_run_id, source_run_id, candidate_id, icp_execution_id, icp_ref, model_role, phase, execution_kind, retry_round, status, score, sourced_company_count, scored_company_count, cumulative_spend_usd, cap_usd, failure_category, retryable, telemetry_degraded, started_at, last_heartbeat_at, finished_at, observed_runtime_seconds, checkpoint_ref, expected_units')
            .eq('telemetry_mode', 'legacy')
            .is('scoring_run_id', null)
            .in('candidate_id', batch)
          if (sourceRunId && isUuid(sourceRunId)) query = query.eq('source_run_id', sourceRunId)
          return query
            .order('scoring_id', { ascending: true })
            .order('icp_ordinal', { ascending: true })
            .order('icp_ref', { ascending: true })
            .range(from, to)
        },
      ))
    } catch (error) {
      console.warn('[admin:research-lab] legacy candidate ICP telemetry unavailable', error)
      return []
    }
  }
  return rows
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
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
    const occurredAt = isoStringOr(row.created_at)
    current.firstActivityAt = earliestIso(current.firstActivityAt, occurredAt) ?? current.firstActivityAt
    current.lastActivityAt = latestIso(current.lastActivityAt, occurredAt) ?? current.lastActivityAt
    byIcp.set(icpRef, current)
  }
  for (const value of byIcp.values()) value.spendUsd = roundTelemetry(value.spendUsd)
  return byIcp
}

function emptyCostRollup(): IcpCostRollup {
  return {
    spendUsd: 0,
    budgetUsd: null,
    eventCount: 0,
    errorCount: 0,
    firstActivityAt: null,
    lastActivityAt: null,
  }
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
    ...normalizeAdminLabCompanyIntent(row),
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
    const requestFingerprint = stringOr(row.request_fingerprint) ?? null
    const requestCommand = providerRequestCommand(row)
    const diagnosticDetail = providerDiagnosticDetail(row)
    const requestIdentity = requestFingerprint ?? requestCommand.value ?? ''
    const key = `${provider}\u0000${endpoint ?? ''}\u0000${statusCode}\u0000${icpRef ?? ''}\u0000${requestIdentity}`
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
      detail: diagnosticDetail,
      statusCode,
      provider,
      endpoint,
      requestCommand: requestCommand.value,
      requestCommandSource: requestCommand.source,
      requestFingerprint,
      icpRef,
      candidateId: candidateId ?? stringOr(row.candidate_id) ?? null,
      runId: null,
      count: 1,
      occurredAt: isoStringOr(row.created_at) ?? null,
    })
  }
  return Array.from(grouped.values()).sort((a, b) => timestampOrZero(b.occurredAt) - timestampOrZero(a.occurredAt))
}

function providerDiagnosticDetail(row: ProviderCostTelemetryRow): string | null {
  const doc = objectRecord(row.event_doc) ?? {}
  const response = objectRecord(doc.response) ?? {}
  const values = [
    doc.failure_class,
    doc.tracking_reason,
    doc.error,
    doc.error_message,
    doc.message,
    doc.detail,
    doc.error_excerpt,
    doc.response_excerpt,
    response.error,
    response.message,
  ]
    .map(stringOr)
    .filter((value): value is string => Boolean(value))
    .map(redactDiagnosticText)
  const unique = Array.from(new Set(values))
  return unique.length > 0 ? unique.join(' · ').slice(0, 1_600) : null
}

type ProviderRequestCommand = {
  value: string | null
  source: AdminLabErrorDetail['requestCommandSource']
}

const HTTP_REQUEST_LINE = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\S+)/i
const SENSITIVE_QUERY_PARAMETER = /^(?:api[-_]?key|key|token|access[-_]?token|auth|authorization|password|pass|secret|signature|credential)$/i

function providerRequestCommand(row: ProviderCostTelemetryRow): ProviderRequestCommand {
  const doc = objectRecord(row.event_doc)
  const request = objectRecord(doc?.request)
  const recordedLine = [
    doc?.request_command,
    doc?.http_command,
    doc?.command,
    doc?.request_line,
    request?.command,
    request?.request_line,
    doc?.evidence,
  ]
    .map(stringOr)
    .map((value) => recordedHttpRequestLine(value))
    .find((value): value is string => Boolean(value))

  if (recordedLine) {
    return { value: recordedLine, source: 'recorded' }
  }

  const recordedMethod = (
    stringOr(doc?.request_method) ??
    stringOr(doc?.http_method) ??
    stringOr(doc?.method) ??
    stringOr(request?.method)
  )?.toUpperCase()
  const recordedTarget =
    stringOr(doc?.request_target) ??
    stringOr(doc?.request_path) ??
    stringOr(doc?.request_url) ??
    stringOr(doc?.url) ??
    stringOr(request?.target) ??
    stringOr(request?.path) ??
    stringOr(request?.url)

  if (recordedTarget) {
    const method = recordedMethod && HTTP_REQUEST_LINE.test(`${recordedMethod} /`)
      ? recordedMethod
      : 'GET'
    return {
      value: sanitizeHttpRequestLine(`${method} ${recordedTarget}`),
      source: 'recorded',
    }
  }

  const endpoint = stringOr(row.endpoint)
  if (!endpoint) return { value: null, source: 'unavailable' }
  const provider = (stringOr(row.provider) ?? '').toLowerCase()
  const inferredMethod = provider === 'sd' && ['/scrape', '/profile'].includes(endpoint)
    ? 'GET '
    : ''
  return {
    value: `${inferredMethod}${endpoint}`,
    source: 'endpoint_only',
  }
}

function recordedHttpRequestLine(value: string | undefined): string | null {
  if (!value) return null
  for (const line of value.split(/\r?\n/)) {
    const trimmed = line.trim().replace(/^[-*]\s*/, '').replace(/^`+|`+$/g, '')
    if (HTTP_REQUEST_LINE.test(trimmed)) return sanitizeHttpRequestLine(trimmed)
  }
  return null
}

function sanitizeHttpRequestLine(value: string): string | null {
  const match = value.trim().match(HTTP_REQUEST_LINE)
  if (!match) return null
  const method = match[1].toUpperCase()
  let target = match[2]

  try {
    if (/^https?:\/\//i.test(target)) {
      const parsed = new URL(target)
      target = `${parsed.pathname}${parsed.search}`
    }
  } catch {
    // Preserve the recorded relative target when it is not URL-parseable.
  }

  const queryStart = target.indexOf('?')
  if (queryStart >= 0) {
    const path = target.slice(0, queryStart)
    const query = target.slice(queryStart + 1)
    const redactedQuery = query.split('&').map((part) => {
      const separator = part.indexOf('=')
      const rawName = separator >= 0 ? part.slice(0, separator) : part
      let decodedName = rawName
      try {
        decodedName = decodeURIComponent(rawName)
      } catch {
        // Use the raw parameter name for the sensitivity check.
      }
      if (!SENSITIVE_QUERY_PARAMETER.test(decodedName)) return part
      return `${rawName}=[redacted]`
    }).join('&')
    target = `${path}?${redactedQuery}`
  }

  return `${method} ${target}`.slice(0, 1_200)
}

function buildDispatchErrors(rows: Array<Record<string, unknown>>): AdminLabErrorDetail[] {
  return rows
    .filter((row) => {
      const status = (stringOr(row.dispatch_status) ?? '').toLowerCase()
      return ['failed', 'rejected', 'timed_out', 'timeout', 'cancelled', 'canceled'].includes(status)
    })
    .map((row, index) => {
      const doc = objectRecord(row.event_doc) ?? {}
      const diagnostics = doc.error_diagnostics
      const status = (stringOr(row.dispatch_status) ?? 'failed').toLowerCase()
      const failureClass = stringOr(doc.failure_class)
      const stage = stringOr(doc.stage)
      const detail = [
        failureClass,
        stage,
        summarizeUnknown(diagnostics),
        stringOr(doc.error),
        stringOr(doc.reason),
        stringOr(doc.message),
      ]
        .filter((value): value is string => Boolean(value))
        .map(redactDiagnosticText)
      const requestCommand = recordedHttpRequestLine(
        stringOr(doc.request_command) ?? stringOr(doc.request_line),
      )
      return {
        id: stringOr(row.dispatch_event_id) ?? `dispatch:${index}`,
        source: 'dispatch' as const,
        title: `${stringOr(row.dispatch_type) ?? 'Scoring dispatch'} ${status}`,
        detail: Array.from(new Set(detail)).join(' · ').slice(0, 1_600) || null,
        statusCode: finiteNumberOrNull(doc.status_code),
        provider: stringOr(doc.provider) ?? null,
        endpoint: stringOr(doc.endpoint) ?? null,
        requestCommand,
        requestCommandSource: requestCommand ? 'recorded' as const : 'unavailable' as const,
        requestFingerprint: stringOr(doc.error_hash) ?? stringOr(doc.request_fingerprint) ?? null,
        icpRef: stringOr(doc.icp_ref) ?? null,
        candidateId: stringOr(row.candidate_id) ?? null,
        runId: stringOr(row.run_id) ?? null,
        count: 1,
        occurredAt: isoStringOr(row.created_at) ?? null,
      }
    })
}

function redactDiagnosticText(value: string): string {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [redacted]')
    .replace(
      /\b(api[-_]?key|access[-_]?token|auth(?:orization)?|password|pass|secret|signature|credential)\b(\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;&]+)/gi,
      '$1$2[redacted]',
    )
    .slice(0, 1_600)
}

function buildCandidateStatusErrors(
  row: Record<string, unknown>,
  candidateId: string,
): AdminLabErrorDetail[] {
  const status = (stringOr(row.current_candidate_status) ?? '').toLowerCase()
  const failureLike = /(?:fail|reject|block|cancel|timed_out|timeout|no_candidate|no_buildable|needs_rescore)/.test(status)
  if (!failureLike) return []
  const reason = stringOr(row.current_reason)
  return [{
    id: `candidate:${candidateId}:${status || 'failed'}`,
    source: 'candidate',
    title: `Candidate ${readableDiagnosticKey(status || 'failed')}`,
    detail: reason ? redactDiagnosticText(reason) : null,
    statusCode: null,
    provider: null,
    endpoint: null,
    requestCommand: null,
    requestCommandSource: 'unavailable',
    requestFingerprint: stringOr(row.current_event_hash) ?? null,
    icpRef: null,
    candidateId,
    runId: stringOr(row.run_id) ?? null,
    count: 1,
    occurredAt: isoStringOr(row.current_status_at) ?? isoStringOr(row.created_at) ?? null,
  }]
}

function buildScoreBundleDiagnosticErrors(
  diagnostics: AdminLabScoreBundleDiagnostics,
  bundle: Record<string, unknown> | undefined,
  candidateId: string,
): AdminLabErrorDetail[] {
  if (!bundle) return []
  const bundleId = stringOr(bundle.score_bundle_id) ?? 'unknown-score-bundle'
  const runId = stringOr(bundle.run_id) ?? null
  const occurredAt = isoStringOr(bundle.current_status_at) ?? isoStringOr(bundle.created_at) ?? null
  const errors: AdminLabErrorDetail[] = []
  const classOccurrences = new Map<string, number>()

  diagnostics.perIcpResults.forEach((row, rowIndex) => {
    const classes = row.failureClasses.length > 0
      ? row.failureClasses
      : row.failureReason || /(?:fail|error|reject|block|timeout)/i.test(row.status ?? '')
        ? ['icp_scoring_failure']
        : []
    for (const failureClass of classes) {
      classOccurrences.set(failureClass, (classOccurrences.get(failureClass) ?? 0) + 1)
      errors.push({
        id: `score-bundle:${bundleId}:${row.icpRef ?? rowIndex}:${failureClass}`,
        source: 'score_bundle',
        title: `ICP · ${readableDiagnosticKey(failureClass)}`,
        detail: row.failureReason ? redactDiagnosticText(row.failureReason) : null,
        statusCode: null,
        provider: null,
        endpoint: null,
        requestCommand: null,
        requestCommandSource: 'unavailable',
        requestFingerprint: bundleId,
        icpRef: row.icpRef,
        candidateId,
        runId,
        count: 1,
        occurredAt,
      })
    }
  })

  for (const [failureClass, count] of Object.entries(diagnostics.scoringHealth?.failureClassCounts ?? {})) {
    const residual = Math.max(0, count - (classOccurrences.get(failureClass) ?? 0))
    if (residual === 0) continue
    errors.push({
      id: `score-bundle:${bundleId}:health:${failureClass}`,
      source: 'score_bundle',
      title: `Scoring health · ${readableDiagnosticKey(failureClass)}`,
      detail: `The score bundle recorded ${count.toLocaleString()} occurrence${count === 1 ? '' : 's'} of this failure class; ${residual.toLocaleString()} were not itemized in per-ICP results.`,
      statusCode: null,
      provider: null,
      endpoint: null,
      requestCommand: null,
      requestCommandSource: 'unavailable',
      requestFingerprint: bundleId,
      icpRef: null,
      candidateId,
      runId,
      count: residual,
      occurredAt,
    })
  }

  const bundleStatus = (stringOr(bundle.current_event_status) ?? '').toLowerCase()
  const bundleReason = stringOr(bundle.current_reason)
  if (bundleReason && /(?:fail|error|reject|block|cancel|timeout)/.test(bundleStatus)) {
    errors.push({
      id: `score-bundle:${bundleId}:status:${bundleStatus}`,
      source: 'score_bundle',
      title: `Score bundle ${readableDiagnosticKey(bundleStatus)}`,
      detail: redactDiagnosticText(bundleReason),
      statusCode: null,
      provider: null,
      endpoint: null,
      requestCommand: null,
      requestCommandSource: 'unavailable',
      requestFingerprint: bundleId,
      icpRef: null,
      candidateId,
      runId,
      count: 1,
      occurredAt,
    })
  }

  return errors
}

function parseCandidateArtifactDetail(row: Record<string, unknown>): AdminLabCandidateArtifactDetail {
  const hypothesis = objectRecord(row.hypothesis_doc) ?? {}
  const patchManifest = objectRecord(row.candidate_patch_manifest) ?? {}
  const patchDoc = objectRecord(patchManifest.patch_doc) ?? {}
  const build = objectRecord(row.candidate_build_doc) ?? {}
  const planAlignment = objectRecord(build.plan_alignment) ?? objectRecord(patchDoc.plan_alignment) ?? {}
  return {
    candidateKind: stringOr(row.candidate_kind) ?? stringOr(patchManifest.candidate_kind) ?? null,
    lane: stringOr(patchDoc.lane) ?? stringOr(planAlignment.detected_lane) ?? null,
    targetComponent: stringOr(patchManifest.target_component_id) ?? null,
    targetFiles: uniqueStrings([
      ...arrayOfStrings(patchDoc.target_files),
      ...arrayOfStrings(patchManifest.target_files),
    ]),
    changedFiles: arrayOfStrings(build.changed_files),
    mechanism: stringOr(hypothesis.mechanism) ?? stringOr(planAlignment.detected_mechanism) ?? null,
    expectedImprovement: summarizeArtifactValue(hypothesis.expected_improvement ?? patchDoc.expected_improvement),
    predictedDelta: finiteNumberOrNull(hypothesis.predicted_delta),
    failureMode: summarizeArtifactValue(hypothesis.failure_mode),
    falsifier: summarizeArtifactValue(hypothesis.falsifier),
    risk: summarizeArtifactValue(hypothesis.risk ?? patchDoc.risk),
    testPlan: summarizeArtifactValue(patchDoc.test_plan),
    rollbackPlan: summarizeArtifactValue(patchDoc.rollback_plan),
    validationResult: summarizeArtifactValue(patchManifest.validation_result),
    buildValidation: summarizeArtifactValue(build.build_validation),
    planVerdict: stringOr(planAlignment.verdict) ?? null,
    planReason: summarizeArtifactValue(planAlignment.reason ?? planAlignment.blocking_issue),
    planConfidence: finiteNumberOrNull(planAlignment.confidence),
    candidateGitCommitSha: stringOr(build.candidate_git_commit_sha) ?? stringOr(build.recorded_git_commit_sha) ?? null,
    parentGitCommitSha: stringOr(build.parent_git_commit_sha) ?? null,
    candidateArtifactHash: stringOr(row.candidate_artifact_hash) ?? stringOr(patchManifest.candidate_artifact_hash) ?? null,
    candidatePatchHash: stringOr(row.candidate_patch_hash) ?? stringOr(patchManifest.manifest_hash) ?? null,
    sourceDiffHash: stringOr(row.candidate_source_diff_hash) ?? stringOr(build.source_diff_hash) ?? null,
    modelManifestHash: stringOr(row.candidate_model_manifest_hash) ?? stringOr(patchManifest.candidate_model_manifest_hash) ?? null,
  }
}

function summarizeArtifactValue(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'string') return redactDiagnosticText(value)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) {
    const parts = value.map(summarizeArtifactValue).filter((item): item is string => Boolean(item))
    return parts.length > 0 ? parts.join(' · ').slice(0, 1_600) : null
  }
  const record = objectRecord(value)
  if (!record) return null
  const summary = stringOr(record.summary) ?? stringOr(record.detail) ?? stringOr(record.reason) ?? stringOr(record.message) ?? stringOr(record.status)
  if (summary) return redactDiagnosticText(summary)
  try {
    return redactDiagnosticText(JSON.stringify(record))
  } catch {
    return null
  }
}

function dedupeAdminErrors(errors: AdminLabErrorDetail[]): AdminLabErrorDetail[] {
  const byId = new Map<string, AdminLabErrorDetail>()
  for (const error of errors) {
    const current = byId.get(error.id)
    if (!current || timestampOrZero(error.occurredAt) > timestampOrZero(current.occurredAt)) {
      byId.set(error.id, error)
    }
  }
  return Array.from(byId.values()).sort((a, b) => timestampOrZero(b.occurredAt) - timestampOrZero(a.occurredAt))
}

function readableDiagnosticKey(value: string): string {
  const readable = value.replace(/[_-]+/g, ' ').trim()
  return readable ? readable.replace(/\b\w/g, (char) => char.toUpperCase()) : 'Unknown'
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

function telemetryStateForRun(
  loop: AdminLabLoopSummary,
  runId: string | null,
  candidates: Array<Record<string, unknown>>,
  bundles: Array<Record<string, unknown>>,
  dispatches: Array<Record<string, unknown>>,
): AdminLabTelemetryState {
  if ((runId ?? '') === (loop.runId ?? '')) return telemetryStateForLoop(loop)

  const operationalStatuses = [
    ...candidates.map((row) => stringOr(row.current_candidate_status)),
    ...bundles.map((row) => stringOr(row.current_event_status)),
    ...dispatches.map((row) => stringOr(row.dispatch_status)),
  ].filter(Boolean).map((value) => value!.toLowerCase())

  if (operationalStatuses.some((value) => /(?:^|_)(?:failed|error|cancelled|canceled)(?:$|_)/.test(value))) {
    return 'failed'
  }
  if (operationalStatuses.some((value) => /(?:^|_)(?:queued|started|running|processing|scoring|in_progress)(?:$|_)/.test(value))) {
    return 'active'
  }
  if (candidates.length > 0 || bundles.length > 0 || dispatches.length > 0) return 'completed'
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

async function fetchGatewayWorkflowControls(
  supabase: ReturnType<typeof getAdminSupabase>,
): Promise<AdminLabWorkflowControls> {
  const { rows, sourceAvailable, unavailableReason } = await fetchOptionalRows(
    supabase,
    'research_lab_gateway_control_current',
    10,
  )
  const rowFor = (controlKey: string) => rows.find(
    (row) => stringOr(row.control_key)?.toLowerCase() === controlKey,
  ) ?? null
  const missingReason = sourceAvailable
    ? 'No current gateway control row was returned.'
    : unavailableReason

  return {
    scoring: normalizeAdminLabGatewayControl(
      rowFor('scoring_maintenance'),
      missingReason,
    ),
    loops: normalizeAdminLabGatewayControl(
      rowFor('autoresearch_maintenance'),
      missingReason,
    ),
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
  control: AdminLabWorkflowControlSummary
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
  let source: AdminLabScoringSummary['source'] = control.source === 'gateway_control' ? 'explicit' : 'inferred'

  if (control.state === 'paused') {
    state = 'paused'
    label = 'Paused'
    detail = control.reason || 'Scoring is explicitly paused by gateway control.'
  } else if (staleRuns > 0) {
    state = 'stalled'
    label = 'Stalled'
    detail = `${staleRuns} active run${staleRuns === 1 ? '' : 's'} have not emitted progress recently.`
  } else if (activeRuns.length > 0 || metrics.scoreBundlesLastHour > 0) {
    state = 'active'
    label = 'Active'
    detail = `${activeRuns.length} active run${activeRuns.length === 1 ? '' : 's'} and ${metrics.scoreBundlesLastHour} scoring event${metrics.scoreBundlesLastHour === 1 ? '' : 's'} in the last hour.`
  } else if (control.state === 'unknown' && metrics.lastScoringAt === null) {
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
    paused: control.state === 'paused',
    pauseReason: control.reason,
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
  const [current, events, operations] = await Promise.all([
    fetchOptionalRows(supabase, 'ops_alert_current', 500),
    fetchOptionalRows(supabase, 'ops_alert_events', 500),
    fetchAlertOperationsSummary(supabase),
  ])
  const opsRows = current.sourceAvailable && current.rows.length > 0
    ? current.rows
    : events.sourceAvailable
      ? events.rows
      : []
  const publicSummary = await fetchPublicLogAlertSummary(
    supabase,
    current.unavailableReason ?? events.unavailableReason,
  )
  const summary = opsRows.length === 0
    ? publicSummary
    : publicSummary.sourceAvailable
      ? mergeBaseAlertSummaries(summarizeOpsAlerts(opsRows), publicSummary)
      : {
          ...summarizeOpsAlerts(opsRows),
          unavailableReason: publicSummary.unavailableReason,
        }
  return { ...summary, operations }
}

async function fetchAlertOperationsSummary(
  supabase: ReturnType<typeof getAdminSupabase>,
): Promise<AdminLabAlertOperationsSummary> {
  const [monitorResult, deliveryResult, registryResult] = await Promise.all([
    supabase
      .from('ops_alert_monitor_state')
      .select('*')
      .eq('monitor_id', ALERT_MONITOR_ID)
      .limit(1),
    supabase
      .from('ops_alert_delivery_events')
      .select('status,due_at,attempted_at,completed_at,created_at,error_detail,channel')
      .order('created_at', { ascending: false })
      .limit(1_000),
    supabase
      .from('ops_validator_registry')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(500),
  ])

  const sourceErrors = [
    monitorResult.error?.message,
    deliveryResult.error?.message,
    registryResult.error?.message,
  ].filter(Boolean)
  const sourceAvailable = sourceErrors.length === 0
  const monitor = ((monitorResult.data ?? []) as Array<Record<string, unknown>>)[0] ?? null
  const deliveries = (deliveryResult.data ?? []) as Array<Record<string, unknown>>
  const now = Date.now()
  const since24h = now - 24 * 60 * 60 * 1000
  const monitorEnabled = process.env.RESEARCH_LAB_ALERT_MONITOR_ENABLED === 'true'
  const monitorIntervalMs = alertMonitorIntervalMs(process.env.RESEARCH_LAB_ALERT_MONITOR_INTERVAL_MS)
  const validatorMap = new Map<string, AdminLabMonitoredValidator>()
  for (const row of (registryResult.data ?? []) as Array<Record<string, unknown>>) {
    const hotkey = stringOr(row.validator_hotkey)
    if (!hotkey) continue
    validatorMap.set(hotkey, {
      hotkey,
      label: stringOr(row.label) ?? null,
      source: 'database',
      enabled: booleanOr(row.enabled) ?? true,
      monitorPcr0: booleanOr(row.monitor_pcr0) ?? true,
      monitorOffchainWeights: booleanOr(row.monitor_offchain_weights) ?? true,
      monitorOnchainWeights: booleanOr(row.monitor_onchain_weights) ?? true,
      expectedPcr0: stringOr(row.expected_pcr0) ?? null,
      updatedAt: isoStringOr(row.updated_at) ?? null,
    })
  }
  for (const hotkey of configuredValidatorHotkeys()) {
    const existing = validatorMap.get(hotkey)
    validatorMap.set(hotkey, {
      hotkey,
      label: existing?.label ?? null,
      source: 'environment',
      enabled: true,
      monitorPcr0: true,
      monitorOffchainWeights: true,
      monitorOnchainWeights: true,
      expectedPcr0: existing?.expectedPcr0 ?? null,
      updatedAt: existing?.updatedAt ?? null,
    })
  }
  const validators = Array.from(validatorMap.values()).sort((left, right) =>
    Number(right.enabled) - Number(left.enabled) ||
      (left.label ?? left.hotkey).localeCompare(right.label ?? right.hotkey),
  )
  const monitoredValidatorCount = validators.filter((validator) => validator.enabled).length
  let emailConfigured = false
  let discordConfigured = false
  let deliveryConfigError: string | null = null
  try {
    const config = parseResearchLabAlertDeliveryConfig(getRuntimeSecretEnvironment())
    emailConfigured = Boolean(config.email)
    discordConfigured = Boolean(config.discord)
  } catch (error) {
    deliveryConfigError = error instanceof Error ? error.message : 'Alert delivery configuration is invalid.'
  }

  const lastStartedAt = stringOr(monitor?.last_started_at) ?? null
  const lastCompletedAt = stringOr(monitor?.last_completed_at) ?? null
  const lastErrorAt = stringOr(monitor?.last_error_at) ?? null
  const lastError = stringOr(monitor?.last_error) ?? null
  const heartbeatAgeMs = lastCompletedAt ? Math.max(0, now - timestampOrZero(lastCompletedAt)) : null
  const leaseExpiresAt = stringOr(monitor?.lease_expires_at)
  const leaseActive = Boolean(stringOr(monitor?.lease_owner) && timestampOrZero(leaseExpiresAt) > now)
  const pending = deliveries.filter((row) => stringOr(row.status) === 'pending')
  const overdue = pending.filter((row) => timestampOrZero(stringOr(row.due_at)) < now)
  const completedWithin24h = deliveries.filter((row) =>
    timestampOrZero(stringOr(row.completed_at) ?? stringOr(row.attempted_at) ?? stringOr(row.created_at)) >= since24h,
  )
  const succeededDeliveryCount24h = completedWithin24h.filter((row) => stringOr(row.status) === 'succeeded').length
  const failedDeliveryCount24h = completedWithin24h.filter((row) => stringOr(row.status) === 'failed').length
  const latestDeliveryAt = latestIso(...deliveries.map((row) =>
    stringOr(row.completed_at) ?? stringOr(row.attempted_at) ?? stringOr(row.created_at),
  )) ?? null
  const oldestPendingAt = earliestIso(...pending.map((row) => stringOr(row.due_at))) ?? null
  const deliveryReady = !deliveryConfigError && (emailConfigured || discordConfigured)
  const configurationBlockers: string[] = []
  if (!monitorEnabled) configurationBlockers.push('Background monitor is disabled')
  if (monitoredValidatorCount === 0) configurationBlockers.push('No validator hotkeys are registered')
  if (!deliveryReady) configurationBlockers.push(deliveryConfigError ?? 'No email or Discord destination is configured')
  if (!sourceAvailable) configurationBlockers.push('Durable alert operations tables are unavailable')

  const heartbeatCriticalMs = Math.max(10 * monitorIntervalMs, 10 * 60 * 1000)
  const heartbeatDegradedMs = Math.max(3 * monitorIntervalMs, 3 * 60 * 1000)
  const unresolvedMonitorError = Boolean(
    lastErrorAt && (!lastCompletedAt || timestampOrZero(lastErrorAt) > timestampOrZero(lastCompletedAt)),
  )
  let state: AdminHealthState = 'healthy'
  if (!sourceAvailable) state = 'unknown'
  else if (!monitorEnabled || monitoredValidatorCount === 0 || !deliveryReady) state = 'degraded'
  else if (heartbeatAgeMs === null || heartbeatAgeMs > heartbeatCriticalMs || unresolvedMonitorError) state = 'critical'
  else if (heartbeatAgeMs > heartbeatDegradedMs || overdue.length > 0 || failedDeliveryCount24h > 0) state = 'degraded'

  const channelLabel = [emailConfigured ? 'email' : null, discordConfigured ? 'Discord' : null]
    .filter(Boolean)
    .join(' + ')
  const detail = !sourceAvailable
    ? `Alert operations telemetry unavailable: ${sourceErrors.join('; ')}`
    : configurationBlockers.length > 0
      ? configurationBlockers.join('; ')
      : heartbeatAgeMs === null
        ? 'Monitor is configured but has never completed a heartbeat.'
        : `${channelLabel} paging ready; ${pending.length} pending, ${failedDeliveryCount24h} failed in 24h.`

  return {
    state,
    sourceAvailable,
    unavailableReason: sourceErrors.join('; ') || null,
    monitorEnabled,
    monitorIntervalMs,
    monitoredValidatorCount,
    validators,
    emailConfigured,
    discordConfigured,
    deliveryReady,
    configurationBlockers,
    lastStartedAt,
    lastCompletedAt,
    lastErrorAt,
    lastError,
    heartbeatAgeMs,
    leaseActive,
    pendingDeliveryCount: pending.length,
    overdueDeliveryCount: overdue.length,
    succeededDeliveryCount24h,
    failedDeliveryCount24h,
    latestDeliveryAt,
    oldestPendingAt,
    detail,
  }
}

function alertMonitorIntervalMs(value: string | undefined): number {
  const requested = Number(value)
  return Number.isFinite(requested)
    ? Math.min(15 * 60_000, Math.max(30_000, Math.trunc(requested)))
    : DEFAULT_ALERT_MONITOR_INTERVAL_MS
}

function mergeBaseAlertSummaries(
  ops: AdminLabAlertSummary,
  publicSummary: AdminLabAlertSummary,
): AdminLabAlertSummary {
  const byFingerprint = new Map<string, AdminLabAlert>()
  for (const alert of [...ops.recent, ...publicSummary.recent]) {
    const key = alert.fingerprint || alert.id
    const current = byFingerprint.get(key)
    byFingerprint.set(key, current ? mergeAdminAlert(current, alert) : alert)
  }
  const recent = Array.from(byFingerprint.values()).sort(
    (a, b) => alertSeverityRank(b.severity) - alertSeverityRank(a.severity) ||
      timestampOrZero(b.lastSeenAt ?? b.firstSeenAt) - timestampOrZero(a.lastSeenAt ?? a.firstSeenAt),
  )
  const criticalLast24h = recent.filter((alert) => alert.severity.toLowerCase() === 'critical').length
  const warningLast24h = recent.filter((alert) => ['warning', 'warn'].includes(alert.severity.toLowerCase())).length
  return {
    ...publicSummary,
    state: worstHealthState([ops.state, publicSummary.state]),
    source: 'combined',
    sourceAvailable: true,
    unavailableReason: null,
    totalLast24h: recent.reduce((sum, alert) => sum + Math.max(1, alert.count), 0),
    criticalLast24h,
    warningLast24h,
    activeCount: recent.filter((alert) => !['resolved', 'closed'].includes(alert.status.toLowerCase())).length,
    latestObservedAt: latestIso(ops.latestObservedAt, publicSummary.latestObservedAt) ?? null,
    recent: recent.slice(0, 24),
  }
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
    operations: emptyAlertOperationsSummary(),
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
  const auditEpochs = new Set(
    auditRows.flatMap((row) => [row.payload_epoch, row.payload_epoch_id]).filter(Boolean),
  )
  const missingAuditRows = weightRows.filter((row) =>
    Boolean(row.payload_epoch_id ?? row.payload_epoch) &&
      !auditEpochs.has(row.payload_epoch_id ?? row.payload_epoch),
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
    operations: emptyAlertOperationsSummary(),
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
    operations: emptyAlertOperationsSummary(),
    recent: [],
  }
}

function emptyAlertOperationsSummary(): AdminLabAlertOperationsSummary {
  return {
    state: 'unknown',
    sourceAvailable: false,
    unavailableReason: null,
    monitorEnabled: false,
    monitorIntervalMs: DEFAULT_ALERT_MONITOR_INTERVAL_MS,
    monitoredValidatorCount: 0,
    validators: [],
    emailConfigured: false,
    discordConfigured: false,
    deliveryReady: false,
    configurationBlockers: [],
    lastStartedAt: null,
    lastCompletedAt: null,
    lastErrorAt: null,
    lastError: null,
    heartbeatAgeMs: null,
    leaseActive: false,
    pendingDeliveryCount: 0,
    overdueDeliveryCount: 0,
    succeededDeliveryCount24h: 0,
    failedDeliveryCount24h: 0,
    latestDeliveryAt: null,
    oldestPendingAt: null,
    detail: 'Alert operations telemetry has not been loaded.',
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
    detail: stringOr(row.detail) ?? stringOr(row.description) ?? null,
    signal: stringOr(row.signal) ?? stringOr(row.alert_signal) ?? null,
    scope: stringOr(row.scope) ?? null,
    entityId: stringOr(row.entity_id) ?? null,
    validatorId: stringOr(row.validator_id) ?? null,
    ageBlocks: finiteNumberOrNull(row.age_blocks),
    sources: arrayOfStrings(row.sources),
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
  const [activeResult, latestVersionsResult, repoCommitsResult] = await Promise.all([
    supabase
      .from('research_lab_private_model_version_current')
      .select(
        'private_model_version_id,current_version_status,current_status_at,created_at,git_commit_sha,build_id,model_artifact_hash,private_model_manifest_hash,component_registry_version,scoring_adapter_version,redacted_version_doc',
      )
      .eq('current_version_status', 'active')
      .order('current_status_at', { ascending: false, nullsFirst: false })
      .limit(1),
    supabase
      .from('research_lab_private_model_version_current')
      .select('git_commit_sha,current_status_at,created_at,redacted_version_doc')
      .not('git_commit_sha', 'is', null)
      .order('created_at', { ascending: false, nullsFirst: false })
      .limit(20),
    supabase
      .from('research_lab_private_repo_commit_events')
      .select('git_commit_sha,commit_status,branch_name,created_at')
      .eq('commit_status', 'pushed')
      .not('git_commit_sha', 'is', null)
      .order('created_at', { ascending: false, nullsFirst: false })
      .limit(20),
  ])

  if (activeResult.error) {
    console.warn('[admin:research-lab] active sourcing model unavailable', activeResult.error.message)
    return emptySourcingModelSummary(false, activeResult.error.message)
  }

  const row = ((activeResult.data ?? []) as Array<Record<string, unknown>>)[0]
  if (!row) return emptySourcingModelSummary(true, null)

  const versionDoc = objectRecord(row.redacted_version_doc)
  const manifestWaitStatus = objectRecord(versionDoc?.manifest_wait_status)
  const gitCommitSha =
    stringOr(row.git_commit_sha) ??
    stringOr(versionDoc?.git_commit_sha) ??
    stringOr(versionDoc?.repo_main_sha) ??
    null
  const branch = stringOr(versionDoc?.repo_branch) ?? 'main'
  const activatedAt = isoStringOr(row.current_status_at) ?? isoStringOr(row.created_at) ?? null
  const comparisonErrors = [
    latestVersionsResult.error ? `model versions: ${latestVersionsResult.error.message}` : null,
    repoCommitsResult.error ? `repo commits: ${repoCommitsResult.error.message}` : null,
  ].filter((value): value is string => Boolean(value))
  if (comparisonErrors.length > 0) {
    console.warn('[admin:research-lab] sourcing model commit comparison incomplete', comparisonErrors.join('; '))
  }

  const observations: Array<{ sha: string; at: string | null; source: string }> = []
  const repoHeadAtActivation = stringOr(versionDoc?.repo_main_sha)
  if (repoHeadAtActivation) {
    observations.push({ sha: repoHeadAtActivation, at: activatedAt, source: 'repo_head_sync' })
  }

  for (const versionRow of (latestVersionsResult.data ?? []) as Array<Record<string, unknown>>) {
    const doc = objectRecord(versionRow.redacted_version_doc)
    const rowBranch = stringOr(doc?.repo_branch)
    if (rowBranch && rowBranch !== branch) continue
    const sha = stringOr(versionRow.git_commit_sha) ?? stringOr(doc?.repo_main_sha)
    if (!sha) continue
    observations.push({
      sha,
      at: isoStringOr(versionRow.created_at) ?? isoStringOr(versionRow.current_status_at) ?? null,
      source: 'model_version',
    })
  }

  for (const commitRow of (repoCommitsResult.data ?? []) as Array<Record<string, unknown>>) {
    const rowBranch = stringOr(commitRow.branch_name)
    if (rowBranch && rowBranch !== branch) continue
    const sha = stringOr(commitRow.git_commit_sha)
    if (!sha) continue
    observations.push({
      sha,
      at: isoStringOr(commitRow.created_at) ?? null,
      source: 'private_repo_push',
    })
  }

  observations.sort((a, b) => timestampOrZero(b.at) - timestampOrZero(a.at))
  const latestKnown = observations[0] ?? null
  const commitComparisonAvailable = !latestVersionsResult.error && !repoCommitsResult.error
  const commitFreshness: AdminLabSourcingModelSummary['commitFreshness'] =
    !gitCommitSha || !latestKnown
      ? 'unknown'
      : gitCommitSha.toLowerCase() !== latestKnown.sha.toLowerCase()
        ? 'behind'
        : commitComparisonAvailable
          ? 'latest'
          : 'unknown'

  return {
    sourceAvailable: true,
    unavailableReason: null,
    status: stringOr(row.current_version_status) ?? null,
    commitFreshness,
    commitComparisonAvailable,
    commitComparisonReason: comparisonErrors.length > 0 ? comparisonErrors.join('; ') : null,
    latestKnownCommitSha: latestKnown?.sha ?? null,
    latestKnownCommitAt: latestKnown?.at ?? null,
    latestKnownCommitSource: latestKnown?.source ?? null,
    comparisonBranch: branch,
    comparisonCheckedAt: new Date().toISOString(),
    versionId: stringOr(row.private_model_version_id) ?? null,
    gitCommitSha,
    imageRefHash:
      stringOr(versionDoc?.image_ref_hash) ??
      stringOr(manifestWaitStatus?.current_json_image_ref_hash) ??
      null,
    buildId: stringOr(row.build_id) ?? null,
    branch,
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
    activatedAt,
    repositoryUrl: SOURCING_MODEL_REPOSITORY_URL,
  }
}

async function fetchLeadpoetRepositorySummary(): Promise<AdminLabRepositorySummary> {
  const [repository, gateway] = await Promise.all([
    fetchLeadpoetRepositoryHead(),
    fetchGatewayDeployment({ gatewayUrl: LEADPOET_GATEWAY_URL }),
  ])
  const comparison = await fetchLeadpoetCommitComparison(
    gateway.commitSha,
    repository.commitSha,
  )

  return {
    ...repository,
    gatewaySourceAvailable: gateway.sourceAvailable,
    gatewayUnavailableReason: gateway.unavailableReason,
    gatewayCommitSha: gateway.commitSha,
    gatewayBranch: gateway.branch,
    gatewayBuildId: gateway.buildId,
    gatewayBuiltAt: gateway.builtAt,
    gatewayLoadedAt: gateway.loadedAt,
    gatewayCommitSource: gateway.commitSource,
    gatewayCheckedAt: gateway.checkedAt,
    commitFreshness: comparison.freshness,
    commitsBehind: comparison.commitsBehind,
  }
}

async function fetchLeadpoetCommitComparison(
  gatewayCommitSha: string | null,
  latestCommitSha: string | null,
): Promise<GatewayCommitComparison> {
  const fallback = parseGatewayCommitComparison(null, gatewayCommitSha, latestCommitSha)
  if (fallback.freshness === 'latest' || !gatewayCommitSha || !latestCommitSha) {
    return fallback
  }

  try {
    const response = await fetch(
      `${LEADPOET_REPOSITORY_COMPARE_API_URL}/${encodeURIComponent(gatewayCommitSha)}...${encodeURIComponent(latestCommitSha)}`,
      {
        headers: leadpoetGithubHeaders(),
        next: { revalidate: 300 },
        signal: AbortSignal.timeout(5_000),
      },
    )
    if (!response.ok) {
      throw new Error(`GitHub compare returned ${response.status}`)
    }
    return parseGatewayCommitComparison(
      await response.json(),
      gatewayCommitSha,
      latestCommitSha,
    )
  } catch (error) {
    console.warn(
      '[admin:research-lab] LeadPoet gateway commit distance unavailable',
      error instanceof Error ? error.message : 'GitHub compare failed',
    )
    return fallback
  }
}

async function fetchLeadpoetRepositoryHead() {
  const checkedAt = new Date().toISOString()
  try {
    const response = await fetch(LEADPOET_REPOSITORY_API_URL, {
      headers: leadpoetGithubHeaders(),
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(5_000),
    })
    if (!response.ok) {
      throw new Error(`GitHub returned ${response.status}`)
    }

    const payload = await response.json() as Record<string, unknown>
    const commit = objectRecord(payload.commit)
    const committer = objectRecord(commit?.committer)
    const author = objectRecord(payload.author)
    const commitSha = stringOr(payload.sha) ?? null
    const reportedCommitUrl = stringOr(payload.html_url)
    const commitUrl = reportedCommitUrl?.startsWith(`${LEADPOET_REPOSITORY_URL}/commit/`)
      ? reportedCommitUrl
      : commitSha
        ? `${LEADPOET_REPOSITORY_URL}/commit/${encodeURIComponent(commitSha)}`
        : null

    return {
      sourceAvailable: Boolean(commitSha),
      unavailableReason: commitSha ? null : 'GitHub did not return a commit SHA',
      owner: LEADPOET_REPOSITORY_OWNER,
      name: LEADPOET_REPOSITORY_NAME,
      branch: LEADPOET_REPOSITORY_BRANCH,
      repositoryUrl: LEADPOET_REPOSITORY_URL,
      commitSha,
      commitUrl,
      committedAt: isoStringOr(committer?.date) ?? null,
      commitMessage: stringOr(commit?.message)?.split('\n')[0] ?? null,
      authorLogin: stringOr(author?.login) ?? stringOr(committer?.name) ?? null,
      checkedAt,
    }
  } catch (error) {
    const unavailableReason = error instanceof Error ? error.message : 'GitHub lookup failed'
    console.warn('[admin:research-lab] LeadPoet repository unavailable', unavailableReason)
    return {
      sourceAvailable: false,
      unavailableReason,
      owner: LEADPOET_REPOSITORY_OWNER,
      name: LEADPOET_REPOSITORY_NAME,
      branch: LEADPOET_REPOSITORY_BRANCH,
      repositoryUrl: LEADPOET_REPOSITORY_URL,
      commitSha: null,
      commitUrl: null,
      committedAt: null,
      commitMessage: null,
      authorLogin: null,
      checkedAt,
    }
  }
}

function leadpoetGithubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'leadpoet-dashboard',
    'X-GitHub-Api-Version': '2022-11-28',
  }
  const githubToken = process.env.GITHUB_TOKEN?.trim()
  if (githubToken) headers.Authorization = `Bearer ${githubToken}`
  return headers
}

function emptySourcingModelSummary(
  sourceAvailable: boolean,
  unavailableReason: string | null,
): AdminLabSourcingModelSummary {
  return {
    sourceAvailable,
    unavailableReason,
    status: null,
    commitFreshness: 'unknown',
    commitComparisonAvailable: false,
    commitComparisonReason: unavailableReason,
    latestKnownCommitSha: null,
    latestKnownCommitAt: null,
    latestKnownCommitSource: null,
    comparisonBranch: null,
    comparisonCheckedAt: null,
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
    repositoryUrl: SOURCING_MODEL_REPOSITORY_URL,
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
  benchmark: AdminLabBenchmarkSummary
  alerts: AdminLabAlertSummary
  attestation: AdminLabAttestationSummary
}): AdminLabHealthSignal[] {
  return [
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
          ? `${input.alerts.verifiedEventCount} stored event-hash envelopes matched (${input.alerts.weightSubmissionCount} weights, ${input.alerts.epochAuditCount} audits); ${input.alerts.activeCount} derived issues. This is an integrity-link check, not signature verification.`
          : input.alerts.source === 'combined'
            ? `${input.alerts.activeCount} canonical or persisted issues across validator, benchmark, run, weight, PCR0, and transparency checks.`
          : `${input.alerts.criticalLast24h} critical, ${input.alerts.warningLast24h} warning, ${input.alerts.activeCount} active.`
        : 'No alert telemetry or public transparency log is readable.',
      updatedAt: input.alerts.latestObservedAt ?? input.alerts.recent[0]?.lastSeenAt,
    },
    {
      id: 'alert_delivery',
      label: 'Paging',
      value: !input.alerts.operations.monitorEnabled
        ? 'Disabled'
        : input.alerts.operations.state === 'healthy'
          ? 'Ready'
          : input.alerts.operations.deliveryReady
            ? 'Attention'
            : 'Not wired',
      state: input.alerts.operations.state,
      detail: input.alerts.operations.detail,
      updatedAt: input.alerts.operations.lastCompletedAt ?? input.alerts.operations.lastErrorAt,
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

function earliestIso(...values: Array<string | null | undefined>): string | undefined {
  let earliest: string | undefined
  for (const value of values) {
    if (!value) continue
    if (!earliest || timestampOrZero(value) < timestampOrZero(earliest)) earliest = value
  }
  return earliest
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

function phaseForRun(
  loop: AdminLabLoopSummary,
  runId: string | null,
  candidates: Array<Record<string, unknown>>,
  bundles: Array<Record<string, unknown>>,
  dispatches: Array<Record<string, unknown>>,
): string {
  if ((runId ?? '') === (loop.runId ?? '')) return phaseForLoop(loop)
  const state = telemetryStateForRun(loop, runId, candidates, bundles, dispatches)
  if (state === 'failed') return 'failed'
  if (state === 'completed') return 'complete'
  if (bundles.length > 0 || dispatches.length > 0) return 'scoring'
  if (candidates.length > 0) return 'candidate'
  return runId ? 'run activity' : 'ticket activity'
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
