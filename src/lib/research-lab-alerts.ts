export type ResearchLabAlertSeverity = 'warning' | 'critical'

export type ResearchLabAlertSignal =
  | 'pcr0_mismatch'
  | 'pcr0_missing'
  | 'pcr0_stale'
  | 'offchain_weight_bundle_missing'
  | 'offchain_weight_bundle_stale'
  | 'onchain_validator_update_missing'
  | 'onchain_validator_update_stale'
  | 'benchmark_failed'
  | 'benchmark_stalled'
  | 'active_run_stale'
  | 'active_run_blocked'
  | 'transparency_checkpoint_stale'
  | 'data_freshness'

export type ResearchLabAlertScope =
  | 'validator'
  | 'benchmark'
  | 'run'
  | 'transparency'
  | 'data'

export type ResearchLabAlertTimestamp = string | number | Date

export type ResearchLabAlertAgeThreshold = {
  warnMs: number
  criticalMs: number
}

export type ResearchLabAlertBlockThreshold = {
  warnBlocks: number
  criticalBlocks: number
}

export type ResearchLabAlertThresholds = {
  pcr0Stale: ResearchLabAlertAgeThreshold
  offchainWeightBundleStale: ResearchLabAlertAgeThreshold
  onchainValidatorUpdateStale: ResearchLabAlertAgeThreshold & ResearchLabAlertBlockThreshold
  benchmarkStalled: ResearchLabAlertAgeThreshold
  activeRunStale: ResearchLabAlertAgeThreshold
  activeRunBlocked: ResearchLabAlertAgeThreshold
  transparencyCheckpointStale: ResearchLabAlertAgeThreshold
  dataFreshness: ResearchLabAlertAgeThreshold
}

export type ResearchLabAlertThresholdOverrides = {
  [Key in keyof ResearchLabAlertThresholds]?: Partial<ResearchLabAlertThresholds[Key]>
}

export type ResearchLabPcr0Observation = {
  /** Null means the source explicitly observed no PCR0. */
  observedPcr0: string | null
  expectedPcr0?: string | null
  /** An explicit comparison result takes precedence over comparing the strings. */
  matched?: boolean | null
  /** Null means PCR0 freshness cannot be established. */
  observedAt: ResearchLabAlertTimestamp | null
}

export type ResearchLabWeightBundleObservation = {
  /** Null means the source explicitly found no published bundle. */
  publishedAt: ResearchLabAlertTimestamp | null
  bundleId?: string | null
}

export type ResearchLabOnchainUpdateObservation = {
  /** Optional wall-clock representation when the source provides one. */
  updatedAt?: ResearchLabAlertTimestamp | null
  /** Canonical Bittensor neuron `last_update` block. */
  lastUpdateBlock?: number | null
  /** Finalized (preferred) or best chain head paired with lastUpdateBlock. */
  currentBlock?: number | null
}

export type ResearchLabValidatorAlertObservation = {
  validatorId: string
  source?: string | null
  /** Undefined means this source did not supply this signal. */
  pcr0?: ResearchLabPcr0Observation
  /** Undefined means this source did not supply this signal. */
  offchainWeightBundle?: ResearchLabWeightBundleObservation
  /** Undefined means this source did not supply this signal. */
  onchainUpdate?: ResearchLabOnchainUpdateObservation
}

export type ResearchLabBenchmarkAlertObservation = {
  benchmarkId: string
  validatorId?: string | null
  source?: string | null
  status: string
  startedAt?: ResearchLabAlertTimestamp | null
  lastActivityAt?: ResearchLabAlertTimestamp | null
  failedAt?: ResearchLabAlertTimestamp | null
  error?: string | null
}

export type ResearchLabActiveRunAlertObservation = {
  runId: string
  validatorId?: string | null
  source?: string | null
  status: string
  startedAt?: ResearchLabAlertTimestamp | null
  lastActivityAt?: ResearchLabAlertTimestamp | null
  blockedAt?: ResearchLabAlertTimestamp | null
  blocked?: boolean | null
  blocker?: string | null
}

