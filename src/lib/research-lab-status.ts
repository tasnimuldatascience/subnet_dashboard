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
}

export type ResearchLabLoopStatus = {
  key: string
  label: string
  band: string
  note?: ResearchLabLoopStatusNote
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
  statusKey?: string | null
  statusLabel?: string | null
  statusNote?: ResearchLabLoopStatusNote | null
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

const SCORED_NO_GAIN_VALUES = new Set(['scored_no_gain', 'no_gain'])
const SCORED_PROMISING_VALUES = new Set([
  'scored_promising',
  'promotion_passed',
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

const ACTIVE_STATUS_KEYS = new Set(['queued', 'running', 'scoring'])
const SCORED_STATUS_KEYS = new Set([
  'scored',
  'scored_no_gain',
  'scored_promising',
  'promotion_passed',
  'promoted',
  'winner',
  'high_gain',
])
const COMPLETED_STATUS_KEYS = new Set([
  'candidate_generation_complete',
  'completed',
  'scored',
  'scored_no_gain',
  'scored_promising',
  'promotion_passed',
  'promoted',
  'winner',
  'high_gain',
  'completed_no_candidate',
  'rebase_unavailable',
  'failed',
])
const PROMISING_STATUS_KEYS = new Set([
  'scored_promising',
  'promotion_passed',
  'promoted',
  'winner',
  'high_gain',
])
const PROMISING_BANDS = new Set(['small_gain', 'passed_threshold', 'promoted', 'high_gain', 'winner'])
const NO_GAIN_OR_FAILED_KEYS = new Set(['scored_no_gain', 'failed', 'rebase_unavailable'])
const PENDING_OR_BLOCKING_STATUS_KEYS = new Set([
  'queued',
  'waiting_for_baseline',
  'blocked_for_credit',
  'needs_rescore',
  'not_started',
  'awaiting_payment',
  'paid_not_started',
  'failed',
  'rebase_unavailable',
])

export const RESEARCH_LAB_STATUS_FILTER_OPTIONS: ResearchLabStatusFilterOption[] = [
  { value: 'all', label: 'All statuses' },
  { value: 'awaiting_payment', label: 'Awaiting payment' },
  { value: 'paid_not_started', label: 'Paid, not started' },
  { value: 'running', label: 'Running' },
  { value: 'scoring', label: 'Scoring' },
  { value: 'waiting_for_baseline', label: 'Waiting for baseline' },
  { value: 'needs_rescore', label: 'Needs rescore' },
  { value: 'blocked_for_credit', label: 'Blocked for credit' },
  { value: 'scored_no_gain', label: 'Completed' },
  { value: 'scored', label: 'Model improved' },
  { value: 'completed_no_candidate', label: 'Completed no candidate' },
  { value: 'failed', label: 'Needs review' },
  { value: 'ops_warnings', label: 'Ops warnings' },
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
  const scoredOpsNote = scoredOutcomeOpsFailureNote(
    projectedLabel,
    candidateStatus,
    queueStatus,
    receiptStatus
  )

  const promotion = promotionStatus(projectedLabel, projectedBand, candidateStatus, scoredOpsNote)
  if (promotion) return promotion

  if (projectedLabel === 'scored_no_gain' || projectedBand === 'no_gain' || candidateStatus === 'scored_no_gain') {
    return status('scored_no_gain', 'Completed', 'no_gain', scoredOpsNote)
  }

  if (projectedLabel === 'scored') {
    return status('scored', 'Model improved', canonicalBand(projectedBand, 'completed'), scoredOpsNote)
  }

  if (FAILED_VALUES.has(projectedLabel)) {
    return status('failed', 'Needs review', 'failed', {
      tone: 'error',
      label: 'Needs review',
      detail: 'The canonical public outcome is terminal failed.',
    })
  }

  if (isNeedsRescore(projectedLabel, candidateStatus, reason)) {
    return status('needs_rescore', 'Needs rescore', 'stale', {
      tone: 'warning',
      label: 'Needs rescore',
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
  loop?: Pick<ResearchLabActivityFilterInput, 'statusNote' | 'opsWarnings'>,
): string {
  const normalized = normalize(value)
  if (normalized === 'ops_warnings') return 'ops_warnings'
  if (normalized === 'scored_promising') return 'scored'
  if (normalized === 'promotion_passed') return 'scored'
  if (normalized === 'promoted') return 'scored'
  if (normalized === 'winner') return 'scored'
  if (normalized === 'high_gain') return 'scored'
  if (normalized === 'rebase_unavailable') return 'failed'
  if (normalized === 'not_started') return 'paid_not_started'
  if (loopHasOpsWarning(loop)) return normalized
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

function promotionStatus(
  projectedLabel: string,
  projectedBand: string,
  candidateStatus: string,
  note?: ResearchLabLoopStatusNote,
): ResearchLabLoopStatus | null {
  if (projectedLabel === 'promoted' || candidateStatus === 'promoted') {
    return status('promoted', 'Promoted', canonicalBand(projectedBand, 'promoted'), note)
  }
  if (projectedLabel === 'winner' || candidateStatus === 'winner') {
    return status('winner', 'Winner', canonicalBand(projectedBand, 'promoted'), note)
  }
  if (projectedLabel === 'high_gain') {
    return status('high_gain', 'High gain', canonicalBand(projectedBand, 'high_gain'), note)
  }
  if (projectedLabel === 'promotion_passed') {
    return status('promotion_passed', 'Promotion passed', canonicalBand(projectedBand, 'passed_threshold'), note)
  }
  if (projectedLabel === 'scored_promising') {
    return status('scored_promising', 'Model improved', canonicalBand(projectedBand, 'small_gain'), note)
  }
  return null
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
  const scoredNote = canonicalOpsWarningNote(opsWarnings) ??
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
    scoredNote
  )
  if (modelResult) return modelResult

  if (hasAny(canonicalValues, NO_PAYMENT_VALUES)) {
    return status('awaiting_payment', 'Awaiting payment', 'pending', canonicalDetailNote({
      tone: 'info',
      label: 'Awaiting payment',
      detail: statusDetail || detailForReason(opsReason) || 'No payment has been recorded for this research loop yet.',
    }))
  }

  if (hasExplicitCreditBlock(canonicalValues, statusDetail, opsWarnings)) {
    return status('blocked_for_credit', 'Waiting for credits', 'blocked', canonicalDetailNote({
      tone: 'warning',
      label: 'Blocked for credit',
      detail: statusDetail || detailForReason(opsReason) || 'The run hit a resumable credit limit and is waiting for credits.',
    }))
  }

  if (isRebaseUnavailable(canonicalValues, statusDetail)) {
    return status('rebase_unavailable', 'Rebase unavailable', 'failed', canonicalDetailNote({
      tone: 'error',
      label: 'Rebase unavailable',
      detail: statusDetail || detailForReason(opsReason) || 'The stale parent model could not be rebased for this loop.',
    }))
  }

  if (isNeedsRescore(publicStatus || resultState, candidateState, opsReason)) {
    return status('needs_rescore', 'Needs rescore', 'stale', canonicalDetailNote({
      tone: 'warning',
      label: 'Needs rescore',
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
    return status('completed_no_candidate', 'Completed no candidate', canonicalBand(projectedBand, 'completed'))
  }

  if (isCanonicalTerminalFailure(publicStatus, resultState, candidateState, executionState)) {
    return status('failed', 'Needs review', 'failed', canonicalDetailNote({
      tone: 'error',
      label: 'Needs review',
      detail: statusDetail || detailForReason(opsReason) || 'The canonical backend lifecycle state is terminal failed.',
    }))
  }

  if (publicStatus === 'scoring' || resultState === 'scoring' || candidateState === 'scoring') {
    return status('scoring', 'Scoring', 'running')
  }

  if (hasAny(canonicalValues, ACTIVE_VALUES)) {
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
  return status(fallback, labelForStatus(fallback), canonicalBand(projectedBand, 'pending'), canonicalOpsWarningNote(opsWarnings))
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
  note?: ResearchLabLoopStatusNote,
): ResearchLabLoopStatus | null {
  const values = [resultState, publicStatus, candidateState]
  if (hasAny(values, SCORED_NO_GAIN_VALUES)) {
    return status('scored_no_gain', 'Completed', 'no_gain', note)
  }
  if (hasAny(values, SCORED_PROMISING_VALUES)) {
    return promotionStatus(
      resultState || publicStatus || candidateState,
      canonicalBand(projectedBand, 'small_gain'),
      candidateState,
      note,
    ) ?? status('scored_promising', 'Model improved', canonicalBand(projectedBand, 'small_gain'), note)
  }
  if (resultState === 'scored' || publicStatus === 'scored' || candidateState === 'scored') {
    return status('scored', 'Model improved', canonicalBand(projectedBand, 'completed'), note)
  }
  return null
}

function canonicalOpsWarningNote(opsWarnings: string[]): ResearchLabLoopStatusNote | undefined {
  if (opsWarnings.length === 0) return undefined
  return {
    tone: 'warning',
    label: 'Ops warning',
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
    label: 'Ops warning',
    detail: 'Queue or receipt state is terminal failed, but the canonical model outcome is preserved.',
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
): ResearchLabLoopStatus {
  const normalizedKey = normalize(key)
  const normalizedBand = normalize(band) || 'pending'
  return {
    key: normalizedKey,
    label,
    band: normalizedBand,
    note,
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
    running: 'Running',
    scoring: 'Scoring',
    pending: 'Pending',
    completed: 'Complete',
    completed_no_candidate: 'Completed no candidate',
    scored: 'Model improved',
    scored_promising: 'Model improved',
    scored_no_gain: 'Completed',
    blocked_for_credit: 'Waiting for credits',
    needs_rescore: 'Needs rescore',
    waiting_for_baseline: 'Waiting for baseline',
    not_started: 'Not started',
    failed: 'Needs review',
  }
  if (explicit[value]) return explicit[value]
  return value.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())
}
