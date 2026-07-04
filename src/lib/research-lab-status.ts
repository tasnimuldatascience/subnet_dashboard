export type ResearchLabLoopStatusTone = 'info' | 'warning' | 'error'

export type ResearchLabLoopStatusNote = {
  tone: ResearchLabLoopStatusTone
  label: string
  detail: string
}

export type ResearchLabLoopStatusInput = {
  publicStatus?: string | null
  paymentState?: string | null
  executionState?: string | null
  candidateState?: string | null
  resultState?: string | null
  opsReason?: string | null
  statusDetail?: string | null
  opsWarnings?: unknown
  outcomeLabel?: string | null
  outcomeBand?: string | null
  runId?: string | null
  receiptId?: string | null
  candidateCount?: number | null
  scoredCandidateCount?: number | null
  candidateStatus?: string | null
  currentCandidateStatus?: string | null
  reason?: string | null
  currentReason?: string | null
  queueStatus?: string | null
  currentQueueStatus?: string | null
  receiptStatus?: string | null
  currentReceiptStatus?: string | null
  currentStatus?: string | null
  improvementGateDecision?: string | null
  promotionStatus?: string | null
  promotionEventType?: string | null
  promotionEvent?: string | null
  eventType?: string | null
}

export type ResearchLabLoopStatus = {
  key: string
  label: string
  band: string
  note?: ResearchLabLoopStatusNote
  action?: ResearchLabLoopStatusNote
  active: boolean
  scoring: boolean
  completed: boolean
  scored: boolean
  promising: boolean
  noGainOrFailed: boolean
  pendingOrBlocking: boolean
}

export type ResearchLabActivityFilterInput = {
  minerHotkey?: string | null
  topicSignatureHash?: string | null
  topicTags?: string[] | null
  researchArea?: string | null
  outcomeLabel?: string | null
  outcomeBand?: string | null
  statusKey?: string | null
  statusLabel?: string | null
  statusNote?: ResearchLabLoopStatusNote | null
  actionNote?: ResearchLabLoopStatusNote | null
  opsWarnings?: string[] | null
  lastActivityAt?: string | null
}

export type ResearchLabActivityFilters = {
  minerQuery?: string
  direction?: string
  status?: string
  outcome?: string
}

export type ResearchLabStatusFilterOption = {
  value: string
  label: string
  count?: number
}

export type ResearchLabOutcomeFilterOption = ResearchLabStatusFilterOption

const FAILED_VALUES = new Set([
  'failed',
  'failure',
  'error',
  'errored',
  'cancelled',
  'canceled',
  'timeout',
  'timed_out',
])

const ACTIVE_VALUES = new Set([
  'queued',
  'assigned',
  'running',
  'scoring',
  'evaluating',
  'evaluation_running',
  'in_progress',
  'processing',
  'started',
])

const NOT_STARTED_VALUES = new Set([
  'not_started',
  'not started',
  'pending_start',
  'pending_worker',
  'worker_not_started',
  'no_worker_run',
  'awaiting_worker',
])

const PAID_VALUES = new Set([
  'paid',
  'payment_received',
  'confirmed',
  'settled',
  'credited',
  'receipt_found',
])

const NO_PAYMENT_VALUES = new Set([
  'no_payment',
  'not_paid',
  'unpaid',
  'awaiting_payment',
  'payment_missing',
  'no_receipt',
])

const CREDIT_BLOCK_VALUES = new Set([
  'blocked_for_credit',
  'waiting_for_credits',
  'waiting_for_credit',
  'openrouter_402',
  'insufficient_credits',
  'insufficient_credit',
  'credit_exhausted',
  'credits_exhausted',
  'resumable_credit_issue',
])

const REBASE_UNAVAILABLE_VALUES = new Set([
  'rebase_unavailable',
  'stale_parent_rebase_unavailable',
  'parent_rebase_unavailable',
])

const SCORED_NO_GAIN_VALUES = new Set([
  'scored_no_gain',
  'no_gain',
  'promotion_checked',
  'public_holdout_rejected',
  'holdout_rejected',
  'promotion_rejected',
])
const PROMOTED_VALUES = new Set(['promoted'])
const COMPLETED_NO_CANDIDATE_VALUES = new Set(['completed_no_candidate'])
const NO_PROMOTION_VALUES = new Set([
  'below_threshold',
  'not_eligible',
  'rejected',
  'promotion_checked',
  'public_holdout_rejected',
  'holdout_rejected',
  'promotion_rejected',
])
const PASSED_THRESHOLD_BANDS = new Set(['passed_threshold', 'promoted', 'high_gain', 'winner'])
const PROMOTION_PASS_VALUES = new Set([
  'promotion_passed',
  'active_version_created',
  'champion_reward_created',
  'merged',
  'reward_created',
  'promoted',
  'winner',
  'high_gain',
])
const SCORED_PROMISING_VALUES = new Set([
  'scored_promising',
  'promotion_passed',
  'active_version_created',
  'champion_reward_created',
  'merged',
  'reward_created',
  'promoted',
  'winner',
  'high_gain',
])

