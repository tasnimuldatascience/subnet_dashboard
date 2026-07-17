import type {
  ResearchLabBenchmarkCorrelation,
  ResearchLabScoringExecutionSummary,
} from './research-lab-scoring-telemetry'

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
  actorRef: string | null
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
  current_actor_ref?: unknown
  actor_ref?: unknown
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
      actorRef: null,
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
    actorRef:
      stringOrNull(row.current_actor_ref) ??
      stringOrNull(row.actor_ref),
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
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string' || value.trim() === '') return null
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

export type AdminLabScoreBundleIcpDiagnostic = {
  icpRef: string | null
  status: string | null
  failureReason: string | null
  failureClass: string | null
  failureClasses: string[]
}

export type AdminLabImprovementGatePolicy = {
  minDelta: number | null
  minDeltaLcb: number | null
  minCandidateScore: number | null
  minSuccessfulIcps: number | null
  maxHardFailures: number | null
  maxCostUsd: number | null
}

export type AdminLabImprovementGateDiagnostic = {
  decision: string | null
  reason: string | null
  blockers: string[]
  policy: AdminLabImprovementGatePolicy | null
  eligibleForProbation: boolean | null
  advisoryBasis: string | null
  referenceEvaluationMode: string | null
}

export type AdminLabPrivateHoldoutGateDiagnostic = {
  decision: string | null
  reason: string | null
  blockers: string[]
  gateType: string | null
  schemaVersion: string | null
  publicIcpCount: number | null
  privateHoldoutIcpCount: number | null
  privateHoldoutEvaluated: boolean | null
  candidatePublicScore: number | null
  baselinePublicScore: number | null
  candidateTotalScore: number | null
  baselinePrivateScore: number | null
  baselineAggregateScore: number | null
  pairedBasePublicScore: number | null
  pairedBaseTotalScore: number | null
  candidateDeltaVsDailyBaseline: number | null
  providerExcludedIcpIds: string[]
  baselineBenchmarkBundleId: string | null
  baselineBenchmarkHash: string | null
  referenceEvaluationMode: string | null
}

export type AdminLabScoringHealthDiagnostic = {
  healthStatus: string | null
  schemaVersion: string | null
  icpCount: number | null
  failureClassCounts: Record<string, number>
  providerErrorCount: number | null
  providerErrorRate: number | null
  timeoutCount: number | null
  timeoutRate: number | null
  invalidOutputCount: number | null
  invalidOutputRate: number | null
  skippedCandidateCount: number | null
  skippedCandidateRate: number | null
  candidateRuntimeFailureCount: number | null
  candidateRuntimeSuccessRate: number | null
  referenceRuntimeFailureCount: number | null
  referenceRuntimeSuccessRate: number | null
  candidateZeroCompanyCount: number | null
  candidateZeroCompanyRate: number | null
  referenceZeroCompanyCount: number | null
  referenceZeroCompanyRate: number | null
  sourcedZeroNoErrorCount: number | null
  sourcedZeroNoErrorRate: number | null
  providerExcludedIcpCount: number | null
  providerExcludedIcpRate: number | null
  providerCostCapBlockedIcpCount: number | null
  providerCostCapBlockedIcpRate: number | null
  providerCostTrackingFailedIcpCount: number | null
  providerCostTrackingFailedIcpRate: number | null
  publicHoldoutDecision: string | null
  baselineBundleId: string | null
  baselineBundleHash: string | null
}

export type AdminLabScoreBundleDiagnostics = {
  perIcpResults: AdminLabScoreBundleIcpDiagnostic[]
  improvementGate: AdminLabImprovementGateDiagnostic | null
  privateHoldoutGate: AdminLabPrivateHoldoutGateDiagnostic | null
  scoringHealth: AdminLabScoringHealthDiagnostic | null
}

