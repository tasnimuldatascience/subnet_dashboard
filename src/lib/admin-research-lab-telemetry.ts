export type AdminLabTelemetryState =
  | 'active'
  | 'completed'
  | 'failed'
  | 'stalled'
  | 'idle'
  | 'unknown'

export type AdminLabWorkflowControlState = 'active' | 'paused' | 'unknown'

export type AdminLabWorkflowControlSummary = {
  state: AdminLabWorkflowControlState
  label: 'Active' | 'Paused' | 'Unknown'
  source: 'gateway_control' | 'missing'
  reason: string | null
  updatedAt: string | null
}

export type AdminLabGatewayControlInput = {
  current_event_type?: unknown
  event_type?: unknown
  current_control_status?: unknown
  control_status?: unknown
  current_reason?: unknown
  reason?: unknown
  status_detail?: unknown
  current_status_at?: unknown
  status_at?: unknown
  updated_at?: unknown
  created_at?: unknown
}

/**
 * Translate a gateway maintenance-control row into the workflow state an
 * operator cares about. An active maintenance control pauses its workflow;
 * an inactive maintenance control means that workflow is active.
 */
export function normalizeAdminLabGatewayControl(
  row: AdminLabGatewayControlInput | null,
  unavailableReason: string | null = null,
): AdminLabWorkflowControlSummary {
  if (!row) {
    return {
      state: 'unknown',
      label: 'Unknown',
      source: 'missing',
      reason: unavailableReason,
      updatedAt: null,
    }
  }

  const eventType = (
    stringOrNull(row.current_event_type) ??
    stringOrNull(row.event_type) ??
    ''
  ).toLowerCase()
  const controlStatus = (
    stringOrNull(row.current_control_status) ??
    stringOrNull(row.control_status) ??
    ''
  ).toLowerCase()
  const paused = eventType.includes('resume') || eventType.includes('unpause')
    ? false
    : eventType.includes('pause')
      ? true
      : controlStatus === 'active'
        ? true
        : controlStatus === 'inactive'
          ? false
          : null
  const state: AdminLabWorkflowControlState = paused === null
    ? 'unknown'
    : paused
      ? 'paused'
      : 'active'

  return {
    state,
    label: state === 'paused' ? 'Paused' : state === 'active' ? 'Active' : 'Unknown',
    source: 'gateway_control',
    reason:
      stringOrNull(row.current_reason) ??
      stringOrNull(row.reason) ??
      stringOrNull(row.status_detail),
    updatedAt:
      isoStringOrNull(row.current_status_at) ??
      isoStringOrNull(row.status_at) ??
      isoStringOrNull(row.updated_at) ??
      isoStringOrNull(row.created_at),
  }
}

export type AdminLabCompanyDetail = {
  id: string
  name: string
  website: string | null
  linkedin: string | null
  finalScore: number | null
  modelSide: string | null
  fitPassed: boolean | null
  intentPassed: boolean | null
  intentScore: number | null
  intentClaimedSignal: string | null
  intentSource: string | null
  intentEvidenceUrl: string | null
  intentEvidenceDate: string | null
  failureReason: string | null
  industry: string | null
  country: string | null
  capturedAt: string | null
}

export type AdminLabCompanyIntentTelemetryInput = {
  intent_signal?: unknown
  intent_claimed_signal?: unknown
  intent_source?: unknown
  intent_evidence_url?: unknown
  intent_evidence_date?: unknown
}

export function normalizeAdminLabCompanyIntent(
  row: AdminLabCompanyIntentTelemetryInput,
): Pick<
  AdminLabCompanyDetail,
  | 'intentScore'
  | 'intentClaimedSignal'
  | 'intentSource'
  | 'intentEvidenceUrl'
  | 'intentEvidenceDate'
> {
  return {
    intentScore: finiteNumberOrNull(row.intent_signal),
    intentClaimedSignal: stringOrNull(row.intent_claimed_signal),
    intentSource: stringOrNull(row.intent_source),
    intentEvidenceUrl: stringOrNull(row.intent_evidence_url),
    intentEvidenceDate: stringOrNull(row.intent_evidence_date),
  }
}