export type ResearchLabTransparencyCheckpointObservation = {
  /** Use a netuid, environment, or other stable checkpoint stream identifier. */
  checkpointId: string
  source?: string | null
  /** Null means the source explicitly found no checkpoint. */
  checkpointAt: ResearchLabAlertTimestamp | null
}

export type ResearchLabDataFreshnessObservation = {
  /** Stable name for the dataset/feed whose freshness is being checked. */
  sourceId: string
  source?: string | null
  /** Null means the dataset has no readable activity timestamp. */
  observedAt: ResearchLabAlertTimestamp | null
}

/**
 * Canonical, already-normalized observations. Arrays may contain the same entity
 * from multiple sources; evaluation merges every emitted signal by fingerprint.
 */
export type ResearchLabAlertObservations = {
  validators?: readonly ResearchLabValidatorAlertObservation[]
  benchmarks?: readonly ResearchLabBenchmarkAlertObservation[]
  activeRuns?: readonly ResearchLabActiveRunAlertObservation[]
  transparencyCheckpoints?: readonly ResearchLabTransparencyCheckpointObservation[]
  dataFreshness?: readonly ResearchLabDataFreshnessObservation[]
}

export type ResearchLabEvaluatedAlert = {
  fingerprint: string
  signal: ResearchLabAlertSignal
  severity: ResearchLabAlertSeverity
  scope: ResearchLabAlertScope
  entityId: string
  validatorId: string | null
  title: string
  detail: string
  /** Timestamp behind the selected (most severe) observation, when readable. */
  observedAt: string | null
  ageMs: number | null
  /** Native chain age for on-chain last-update alerts. */
  ageBlocks: number | null
  /** Stable, sorted source labels contributing the same fingerprint. */
  sources: string[]
  /** Number of raw alert candidates collapsed into this fingerprint. */
  occurrences: number
}

export type ResearchLabAlertEvaluationOptions = {
  /** Required to keep evaluation pure and replayable. */
  now: ResearchLabAlertTimestamp
  thresholds?: ResearchLabAlertThresholdOverrides
}

const HOUR_MS = 60 * 60 * 1000
const MINUTE_MS = 60 * 1000

export const DEFAULT_RESEARCH_LAB_ALERT_THRESHOLDS: Readonly<ResearchLabAlertThresholds> =
  Object.freeze({
    pcr0Stale: frozenThreshold(3 * HOUR_MS, 6 * HOUR_MS),
    offchainWeightBundleStale: frozenThreshold(3 * HOUR_MS, 6 * HOUR_MS),
    onchainValidatorUpdateStale: Object.freeze({
      warnMs: 3 * HOUR_MS,
      criticalMs: 6 * HOUR_MS,
      warnBlocks: 360,
      criticalBlocks: 720,
    }),
    benchmarkStalled: frozenThreshold(15 * MINUTE_MS, 30 * MINUTE_MS),
    activeRunStale: frozenThreshold(15 * MINUTE_MS, 30 * MINUTE_MS),
    activeRunBlocked: frozenThreshold(0, 60 * MINUTE_MS),
    transparencyCheckpointStale: frozenThreshold(6 * HOUR_MS, 12 * HOUR_MS),
    dataFreshness: frozenThreshold(15 * MINUTE_MS, 60 * MINUTE_MS),
  })

const FAILED_STATUSES = new Set([
  'failed',
  'failure',
  'error',
  'errored',
  'cancelled',
  'canceled',
  'timeout',
  'timed_out',
])

const ACTIVE_BENCHMARK_STATUSES = new Set([
  'active',
  'assigned',
  'evaluating',
  'in_progress',
  'processing',
  'queued',
  'running',
  'scoring',
  'started',
])

const ACTIVE_RUN_STATUSES = new Set([
  ...ACTIVE_BENCHMARK_STATUSES,
  'paid_not_started',
  'waiting_for_baseline',
])