const SCORING_VALUES = new Set([
  'assigned',
  'running',
  'scoring',
  'evaluating',
  'evaluation_running',
  'processing',
])

const BASELINE_NOT_READY_VALUES = new Set([
  'baseline_not_ready',
  'benchmark_baseline_not_ready',
  'parent_baseline_not_ready',
  'waiting_for_baseline',
])

const ACTIVE_STATUS_KEYS = new Set(['queued', 'running', 'started', 'scoring'])
const SCORED_STATUS_KEYS = new Set([
  'scored',
  'scored_no_gain',
  'scored_promising',
  'promotion_passed',
  'active_version_created',
  'champion_reward_created',
  'merged',
  'reward_created',
  'promoted',
  'winner',
  'high_gain',
  'failed_after_scoring',
])
const COMPLETED_STATUS_KEYS = new Set([
  'candidate_generation_complete',
  'completed',
  'scored',
  'scored_no_gain',
  'scored_promising',
  'promotion_passed',
  'active_version_created',
  'champion_reward_created',
  'merged',
  'reward_created',
  'promoted',
  'winner',
  'high_gain',
  'completed_no_candidate',
  'scoring_failed',
  'failed_after_scoring',
  'rebase_unavailable',
  'failed',
])
const PROMISING_STATUS_KEYS = new Set([
  'scored_promising',
  'promotion_passed',
  'active_version_created',
  'champion_reward_created',
  'merged',
  'reward_created',
  'promoted',
  'winner',
  'high_gain',
])
const PROMISING_BANDS = PASSED_THRESHOLD_BANDS
const NO_GAIN_OR_FAILED_KEYS = new Set([
  'scored_no_gain',
  'completed_no_candidate',
  'scoring_failed',
  'failed_after_scoring',
  'failed',
  'rebase_unavailable',
])
const PENDING_OR_BLOCKING_STATUS_KEYS = new Set([
  'queued',
  'started',
  'waiting_for_baseline',
  'blocked_for_credit',
  'needs_rescore',
  'stale',
  'not_started',
  'awaiting_payment',
  'paid_not_started',
  'rebase_unavailable',
])

export const RESEARCH_LAB_STATUS_FILTER_OPTIONS: ResearchLabStatusFilterOption[] = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'promoted', label: 'Model Improvement' },
  { value: 'scored', label: 'Scored' },
  { value: 'completed_no_candidate', label: 'No Candidate' },
  { value: 'failed', label: 'Failed' },
  { value: 'awaiting_payment', label: 'Awaiting Funding' },
]

export const RESEARCH_LAB_OUTCOME_FILTER_OPTIONS = RESEARCH_LAB_STATUS_FILTER_OPTIONS

