export type ResearchLabLoopStatusTone = 'info' | 'warning' | 'error'

export type ResearchLabLoopStatusNote = {
  tone: ResearchLabLoopStatusTone
  label: string
  detail: string
}

export type ResearchLabLoopStatusInput = {
  outcomeLabel?: string | null
  outcomeBand?: string | null
  runId?: string | null
  receiptId?: string | null
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

const COMPLETED_VALUES = new Set([
  'completed',
  'complete',
  'succeeded',
  'success',
  'done',
  'scored',
  'evaluated',
  'evaluation_complete',
  'promoted',
  'winner',
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

const SCORING_VALUES = new Set([
  'assigned',
  'running',
  'scoring',
  'evaluating',
  'evaluation_running',
  'processing',
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
const NO_GAIN_OR_FAILED_KEYS = new Set(['scored_no_gain', 'failed'])
const PENDING_OR_BLOCKING_STATUS_KEYS = new Set([
  'queued',
  'waiting_for_baseline',
  'needs_rescore',
  'not_started',
])

export function deriveResearchLabLoopStatus(input: ResearchLabLoopStatusInput): ResearchLabLoopStatus {
  const projectedLabel = normalize(input.outcomeLabel) || 'submitted'
  const projectedBand = normalize(input.outcomeBand) || 'pending'
  const candidateStatus = normalize(input.currentCandidateStatus ?? input.candidateStatus)
  const reason = normalize(input.currentReason ?? input.reason)
  const queueStatus = normalize(input.currentQueueStatus ?? input.queueStatus)
  const receiptStatus = normalize(input.currentReceiptStatus ?? input.receiptStatus)
  const currentStatus = normalize(input.currentStatus)
  const scoredCandidateCount = numeric(input.scoredCandidateCount)
  const operationalValues = [candidateStatus, queueStatus, receiptStatus, currentStatus].filter(Boolean)
  const hasOperationalState = operationalValues.length > 0

  if (hasAny(operationalValues, FAILED_VALUES) || projectedLabel === 'failed' || projectedBand === 'failed') {
    return status('failed', 'Failed', 'failed', {
      tone: 'error',
      label: 'Failed',
      detail: 'The queue, receipt, or candidate state is terminal failed.',
    })
  }

  const promotion = promotionStatus(projectedLabel, projectedBand, candidateStatus)
  if (promotion) return promotion

  const operationalScored = hasAny(operationalValues, COMPLETED_VALUES)
  if (
    projectedLabel === 'scored_no_gain' ||
    (projectedBand === 'no_gain' && (scoredCandidateCount > 0 || operationalScored)) ||
    (candidateStatus === 'scored_no_gain')
  ) {
    return status('scored_no_gain', 'Scored, no gain', 'no_gain')
  }

  if (
    projectedLabel === 'scored' ||
    (operationalScored && scoredCandidateCount > 0)
  ) {
    return status('scored', 'Scored', projectedBand === 'pending' ? 'completed' : projectedBand)
  }

  if (candidateStatus === 'queued' && reason === 'baseline_not_ready') {
    return status('waiting_for_baseline', 'Waiting for baseline', 'pending', {
      tone: 'warning',
      label: 'Waiting for baseline',
      detail: 'Candidate is queued, but scoring is waiting for the benchmark baseline to become ready.',
    })
  }

  if (isNeedsRescore(projectedLabel, candidateStatus, reason)) {
    return status('needs_rescore', 'Needs rescore', 'stale', {
      tone: 'warning',
      label: 'Needs rescore',
      detail: 'Candidate was created against an older parent model and needs to be rebased or rescored against the current parent.',
    })
  }

  const terminalCompleted = hasAny(operationalValues, COMPLETED_VALUES)
  const activeProjection = ACTIVE_STATUS_KEYS.has(projectedLabel)
  if (activeProjection && hasOperationalState && terminalCompleted) {
    if (scoredCandidateCount > 0) return status('scored', 'Scored', 'completed')
    return status('completed', 'Complete', 'completed')
  }

  if (
    activeProjection &&
    (!hasOperationalState || hasAny(operationalValues, ACTIVE_VALUES))
  ) {
    if (projectedLabel === 'scoring') return status('scoring', 'Scoring', 'running')
    if (projectedLabel === 'running') return status('running', 'Running', 'running')
    return status('queued', 'Queued', 'pending')
  }

  if (!input.runId && !input.receiptId) {
    return status('not_started', 'Not started', 'pending', {
      tone: 'info',
      label: 'Not started',
      detail: 'The ticket is recorded, but no run or receipt has been published yet.',
    })
  }

  if (projectedLabel === 'candidate_generation_complete') {
    return status('candidate_generation_complete', 'Candidate generated', 'completed')
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

export function isNoGainOrFailedResearchLabLoopStatus(key: string, band?: string | null): boolean {
  return NO_GAIN_OR_FAILED_KEYS.has(normalize(key)) || normalize(band) === 'failed'
}

function promotionStatus(
  projectedLabel: string,
  projectedBand: string,
  candidateStatus: string,
): ResearchLabLoopStatus | null {
  if (projectedLabel === 'promoted' || candidateStatus === 'promoted') {
    return status('promoted', 'Promoted', 'promoted')
  }
  if (projectedLabel === 'winner' || candidateStatus === 'winner' || projectedBand === 'winner') {
    return status('winner', 'Winner', 'promoted')
  }
  if (projectedLabel === 'high_gain' || projectedBand === 'high_gain') {
    return status('high_gain', 'High gain', 'high_gain')
  }
  if (projectedLabel === 'promotion_passed') {
    return status('promotion_passed', 'Promotion passed', 'passed_threshold')
  }
  if (projectedLabel === 'scored_promising' || projectedBand === 'small_gain') {
    return status('scored_promising', 'Scored, promising', projectedBand || 'small_gain')
  }
  return null
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
    noGainOrFailed: isNoGainOrFailedResearchLabLoopStatus(normalizedKey, normalizedBand),
    pendingOrBlocking: PENDING_OR_BLOCKING_STATUS_KEYS.has(normalizedKey),
  }
}

function hasAny(values: string[], set: Set<string>): boolean {
  return values.some((value) => set.has(value))
}

function normalize(value: string | null | undefined): string {
  return String(value ?? '').trim().toLowerCase()
}

function numeric(value: number | null | undefined): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function labelForStatus(value: string): string {
  const explicit: Record<string, string> = {
    submitted: 'Submitted',
    queued: 'Queued',
    running: 'Running',
    scoring: 'Scoring',
    pending: 'Pending',
    completed: 'Complete',
    scored: 'Scored',
    scored_no_gain: 'Scored, no gain',
    needs_rescore: 'Needs rescore',
    waiting_for_baseline: 'Waiting for baseline',
    not_started: 'Not started',
    failed: 'Failed',
  }
  if (explicit[value]) return explicit[value]
  return value.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())
}