const BLOCKED_RUN_STATUSES = new Set([
  'blocked',
  'blocked_for_credit',
  'paused',
  'stale',
  'waiting_for_baseline',
  'waiting_for_credits',
])

type AlertCandidate = Omit<ResearchLabEvaluatedAlert, 'sources' | 'occurrences'> & {
  source: string
}

export function evaluateResearchLabAlerts(
  observations: ResearchLabAlertObservations,
  options: ResearchLabAlertEvaluationOptions,
): ResearchLabEvaluatedAlert[] {
  const nowMs = requiredTimestamp(options.now, 'now')
  const thresholds = resolveResearchLabAlertThresholds(options.thresholds)
  const candidates: AlertCandidate[] = []

  for (const observation of observations.validators ?? []) {
    evaluateValidatorObservation(observation, nowMs, thresholds, candidates)
  }
  for (const observation of observations.benchmarks ?? []) {
    evaluateBenchmarkObservation(observation, nowMs, thresholds, candidates)
  }
  for (const observation of observations.activeRuns ?? []) {
    evaluateActiveRunObservation(observation, nowMs, thresholds, candidates)
  }
  for (const observation of observations.transparencyCheckpoints ?? []) {
    evaluateCheckpointObservation(observation, nowMs, thresholds, candidates)
  }
  for (const observation of observations.dataFreshness ?? []) {
    evaluateDataFreshnessObservation(observation, nowMs, thresholds, candidates)
  }

  return dedupeCandidates(candidates)
}

export function resolveResearchLabAlertThresholds(
  overrides: ResearchLabAlertThresholdOverrides = {},
): ResearchLabAlertThresholds {
  const resolved = {} as ResearchLabAlertThresholds
  for (const key of Object.keys(DEFAULT_RESEARCH_LAB_ALERT_THRESHOLDS) as Array<keyof ResearchLabAlertThresholds>) {
    const defaults = DEFAULT_RESEARCH_LAB_ALERT_THRESHOLDS[key]
    const override = overrides[key]
    const threshold = { ...defaults, ...override } as ResearchLabAlertThresholds[typeof key]
    validateThreshold(key, threshold)
    if (key === 'onchainValidatorUpdateStale') {
      validateBlockThreshold(key, threshold as ResearchLabAlertAgeThreshold & ResearchLabAlertBlockThreshold)
    }
    ;(resolved as unknown as Record<
      keyof ResearchLabAlertThresholds,
      ResearchLabAlertThresholds[keyof ResearchLabAlertThresholds]
    >)[key] = threshold
  }
  return resolved
}

export function buildResearchLabAlertFingerprint(
  signal: ResearchLabAlertSignal,
  scope: ResearchLabAlertScope,
  entityId: string,
): string {
  return `research-lab:v1:${signal}:${scope}:${encodeURIComponent(requiredId(entityId, 'entityId'))}`
}