export function deriveResearchLabLoopStatus(input: ResearchLabLoopStatusInput): ResearchLabLoopStatus {
  if (hasCanonicalLifecycleFields(input)) {
    return deriveCanonicalResearchLabLoopStatus(input)
  }

  const projectedLabel = normalize(input.outcomeLabel) || 'submitted'
  const projectedBand = normalize(input.outcomeBand) || 'pending'
  const candidateStatus = normalize(input.currentCandidateStatus ?? input.candidateStatus)
  const reason = normalize(input.currentReason ?? input.reason)
  const queueStatus = normalize(input.currentQueueStatus ?? input.queueStatus)
  const receiptStatus = normalize(input.currentReceiptStatus ?? input.receiptStatus)
  const currentStatus = normalize(input.currentStatus)
  const operationalValues = [candidateStatus, queueStatus, receiptStatus, currentStatus].filter(Boolean)
  const scoredOpsAction = scoredOutcomeOpsFailureNote(
    projectedLabel,
    candidateStatus,
    queueStatus,
    receiptStatus
  )

  const modelOutcome = normalizedModelOutcomeStatus({
    projectedLabel,
    projectedBand,
    candidateStatus,
    improvementGateDecision: input.improvementGateDecision,
    promotionStatus: input.promotionStatus,
    promotionEventType: input.promotionEventType,
    promotionEvent: input.promotionEvent,
    eventType: input.eventType,
    action: scoredOpsAction,
  })
  if (modelOutcome) return modelOutcome

  if (projectedLabel === 'awaiting_payment') {
    return status('awaiting_payment', 'Awaiting funding', 'pending')
  }

  if (FAILED_VALUES.has(projectedLabel)) {
    return terminalFailureStatus(input, scoredOpsAction)
  }

  if (isNeedsRescore(projectedLabel, candidateStatus, reason)) {
    return status('stale', 'Stale', 'stale', undefined, {
      tone: 'warning',
      label: 'Stale recovery needed',
      detail: 'Candidate was created against an older parent model and needs to be rebased or rescored against the current parent.',
    })
  }

  if (isBaselineNotReady(projectedLabel, reason, operationalValues)) {
    const completedGeneration = queueStatus === 'completed' || projectedLabel === 'completed'
    return status('waiting_for_baseline', labelForStatus('waiting_for_baseline'), 'pending', {
      tone: 'warning',
      label: labelForStatus('waiting_for_baseline'),
      detail: completedGeneration
        ? 'Candidate generation completed, but scoring is waiting for the benchmark baseline.'
        : 'Scoring is waiting for the benchmark baseline to become ready.',
    })
  }

  if (ACTIVE_STATUS_KEYS.has(projectedLabel) && (!operationalValues.length || hasAny(operationalValues, ACTIVE_VALUES))) {
    if (projectedLabel === 'scoring') return status('scoring', 'Scoring', 'running')
    if (projectedLabel === 'running') return status('running', 'Running', 'running')
    if (projectedLabel === 'started') return status('started', 'Started', 'running')
    return status('queued', 'Queued', 'pending')
  }

  return status(projectedLabel, labelForStatus(projectedLabel), projectedBand)
}

export function isActiveResearchLabLoopStatus(key: string): boolean {
  return ACTIVE_STATUS_KEYS.has(normalize(key))
}

export function isScoredResearchLabLoopStatus(key: string): boolean {
  return SCORED_STATUS_KEYS.has(normalize(key))
}

export function isCompletedResearchLabLoopStatus(key: string): boolean {
  return COMPLETED_STATUS_KEYS.has(normalize(key))
}

export function isPromisingResearchLabLoopStatus(key: string, band?: string | null): boolean {
  return PROMISING_STATUS_KEYS.has(normalize(key)) || PROMISING_BANDS.has(normalize(band))
}

export function isNoGainOrFailedResearchLabLoopStatus(key: string): boolean {
  return NO_GAIN_OR_FAILED_KEYS.has(normalize(key))
}

export function isPendingOrBlockingResearchLabLoopStatus(key: string): boolean {
  return PENDING_OR_BLOCKING_STATUS_KEYS.has(normalize(key))
}

export function researchLabStatusLabel(value: string | null | undefined): string {
  return labelForStatus(normalize(value) || 'submitted')
}

export function researchLabStatusFilterKey(
  value: string | null | undefined,
  _loop?: Pick<ResearchLabActivityFilterInput, 'statusNote' | 'opsWarnings'>,
): string {
  void _loop
  const normalized = normalize(value)
  if (ACTIVE_STATUS_KEYS.has(normalized)) return 'active'
  if (normalized === 'promoted' || normalized === 'winner' || normalized === 'high_gain') return 'promoted'
  if (normalized === 'promotion_passed') return 'promoted'
  if (normalized === 'active_version_created') return 'promoted'
  if (normalized === 'champion_reward_created') return 'promoted'
  if (normalized === 'merged') return 'promoted'
  if (normalized === 'reward_created') return 'promoted'
  if (normalized === 'scored_promising') return 'scored'
  if (normalized === 'scored_no_gain') return 'scored'
  if (normalized === 'scored') return 'scored'
  if (normalized === 'completed_no_candidate') return 'completed_no_candidate'
  if (normalized === 'scoring_failed' || normalized === 'failed_after_scoring') return 'failed'
  if (normalized === 'failed' || normalized === 'rebase_unavailable') return 'failed'
  if (normalized === 'awaiting_payment') return 'awaiting_payment'
  if (normalized === 'not_started') return 'paid_not_started'
  return normalized
}

export function researchLabOutcomeFilterKey(value: string | null | undefined): string {
  return researchLabStatusFilterKey(value)
}

export function researchLabLoopDirectionKey(loop: ResearchLabActivityFilterInput): string {
  return researchLabLoopDirectionKeys(loop)[0] ?? 'generalist'
}

