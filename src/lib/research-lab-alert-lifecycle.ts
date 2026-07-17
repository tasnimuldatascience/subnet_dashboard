import type {
  ResearchLabAlertResolution,
  ResearchLabAlertSeverity,
  ResearchLabEvaluatedAlert,
} from './research-lab-alerts'

export type ResearchLabAlertLifecycleTimestamp = string | number | Date

export type ResearchLabAlertIncidentStatus = 'pending' | 'open' | 'resolved'

export type ResearchLabAlertTransitionType =
  | 'open'
  | 'escalate'
  | 'deescalate'
  | 'recover'
  | 'debounce_cancel'

export type ResearchLabAlertDeliverableTransition = Extract<
  ResearchLabAlertTransitionType,
  'open' | 'escalate' | 'recover'
>

export type ResearchLabAlertDeliveryChannel = 'email' | 'discord'

/**
 * One durable row per alert fingerprint. Resolved rows are deliberately kept:
 * the next observation reuses the incident identity but starts a new episode.
 */
export type ResearchLabAlertIncident = {
  incidentId: string
  fingerprint: string
  status: ResearchLabAlertIncidentStatus
  episode: number
  transitionSequence: number
  severity: ResearchLabAlertSeverity | null
  pendingSince: string | null
  firstObservedAt: string
  lastObservedAt: string
  openedAt: string | null
  resolvedAt: string | null
  createdAt: string
  updatedAt: string
  lastTransitionAt: string | null
  lastTransitionType: ResearchLabAlertTransitionType | null
  /** Latest alert snapshot, retained after recovery for audit and messaging. */
  alert: ResearchLabEvaluatedAlert
}

export type ResearchLabAlertTransitionEvent = {
  eventId: string
  transitionId: string
  incidentId: string
  fingerprint: string
  episode: number
  sequence: number
  transition: ResearchLabAlertTransitionType
  fromStatus: ResearchLabAlertIncidentStatus | null
  toStatus: ResearchLabAlertIncidentStatus
  fromSeverity: ResearchLabAlertSeverity | null
  toSeverity: ResearchLabAlertSeverity | null
  occurredAt: string
  alert: ResearchLabEvaluatedAlert
}

export type ResearchLabAlertResolvedTransition = ResearchLabAlertTransitionEvent & {
  transition: 'recover' | 'debounce_cancel'
  toStatus: 'resolved'
}

export type ResearchLabAlertDestination = {
  channel: ResearchLabAlertDeliveryChannel
  /** Email address or Discord webhook/target. Whitespace is ignored. */
  destination: string
  enabled?: boolean
  minimumSeverity?: ResearchLabAlertSeverity
  transitions?: readonly ResearchLabAlertDeliverableTransition[]
}

export type ResearchLabAlertDeliveryPayload = {
  transitionId: string
  transition: ResearchLabAlertDeliverableTransition
  incidentId: string
  fingerprint: string
  episode: number
  sequence: number
  occurredAt: string
  fromStatus: ResearchLabAlertIncidentStatus | null
  toStatus: ResearchLabAlertIncidentStatus
  fromSeverity: ResearchLabAlertSeverity | null
  toSeverity: ResearchLabAlertSeverity | null
  severity: ResearchLabAlertSeverity
  alert: ResearchLabEvaluatedAlert
}

/**
 * A durable queue intent. `idempotencyKey` intentionally remains identical
 * across retries; `intentId` identifies the individual attempt.
 */
export type ResearchLabAlertDeliveryIntent = {
  intentId: string
  idempotencyKey: string
  attempt: number
  isRetry: boolean
  dueAt: string
  retryDelayMs: number
  channel: ResearchLabAlertDeliveryChannel
  destination: string
  destinationHash: string
  transitionId: string
  transition: ResearchLabAlertDeliverableTransition
  incidentId: string
  fingerprint: string
  payload: ResearchLabAlertDeliveryPayload
}

/** Append-only outcome recorded by the delivery worker. */
export type ResearchLabAlertDeliveryAttempt = {
  intentId: string
  idempotencyKey: string
  attempt: number
  status: 'pending' | 'succeeded' | 'failed'
  attemptedAt: ResearchLabAlertLifecycleTimestamp
  channel: ResearchLabAlertDeliveryChannel
  destinationHash: string
  transitionId: string
  transition: ResearchLabAlertDeliverableTransition
  incidentId: string
  fingerprint: string
  payload: ResearchLabAlertDeliveryPayload
  error?: string | null
}

export type ResearchLabAlertDeliverySuppression = {
  idempotencyKey: string
  transitionId: string
  channel: ResearchLabAlertDeliveryChannel
  destinationHash: string
  reason: 'cooldown' | 'minimum_severity' | 'transition_filtered'
  eligibleAt: string | null
}

export type ResearchLabAlertRetryExhaustion = {
  idempotencyKey: string
  transitionId: string
  channel: ResearchLabAlertDeliveryChannel
  destinationHash: string
  attempts: number
  maxAttempts: number
  lastAttemptAt: string
}

export type ResearchLabAlertRetryPolicy = {
  /** Includes the initial attempt. */
  maxAttempts: number
  baseDelayMs: number
  maxDelayMs: number
}