/**
 * Normalize the diagnostic portions of a private score bundle into a stable UI
 * contract. Score bundles are persisted as JSON, so every value is treated as
 * untrusted and malformed or missing fields remain unknown (`null`) rather than
 * being reported as zero or false.
 */
export function parseAdminLabScoreBundleDiagnostics(
  value: unknown,
): AdminLabScoreBundleDiagnostics {
  const doc = recordOrNull(value)
  if (!doc) return emptyScoreBundleDiagnostics()

  const aggregates = recordOrNull(field(doc, 'aggregates'))
  const perIcpValue =
    field(aggregates, 'per_icp_results', 'perIcpResults') ??
    field(doc, 'per_icp_results', 'perIcpResults')
  const perIcpResults = Array.isArray(perIcpValue)
    ? perIcpValue
        .map(parseScoreBundleIcpDiagnostic)
        .filter((item): item is AdminLabScoreBundleIcpDiagnostic => item !== null)
    : []

  const improvementGate = parseImprovementGate(
    recordOrNull(field(doc, 'improvement_gate', 'improvementGate')),
  )
  const scoringHealthSource = recordOrNull(
    field(doc, 'scoring_health', 'scoringHealth'),
  )
  const scoringHealth = parseScoringHealth(scoringHealthSource)
  const nestedPrivateHoldout = recordOrNull(
    field(scoringHealthSource, 'private_holdout_gate', 'privateHoldoutGate'),
  )
  const rootPrivateHoldout = recordOrNull(
    field(doc, 'private_holdout_gate', 'privateHoldoutGate'),
  )
  const privateHoldoutGate = parsePrivateHoldoutGate(
    mergeRecords(nestedPrivateHoldout, rootPrivateHoldout),
  )

  return {
    perIcpResults,
    improvementGate,
    privateHoldoutGate,
    scoringHealth,
  }
}

function emptyScoreBundleDiagnostics(): AdminLabScoreBundleDiagnostics {
  return {
    perIcpResults: [],
    improvementGate: null,
    privateHoldoutGate: null,
    scoringHealth: null,
  }
}

function parseScoreBundleIcpDiagnostic(
  value: unknown,
): AdminLabScoreBundleIcpDiagnostic | null {
  const row = recordOrNull(value)
  if (!row) return null

  const icpRef = stringOrNull(field(row, 'icp_ref', 'icpRef'))
  const status = stringOrNull(field(row, 'status'))
  const failureReason = stringOrNull(field(row, 'failure_reason', 'failureReason'))
  const explicitFailureClasses = uniqueStringsFromUnknown(
    field(row, 'failure_classes', 'failureClasses') ??
      field(row, 'failure_class', 'failureClass'),
    true,
  )
  const reasonFailureClasses = failureClassesFromReason(failureReason)
  const failureClasses = uniqueStrings([
    ...explicitFailureClasses,
    ...reasonFailureClasses,
  ])

  if (!icpRef && !status && !failureReason && failureClasses.length === 0) {
    return null
  }

  return {
    icpRef,
    status,
    failureReason,
    failureClass: failureClasses[0] ?? null,
    failureClasses,
  }
}

function parseImprovementGate(
  gate: Record<string, unknown> | null,
): AdminLabImprovementGateDiagnostic | null {
  if (!gate) return null

  const policy = parseImprovementGatePolicy(
    recordOrNull(field(gate, 'policy')),
  )
  const result: AdminLabImprovementGateDiagnostic = {
    decision: stringOrNull(field(gate, 'decision')),
    reason: stringOrNull(field(gate, 'reason')),
    blockers: uniqueStringsFromUnknown(field(gate, 'blockers')),
    policy,
    eligibleForProbation: booleanOrNull(
      field(gate, 'eligible_for_probation', 'eligibleForProbation'),
    ),
    advisoryBasis: stringOrNull(field(gate, 'advisory_basis', 'advisoryBasis')),
    referenceEvaluationMode: stringOrNull(
      field(gate, 'reference_evaluation_mode', 'referenceEvaluationMode'),
    ),
  }

  return hasImprovementGateData(result) ? result : null
}