function evaluateValidatorObservation(
  observation: ResearchLabValidatorAlertObservation,
  nowMs: number,
  thresholds: ResearchLabAlertThresholds,
  candidates: AlertCandidate[],
): void {
  const validatorId = requiredId(observation.validatorId, 'validatorId')
  const source = sourceLabel(observation.source, 'validator telemetry')

  if (observation.pcr0 !== undefined) {
    const pcr0 = observation.pcr0
    const observedPcr0 = nonEmptyString(pcr0.observedPcr0)
    const expectedPcr0 = nonEmptyString(pcr0.expectedPcr0)
    const observedAtMs = optionalTimestamp(pcr0.observedAt)

    if (!observedPcr0) {
      candidates.push(immediateCandidate({
        signal: 'pcr0_missing',
        scope: 'validator',
        entityId: validatorId,
        validatorId,
        title: `Validator ${validatorId} is missing PCR0`,
        detail: 'The validator has no canonical PCR0 observation, so audited weight publication cannot be verified.',
        observedAtMs,
        nowMs,
        source,
      }))
    } else {
      const mismatched = pcr0.matched === false || (
        pcr0.matched !== true &&
        expectedPcr0 !== null &&
        normalizePcr0(expectedPcr0) !== normalizePcr0(observedPcr0)
      )
      if (mismatched) {
        candidates.push(immediateCandidate({
          signal: 'pcr0_mismatch',
          scope: 'validator',
          entityId: validatorId,
          validatorId,
          title: `Validator ${validatorId} PCR0 mismatch`,
          detail: expectedPcr0
            ? `Observed PCR0 ${observedPcr0} does not match expected PCR0 ${expectedPcr0}.`
            : `The canonical PCR0 comparison rejected observed PCR0 ${observedPcr0}.`,
          observedAtMs,
          nowMs,
          source,
        }))
      }

      const stale = staleCandidate({
        signal: 'pcr0_stale',
        scope: 'validator',
        entityId: validatorId,
        validatorId,
        title: `Validator ${validatorId} PCR0 observation is stale`,
        missingTimestampDetail: 'The validator publishes a PCR0, but its observation time is missing or invalid.',
        staleDetail: (ageMs) => `The latest PCR0 observation is ${durationLabel(ageMs)} old.`,
        observedAtMs,
        nowMs,
        threshold: thresholds.pcr0Stale,
        source,
      })
      if (stale) candidates.push(stale)
    }
  }

  if (observation.offchainWeightBundle !== undefined) {
    const bundle = observation.offchainWeightBundle
    const publishedAtMs = optionalTimestamp(bundle.publishedAt)
    if (publishedAtMs === null) {
      candidates.push(immediateCandidate({
        signal: 'offchain_weight_bundle_missing',
        scope: 'validator',
        entityId: validatorId,
        validatorId,
        title: `Validator ${validatorId} is missing an off-chain weight bundle`,
        detail: 'No canonical off-chain weight bundle publication was found for this validator.',
        observedAtMs: null,
        nowMs,
        source,
      }))
    } else {
      const stale = staleCandidate({
        signal: 'offchain_weight_bundle_stale',
        scope: 'validator',
        entityId: validatorId,
        validatorId,
        title: `Validator ${validatorId} off-chain weight bundle is stale`,
        missingTimestampDetail: 'The off-chain weight bundle has no readable publication time.',
        staleDetail: (ageMs) => `The latest off-chain weight bundle is ${durationLabel(ageMs)} old.`,
        observedAtMs: publishedAtMs,
        nowMs,
        threshold: thresholds.offchainWeightBundleStale,
        source,
      })
      if (stale) candidates.push(stale)
    }
  }

  if (observation.onchainUpdate !== undefined) {
    const update = observation.onchainUpdate
    const updatedAtMs = optionalTimestamp(update.updatedAt)
    const lastUpdateBlock = optionalBlock(update.lastUpdateBlock)
    const currentBlock = optionalBlock(update.currentBlock)
    if (lastUpdateBlock !== null && currentBlock !== null) {
      const stale = staleBlockCandidate({
        signal: 'onchain_validator_update_stale',
        scope: 'validator',
        entityId: validatorId,
        validatorId,
        title: `Validator ${validatorId} on-chain update is stale`,
        staleDetail: (ageBlocks) => `The validator last set weights ${ageBlocks} block${ageBlocks === 1 ? '' : 's'} ago (last update ${lastUpdateBlock}, head ${currentBlock}).`,
        observedAtMs: updatedAtMs,
        ageBlocks: Math.max(0, currentBlock - lastUpdateBlock),
        threshold: thresholds.onchainValidatorUpdateStale,
        source,
      })
      if (stale) candidates.push(stale)
    } else if (lastUpdateBlock !== null && updatedAtMs === null) {
      candidates.push(immediateCandidate({
        signal: 'onchain_validator_update_missing',
        scope: 'validator',
        entityId: validatorId,
        validatorId,
        title: `Validator ${validatorId} on-chain freshness is unavailable`,
        detail: `The validator last-update block is ${lastUpdateBlock}, but the current chain head is missing or invalid.`,
        observedAtMs: null,
        nowMs,
        source,
      }))
    } else if (updatedAtMs !== null) {
      const stale = staleCandidate({
        signal: 'onchain_validator_update_stale',
        scope: 'validator',
        entityId: validatorId,
        validatorId,
        title: `Validator ${validatorId} on-chain update is stale`,
        missingTimestampDetail: 'The validator on-chain update has no readable time.',
        staleDetail: (ageMs) => `The latest on-chain validator update is ${durationLabel(ageMs)} old.`,
        observedAtMs: updatedAtMs,
        nowMs,
        threshold: thresholds.onchainValidatorUpdateStale,
        source,
      })
      if (stale) candidates.push(stale)
    } else {
      candidates.push(immediateCandidate({
        signal: 'onchain_validator_update_missing',
        scope: 'validator',
        entityId: validatorId,
        validatorId,
        title: `Validator ${validatorId} is missing an on-chain update`,
        detail: 'No canonical on-chain validator last-update was found.',
        observedAtMs: null,
        nowMs,
        source,
      }))
    }
  }
}