function finiteNumberOrNull(value: unknown): number | null {
  if (typeof value === 'string' && value.trim() === '') return null
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function isoStringOrNull(value: unknown): string | null {
  const text = stringOrNull(value)
  if (!text) return null
  return Number.isFinite(new Date(text).getTime()) ? text : null
}

export type AdminLabErrorDetail = {
  id: string
  source: 'provider' | 'dispatch' | 'candidate' | 'score_bundle'
  title: string
  detail: string | null
  statusCode: number | null
  provider: string | null
  endpoint: string | null
  requestCommand: string | null
  requestCommandSource: 'recorded' | 'endpoint_only' | 'unavailable'
  requestFingerprint: string | null
  icpRef: string | null
  candidateId: string | null
  runId: string | null
  count: number
  occurredAt: string | null
}

export type AdminLabFunnelDetail = {
  sourced: number
  fitPass: number
  verified: number
  intentValid: number
  scored: number
}

export type AdminLabIntentSignalDetail = {
  text: string
  category: string | null
  maxAgeDays: number | null
  primary: boolean
}

export type AdminLabIcpDetail = {
  icpRef: string
  icpHash: string | null
  label: string
  industry: string | null
  subIndustry: string | null
  status: string
  score: number | null
  baseScore: number | null
  delta: number | null
  spendUsd: number
  budgetUsd: number | null
  providerEventCount: number
  errorCount: number
  runtimeStartedAt: string | null
  runtimeEndedAt: string | null
  lastActivityAt: string | null
  runtimeMs: number | null
  isInProgress: boolean
  failureReason: string | null
  hardFailure: boolean
  funnel: AdminLabFunnelDetail | null
  intentSignals: AdminLabIntentSignalDetail[]
  companyScoreCount: number
  companies: AdminLabCompanyDetail[]
}

export type AdminLabDailyBenchmark = {
  state: AdminLabTelemetryState
  stateLabel: string
  detail: string
  benchmarkDate: string | null
  attempt: number | null
  rollingWindowHash: string | null
  workerRef: string | null
  startedAt: string | null
  lastActivityAt: string | null
  completedAt: string | null
  icpsTotal: number
  icpsProcessed: number
  icpsRemaining: number
  progressPercent: number
  provisionalScore: number | null
  completedAverageScore: number | null
  spendUsd: number
  budgetUsd: number | null
  providerEventCount: number
  companyCount: number
  errorCount: number
  icps: AdminLabIcpDetail[]
  errors: AdminLabErrorDetail[]
}

export type AdminLabChampionSummary = {
  championRewardId: string
  candidateId: string
  ticketId: string | null
  runId: string | null
  scoreBundleId: string
  minerHotkey: string
  status: string
  reason: string | null
  promotedAt: string | null
  improvementPoints: number | null
  thresholdPoints: number | null
  candidateScore: number | null
  baseScore: number | null
  meanDelta: number | null
  deltaLcb: number | null
  spendUsd: number
  budgetUsd: number | null
  icpCount: number
  successfulIcpCount: number
  companyCount: number
  errorCount: number
  icps: AdminLabIcpDetail[]
  errors: AdminLabErrorDetail[]
}

export type AdminLabCandidateRunDetail = {
  candidateId: string
  status: string
  reason: string | null
  summary: string | null
  scoreBundleId: string | null
  createdAt: string | null
  statusAt: string | null
  candidateScore: number | null
  baseScore: number | null
  meanDelta: number | null
  deltaLcb: number | null
  spendUsd: number
  budgetUsd: number | null
  providerEventCount: number
  companyCount: number
  errorCount: number
  icps: AdminLabIcpDetail[]
  errors: AdminLabErrorDetail[]
}

export type AdminLabRunDetail = {
  ticketId: string
  runId: string | null
  state: AdminLabTelemetryState
  phase: string
  totalSpendUsd: number
  totalBudgetUsd: number | null
  providerEventCount: number
  companyCount: number
  errorCount: number
  candidates: AdminLabCandidateRunDetail[]
  errors: AdminLabErrorDetail[]
  fetchedAt: string
}