function parseImprovementGatePolicy(
  policy: Record<string, unknown> | null,
): AdminLabImprovementGatePolicy | null {
  if (!policy) return null

  const result: AdminLabImprovementGatePolicy = {
    minDelta: finiteNumberOrNull(field(policy, 'min_delta', 'minDelta')),
    minDeltaLcb: finiteNumberOrNull(field(policy, 'min_delta_lcb', 'minDeltaLcb')),
    minCandidateScore: finiteNumberOrNull(
      field(policy, 'min_candidate_score', 'minCandidateScore'),
    ),
    minSuccessfulIcps: nonNegativeIntegerOrNull(
      field(policy, 'min_successful_icps', 'minSuccessfulIcps'),
    ),
    maxHardFailures: nonNegativeIntegerOrNull(
      field(policy, 'max_hard_failures', 'maxHardFailures'),
    ),
    maxCostUsd: finiteNumberOrNull(field(policy, 'max_cost_usd', 'maxCostUsd')),
  }

  return Object.values(result).some((item) => item !== null) ? result : null
}

function parsePrivateHoldoutGate(
  gate: Record<string, unknown> | null,
): AdminLabPrivateHoldoutGateDiagnostic | null {
  if (!gate) return null

  const result: AdminLabPrivateHoldoutGateDiagnostic = {
    decision: stringOrNull(field(gate, 'decision')),
    reason: stringOrNull(field(gate, 'reason')),
    blockers: uniqueStringsFromUnknown(field(gate, 'blockers')),
    gateType: stringOrNull(field(gate, 'gate_type', 'gateType')),
    schemaVersion: stringOrNull(field(gate, 'schema_version', 'schemaVersion')),
    publicIcpCount: nonNegativeIntegerOrNull(
      field(gate, 'public_icp_count', 'publicIcpCount'),
    ),
    privateHoldoutIcpCount: nonNegativeIntegerOrNull(
      field(gate, 'private_holdout_icp_count', 'privateHoldoutIcpCount'),
    ),
    privateHoldoutEvaluated: booleanOrNull(
      field(gate, 'private_holdout_evaluated', 'privateHoldoutEvaluated'),
    ),
    candidatePublicScore: finiteNumberOrNull(
      field(gate, 'candidate_public_score', 'candidatePublicScore'),
    ),
    baselinePublicScore: finiteNumberOrNull(
      field(gate, 'baseline_public_score', 'baselinePublicScore'),
    ),
    candidateTotalScore: finiteNumberOrNull(
      field(gate, 'candidate_total_score', 'candidateTotalScore'),
    ),
    baselinePrivateScore: finiteNumberOrNull(
      field(gate, 'baseline_private_score', 'baselinePrivateScore'),
    ),
    baselineAggregateScore: finiteNumberOrNull(
      field(gate, 'baseline_aggregate_score', 'baselineAggregateScore'),
    ),
    pairedBasePublicScore: finiteNumberOrNull(
      field(gate, 'paired_base_public_score', 'pairedBasePublicScore'),
    ),
    pairedBaseTotalScore: finiteNumberOrNull(
      field(gate, 'paired_base_total_score', 'pairedBaseTotalScore'),
    ),
    candidateDeltaVsDailyBaseline: finiteNumberOrNull(
      field(
        gate,
        'candidate_delta_vs_daily_baseline',
        'candidateDeltaVsDailyBaseline',
      ),
    ),
    providerExcludedIcpIds: uniqueStringsFromUnknown(
      field(gate, 'provider_excluded_icp_ids', 'providerExcludedIcpIds'),
    ),
    baselineBenchmarkBundleId: stringOrNull(
      field(gate, 'baseline_benchmark_bundle_id', 'baselineBenchmarkBundleId'),
    ),
    baselineBenchmarkHash: stringOrNull(
      field(gate, 'baseline_benchmark_hash', 'baselineBenchmarkHash'),
    ),
    referenceEvaluationMode: stringOrNull(
      field(gate, 'reference_evaluation_mode', 'referenceEvaluationMode'),
    ),
  }

  return hasPrivateHoldoutGateData(result) ? result : null
}