function evaluateBenchmarkObservation(
  observation: ResearchLabBenchmarkAlertObservation,
  nowMs: number,
  thresholds: ResearchLabAlertThresholds,
  candidates: AlertCandidate[],
): void {
  const benchmarkId = requiredId(observation.benchmarkId, 'benchmarkId')
  const validatorId = optionalId(observation.validatorId)
  const source = sourceLabel(observation.source, 'benchmark telemetry')
  const status = normalizedStatus(observation.status)

  if (FAILED_STATUSES.has(status)) {
    const failedAtMs = firstTimestamp(observation.failedAt, observation.lastActivityAt, observation.startedAt)
    candidates.push(immediateCandidate({
      signal: 'benchmark_failed',
      scope: 'benchmark',
      entityId: benchmarkId,
      validatorId,
      title: `Benchmark ${benchmarkId} failed`,
      detail: nonEmptyString(observation.error) ?? `Benchmark ended with status ${status || 'failed'}.`,
      observedAtMs: failedAtMs,
      nowMs,
      source,
    }))
  }

  if (ACTIVE_BENCHMARK_STATUSES.has(status)) {
    const activityAtMs = firstTimestamp(observation.lastActivityAt, observation.startedAt)
    const stale = staleCandidate({
      signal: 'benchmark_stalled',
      scope: 'benchmark',
      entityId: benchmarkId,
      validatorId,
      title: `Benchmark ${benchmarkId} is stalled`,
      missingTimestampDetail: 'The benchmark is active but has no readable activity timestamp.',
      staleDetail: (ageMs) => `The active benchmark has not emitted progress for ${durationLabel(ageMs)}.`,
      observedAtMs: activityAtMs,
      nowMs,
      threshold: thresholds.benchmarkStalled,
      source,
    })
    if (stale) candidates.push(stale)
  }
}