export type ResearchLabAlertLifecyclePolicy = {
  debounceMs?: number | Partial<Record<ResearchLabAlertSeverity, number>>
  cooldownMs?: number | Partial<Record<ResearchLabAlertDeliverableTransition, number>>
  retry?: Partial<ResearchLabAlertRetryPolicy>
}

export type ResolvedResearchLabAlertLifecyclePolicy = {
  debounceMs: Record<ResearchLabAlertSeverity, number>
  cooldownMs: Record<ResearchLabAlertDeliverableTransition, number>
  retry: ResearchLabAlertRetryPolicy
}

export type ResearchLabAlertLifecycleInput = {
  /** Required for deterministic replay; the planner never reads the clock. */
  now: ResearchLabAlertLifecycleTimestamp
  previousIncidents?: readonly ResearchLabAlertIncident[]
  evaluatedAlerts: readonly ResearchLabEvaluatedAlert[]
  /** Terminal entity outcomes used to make closure notifications truthful. */
  resolutions?: readonly ResearchLabAlertResolution[]
  destinations?: readonly ResearchLabAlertDestination[]
  priorDeliveryAttempts?: readonly ResearchLabAlertDeliveryAttempt[]
  policy?: ResearchLabAlertLifecyclePolicy
}

export type ResearchLabAlertLifecyclePlan = {
  incidentUpserts: ResearchLabAlertIncident[]
  resolvedTransitions: ResearchLabAlertResolvedTransition[]
  transitionEvents: ResearchLabAlertTransitionEvent[]
  deliveryIntents: ResearchLabAlertDeliveryIntent[]
  deliverySuppressions: ResearchLabAlertDeliverySuppression[]
  retryExhaustions: ResearchLabAlertRetryExhaustion[]
  policy: ResolvedResearchLabAlertLifecyclePolicy
}

const SECOND_MS = 1_000
const MINUTE_MS = 60 * SECOND_MS

export const DEFAULT_RESEARCH_LAB_ALERT_LIFECYCLE_POLICY: Readonly<ResolvedResearchLabAlertLifecyclePolicy> =
  Object.freeze({
    debounceMs: Object.freeze({
      warning: 5 * MINUTE_MS,
      critical: MINUTE_MS,
    }),
    cooldownMs: Object.freeze({
      open: 30 * MINUTE_MS,
      escalate: 15 * MINUTE_MS,
      recover: 30 * MINUTE_MS,
    }),
    retry: Object.freeze({
      maxAttempts: 5,
      baseDelayMs: MINUTE_MS,
      maxDelayMs: 30 * MINUTE_MS,
    }),
  })

const DELIVERABLE_TRANSITIONS = new Set<ResearchLabAlertTransitionType>([
  'open',
  'escalate',
  'recover',
])

type NormalizedDestination = {
  channel: ResearchLabAlertDeliveryChannel
  destination: string
  destinationHash: string
  minimumSeverity: ResearchLabAlertSeverity
  transitions: ReadonlySet<ResearchLabAlertDeliverableTransition>
}

type DeliverySeed = {
  destination: NormalizedDestination
  payload: ResearchLabAlertDeliveryPayload
  idempotencyKey: string
}

type CanonicalAttemptGroup = {
  idempotencyKey: string
  attempts: ResearchLabAlertDeliveryAttempt[]
  latest: ResearchLabAlertDeliveryAttempt
  maxAttempt: number
  succeeded: boolean
}

export function planResearchLabAlertLifecycle(
  input: ResearchLabAlertLifecycleInput,
): ResearchLabAlertLifecyclePlan {
  const nowMs = requiredTimestamp(input.now, 'now')
  const now = new Date(nowMs).toISOString()
  const policy = resolveResearchLabAlertLifecyclePolicy(input.policy)
  const currentAlerts = indexCurrentAlerts(input.evaluatedAlerts)
  const previousIncidents = indexPreviousIncidents(input.previousIncidents ?? [])
  const resolutions = indexResolutions(input.resolutions ?? [])
  const destinations = normalizeDestinations(input.destinations ?? [])
  const attempts = canonicalizeAttempts(input.priorDeliveryAttempts ?? [])
  const incidentUpserts: ResearchLabAlertIncident[] = []
  const transitionEvents: ResearchLabAlertTransitionEvent[] = []

  for (const [fingerprint, alert] of sortedEntries(currentAlerts)) {
    const previous = previousIncidents.get(fingerprint) ?? null
    const observed = observeIncident(previous, alert, now)
    const debounceMs = policy.debounceMs[alert.severity]

    if (observed.status === 'pending') {
      const pendingSinceMs = requiredTimestamp(observed.pendingSince, 'incident.pendingSince')
      if (Math.max(0, nowMs - pendingSinceMs) >= debounceMs) {
        const opened = transitionIncident({
          incident: observed,
          previous,
          transition: 'open',
          toStatus: 'open',
          toSeverity: alert.severity,
          now,
        })
        incidentUpserts.push(opened.incident)
        transitionEvents.push(opened.event)
      } else {
        incidentUpserts.push(observed)
      }
      continue
    }

    if (observed.status !== 'open') {
      throw new Error(`Observed incident ${observed.incidentId} has invalid status ${observed.status}`)
    }

    if (previous?.severity === 'warning' && alert.severity === 'critical') {
      const escalated = transitionIncident({
        incident: observed,
        previous,
        transition: 'escalate',
        toStatus: 'open',
        toSeverity: 'critical',
        now,
      })
      incidentUpserts.push(escalated.incident)
      transitionEvents.push(escalated.event)
    } else if (previous?.severity === 'critical' && alert.severity === 'warning') {
      const deescalated = transitionIncident({
        incident: observed,
        previous,
        transition: 'deescalate',
        toStatus: 'open',
        toSeverity: 'warning',
        now,
      })
      incidentUpserts.push(deescalated.incident)
      transitionEvents.push(deescalated.event)
    } else {
      incidentUpserts.push(observed)
    }
  }

  for (const [fingerprint, previous] of sortedEntries(previousIncidents)) {
    if (currentAlerts.has(fingerprint) || previous.status === 'resolved') continue
    const transition = previous.status === 'open' ? 'recover' : 'debounce_cancel'
    const resolution = resolutions.get(fingerprint)
    const resolved = transitionIncident({
      incident: {
        ...copyIncident(previous),
        updatedAt: now,
        alert: resolution
          ? applyResolution(previous.alert, resolution)
          : copyAlert(previous.alert),
      },
      previous,
      transition,
      toStatus: 'resolved',
      toSeverity: null,
      now,
    })
    incidentUpserts.push(resolved.incident)
    transitionEvents.push(resolved.event)
  }

  incidentUpserts.sort(compareIncidents)
  transitionEvents.sort(compareTransitions)

  const finalIncidents = new Map(previousIncidents)
  for (const incident of incidentUpserts) finalIncidents.set(incident.fingerprint, incident)

  const {
    deliveryIntents,
    deliverySuppressions,
    retryExhaustions,
  } = planDeliveries({
    transitionEvents,
    destinations,
    attempts,
    finalIncidents,
    nowMs,
    policy,
  })

  return {
    incidentUpserts,
    resolvedTransitions: transitionEvents.filter(isResolvedTransition),
    transitionEvents,
    deliveryIntents,
    deliverySuppressions,
    retryExhaustions,
    policy,
  }
}