export function researchLabLoopDirectionKeys(loop: ResearchLabActivityFilterInput): string[] {
  const tags = Array.isArray(loop.topicTags) ? loop.topicTags.filter(Boolean) : []
  const tagKeys = Array.from(new Set(tags.map(normalize).filter(Boolean)))
  if (tagKeys.length > 0) return tagKeys
  return [normalize(loop.researchArea) || 'generalist']
}

export function researchLabLoopMatchesDirection(
  loop: ResearchLabActivityFilterInput,
  direction: string | null | undefined,
): boolean {
  const normalizedDirection = normalize(direction)
  if (!normalizedDirection || normalizedDirection === 'all') return true
  return researchLabLoopDirectionKeys(loop).includes(normalizedDirection)
}

export function researchLabStatusFilterOptionsWithCounts<T extends ResearchLabActivityFilterInput>(
  loops: T[],
  filters: Pick<ResearchLabActivityFilters, 'minerQuery' | 'direction'> = {},
): ResearchLabStatusFilterOption[] {
  const scopedLoops = filterResearchLabActivityLoops(loops, {
    minerQuery: filters.minerQuery,
    direction: filters.direction,
    status: 'all',
  })
  const counts = new Map<string, number>([['all', scopedLoops.length]])

  for (const loop of scopedLoops) {
    const key = researchLabStatusFilterKey(loop.statusKey || loop.outcomeLabel, loop)
    if (!key) continue
    counts.set(key, (counts.get(key) ?? 0) + 1)
    if (loopHasOpsWarning(loop)) counts.set('ops_warnings', (counts.get('ops_warnings') ?? 0) + 1)
  }

  return RESEARCH_LAB_STATUS_FILTER_OPTIONS
    .map((option) => ({
      ...option,
      count: counts.get(option.value) ?? 0,
    }))
    .filter((option) => option.value === 'all' || (option.count ?? 0) > 0)
}

export function researchLabOutcomeFilterOptionsWithCounts<T extends ResearchLabActivityFilterInput>(
  loops: T[],
  filters: Pick<ResearchLabActivityFilters, 'minerQuery' | 'direction'> = {},
): ResearchLabOutcomeFilterOption[] {
  return researchLabStatusFilterOptionsWithCounts(loops, filters)
}

export function filterResearchLabActivityLoops<T extends ResearchLabActivityFilterInput>(
  loops: T[],
  filters: ResearchLabActivityFilters,
): T[] {
  const q = normalize(filters.minerQuery)
  const direction = filters.direction || 'all'
  const selectedStatus = filters.status || filters.outcome || 'all'

  return loops
    .filter((loop) => {
      if (!researchLabLoopMatchesDirection(loop, direction)) return false
      if (selectedStatus !== 'all') {
        if (selectedStatus === 'ops_warnings') {
          if (!loopHasOpsWarning(loop)) return false
        } else if (researchLabStatusFilterKey(loop.statusKey || loop.outcomeLabel, loop) !== selectedStatus) {
          return false
        }
      }
      if (!q) return true
      return normalize(loop.minerHotkey).includes(q)
    })
    .slice()
    .sort((a, b) => timeValue(b.lastActivityAt) - timeValue(a.lastActivityAt))
}