function parseScoringHealth(
  health: Record<string, unknown> | null,
): AdminLabScoringHealthDiagnostic | null {
  if (!health) return null

  const result: AdminLabScoringHealthDiagnostic = {
    healthStatus: stringOrNull(field(health, 'health_status', 'healthStatus')),
    schemaVersion: stringOrNull(field(health, 'schema_version', 'schemaVersion')),
    icpCount: nonNegativeIntegerOrNull(field(health, 'icp_count', 'icpCount')),
    failureClassCounts: countRecord(
      field(health, 'failure_class_counts', 'failureClassCounts'),
    ),
    providerErrorCount: nonNegativeIntegerOrNull(
      field(health, 'provider_error_count', 'providerErrorCount'),
    ),
    providerErrorRate: finiteNumberOrNull(
      field(health, 'provider_error_rate', 'providerErrorRate'),
    ),
    timeoutCount: nonNegativeIntegerOrNull(
      field(health, 'timeout_count', 'timeoutCount'),
    ),
    timeoutRate: finiteNumberOrNull(field(health, 'timeout_rate', 'timeoutRate')),
    invalidOutputCount: nonNegativeIntegerOrNull(
      field(health, 'invalid_output_count', 'invalidOutputCount'),
    ),
    invalidOutputRate: finiteNumberOrNull(
      field(health, 'invalid_output_rate', 'invalidOutputRate'),
    ),
    skippedCandidateCount: nonNegativeIntegerOrNull(
      field(health, 'skipped_candidate_count', 'skippedCandidateCount'),
    ),
    skippedCandidateRate: finiteNumberOrNull(
      field(health, 'skipped_candidate_rate', 'skippedCandidateRate'),
    ),
    candidateRuntimeFailureCount: nonNegativeIntegerOrNull(
      field(
        health,
        'candidate_runtime_failure_count',
        'candidateRuntimeFailureCount',
      ),
    ),
    candidateRuntimeSuccessRate: finiteNumberOrNull(
      field(
        health,
        'candidate_runtime_success_rate',
        'candidateRuntimeSuccessRate',
      ),
    ),
    referenceRuntimeFailureCount: nonNegativeIntegerOrNull(
      field(
        health,
        'reference_runtime_failure_count',
        'referenceRuntimeFailureCount',
      ),
    ),
    referenceRuntimeSuccessRate: finiteNumberOrNull(
      field(
        health,
        'reference_runtime_success_rate',
        'referenceRuntimeSuccessRate',
      ),
    ),
    candidateZeroCompanyCount: nonNegativeIntegerOrNull(
      field(
        health,
        'candidate_zero_company_count',
        'candidateZeroCompanyCount',
      ),
    ),
    candidateZeroCompanyRate: finiteNumberOrNull(
      field(health, 'candidate_zero_company_rate', 'candidateZeroCompanyRate'),
    ),
    referenceZeroCompanyCount: nonNegativeIntegerOrNull(
      field(
        health,
        'reference_zero_company_count',
        'referenceZeroCompanyCount',
      ),
    ),
    referenceZeroCompanyRate: finiteNumberOrNull(
      field(health, 'reference_zero_company_rate', 'referenceZeroCompanyRate'),
    ),
    sourcedZeroNoErrorCount: nonNegativeIntegerOrNull(
      field(health, 'sourced_zero_no_error_count', 'sourcedZeroNoErrorCount'),
    ),
    sourcedZeroNoErrorRate: finiteNumberOrNull(
      field(health, 'sourced_zero_no_error_rate', 'sourcedZeroNoErrorRate'),
    ),
    providerExcludedIcpCount: nonNegativeIntegerOrNull(
      field(health, 'provider_excluded_icp_count', 'providerExcludedIcpCount'),
    ),
    providerExcludedIcpRate: finiteNumberOrNull(
      field(health, 'provider_excluded_icp_rate', 'providerExcludedIcpRate'),
    ),
    providerCostCapBlockedIcpCount: nonNegativeIntegerOrNull(
      field(
        health,
        'provider_cost_cap_blocked_icp_count',
        'providerCostCapBlockedIcpCount',
      ),
    ),
    providerCostCapBlockedIcpRate: finiteNumberOrNull(
      field(
        health,
        'provider_cost_cap_blocked_icp_rate',
        'providerCostCapBlockedIcpRate',
      ),
    ),
    providerCostTrackingFailedIcpCount: nonNegativeIntegerOrNull(
      field(
        health,
        'provider_cost_tracking_failed_icp_count',
        'providerCostTrackingFailedIcpCount',
      ),
    ),
    providerCostTrackingFailedIcpRate: finiteNumberOrNull(
      field(
        health,
        'provider_cost_tracking_failed_icp_rate',
        'providerCostTrackingFailedIcpRate',
      ),
    ),
    publicHoldoutDecision: stringOrNull(
      field(health, 'public_holdout_decision', 'publicHoldoutDecision'),
    ),
    baselineBundleId: stringOrNull(
      field(health, 'baseline_bundle_id', 'baselineBundleId'),
    ),
    baselineBundleHash: stringOrNull(
      field(health, 'baseline_bundle_hash', 'baselineBundleHash'),
    ),
  }

  return hasScoringHealthData(result) ? result : null
}