export function resolveResearchLabAlertLifecyclePolicy(
  override: ResearchLabAlertLifecyclePolicy = {},
): ResolvedResearchLabAlertLifecyclePolicy {
  const debounceMs = resolveDurationMap(
    'debounceMs',
    override.debounceMs,
    DEFAULT_RESEARCH_LAB_ALERT_LIFECYCLE_POLICY.debounceMs,
    ['warning', 'critical'],
  )
  const cooldownMs = resolveDurationMap(
    'cooldownMs',
    override.cooldownMs,
    DEFAULT_RESEARCH_LAB_ALERT_LIFECYCLE_POLICY.cooldownMs,
    ['open', 'escalate', 'recover'],
  )
  const retry = {
    ...DEFAULT_RESEARCH_LAB_ALERT_LIFECYCLE_POLICY.retry,
    ...override.retry,
  }

  if (!Number.isInteger(retry.maxAttempts) || retry.maxAttempts < 1 || retry.maxAttempts > 20) {
    throw new Error('retry.maxAttempts must be an integer between 1 and 20')
  }
  requiredDuration(retry.baseDelayMs, 'retry.baseDelayMs')
  requiredDuration(retry.maxDelayMs, 'retry.maxDelayMs')
  if (retry.maxDelayMs < retry.baseDelayMs) {
    throw new Error('retry.maxDelayMs must be greater than or equal to retry.baseDelayMs')
  }

  return { debounceMs, cooldownMs, retry }
}

export function buildResearchLabAlertIncidentId(fingerprint: string): string {
  return `research-lab-incident:v1:${encodeURIComponent(requiredUnpaddedText(fingerprint, 'fingerprint'))}`
}

export function hashResearchLabAlertDestination(
  channel: ResearchLabAlertDeliveryChannel,
  destination: string,
): string {
  const normalized = normalizeDestinationValue(channel, destination)
  return stableOpaqueHash(`${channel}\u0000${normalized}`)
}

export function buildResearchLabAlertDeliveryIdempotencyKey(
  transitionId: string,
  channel: ResearchLabAlertDeliveryChannel,
  destinationHash: string,
): string {
  return `${requiredText(transitionId, 'transitionId')}:delivery:${channel}:${requiredText(destinationHash, 'destinationHash')}`
}

export function researchLabAlertRetryDelayMs(
  failedAttempt: number,
  retry: ResearchLabAlertRetryPolicy = DEFAULT_RESEARCH_LAB_ALERT_LIFECYCLE_POLICY.retry,
): number {
  if (!Number.isInteger(failedAttempt) || failedAttempt < 1) {
    throw new Error('failedAttempt must be a positive integer')
  }
  requiredDuration(retry.baseDelayMs, 'retry.baseDelayMs')
  requiredDuration(retry.maxDelayMs, 'retry.maxDelayMs')
  if (retry.maxDelayMs < retry.baseDelayMs) {
    throw new Error('retry.maxDelayMs must be greater than or equal to retry.baseDelayMs')
  }
  const multiplier = 2 ** Math.min(failedAttempt - 1, 19)
  return Math.min(retry.maxDelayMs, retry.baseDelayMs * multiplier)
}