function deriveCanonicalResearchLabLoopStatus(input: ResearchLabLoopStatusInput): ResearchLabLoopStatus {
  const publicStatus = normalize(input.publicStatus)
  const paymentState = normalize(input.paymentState)
  const executionState = normalize(input.executionState)
  const candidateState = normalize(input.candidateState)
  const resultState = normalize(input.resultState)
  const opsReason = normalize(input.opsReason)
  const statusDetail = cleanText(input.statusDetail)
  const queueStatus = normalize(input.currentQueueStatus ?? input.queueStatus)
  const receiptStatus = normalize(input.currentReceiptStatus ?? input.receiptStatus)
  const legacyOutcome = normalize(input.outcomeLabel)
  const projectedBand = normalize(input.outcomeBand) || 'pending'
  const opsWarnings = opsWarningTexts(input.opsWarnings)
  const canonicalValues = [
    resultState,
    publicStatus,
    candidateState,
    executionState,
    paymentState,
    opsReason,
  ].filter(Boolean)
  const scoredAction = canonicalOpsWarningNote(opsWarnings) ??
    scoredOutcomeOpsFailureNote(
      resultState || publicStatus || legacyOutcome,
      candidateState,
      queueStatus,
      receiptStatus
    )

  const modelResult = canonicalModelResultStatus(
    resultState,
    publicStatus,
    candidateState,
    projectedBand,
    {
      improvementGateDecision: input.improvementGateDecision,
      promotionStatus: input.promotionStatus,
      promotionEventType: input.promotionEventType,
      promotionEvent: input.promotionEvent,
      eventType: input.eventType,
    },
    scoredAction
  )
  if (modelResult) return modelResult

  if (hasAny(canonicalValues, NO_PAYMENT_VALUES)) {
    return status('awaiting_payment', 'Awaiting funding', 'pending')
  }

  if (hasExplicitCreditBlock(canonicalValues, statusDetail, opsWarnings)) {
    return status('blocked_for_credit', 'Waiting for credits', 'blocked', undefined, canonicalDetailNote({
      tone: 'warning',
      label: 'Retry available',
      detail: statusDetail || detailForReason(opsReason) || 'The run hit a resumable credit limit and is waiting for credits.',
    }))
  }

  if (isRebaseUnavailable(canonicalValues, statusDetail)) {
    return status('stale', 'Stale', 'stale', undefined, canonicalDetailNote({
      tone: 'warning',
      label: 'Stale recovery needed',
      detail: statusDetail || detailForReason(opsReason) || 'The stale parent model could not be rebased for this loop.',
    }))
  }

  if (isNeedsRescore(publicStatus || resultState, candidateState, opsReason)) {
    return status('stale', 'Stale', 'stale', undefined, canonicalDetailNote({
      tone: 'warning',
      label: 'Stale recovery needed',
      detail: statusDetail || 'Candidate was created against an older parent model and needs to be rebased or rescored against the current parent.',
    }))
  }

  if (isBaselineNotReady(publicStatus || resultState, opsReason, canonicalValues)) {
    return status('waiting_for_baseline', 'Waiting for baseline', 'pending', canonicalDetailNote({
      tone: 'warning',
      label: 'Waiting for baseline',
      detail: statusDetail || 'Scoring is waiting for the benchmark baseline to become ready.',
    }))
  }

  if (publicStatus === 'completed_no_candidate' || resultState === 'completed_no_candidate') {
    return completedNoCandidateStatus(scoredAction)
  }

  if (isCanonicalTerminalFailure(publicStatus, resultState, candidateState, executionState)) {
    return terminalFailureStatus(input, scoredAction)
  }

  if (publicStatus === 'scoring' || resultState === 'scoring' || candidateState === 'scoring') {
    return status('scoring', 'Scoring', 'running')
  }

  if (hasAny(canonicalValues, ACTIVE_VALUES)) {
    if (publicStatus === 'started' || executionState === 'started') return status('started', 'Started', 'running')
    return status('running', 'Running', 'running')
  }

  if (hasAny(canonicalValues, PAID_VALUES) && hasAny(canonicalValues, NOT_STARTED_VALUES)) {
    return status('paid_not_started', 'Paid, not started', 'pending')
  }

  if (publicStatus === 'paid_not_started' || executionState === 'paid_not_started') {
    return status('paid_not_started', 'Paid, not started', 'pending')
  }

  if (
    PAID_VALUES.has(paymentState) &&
    (!input.runId || publicStatus === 'submitted' || publicStatus === 'pending' || !publicStatus) &&
    !resultState &&
    !candidateState
  ) {
    return status('paid_not_started', 'Paid, not started', 'pending')
  }

  const fallback = resultState || publicStatus || executionState || paymentState || candidateState || legacyOutcome || 'submitted'
  return status(fallback, labelForStatus(fallback), canonicalBand(projectedBand, 'pending'), undefined, canonicalOpsWarningNote(opsWarnings))
}

function hasCanonicalLifecycleFields(input: ResearchLabLoopStatusInput): boolean {
  const statusDetail = cleanText(input.statusDetail)
  const opsWarnings = opsWarningTexts(input.opsWarnings)
  const primaryFields = [
    input.publicStatus,
    input.paymentState,
    input.executionState,
    input.candidateState,
    input.resultState,
    input.opsReason,
  ].some((value) => normalize(value))
  return primaryFields ||
    hasExplicitCreditBlock([], statusDetail, opsWarnings) ||
    isRebaseUnavailable([], statusDetail)
}

function canonicalModelResultStatus(
  resultState: string,
  publicStatus: string,
  candidateState: string,
  projectedBand: string,
  signals: Pick<ResearchLabLoopStatusInput,
    'eventType' |
    'improvementGateDecision' |
    'promotionEvent' |
    'promotionEventType' |
    'promotionStatus'
  >,
  action?: ResearchLabLoopStatusNote,
): ResearchLabLoopStatus | null {
  return normalizedModelOutcomeStatus({
    projectedLabel: resultState || publicStatus || candidateState,
    projectedBand,
    candidateStatus: candidateState,
    resultState,
    publicStatus,
    improvementGateDecision: signals.improvementGateDecision,
    promotionStatus: signals.promotionStatus,
    promotionEventType: signals.promotionEventType,
    promotionEvent: signals.promotionEvent,
    eventType: signals.eventType,
    action,
  })
}