function evaluateActiveRunObservation(
  observation: ResearchLabActiveRunAlertObservation,
  nowMs: number,
  thresholds: ResearchLabAlertThresholds,
  candidates: AlertCandidate[],
): void {
  const runId = requiredId(observation.runId, 'runId')
  const validatorId = optionalId(observation.validatorId)
  const source = sourceLabel(observation.source, 'run telemetry')
  const status = normalizedStatus(observation.status)
  const activityAtMs = firstTimestamp(observation.lastActivityAt, observation.startedAt)

  if (ACTIVE_RUN_STATUSES.has(status)) {
    const stale = staleCandidate({
      signal: 'active_run_stale',
      scope: 'run',
      entityId: runId,
      validatorId,
      title: `Active run ${runId} is stale`,
      missingTimestampDetail: 'The run is active but has no readable activity timestamp.',
      staleDetail: (ageMs) => `The active run has not emitted progress for ${durationLabel(ageMs)}.`,
      observedAtMs: activityAtMs,
      nowMs,
      threshold: thresholds.activeRunStale,
      source,
    })
    if (stale) candidates.push(stale)
  }

  if (observation.blocked === true || BLOCKED_RUN_STATUSES.has(status)) {
    const blockedAtMs = firstTimestamp(observation.blockedAt, observation.lastActivityAt, observation.startedAt)
    const blocked = staleCandidate({
      signal: 'active_run_blocked',
      scope: 'run',
      entityId: runId,
      validatorId,
      title: `Active run ${runId} is blocked`,
      missingTimestampDetail: nonEmptyString(observation.blocker) ?? 'The run is blocked and has no readable blocker timestamp.',
      staleDetail: (ageMs) => {
        const blocker = nonEmptyString(observation.blocker)
        return blocker
          ? `${blocker} Blocked for ${durationLabel(ageMs)}.`
          : `The run has been blocked for ${durationLabel(ageMs)}.`
      },
      observedAtMs: blockedAtMs,
      nowMs,
      threshold: thresholds.activeRunBlocked,
      source,
    })
    if (blocked) candidates.push(blocked)
  }
}

function evaluateCheckpointObservation(
  observation: ResearchLabTransparencyCheckpointObservation,
  nowMs: number,
  thresholds: ResearchLabAlertThresholds,
  candidates: AlertCandidate[],
): void {
  const checkpointId = requiredId(observation.checkpointId, 'checkpointId')
  const source = sourceLabel(observation.source, 'transparency log')
  const checkpointAtMs = optionalTimestamp(observation.checkpointAt)
  const stale = staleCandidate({
    signal: 'transparency_checkpoint_stale',
    scope: 'transparency',
    entityId: checkpointId,
    validatorId: null,
    title: `Transparency checkpoint ${checkpointId} is stale`,
    missingTimestampDetail: 'No canonical transparency checkpoint was found.',
    staleDetail: (ageMs) => `The latest transparency checkpoint is ${durationLabel(ageMs)} old.`,
    observedAtMs: checkpointAtMs,
    nowMs,
    threshold: thresholds.transparencyCheckpointStale,
    source,
  })
  if (stale) candidates.push(stale)
}

function evaluateDataFreshnessObservation(
  observation: ResearchLabDataFreshnessObservation,
  nowMs: number,
  thresholds: ResearchLabAlertThresholds,
  candidates: AlertCandidate[],
): void {
  const sourceId = requiredId(observation.sourceId, 'sourceId')
  const source = sourceLabel(observation.source, sourceId)
  const observedAtMs = optionalTimestamp(observation.observedAt)
  const stale = staleCandidate({
    signal: 'data_freshness',
    scope: 'data',
    entityId: sourceId,
    validatorId: null,
    title: `Data source ${sourceId} is stale`,
    missingTimestampDetail: 'The data source has no readable activity timestamp.',
    staleDetail: (ageMs) => `The latest data activity is ${durationLabel(ageMs)} old.`,
    observedAtMs,
    nowMs,
    threshold: thresholds.dataFreshness,
    source,
  })
  if (stale) candidates.push(stale)
}

function staleCandidate(input: {
  signal: ResearchLabAlertSignal
  scope: ResearchLabAlertScope
  entityId: string
  validatorId: string | null
  title: string
  missingTimestampDetail: string
  staleDetail: (ageMs: number) => string
  observedAtMs: number | null
  nowMs: number
  threshold: ResearchLabAlertAgeThreshold
  source: string
}): AlertCandidate | null {
  if (input.observedAtMs === null) {
    return candidate({
      ...input,
      severity: 'critical',
      detail: input.missingTimestampDetail,
      ageMs: null,
    })
  }

  const ageMs = Math.max(0, input.nowMs - input.observedAtMs)
  const severity = severityAtAge(ageMs, input.threshold)
  if (!severity) return null
  return candidate({
    ...input,
    severity,
    detail: input.staleDetail(ageMs),
    ageMs,
  })
}