function observeIncident(
  previous: ResearchLabAlertIncident | null,
  alertInput: ResearchLabEvaluatedAlert,
  now: string,
): ResearchLabAlertIncident {
  const alert = copyAlert(alertInput)
  if (!previous || previous.status === 'resolved') {
    return {
      incidentId: previous?.incidentId ?? buildResearchLabAlertIncidentId(alert.fingerprint),
      fingerprint: alert.fingerprint,
      status: 'pending',
      episode: (previous?.episode ?? 0) + 1,
      transitionSequence: previous?.transitionSequence ?? 0,
      severity: alert.severity,
      pendingSince: now,
      firstObservedAt: now,
      lastObservedAt: now,
      openedAt: null,
      resolvedAt: null,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
      lastTransitionAt: previous?.lastTransitionAt ?? null,
      lastTransitionType: previous?.lastTransitionType ?? null,
      alert,
    }
  }

  return {
    ...copyIncident(previous),
    status: previous.status,
    severity: alert.severity,
    lastObservedAt: now,
    resolvedAt: null,
    updatedAt: now,
    alert,
  }
}

function transitionIncident({
  incident,
  previous,
  transition,
  toStatus,
  toSeverity,
  now,
}: {
  incident: ResearchLabAlertIncident
  previous: ResearchLabAlertIncident | null
  transition: ResearchLabAlertTransitionType
  toStatus: ResearchLabAlertIncidentStatus
  toSeverity: ResearchLabAlertSeverity | null
  now: string
}): { incident: ResearchLabAlertIncident; event: ResearchLabAlertTransitionEvent } {
  const sequence = (previous?.transitionSequence ?? incident.transitionSequence) + 1
  const transitionId = `${incident.incidentId}:episode:${incident.episode}:transition:${sequence}:${transition}`
  const fromStatus = previous?.status ?? null
  const fromSeverity = previous?.severity ?? null
  const next: ResearchLabAlertIncident = {
    ...copyIncident(incident),
    status: toStatus,
    severity: toSeverity,
    transitionSequence: sequence,
    pendingSince: toStatus === 'pending' ? incident.pendingSince : null,
    openedAt: transition === 'open' ? now : incident.openedAt,
    resolvedAt: toStatus === 'resolved' ? now : null,
    updatedAt: now,
    lastTransitionAt: now,
    lastTransitionType: transition,
  }
  const event: ResearchLabAlertTransitionEvent = {
    eventId: transitionId,
    transitionId,
    incidentId: incident.incidentId,
    fingerprint: incident.fingerprint,
    episode: incident.episode,
    sequence,
    transition,
    fromStatus,
    toStatus,
    fromSeverity,
    toSeverity,
    occurredAt: now,
    alert: copyAlert(incident.alert),
  }
  return { incident: next, event }
}

function planDeliveries({
  transitionEvents,
  destinations,
  attempts,
  finalIncidents,
  nowMs,
  policy,
}: {
  transitionEvents: readonly ResearchLabAlertTransitionEvent[]
  destinations: readonly NormalizedDestination[]
  attempts: ReadonlyMap<string, CanonicalAttemptGroup>
  finalIncidents: ReadonlyMap<string, ResearchLabAlertIncident>
  nowMs: number
  policy: ResolvedResearchLabAlertLifecyclePolicy
}): Pick<
  ResearchLabAlertLifecyclePlan,
  'deliveryIntents' | 'deliverySuppressions' | 'retryExhaustions'