type NormalizedModelOutcomeStatusInput = Pick<ResearchLabLoopStatusInput,
  'eventType' |
  'improvementGateDecision' |
  'promotionEvent' |
  'promotionEventType' |
  'promotionStatus'
> & {
  projectedLabel: string
  projectedBand: string
  candidateStatus?: string
  resultState?: string
  publicStatus?: string
  note?: ResearchLabLoopStatusNote
  action?: ResearchLabLoopStatusNote
}

function normalizedModelOutcomeStatus(input: NormalizedModelOutcomeStatusInput): ResearchLabLoopStatus | null {
  const projectedLabel = normalize(input.projectedLabel)
  const projectedBand = normalize(input.projectedBand) || 'pending'
  const candidateStatus = normalize(input.candidateStatus)
  const resultState = normalize(input.resultState)
  const publicStatus = normalize(input.publicStatus)
  const statusValues = [
    projectedLabel,
    candidateStatus,
    resultState,
    publicStatus,
  ].filter(Boolean)
  const promotionSignals = [
    input.promotionStatus,
    input.promotionEventType,
    input.promotionEvent,
    input.eventType,
  ].map(normalize).filter(Boolean)
  const improvementGateDecision = normalize(input.improvementGateDecision)

  if (hasAny(statusValues, PROMOTED_VALUES) || projectedLabel === 'promoted') {
    return status('promoted', 'Model Improvement', canonicalBand(projectedBand, 'promoted'), input.note, input.action)
  }

  if (hasAny(statusValues, SCORED_NO_GAIN_VALUES) || projectedBand === 'no_gain') {
    return noGainStatus(input.action)
  }

  if (hasAny(statusValues, COMPLETED_NO_CANDIDATE_VALUES)) {
    return completedNoCandidateStatus(input.action)
  }

  const hasScoredLikeOutcome =
    projectedLabel === 'scored' ||
    candidateStatus === 'scored' ||
    resultState === 'scored' ||
    publicStatus === 'scored' ||
    hasAny(statusValues, SCORED_PROMISING_VALUES) ||
    projectedBand === 'small_gain'
  const hasBelowThresholdSignal =
    NO_PROMOTION_VALUES.has(improvementGateDecision) ||
    hasAny(promotionSignals, NO_PROMOTION_VALUES)

  if (hasBelowThresholdSignal && hasScoredLikeOutcome) {
    return noGainStatus(input.action)
  }

  if (statusValues.includes('scored_promising')) {
    return status('scored_promising', 'Scored · Promising', canonicalBand(projectedBand, 'small_gain'), input.note, input.action)
  }

  const hasPassedThreshold =
    PASSED_THRESHOLD_BANDS.has(projectedBand) ||
    hasAny(statusValues, PROMOTION_PASS_VALUES) ||
    hasAny(promotionSignals, PROMOTION_PASS_VALUES)

  if (hasPassedThreshold) {
    return modelImprovedStatus(projectedLabel, projectedBand, candidateStatus, promotionSignals, input.action)
  }

  if (projectedLabel === 'scored' || resultState === 'scored' || publicStatus === 'scored') {
    return status('scored_promising', 'Scored · Promising', canonicalBand(projectedBand, 'completed'), input.note, input.action)
  }

  return null
}

function modelImprovedStatus(
  projectedLabel: string,
  projectedBand: string,
  candidateStatus: string,
  promotionSignals: string[],
  action?: ResearchLabLoopStatusNote,
): ResearchLabLoopStatus {
  if (projectedLabel === 'promoted' || candidateStatus === 'promoted' || promotionSignals.includes('promoted')) {
    return status('promoted', 'Model Improvement', canonicalBand(projectedBand, 'promoted'), undefined, action)
  }
  if (projectedLabel === 'winner' || candidateStatus === 'winner' || promotionSignals.includes('winner')) {
    return status('promoted', 'Model Improvement', canonicalBand(projectedBand, 'promoted'), undefined, action)
  }
  if (projectedLabel === 'high_gain' || candidateStatus === 'high_gain' || promotionSignals.includes('high_gain')) {
    return status('promoted', 'Model Improvement', canonicalBand(projectedBand, 'high_gain'), undefined, action)
  }
  if (projectedLabel === 'promotion_passed' || promotionSignals.includes('promotion_passed')) {
    return status('promoted', 'Model Improvement', canonicalBand(projectedBand, 'passed_threshold'), undefined, action)
  }
  return status('scored_promising', 'Scored · Promising', canonicalBand(projectedBand, 'passed_threshold'), undefined, action)
}