function hasImprovementGateData(value: AdminLabImprovementGateDiagnostic): boolean {
  return (
    value.decision !== null ||
    value.reason !== null ||
    value.blockers.length > 0 ||
    value.policy !== null ||
    value.eligibleForProbation !== null ||
    value.advisoryBasis !== null ||
    value.referenceEvaluationMode !== null
  )
}

function hasPrivateHoldoutGateData(
  value: AdminLabPrivateHoldoutGateDiagnostic,
): boolean {
  return Object.entries(value).some(([, item]) =>
    Array.isArray(item) ? item.length > 0 : item !== null,
  )
}

function hasScoringHealthData(value: AdminLabScoringHealthDiagnostic): boolean {
  return Object.entries(value).some(([key, item]) =>
    key === 'failureClassCounts'
      ? Object.keys(value.failureClassCounts).length > 0
      : item !== null,
  )
}

function recordOrNull(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function mergeRecords(
  fallback: Record<string, unknown> | null,
  primary: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!fallback) return primary
  if (!primary) return fallback
  const presentPrimaryFields = Object.fromEntries(
    Object.entries(primary).filter(([, value]) => value !== null && value !== undefined),
  )
  return { ...fallback, ...presentPrimaryFields }
}

function field(
  record: Record<string, unknown> | null,
  ...keys: string[]
): unknown {
  if (!record) return undefined
  for (const key of keys) {
    const value = record[key]
    if (value !== null && value !== undefined) return value
  }
  return undefined
}

function booleanOrNull(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true') return true
    if (normalized === 'false') return false
  }
  return null
}

function nonNegativeIntegerOrNull(value: unknown): number | null {
  const number = finiteNumberOrNull(value)
  return number !== null && Number.isInteger(number) && number >= 0 ? number : null
}

function uniqueStringsFromUnknown(value: unknown, split = false): string[] {
  const values = Array.isArray(value) ? value : [value]
  const normalized = values.flatMap((item) => {
    const text = stringOrNull(item)
    if (!text) return []
    return split ? text.split(/[;,]/).map((part) => part.trim()) : [text]
  })
  return uniqueStrings(normalized)
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}