> {
  const seeds = new Map<string, DeliverySeed>()
  const deliverySuppressions: ResearchLabAlertDeliverySuppression[] = []

  for (const event of transitionEvents) {
    if (!isDeliverableTransition(event.transition)) continue
    const payload = deliveryPayload(event)
    for (const destination of destinations) {
      const idempotencyKey = buildResearchLabAlertDeliveryIdempotencyKey(
        event.transitionId,
        destination.channel,
        destination.destinationHash,
      )
      if (!destination.transitions.has(event.transition)) {
        deliverySuppressions.push(suppression(
          idempotencyKey,
          event,
          destination,
          'transition_filtered',
          null,
        ))
        continue
      }
      if (severityRank(payload.severity) < severityRank(destination.minimumSeverity)) {
        deliverySuppressions.push(suppression(
          idempotencyKey,
          event,
          destination,
          'minimum_severity',
          null,
        ))
        continue
      }

      const cooldownMs = policy.cooldownMs[event.transition]
      const cooldownReference = latestCooldownAttempt({
        attempts,
        event,
        destination,
        currentIdempotencyKey: idempotencyKey,
      })
      const eligibleAtMs = cooldownReference === null
        ? null
        : cooldownReference + cooldownMs
      if (eligibleAtMs !== null && nowMs < eligibleAtMs) {
        deliverySuppressions.push(suppression(
          idempotencyKey,
          event,
          destination,
          'cooldown',
          new Date(eligibleAtMs).toISOString(),
        ))
        continue
      }
      seeds.set(idempotencyKey, { destination, payload, idempotencyKey })
    }
  }

  // A retry survives only while its transition is still the incident's latest
  // state change. This prevents an old open/escalation page after recovery.
  for (const group of attempts.values()) {
    if (!isRetryStillRelevant(group.latest, finalIncidents)) continue
    const destination = destinations.find((candidate) => (
      candidate.channel === group.latest.channel &&
      candidate.destinationHash === group.latest.destinationHash
    ))
    if (!destination) continue
    if (
      !destination.transitions.has(group.latest.transition) ||
      severityRank(group.latest.payload.severity) < severityRank(destination.minimumSeverity)
    ) continue
    if (!seeds.has(group.idempotencyKey)) {
      seeds.set(group.idempotencyKey, {
        destination,
        payload: copyPayload(group.latest.payload),
        idempotencyKey: group.idempotencyKey,
      })
    }
  }

  const deliveryIntents: ResearchLabAlertDeliveryIntent[] = []
  const retryExhaustions: ResearchLabAlertRetryExhaustion[] = []
  for (const seed of Array.from(seeds.values()).sort(compareDeliverySeeds)) {
    const group = attempts.get(seed.idempotencyKey)
    if (!group) {
      deliveryIntents.push(deliveryIntent(seed, 1, seed.payload.occurredAt, 0))
      continue
    }
    if (group.succeeded || group.latest.status === 'pending') continue
    if (group.maxAttempt >= policy.retry.maxAttempts) {
      retryExhaustions.push(retryExhaustion(group, policy.retry.maxAttempts))
      continue
    }
    const delayMs = researchLabAlertRetryDelayMs(group.maxAttempt, policy.retry)
    const attemptedAtMs = requiredTimestamp(group.latest.attemptedAt, 'deliveryAttempt.attemptedAt')
    deliveryIntents.push(deliveryIntent(
      seed,
      group.maxAttempt + 1,
      new Date(attemptedAtMs + delayMs).toISOString(),
      delayMs,
    ))
  }

  // Exhaustion remains observable even when the destination was later disabled.
  for (const group of attempts.values()) {
    if (
      group.succeeded ||
      group.latest.status !== 'failed' ||
      group.maxAttempt < policy.retry.maxAttempts ||
      !isRetryStillRelevant(group.latest, finalIncidents) ||
      retryExhaustions.some((item) => item.idempotencyKey === group.idempotencyKey)
    ) continue
    retryExhaustions.push(retryExhaustion(group, policy.retry.maxAttempts))
  }

  deliveryIntents.sort(compareDeliveryIntents)
  deliverySuppressions.sort(compareSuppressions)
  retryExhaustions.sort((left, right) => left.idempotencyKey.localeCompare(right.idempotencyKey))
  return { deliveryIntents, deliverySuppressions, retryExhaustions }
}

function deliveryPayload(event: ResearchLabAlertTransitionEvent): ResearchLabAlertDeliveryPayload {
  if (!isDeliverableTransition(event.transition)) {
    throw new Error(`Transition ${event.transition} cannot produce a delivery payload`)
  }
  const severity = event.transition === 'recover'
    ? event.fromSeverity
    : event.toSeverity
  if (!severity) throw new Error(`Transition ${event.transitionId} has no notification severity`)
  return {
    transitionId: event.transitionId,
    transition: event.transition,
    incidentId: event.incidentId,
    fingerprint: event.fingerprint,
    episode: event.episode,
    sequence: event.sequence,
    occurredAt: event.occurredAt,
    fromStatus: event.fromStatus,
    toStatus: event.toStatus,
    fromSeverity: event.fromSeverity,
    toSeverity: event.toSeverity,
    severity,
    alert: copyAlert(event.alert),
  }
}

function deliveryIntent(
  seed: DeliverySeed,
  attempt: number,
  dueAt: string,
  retryDelayMs: number,
): ResearchLabAlertDeliveryIntent {
  return {
    intentId: `${seed.idempotencyKey}:attempt:${attempt}`,
    idempotencyKey: seed.idempotencyKey,
    attempt,
    isRetry: attempt > 1,
    dueAt,
    retryDelayMs,
    channel: seed.destination.channel,
    destination: seed.destination.destination,
    destinationHash: seed.destination.destinationHash,
    transitionId: seed.payload.transitionId,
    transition: seed.payload.transition,
    incidentId: seed.payload.incidentId,
    fingerprint: seed.payload.fingerprint,
    payload: copyPayload(seed.payload),
  }
}

function latestCooldownAttempt({
  attempts,
  event,
  destination,
  currentIdempotencyKey,
}: {
  attempts: ReadonlyMap<string, CanonicalAttemptGroup>
  event: ResearchLabAlertTransitionEvent
  destination: NormalizedDestination
  currentIdempotencyKey: string
}): number | null {
  let latest: number | null = null
  for (const group of attempts.values()) {
    if (group.idempotencyKey === currentIdempotencyKey) continue
    for (const attempt of group.attempts) {
      if (
        (attempt.status !== 'succeeded' && attempt.status !== 'pending') ||
        attempt.fingerprint !== event.fingerprint ||
        attempt.transition !== event.transition ||
        attempt.channel !== destination.channel ||
        attempt.destinationHash !== destination.destinationHash
      ) continue
      const timestamp = requiredTimestamp(attempt.attemptedAt, 'deliveryAttempt.attemptedAt')
      if (latest === null || timestamp > latest) latest = timestamp
    }
  }
  return latest
}

function isRetryStillRelevant(
  attempt: ResearchLabAlertDeliveryAttempt,
  incidents: ReadonlyMap<string, ResearchLabAlertIncident>,
): boolean {
  const incident = incidents.get(attempt.fingerprint)
  if (
    !incident ||
    incident.incidentId !== attempt.incidentId ||
    incident.episode !== attempt.payload.episode ||
    incident.transitionSequence !== attempt.payload.sequence
  ) return false
  if (attempt.transition === 'recover') return incident.status === 'resolved'
  return incident.status === 'open'
}