function noGainStatus(action?: ResearchLabLoopStatusNote): ResearchLabLoopStatus {
  return status('scored_no_gain', 'Scored · No promotion', 'no_gain', finalOutcomeNote(
    'Scoring completed; candidate did not clear promotion threshold or holdout gate.'
  ), action)
}

function completedNoCandidateStatus(action?: ResearchLabLoopStatusNote): ResearchLabLoopStatus {
  return status('completed_no_candidate', 'No candidate', 'completed', finalOutcomeNote(
    'Final outcome: no valid candidate was produced.'
  ), action)
}

function terminalFailureStatus(
  input: Pick<ResearchLabLoopStatusInput, 'candidateCount' | 'scoredCandidateCount'>,
  action?: ResearchLabLoopStatusNote,
): ResearchLabLoopStatus {
  const candidateCount = countValue(input.candidateCount)
  const scoredCandidateCount = countValue(input.scoredCandidateCount)
  if (candidateCount === 0) {
    return completedNoCandidateStatus(action)
  }
  if (scoredCandidateCount === 0) {
    return status('scoring_failed', 'Scoring failed', 'failed', finalOutcomeNote(
      'Final outcome: candidate scoring exhausted retry budget.'
    ), action)
  }
  return status('failed_after_scoring', 'Failed after scoring', 'failed', finalOutcomeNote(
    'Final outcome: scoring completed, then the loop entered a failed terminal state.'
  ), action)
}

function finalOutcomeNote(detail: string): ResearchLabLoopStatusNote {
  return {
    tone: 'info',
    label: 'Final',
    detail,
  }
}

function countValue(value: number | null | undefined): number {
  const numeric = Number(value ?? 0)
  return Number.isFinite(numeric) ? Math.max(0, numeric) : 0
}

function canonicalOpsWarningNote(opsWarnings: string[]): ResearchLabLoopStatusNote | undefined {
  if (opsWarnings.length === 0) return undefined
  return {
    tone: 'warning',
    label: 'Review recommended',
    detail: opsWarnings[0],
  }
}

function canonicalDetailNote(note: ResearchLabLoopStatusNote): ResearchLabLoopStatusNote | undefined {
  return note.detail ? note : undefined
}

function canonicalBand(projectedBand: string, fallback: string): string {
  if (!projectedBand || projectedBand === 'pending' || projectedBand === 'failed') return fallback
  return projectedBand
}

function scoredOutcomeOpsFailureNote(
  projectedLabel: string,
  candidateStatus: string,
  queueStatus: string,
  receiptStatus: string,
): ResearchLabLoopStatusNote | undefined {
  if (!hasAny([queueStatus, receiptStatus].filter(Boolean), FAILED_VALUES)) return undefined
  if (candidateStatus !== 'scored' && !isCanonicalScoredOutcome(projectedLabel)) return undefined
  return {
    tone: 'warning',
    label: 'Review recommended',
    detail: 'Queue or receipt state is terminal failed, but the final model outcome is preserved.',
  }
}

function isCanonicalScoredOutcome(value: string): boolean {
  return SCORED_STATUS_KEYS.has(normalize(value))
}

function isBaselineNotReady(projectedLabel: string, reason: string, operationalValues: string[]): boolean {
  return BASELINE_NOT_READY_VALUES.has(projectedLabel) ||
    BASELINE_NOT_READY_VALUES.has(reason) ||
    hasAny(operationalValues, BASELINE_NOT_READY_VALUES)
}

function isNeedsRescore(projectedLabel: string, candidateStatus: string, reason: string): boolean {
  return (
    projectedLabel === 'needs_rescore' ||
    candidateStatus === 'needs_rescore' ||
    reason === 'needs_rescore' ||
    reason === 'stale_parent' ||
    reason === 'stale_parent_needs_rescore' ||
    reason === 'parent_stale'
  )
}

function isCanonicalTerminalFailure(
  publicStatus: string,
  resultState: string,
  candidateState: string,
  executionState: string,
): boolean {
  if (FAILED_VALUES.has(resultState) || FAILED_VALUES.has(publicStatus)) return true
  if (FAILED_VALUES.has(candidateState)) return true
  return FAILED_VALUES.has(executionState) && (FAILED_VALUES.has(publicStatus) || FAILED_VALUES.has(resultState))
}

function isRebaseUnavailable(values: string[], statusDetail: string): boolean {
  if (hasAny(values, REBASE_UNAVAILABLE_VALUES)) return true
  const normalizedDetail = normalize(statusDetail)
  return normalizedDetail.includes('rebase unavailable') || normalizedDetail.includes('rebase_unavailable')
}