function staleBlockCandidate(input: {
  signal: ResearchLabAlertSignal
  scope: ResearchLabAlertScope
  entityId: string
  validatorId: string | null
  title: string
  staleDetail: (ageBlocks: number) => string
  observedAtMs: number | null
  ageBlocks: number
  threshold: ResearchLabAlertBlockThreshold
  source: string
}): AlertCandidate | null {
  const severity = severityAtBlockAge(input.ageBlocks, input.threshold)
  if (!severity) return null
  return candidate({
    ...input,
    severity,
    detail: input.staleDetail(input.ageBlocks),
    ageMs: null,
  })
}

function immediateCandidate(input: {
  signal: ResearchLabAlertSignal
  scope: ResearchLabAlertScope
  entityId: string
  validatorId: string | null
  title: string
  detail: string
  observedAtMs: number | null
  nowMs: number
  source: string
}): AlertCandidate {
  return candidate({
    ...input,
    severity: 'critical',
    ageMs: input.observedAtMs === null ? null : Math.max(0, input.nowMs - input.observedAtMs),
  })
}

function candidate(input: {
  signal: ResearchLabAlertSignal
  severity: ResearchLabAlertSeverity
  scope: ResearchLabAlertScope
  entityId: string
  validatorId: string | null
  title: string
  detail: string
  observedAtMs: number | null
  ageMs: number | null
  ageBlocks?: number | null
  source: string
}): AlertCandidate {
  return {
    fingerprint: buildResearchLabAlertFingerprint(input.signal, input.scope, input.entityId),
    signal: input.signal,
    severity: input.severity,
    scope: input.scope,
    entityId: input.entityId,
    validatorId: input.validatorId,
    title: input.title,
    detail: input.detail,
    observedAt: input.observedAtMs === null ? null : new Date(input.observedAtMs).toISOString(),
    ageMs: input.ageMs,
    ageBlocks: input.ageBlocks ?? null,
    source: input.source,
  }
}

function dedupeCandidates(candidates: readonly AlertCandidate[]): ResearchLabEvaluatedAlert[] {
  const grouped = new Map<string, AlertCandidate[]>()
  for (const candidate of candidates) {
    const existing = grouped.get(candidate.fingerprint)
    if (existing) existing.push(candidate)
    else grouped.set(candidate.fingerprint, [candidate])
  }

  return Array.from(grouped.values())
    .map((matches) => {
      const selected = [...matches].sort(compareCandidatePriority)[0]
      return {
        fingerprint: selected.fingerprint,
        signal: selected.signal,
        severity: selected.severity,
        scope: selected.scope,
        entityId: selected.entityId,
        validatorId: selected.validatorId,
        title: selected.title,
        detail: selected.detail,
        observedAt: selected.observedAt,
        ageMs: selected.ageMs,
        ageBlocks: selected.ageBlocks,
        sources: Array.from(new Set(matches.map((match) => match.source))).sort(),
        occurrences: matches.length,
      }
    })
    .sort(compareEvaluatedAlerts)
}

function compareCandidatePriority(a: AlertCandidate, b: AlertCandidate): number {
  return severityRank(b.severity) - severityRank(a.severity) ||
    nullableAgeRank(b.ageMs) - nullableAgeRank(a.ageMs) ||
    nullableAgeRank(b.ageBlocks) - nullableAgeRank(a.ageBlocks) ||
    a.source.localeCompare(b.source) ||
    a.detail.localeCompare(b.detail)
}

function compareEvaluatedAlerts(a: ResearchLabEvaluatedAlert, b: ResearchLabEvaluatedAlert): number {
  return severityRank(b.severity) - severityRank(a.severity) ||
    a.fingerprint.localeCompare(b.fingerprint)
}