function suppression(
  idempotencyKey: string,
  event: ResearchLabAlertTransitionEvent,
  destination: NormalizedDestination,
  reason: ResearchLabAlertDeliverySuppression['reason'],
  eligibleAt: string | null,
): ResearchLabAlertDeliverySuppression {
  return {
    idempotencyKey,
    transitionId: event.transitionId,
    channel: destination.channel,
    destinationHash: destination.destinationHash,
    reason,
    eligibleAt,
  }
}

function retryExhaustion(
  group: CanonicalAttemptGroup,
  maxAttempts: number,
): ResearchLabAlertRetryExhaustion {
  return {
    idempotencyKey: group.idempotencyKey,
    transitionId: group.latest.transitionId,
    channel: group.latest.channel,
    destinationHash: group.latest.destinationHash,
    attempts: group.maxAttempt,
    maxAttempts,
    lastAttemptAt: new Date(requiredTimestamp(
      group.latest.attemptedAt,
      'deliveryAttempt.attemptedAt',
    )).toISOString(),
  }
}

function canonicalizeAttempts(
  attemptsInput: readonly ResearchLabAlertDeliveryAttempt[],
): Map<string, CanonicalAttemptGroup> {
  const grouped = new Map<string, ResearchLabAlertDeliveryAttempt[]>()
  for (const input of attemptsInput) {
    validateAttempt(input)
    const attempt = copyAttempt(input)
    const existing = grouped.get(attempt.idempotencyKey)
    if (existing) existing.push(attempt)
    else grouped.set(attempt.idempotencyKey, [attempt])
  }

  const result = new Map<string, CanonicalAttemptGroup>()
  for (const [idempotencyKey, records] of grouped) {
    const byAttempt = new Map<number, ResearchLabAlertDeliveryAttempt>()
    for (const record of records) {
      const existing = byAttempt.get(record.attempt)
      if (!existing || compareAttemptRecord(existing, record) < 0) {
        byAttempt.set(record.attempt, record)
      }
    }
    const attempts = Array.from(byAttempt.values()).sort((left, right) => left.attempt - right.attempt)
    const latest = attempts[attempts.length - 1]
    result.set(idempotencyKey, {
      idempotencyKey,
      attempts,
      latest,
      maxAttempt: latest.attempt,
      // Provider acceptance is terminal even if a racing/stale worker later
      // appends a failed status for the same attempt.
      succeeded: records.some((attempt) => attempt.status === 'succeeded'),
    })
  }
  return result
}

function validateAttempt(attempt: ResearchLabAlertDeliveryAttempt): void {
  if (!Number.isInteger(attempt.attempt) || attempt.attempt < 1) {
    throw new Error('deliveryAttempt.attempt must be a positive integer')
  }
  requiredTimestamp(attempt.attemptedAt, 'deliveryAttempt.attemptedAt')
  if (!['pending', 'succeeded', 'failed'].includes(attempt.status)) {
    throw new Error(`Unsupported delivery attempt status ${attempt.status}`)
  }
  if (!isDeliverableTransition(attempt.transition)) {
    throw new Error(`Unsupported delivery transition ${attempt.transition}`)
  }
  const expectedKey = buildResearchLabAlertDeliveryIdempotencyKey(
    attempt.transitionId,
    attempt.channel,
    attempt.destinationHash,
  )
  if (attempt.idempotencyKey !== expectedKey) {
    throw new Error(`Delivery attempt ${attempt.intentId} has an invalid idempotency key`)
  }
  if (
    attempt.payload.transitionId !== attempt.transitionId ||
    attempt.payload.transition !== attempt.transition ||
    attempt.payload.incidentId !== attempt.incidentId ||
    attempt.payload.fingerprint !== attempt.fingerprint
  ) {
    throw new Error(`Delivery attempt ${attempt.intentId} does not match its payload`)
  }
}

function normalizeDestinations(
  destinations: readonly ResearchLabAlertDestination[],
): NormalizedDestination[] {
  const normalized = new Map<string, NormalizedDestination>()
  for (const input of destinations) {
    if (input.enabled === false) continue
    const destination = normalizeDestinationValue(input.channel, input.destination)
    const destinationHash = hashResearchLabAlertDestination(input.channel, destination)
    const minimumSeverity = input.minimumSeverity ?? 'warning'
    if (minimumSeverity !== 'warning' && minimumSeverity !== 'critical') {
      throw new Error(`Unsupported minimum severity ${minimumSeverity}`)
    }
    const transitions = new Set<ResearchLabAlertDeliverableTransition>(
      input.transitions ?? ['open', 'escalate', 'recover'],
    )
    for (const transition of transitions) {
      if (!isDeliverableTransition(transition)) {
        throw new Error(`Unsupported destination transition ${transition}`)
      }
    }
    const key = `${input.channel}:${destinationHash}`
    const existing = normalized.get(key)
    if (existing && existing.destination !== destination) {
      throw new Error(`Destination hash collision for ${input.channel}:${destinationHash}`)
    }
    normalized.set(key, {
      channel: input.channel,
      destination,
      destinationHash,
      minimumSeverity,
      transitions,
    })
  }
  return Array.from(normalized.values()).sort(compareDestinations)
}