function hasExplicitCreditBlock(values: string[], statusDetail: string, opsWarnings: string[]): boolean {
  if (hasAny(values, CREDIT_BLOCK_VALUES)) return true
  const haystack = [statusDetail, ...opsWarnings].map(normalize).join(' ')
  return (
    haystack.includes('openrouter 402') ||
    haystack.includes('openrouter_402') ||
    (haystack.includes('402') && haystack.includes('credit')) ||
    haystack.includes('insufficient credit') ||
    haystack.includes('insufficient_credits') ||
    haystack.includes('waiting for credit') ||
    haystack.includes('blocked for credit')
  )
}

function loopHasOpsWarning(
  loop?: Pick<ResearchLabActivityFilterInput, 'statusNote' | 'opsWarnings'>,
): boolean {
  if (!loop) return false
  if (Array.isArray(loop.opsWarnings) && loop.opsWarnings.length > 0) return true
  return normalize(loop.statusNote?.label).includes('ops warning')
}

function opsWarningTexts(value: unknown): string[] {
  if (!value) return []
  const raw = Array.isArray(value) ? value : [value]
  return raw
    .map((item) => {
      if (typeof item === 'string') return item
      if (typeof item === 'number' || typeof item === 'boolean') return String(item)
      if (!item || typeof item !== 'object') return ''
      const record = item as Record<string, unknown>
      return cleanText(
        record.detail ??
        record.message ??
        record.reason ??
        record.code ??
        record.label ??
        JSON.stringify(record)
      )
    })
    .map((item) => item.trim())
    .filter(Boolean)
}

function detailForReason(reason: string): string {
  return reason ? labelForStatus(reason) : ''
}

function status(
  key: string,
  label: string,
  band: string,
  note?: ResearchLabLoopStatusNote,
  action?: ResearchLabLoopStatusNote,
): ResearchLabLoopStatus {
  const normalizedKey = normalize(key)
  const normalizedBand = normalize(band) || 'pending'
  return {
    key: normalizedKey,
    label,
    band: normalizedBand,
    note,
    action,
    active: ACTIVE_STATUS_KEYS.has(normalizedKey),
    scoring: SCORING_VALUES.has(normalizedKey),
    completed: COMPLETED_STATUS_KEYS.has(normalizedKey),
    scored: SCORED_STATUS_KEYS.has(normalizedKey),
    promising: isPromisingResearchLabLoopStatus(normalizedKey, normalizedBand),
    noGainOrFailed: isNoGainOrFailedResearchLabLoopStatus(normalizedKey),
    pendingOrBlocking: PENDING_OR_BLOCKING_STATUS_KEYS.has(normalizedKey),
  }
}

function hasAny(values: string[], set: Set<string>): boolean {
  return values.some((value) => set.has(value))
}

function cleanText(value: unknown): string {
  return String(value ?? '').trim()
}

function normalize(value: unknown): string {
  return String(value ?? '').trim().toLowerCase()
}

function timeValue(value: string | null | undefined): number {
  const time = new Date(value ?? '').getTime()
  return Number.isFinite(time) ? time : 0
}

function labelForStatus(value: string): string {
  const explicit: Record<string, string> = {
    submitted: 'Submitted',
    queued: 'Queued',
    started: 'Started',
    running: 'Running',
    scoring: 'Scoring',
    pending: 'Pending',
    completed: 'Complete',
    completed_no_candidate: 'No candidate',
    scored: 'Scored · Promising',
    scored_promising: 'Scored · Promising',
    scored_no_gain: 'Scored · No promotion',
    promotion_checked: 'Scored · No promotion',
    public_holdout_rejected: 'Scored · No promotion',
    holdout_rejected: 'Scored · No promotion',
    promotion_rejected: 'Scored · No promotion',
    promotion_passed: 'Model Improvement',
    active_version_created: 'Model Improvement',
    champion_reward_created: 'Model Improvement',
    merged: 'Model Improvement',
    reward_created: 'Model Improvement',
    promoted: 'Model Improvement',
    scoring_failed: 'Scoring failed',
    failed_after_scoring: 'Failed after scoring',
    blocked_for_credit: 'Waiting for credits',
    needs_rescore: 'Stale',
    stale: 'Stale',
    waiting_for_baseline: 'Waiting for baseline',
    awaiting_payment: 'Awaiting funding',
    not_started: 'Not started',
    failed: 'Failed',
  }
  if (explicit[value]) return explicit[value]
  return value.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())
}