function failureClassesFromReason(reason: string | null): string[] {
  if (!reason) return []
  return uniqueStrings(
    reason
      .split(';')
      .map((item) => item.trim())
      .filter((item) => /^[a-z0-9]+(?:[._:-][a-z0-9]+)*$/i.test(item)),
  )
}

function countRecord(value: unknown): Record<string, number> {
  const record = recordOrNull(value)
  if (!record) return {}
  return Object.fromEntries(
    Object.entries(record).flatMap(([key, item]) => {
      const normalizedKey = key.trim()
      const count = nonNegativeIntegerOrNull(item)
      return normalizedKey && count !== null ? [[normalizedKey, count]] : []
    }),
  )
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
  publicationStatus: string
  executionStatus: string | null
  correlation: ResearchLabBenchmarkCorrelation
  telemetryMode: ResearchLabScoringExecutionSummary['telemetryMode']
  telemetryDegraded: boolean
  scoringId: string | null
  scoringRunId: string | null
  publishedBenchmarkBundleId: string | null
  executionBenchmarkBundleId: string | null
  reportId: string | null
  benchmarkDate: string | null
  attempt: number | null
  rollingWindowHash: string | null
  workerRef: string | null
  startedAt: string | null
  lastActivityAt: string | null
  completedAt: string | null
  durationSeconds: number | null
  icpsTotal: number | null
  icpsProcessed: number | null
  icpsRemaining: number | null
  completedIcpCount: number | null
  skippedIcpCount: number | null
  failedIcpCount: number | null
  cancelledIcpCount: number | null
  progressPercent: number | null
  publishedScore: number | null
  spendUsd: number | null
  budgetUsd: number | null
  providerEventCount: number
  companyCount: number
  errorCount: number
  icps: AdminLabIcpDetail[]
  errors: AdminLabErrorDetail[]
}

export type AdminLabBenchmarkRunSummary = {
  scoringId: string
  scoringRunId: string
  benchmarkDate: string | null
  runAttempt: number
  publicationStatus: string
  executionStatus: string | null
  correlation: ResearchLabBenchmarkCorrelation
  benchmarkBundleId: string | null
  reportId: string | null
  canonicalPublishedScore: number | null
  expectedUnits: number | null
  resolvedUnits: number | null
  completedUnits: number | null
  skippedUnits: number | null
  failedUnits: number | null
  cancelledUnits: number | null
  progressPercent: number | null
  spendUsd: number | null
  capUsd: number | null
  failureCategory: string | null
  retryable: boolean | null
  telemetryMode: ResearchLabScoringExecutionSummary['telemetryMode']
  telemetryDegraded: boolean
  workerRef: string | null
  startedAt: string | null
  completedAt: string | null
  durationSeconds: number | null
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
  execution: ResearchLabScoringExecutionSummary | null
  diagnostics: AdminLabScoreBundleDiagnostics
  artifact: AdminLabCandidateArtifactDetail
  icps: AdminLabIcpDetail[]
  errors: AdminLabErrorDetail[]
}

export type AdminLabCandidateArtifactDetail = {
  candidateKind: string | null
  lane: string | null
  targetComponent: string | null
  targetFiles: string[]
  changedFiles: string[]
  mechanism: string | null
  expectedImprovement: string | null
  predictedDelta: number | null
  failureMode: string | null
  falsifier: string | null
  risk: string | null
  testPlan: string | null
  rollbackPlan: string | null
  validationResult: string | null
  buildValidation: string | null
  planVerdict: string | null
  planReason: string | null
  planConfidence: number | null
  candidateGitCommitSha: string | null
  parentGitCommitSha: string | null
  candidateArtifactHash: string | null
  candidatePatchHash: string | null
  sourceDiffHash: string | null
  modelManifestHash: string | null
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
  scoringExecutions: ResearchLabScoringExecutionSummary[]
  candidates: AdminLabCandidateRunDetail[]
  errors: AdminLabErrorDetail[]
  fetchedAt: string
}