function normalizeDestinationValue(
  channel: ResearchLabAlertDeliveryChannel,
  destination: string,
): string {
  if (channel !== 'email' && channel !== 'discord') {
    throw new Error(`Unsupported delivery channel ${channel}`)
  }
  const value = requiredText(destination, 'destination').trim()
  return channel === 'email' ? value.toLowerCase() : value
}

function indexCurrentAlerts(
  alerts: readonly ResearchLabEvaluatedAlert[],
): Map<string, ResearchLabEvaluatedAlert> {
  const result = new Map<string, ResearchLabEvaluatedAlert>()
  for (const input of alerts) {
    const alert = copyAlert(input)
    requiredUnpaddedText(alert.fingerprint, 'alert.fingerprint')
    if (result.has(alert.fingerprint)) {
      throw new Error(`Duplicate evaluated alert fingerprint ${alert.fingerprint}`)
    }
    result.set(alert.fingerprint, alert)
  }
  return result
}

function indexPreviousIncidents(
  incidents: readonly ResearchLabAlertIncident[],
): Map<string, ResearchLabAlertIncident> {
  const result = new Map<string, ResearchLabAlertIncident>()
  for (const input of incidents) {
    const incident = copyIncident(input)
    validateIncident(incident)
    if (result.has(incident.fingerprint)) {
      throw new Error(`Duplicate incident fingerprint ${incident.fingerprint}`)
    }
    result.set(incident.fingerprint, incident)
  }
  return result
}

function indexResolutions(
  resolutions: readonly ResearchLabAlertResolution[],
): Map<string, ResearchLabAlertResolution> {
  const result = new Map<string, ResearchLabAlertResolution>()
  for (const input of resolutions) {
    const fingerprint = requiredUnpaddedText(input.fingerprint, 'resolution.fingerprint')
    if (result.has(fingerprint)) {
      throw new Error(`Duplicate alert resolution fingerprint ${fingerprint}`)
    }
    if (input.metadata.kind !== 'terminal') {
      throw new Error(`Resolution ${fingerprint} has unsupported kind ${input.metadata.kind}`)
    }
    if (!['completed', 'failed', 'cancelled', 'unknown'].includes(input.metadata.outcome)) {
      throw new Error(`Resolution ${fingerprint} has unsupported outcome ${input.metadata.outcome}`)
    }
    if (input.observedAt !== null) requiredTimestamp(input.observedAt, 'resolution.observedAt')
    result.set(fingerprint, {
      ...input,
      fingerprint,
      title: requiredText(input.title, 'resolution.title'),
      detail: requiredText(input.detail, 'resolution.detail'),
      observedAt: input.observedAt,
      metadata: {
        ...input.metadata,
        label: requiredText(input.metadata.label, 'resolution.metadata.label'),
      },
    })
  }
  return result
}

function applyResolution(
  alert: ResearchLabEvaluatedAlert,
  resolution: ResearchLabAlertResolution,
): ResearchLabEvaluatedAlert {
  if (alert.fingerprint !== resolution.fingerprint) {
    throw new Error(`Resolution ${resolution.fingerprint} does not match its alert`)
  }
  return {
    ...copyAlert(alert),
    title: resolution.title,
    detail: resolution.detail,
    observedAt: resolution.observedAt,
    ageMs: null,
    resolution: { ...resolution.metadata },
  }
}

function validateIncident(incident: ResearchLabAlertIncident): void {
  requiredUnpaddedText(incident.fingerprint, 'incident.fingerprint')
  if (incident.incidentId !== buildResearchLabAlertIncidentId(incident.fingerprint)) {
    throw new Error(`Incident ${incident.incidentId} does not match its fingerprint`)
  }
  if (!['pending', 'open', 'resolved'].includes(incident.status)) {
    throw new Error(`Incident ${incident.incidentId} has invalid status ${incident.status}`)
  }
  if (!Number.isInteger(incident.episode) || incident.episode < 1) {
    throw new Error(`Incident ${incident.incidentId} has invalid episode`)
  }
  if (!Number.isInteger(incident.transitionSequence) || incident.transitionSequence < 0) {
    throw new Error(`Incident ${incident.incidentId} has invalid transition sequence`)
  }
  for (const [field, value] of [
    ['firstObservedAt', incident.firstObservedAt],
    ['lastObservedAt', incident.lastObservedAt],
    ['createdAt', incident.createdAt],
    ['updatedAt', incident.updatedAt],
  ] as const) requiredTimestamp(value, `incident.${field}`)
  for (const [field, value] of [
    ['pendingSince', incident.pendingSince],
    ['openedAt', incident.openedAt],
    ['resolvedAt', incident.resolvedAt],
    ['lastTransitionAt', incident.lastTransitionAt],
  ] as const) {
    if (value !== null) requiredTimestamp(value, `incident.${field}`)
  }
  if (incident.status === 'pending' && incident.pendingSince === null) {
    throw new Error(`Pending incident ${incident.incidentId} is missing pendingSince`)
  }
  if (incident.status === 'open' && incident.severity === null) {
    throw new Error(`Open incident ${incident.incidentId} is missing severity`)
  }
  if (incident.status === 'resolved' && incident.severity !== null) {
    throw new Error(`Resolved incident ${incident.incidentId} must have null severity`)
  }
  if (incident.alert.fingerprint !== incident.fingerprint) {
    throw new Error(`Incident ${incident.incidentId} alert fingerprint does not match`)
  }
}