function severityAtAge(
  ageMs: number,
  threshold: ResearchLabAlertAgeThreshold,
): ResearchLabAlertSeverity | null {
  if (ageMs >= threshold.criticalMs) return 'critical'
  if (ageMs >= threshold.warnMs) return 'warning'
  return null
}

function severityAtBlockAge(
  ageBlocks: number,
  threshold: ResearchLabAlertBlockThreshold,
): ResearchLabAlertSeverity | null {
  if (ageBlocks >= threshold.criticalBlocks) return 'critical'
  if (ageBlocks >= threshold.warnBlocks) return 'warning'
  return null
}

function validateThreshold(
  key: keyof ResearchLabAlertThresholds,
  threshold: ResearchLabAlertAgeThreshold,
): void {
  if (!Number.isFinite(threshold.warnMs) || threshold.warnMs < 0) {
    throw new TypeError(`${key}.warnMs must be a finite, non-negative number`)
  }
  if (!Number.isFinite(threshold.criticalMs) || threshold.criticalMs < threshold.warnMs) {
    throw new TypeError(`${key}.criticalMs must be finite and greater than or equal to warnMs`)
  }
}

function validateBlockThreshold(
  key: keyof ResearchLabAlertThresholds,
  threshold: ResearchLabAlertBlockThreshold,
): void {
  if (!Number.isSafeInteger(threshold.warnBlocks) || threshold.warnBlocks < 0) {
    throw new TypeError(`${key}.warnBlocks must be a non-negative safe integer`)
  }
  if (!Number.isSafeInteger(threshold.criticalBlocks) || threshold.criticalBlocks < threshold.warnBlocks) {
    throw new TypeError(`${key}.criticalBlocks must be a safe integer greater than or equal to warnBlocks`)
  }
}

function frozenThreshold(warnMs: number, criticalMs: number): Readonly<ResearchLabAlertAgeThreshold> {
  return Object.freeze({ warnMs, criticalMs })
}

function requiredTimestamp(value: ResearchLabAlertTimestamp, label: string): number {
  const timestamp = optionalTimestamp(value)
  if (timestamp === null) throw new TypeError(`${label} must be a valid timestamp`)
  return timestamp
}

function optionalTimestamp(value: ResearchLabAlertTimestamp | null | undefined): number | null {
  if (value === null || value === undefined) return null
  const timestamp = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : null
}

function optionalBlock(value: number | null | undefined): number | null {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : null
}

function firstTimestamp(
  ...values: Array<ResearchLabAlertTimestamp | null | undefined>
): number | null {
  for (const value of values) {
    const timestamp = optionalTimestamp(value)
    if (timestamp !== null) return timestamp
  }
  return null
}

function requiredId(value: string, label: string): string {
  const id = nonEmptyString(value)
  if (!id) throw new TypeError(`${label} must be a non-empty string`)
  return id
}

function optionalId(value: string | null | undefined): string | null {
  return nonEmptyString(value)
}

function nonEmptyString(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function sourceLabel(value: string | null | undefined, fallback: string): string {
  return nonEmptyString(value) ?? fallback
}

function normalizedStatus(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, '_')
}

function normalizePcr0(value: string): string {
  return value.trim().toLowerCase()
}

function severityRank(severity: ResearchLabAlertSeverity): number {
  return severity === 'critical' ? 2 : 1
}

function nullableAgeRank(ageMs: number | null): number {
  return ageMs === null ? Number.MAX_SAFE_INTEGER : ageMs
}

function durationLabel(ageMs: number): string {
  if (ageMs < MINUTE_MS) return `${Math.floor(ageMs / 1000)}s`
  if (ageMs < HOUR_MS) return `${Math.floor(ageMs / MINUTE_MS)}m`
  const hours = Math.floor(ageMs / HOUR_MS)
  const minutes = Math.floor((ageMs % HOUR_MS) / MINUTE_MS)
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`
}