function copyIncident(incident: ResearchLabAlertIncident): ResearchLabAlertIncident {
  return { ...incident, alert: copyAlert(incident.alert) }
}

function copyAlert(alert: ResearchLabEvaluatedAlert): ResearchLabEvaluatedAlert {
  return {
    ...alert,
    sources: [...alert.sources],
    ...(alert.resolution ? { resolution: { ...alert.resolution } } : {}),
  }
}

function copyPayload(payload: ResearchLabAlertDeliveryPayload): ResearchLabAlertDeliveryPayload {
  return { ...payload, alert: copyAlert(payload.alert) }
}

function copyAttempt(attempt: ResearchLabAlertDeliveryAttempt): ResearchLabAlertDeliveryAttempt {
  return { ...attempt, payload: copyPayload(attempt.payload) }
}

function resolveDurationMap<Key extends string>(
  name: string,
  override: number | Partial<Record<Key, number>> | undefined,
  defaults: Readonly<Record<Key, number>>,
  keys: readonly Key[],
): Record<Key, number> {
  const result = {} as Record<Key, number>
  for (const key of keys) {
    const value = typeof override === 'number'
      ? override
      : override?.[key] ?? defaults[key]
    result[key] = requiredDuration(value, `${name}.${key}`)
  }
  return result
}

function requiredDuration(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a finite, non-negative duration`)
  }
  return value
}

function requiredTimestamp(
  value: ResearchLabAlertLifecycleTimestamp | null,
  name: string,
): number {
  const timestamp = value instanceof Date
    ? value.getTime()
    : typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim()
        ? Date.parse(value)
        : Number.NaN
  if (!Number.isFinite(timestamp)) throw new Error(`${name} must be a valid timestamp`)
  return timestamp
}

function requiredText(value: string, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} must be non-empty`)
  return value.trim()
}

function requiredUnpaddedText(value: string, name: string): string {
  const normalized = requiredText(value, name)
  if (normalized !== value) throw new Error(`${name} must not contain leading or trailing whitespace`)
  return value
}

/**
 * Compact deterministic 128-bit-style opaque hash. It keeps raw destinations
 * out of durable keys; it is not an authentication or password-hashing primitive.
 */
function stableOpaqueHash(value: string): string {
  const seeds = [0, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35]
  return seeds.map((seed) => {
    let hash = (0x811c9dc5 ^ seed) >>> 0
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index)
      hash ^= code & 0xff
      hash = Math.imul(hash, 0x01000193) >>> 0
      hash ^= code >>> 8
      hash = Math.imul(hash, 0x01000193) >>> 0
    }
    return hash.toString(16).padStart(8, '0')
  }).join('')
}

function isDeliverableTransition(
  transition: ResearchLabAlertTransitionType,
): transition is ResearchLabAlertDeliverableTransition {
  return DELIVERABLE_TRANSITIONS.has(transition)
}

function isResolvedTransition(
  event: ResearchLabAlertTransitionEvent,
): event is ResearchLabAlertResolvedTransition {
  return (
    event.toStatus === 'resolved' &&
    (event.transition === 'recover' || event.transition === 'debounce_cancel')
  )
}

function severityRank(severity: ResearchLabAlertSeverity): number {
  return severity === 'critical' ? 2 : 1
}

function sortedEntries<Value>(map: ReadonlyMap<string, Value>): Array<[string, Value]> {
  return Array.from(map.entries()).sort(([left], [right]) => left.localeCompare(right))
}

function compareIncidents(left: ResearchLabAlertIncident, right: ResearchLabAlertIncident): number {
  return left.fingerprint.localeCompare(right.fingerprint)
}

function compareTransitions(
  left: ResearchLabAlertTransitionEvent,
  right: ResearchLabAlertTransitionEvent,
): number {
  return left.transitionId.localeCompare(right.transitionId)
}

function compareDestinations(left: NormalizedDestination, right: NormalizedDestination): number {
  return `${left.channel}:${left.destinationHash}`.localeCompare(`${right.channel}:${right.destinationHash}`)
}

function compareDeliverySeeds(left: DeliverySeed, right: DeliverySeed): number {
  return left.idempotencyKey.localeCompare(right.idempotencyKey)
}

function compareDeliveryIntents(
  left: ResearchLabAlertDeliveryIntent,
  right: ResearchLabAlertDeliveryIntent,
): number {
  return left.intentId.localeCompare(right.intentId)
}

function compareSuppressions(
  left: ResearchLabAlertDeliverySuppression,
  right: ResearchLabAlertDeliverySuppression,
): number {
  return `${left.idempotencyKey}:${left.reason}`.localeCompare(`${right.idempotencyKey}:${right.reason}`)
}

function compareAttemptRecord(
  left: ResearchLabAlertDeliveryAttempt,
  right: ResearchLabAlertDeliveryAttempt,
): number {
  const time = requiredTimestamp(left.attemptedAt, 'deliveryAttempt.attemptedAt') -
    requiredTimestamp(right.attemptedAt, 'deliveryAttempt.attemptedAt')
  if (time !== 0) return time
  const rank = { pending: 0, failed: 1, succeeded: 2 }
  return rank[left.status] - rank[right.status]
}
