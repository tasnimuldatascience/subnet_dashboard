import type { SupabaseClient } from '@supabase/supabase-js'

import { getAdminSupabase } from './admin-supabase'
import {
  deliverResearchLabAlert,
  parseResearchLabAlertDeliveryConfig,
  sanitizeResearchLabProviderError,
  type ResearchLabAlertChannelConfig,
  type ResearchLabAlertDeliveryChannel,
} from './research-lab-alert-delivery'
import {
  planResearchLabAlertLifecycle,
  type ResearchLabAlertDeliveryAttempt,
  type ResearchLabAlertDeliveryIntent,
  type ResearchLabAlertDestination,
  type ResearchLabAlertIncident,
  type ResearchLabAlertTransitionEvent,
} from './research-lab-alert-lifecycle'
import type {
  ResearchLabAlertResolution,
  ResearchLabAlertSeverity,
  ResearchLabEvaluatedAlert,
} from './research-lab-alerts'
import { parseResearchLabAlertSignalAllowlist } from './research-lab-alerts'
import { getRuntimeSecretEnvironment } from './runtime-secret-environment'

const MONITOR_ID = 'research-lab-alerts:v1'
const LEASE_SECONDS = 180
const MONITOR_OWNER = `${process.pid}:${crypto.randomUUID()}`
const DELIVERY_BATCH_SIZE = 50
const DELIVERY_HISTORY_LIMIT = 5_000

const ALERT_SEVERITIES = new Set<ResearchLabAlertSeverity>(['warning', 'critical'])
const DELIVERABLE_TRANSITIONS = new Set(['open', 'escalate', 'remind', 'recover'])

export type ResearchLabAlertMonitorResult = {
  acquired: boolean
  evaluatedAlertCount: number
  incidentUpsertCount: number
  transitionCount: number
  deliveryCount: number
  deliveryFailureCount: number
  completedAt: string | null
}

export type ResearchLabAlertMonitorDependencies = {
  supabase?: SupabaseClient
  collectAlerts?: () => Promise<ResearchLabEvaluatedAlert[]>
  now?: () => Date
  owner?: string
  env?: Readonly<Record<string, string | undefined>>
}

let activeRun: Promise<ResearchLabAlertMonitorResult> | null = null

/**
 * Evaluate, persist, transition, and deliver Research Lab alerts. The database
 * lease makes this safe across multiple dashboard processes; activeRun avoids
 * stacking ticks within one process.
 */
export function runResearchLabAlertMonitor(
  dependencies: ResearchLabAlertMonitorDependencies = {},
): Promise<ResearchLabAlertMonitorResult> {
  if (activeRun) return activeRun
  activeRun = executeMonitor(dependencies).finally(() => {
    activeRun = null
  })
  return activeRun
}

async function executeMonitor(
  dependencies: ResearchLabAlertMonitorDependencies,
): Promise<ResearchLabAlertMonitorResult> {
  const supabase = dependencies.supabase ?? getAdminSupabase()
  const now = dependencies.now?.() ?? new Date()
  const nowIso = now.toISOString()
  // Reuse one owner for the lifetime of this worker so each 60-second tick can
  // renew its own 180-second lease. A new UUID per tick would lock the worker
  // out until the prior lease expired.
  const owner = dependencies.owner ?? MONITOR_OWNER
  const env = dependencies.env ?? getRuntimeSecretEnvironment()
  const acquired = await claimMonitorLease(supabase, owner, LEASE_SECONDS)
  if (!acquired) return emptyResult(false)

  let evaluatedAlertCount = 0
  let incidentUpsertCount = 0
  let transitionCount = 0
  let deliveryCount = 0
  let deliveryFailureCount = 0

  try {
    const config = parseResearchLabAlertDeliveryConfig(env)
    const destinations = buildResearchLabAlertDestinations(config, env)
    const enabledSignals = parseResearchLabAlertSignalAllowlist(
      env.RESEARCH_LAB_ALERT_SIGNALS,
    )
    const [snapshot, previousIncidents, priorDeliveryAttempts] = await Promise.all([
      dependencies.collectAlerts
        ? dependencies.collectAlerts().then((alerts) => ({ alerts, resolutions: [] }))
        : collectCanonicalAlertSnapshotFromAdminRoute(),
      readCurrentIncidents(supabase),
      readDeliveryAttempts(supabase),
    ])
    const evaluatedAlerts = enabledSignals
      ? snapshot.alerts.filter((alert) => enabledSignals.has(alert.signal))
      : snapshot.alerts
    evaluatedAlertCount = evaluatedAlerts.length

    const plan = planResearchLabAlertLifecycle({
      now,
      previousIncidents,
      evaluatedAlerts,
      resolutions: snapshot.resolutions,
      destinations,
      priorDeliveryAttempts,
    })

    await persistLifecyclePlan(supabase, plan.incidentUpserts, plan.transitionEvents, plan.deliveryIntents)
    incidentUpsertCount = plan.incidentUpserts.length
    transitionCount = plan.transitionEvents.length

    const deliverySummary = await deliverDueIntents(supabase, config, nowIso)
    deliveryCount = deliverySummary.deliveryCount
    deliveryFailureCount = deliverySummary.failureCount
    const completedAt = (dependencies.now?.() ?? new Date()).toISOString()

    await updateMonitorHeartbeat(supabase, owner, {
      last_completed_at: completedAt,
      last_error_at: null,
      last_error: null,
      last_evaluated_alert_count: evaluatedAlertCount,
      last_delivery_count: deliveryCount,
      last_delivery_failure_count: deliveryFailureCount,
      heartbeat_doc: {
        incident_upserts: incidentUpsertCount,
        transitions: transitionCount,
        configured_channels: destinations.map((item) => item.channel),
        configured_signals: enabledSignals
          ? [...enabledSignals].sort()
          : 'all',
      },
    })

    return {
      acquired: true,
      evaluatedAlertCount,
      incidentUpsertCount,
      transitionCount,
      deliveryCount,
      deliveryFailureCount,
      completedAt,
    }
  } catch (error) {
    const failedAt = (dependencies.now?.() ?? new Date()).toISOString()
    const detail = sanitizeResearchLabProviderError(error)
    await updateMonitorHeartbeat(supabase, owner, {
      last_error_at: failedAt,
      last_error: detail,
      last_evaluated_alert_count: evaluatedAlertCount,
      last_delivery_count: deliveryCount,
      last_delivery_failure_count: deliveryFailureCount,
      heartbeat_doc: {
        incident_upserts: incidentUpsertCount,
        transitions: transitionCount,
      },
    }).catch(() => undefined)
    throw error
  }
}

export function buildResearchLabAlertDestinations(
  config: ResearchLabAlertChannelConfig,
  env: Readonly<Record<string, string | undefined>> = process.env,
): ResearchLabAlertDestination[] {
  const minimumSeverity = parseMinimumSeverity(env.RESEARCH_LAB_ALERT_MINIMUM_SEVERITY)
  const destinations: ResearchLabAlertDestination[] = []
  if (config.discord) {
    destinations.push({
      channel: 'discord',
      destination: config.discord.webhookUrl,
      minimumSeverity,
    })
  }
  if (config.email) {
    destinations.push({
      channel: 'email',
      destination: config.email.to.join(','),
      minimumSeverity,
      ...(config.discord ? { fallbackFor: 'discord' as const } : {}),
    })
  }
  return destinations
}

async function collectCanonicalAlertSnapshotFromAdminRoute(): Promise<{
  alerts: ResearchLabEvaluatedAlert[]
  resolutions: ResearchLabAlertResolution[]
}> {
  const [{ GET }, { NextRequest }] = await Promise.all([
    import('../app/api/admin/research-lab/route'),
    import('next/server'),
  ])
  const response = await GET(new NextRequest('http://research-lab-monitor.local/api/admin/research-lab'))
  const body = await response.json() as {
    error?: unknown
    ops?: { evaluatedAlerts?: unknown; alertResolutions?: unknown }
  }
  if (!response.ok) {
    throw new Error(`Research Lab alert snapshot failed (${response.status}): ${safeError(body.error)}`)
  }
  if (!Array.isArray(body.ops?.evaluatedAlerts)) {
    throw new Error('Research Lab alert snapshot omitted ops.evaluatedAlerts.')
  }
  return {
    alerts: body.ops.evaluatedAlerts.filter(isEvaluatedAlert),
    resolutions: Array.isArray(body.ops.alertResolutions)
      ? body.ops.alertResolutions.filter(isAlertResolution)
      : [],
  }
}

async function claimMonitorLease(
  supabase: SupabaseClient,
  owner: string,
  leaseSeconds: number,
): Promise<boolean> {
  const { data, error } = await supabase.rpc('claim_ops_alert_monitor_lease', {
    p_monitor_id: MONITOR_ID,
    p_owner: owner,
    p_lease_seconds: leaseSeconds,
  })
  if (error) throw new Error(`Could not claim alert monitor lease: ${error.message}`)
  return data === true
}

async function readCurrentIncidents(supabase: SupabaseClient): Promise<ResearchLabAlertIncident[]> {
  const { data, error } = await supabase
    .from('ops_alert_current')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(2_000)
  if (error) throw new Error(`Could not read current alert incidents: ${error.message}`)
  return ((data ?? []) as Array<Record<string, unknown>>)
    .map(parseIncidentRow)
    .filter((value): value is ResearchLabAlertIncident => value !== null)
}

async function readDeliveryAttempts(
  supabase: SupabaseClient,
): Promise<ResearchLabAlertDeliveryAttempt[]> {
  const { data, error } = await supabase
    .from('ops_alert_delivery_events')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(DELIVERY_HISTORY_LIMIT)
  if (error) throw new Error(`Could not read alert delivery history: ${error.message}`)
  return ((data ?? []) as Array<Record<string, unknown>>)
    .map(parseDeliveryAttemptRow)
    .filter((value): value is ResearchLabAlertDeliveryAttempt => value !== null)
}

async function persistLifecyclePlan(
  supabase: SupabaseClient,
  incidents: readonly ResearchLabAlertIncident[],
  transitions: readonly ResearchLabAlertTransitionEvent[],
  intents: readonly ResearchLabAlertDeliveryIntent[],
): Promise<void> {
  // Transitioning incidents already have a pending/open/resolved current row
  // from a prior tick. Persist the append-only event and delivery intent first:
  // if a later current-row upsert fails, the next tick safely replays the same
  // stable ids instead of losing the only notification-producing transition.
  if (transitions.length > 0) {
    const { error } = await supabase
      .from('ops_alert_events')
      .upsert(transitions.map(serializeTransition), {
        onConflict: 'event_id',
        ignoreDuplicates: true,
      })
    if (error) throw new Error(`Could not persist alert transitions: ${error.message}`)
  }
  if (intents.length > 0) {
    const { error } = await supabase
      .from('ops_alert_delivery_events')
      .upsert(intents.map(serializeIntent), {
        onConflict: 'intent_id',
        ignoreDuplicates: true,
      })
    if (error) throw new Error(`Could not enqueue alert deliveries: ${error.message}`)
  }
  if (incidents.length > 0) {
    const { error } = await supabase
      .from('ops_alert_current')
      .upsert(incidents.map(serializeIncident), { onConflict: 'fingerprint' })
    if (error) throw new Error(`Could not persist alert incidents: ${error.message}`)
  }
}

async function deliverDueIntents(
  supabase: SupabaseClient,
  config: ResearchLabAlertChannelConfig,
  nowIso: string,
): Promise<{ deliveryCount: number; failureCount: number }> {
  const { data, error } = await supabase
    .from('ops_alert_delivery_events')
    .select('*')
    .eq('status', 'pending')
    .lte('due_at', nowIso)
    .order('due_at', { ascending: true })
    .limit(DELIVERY_BATCH_SIZE)
  if (error) throw new Error(`Could not read due alert deliveries: ${error.message}`)

  let deliveryCount = 0
  let failureCount = 0
  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    const intent = parseDeliveryIntentRow(row)
    if (!intent) continue
    const attemptedAt = new Date().toISOString()
    const channelConfig = configForChannel(config, intent.channel)
    if (!channelConfig) {
      await completeDelivery(supabase, intent.intentId, {
        status: 'failed',
        attemptedAt,
        httpStatus: null,
        errorCode: 'provider_error',
        error: `${intent.channel} alert channel is no longer configured.`,
      })
      deliveryCount += 1
      failureCount += 1
      continue
    }

    const result = await deliverResearchLabAlert({
      alert: intent.payload.alert,
      transition: intent.transition,
      config: channelConfig,
      idempotencyKey: intent.idempotencyKey,
    })
    const outcome = result.deliveries.find((item) => item.channel === intent.channel)
    const succeeded = outcome?.status === 'sent'
    await completeDelivery(supabase, intent.intentId, {
      status: succeeded ? 'succeeded' : 'failed',
      attemptedAt,
      httpStatus: outcome?.httpStatus ?? null,
      errorCode: outcome?.errorCode ?? (succeeded ? null : 'provider_error'),
      error: outcome?.error ?? (succeeded ? null : 'Alert provider returned no delivery outcome.'),
    })
    deliveryCount += 1
    if (!succeeded) failureCount += 1
  }
  return { deliveryCount, failureCount }
}

async function completeDelivery(
  supabase: SupabaseClient,
  intentId: string,
  input: {
    status: 'succeeded' | 'failed'
    attemptedAt: string
    httpStatus: number | null
    errorCode: string | null
    error: string | null
  },
): Promise<void> {
  const completedAt = new Date().toISOString()
  const { error } = await supabase
    .from('ops_alert_delivery_events')
    .update({
      status: input.status,
      provider_http_status: input.httpStatus,
      error_code: input.errorCode,
      error_detail: input.error ? sanitizeResearchLabProviderError(input.error) : null,
      attempted_at: input.attemptedAt,
      completed_at: completedAt,
    })
    .eq('intent_id', intentId)
    .eq('status', 'pending')
  if (error) throw new Error(`Could not record alert delivery outcome: ${error.message}`)
}

async function updateMonitorHeartbeat(
  supabase: SupabaseClient,
  owner: string,
  values: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase
    .from('ops_alert_monitor_state')
    .update({
      ...values,
      lease_owner: null,
      lease_expires_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('monitor_id', MONITOR_ID)
    .eq('lease_owner', owner)
  if (error) throw new Error(`Could not update alert monitor heartbeat: ${error.message}`)
}

function serializeIncident(incident: ResearchLabAlertIncident): Record<string, unknown> {
  return {
    fingerprint: incident.fingerprint,
    incident_id: incident.incidentId,
    status: incident.status,
    episode: incident.episode,
    transition_sequence: incident.transitionSequence,
    severity: incident.severity,
    signal: incident.alert.signal,
    scope: incident.alert.scope,
    entity_id: incident.alert.entityId,
    validator_id: incident.alert.validatorId,
    title: incident.alert.title,
    detail: incident.alert.detail,
    sources: incident.alert.sources,
    occurrences: incident.alert.occurrences,
    observed_at: incident.alert.observedAt,
    age_ms: incident.alert.ageMs,
    age_blocks: incident.alert.ageBlocks,
    pending_since: incident.pendingSince,
    first_observed_at: incident.firstObservedAt,
    last_observed_at: incident.lastObservedAt,
    opened_at: incident.openedAt,
    resolved_at: incident.resolvedAt,
    last_transition_at: incident.lastTransitionAt,
    last_transition_type: incident.lastTransitionType,
    alert_doc: incident.alert,
    created_at: incident.createdAt,
    updated_at: incident.updatedAt,
  }
}

function serializeTransition(event: ResearchLabAlertTransitionEvent): Record<string, unknown> {
  return {
    event_id: event.eventId,
    transition_id: event.transitionId,
    incident_id: event.incidentId,
    fingerprint: event.fingerprint,
    episode: event.episode,
    sequence: event.sequence,
    transition: event.transition,
    from_status: event.fromStatus,
    to_status: event.toStatus,
    from_severity: event.fromSeverity,
    to_severity: event.toSeverity,
    occurred_at: event.occurredAt,
    alert_doc: event.alert,
  }
}

function serializeIntent(intent: ResearchLabAlertDeliveryIntent): Record<string, unknown> {
  return {
    intent_id: intent.intentId,
    idempotency_key: intent.idempotencyKey,
    attempt: intent.attempt,
    is_retry: intent.isRetry,
    status: 'pending',
    due_at: intent.dueAt,
    retry_delay_ms: intent.retryDelayMs,
    channel: intent.channel,
    destination_hash: intent.destinationHash,
    transition_id: intent.transitionId,
    transition: intent.transition,
    incident_id: intent.incidentId,
    fingerprint: intent.fingerprint,
    payload_doc: intent.payload,
  }
}

function parseIncidentRow(row: Record<string, unknown>): ResearchLabAlertIncident | null {
  const alert = isEvaluatedAlert(row.alert_doc) ? row.alert_doc : null
  if (!alert || !text(row.incident_id) || !text(row.fingerprint)) return null
  const status = text(row.status)
  if (status !== 'pending' && status !== 'open' && status !== 'resolved') return null
  const severity = row.severity === null ? null : text(row.severity)
  if (severity !== null && !ALERT_SEVERITIES.has(severity as ResearchLabAlertSeverity)) return null
  return {
    incidentId: text(row.incident_id)!,
    fingerprint: text(row.fingerprint)!,
    status,
    episode: integer(row.episode, 1),
    transitionSequence: integer(row.transition_sequence, 0),
    severity: severity as ResearchLabAlertSeverity | null,
    pendingSince: nullableText(row.pending_since),
    firstObservedAt: text(row.first_observed_at) ?? alert.observedAt ?? new Date(0).toISOString(),
    lastObservedAt: text(row.last_observed_at) ?? alert.observedAt ?? new Date(0).toISOString(),
    openedAt: nullableText(row.opened_at),
    resolvedAt: nullableText(row.resolved_at),
    createdAt: text(row.created_at) ?? new Date(0).toISOString(),
    updatedAt: text(row.updated_at) ?? new Date(0).toISOString(),
    lastTransitionAt: nullableText(row.last_transition_at),
    lastTransitionType: (nullableText(row.last_transition_type) as ResearchLabAlertIncident['lastTransitionType']),
    alert,
  }
}

function parseDeliveryAttemptRow(
  row: Record<string, unknown>,
): ResearchLabAlertDeliveryAttempt | null {
  const payload = parseDeliveryPayload(row.payload_doc)
  const status = text(row.status)
  const channel = text(row.channel)
  const transition = text(row.transition)
  if (
    !payload ||
    (status !== 'pending' && status !== 'succeeded' && status !== 'failed') ||
    (channel !== 'email' && channel !== 'discord') ||
    !DELIVERABLE_TRANSITIONS.has(transition ?? '')
  ) return null
  const intentId = text(row.intent_id)
  const idempotencyKey = text(row.idempotency_key)
  const destinationHash = text(row.destination_hash)
  if (!intentId || !idempotencyKey || !destinationHash) return null
  return {
    intentId,
    idempotencyKey,
    attempt: integer(row.attempt, 1),
    status,
    attemptedAt: text(row.attempted_at) ?? text(row.completed_at) ?? text(row.created_at) ?? text(row.due_at)!,
    channel,
    destinationHash,
    transitionId: text(row.transition_id) ?? payload.transitionId,
    transition: transition as ResearchLabAlertDeliveryAttempt['transition'],
    incidentId: text(row.incident_id) ?? payload.incidentId,
    fingerprint: text(row.fingerprint) ?? payload.fingerprint,
    payload,
    error: nullableText(row.error_detail),
    providerHttpStatus: nullableInteger(row.provider_http_status),
  }
}

function parseDeliveryIntentRow(row: Record<string, unknown>): ResearchLabAlertDeliveryIntent | null {
  const attempt = parseDeliveryAttemptRow(row)
  if (!attempt) return null
  return {
    intentId: attempt.intentId,
    idempotencyKey: attempt.idempotencyKey,
    attempt: attempt.attempt,
    isRetry: row.is_retry === true,
    dueAt: text(row.due_at) ?? new Date(0).toISOString(),
    retryDelayMs: integer(row.retry_delay_ms, 0),
    channel: attempt.channel,
    destination: '',
    destinationHash: attempt.destinationHash,
    transitionId: attempt.transitionId,
    transition: attempt.transition,
    incidentId: attempt.incidentId,
    fingerprint: attempt.fingerprint,
    payload: attempt.payload,
  }
}

function parseDeliveryPayload(value: unknown): ResearchLabAlertDeliveryAttempt['payload'] | null {
  if (!value || typeof value !== 'object') return null
  const payload = value as Record<string, unknown>
  if (!isEvaluatedAlert(payload.alert)) return null
  const transition = text(payload.transition)
  if (!DELIVERABLE_TRANSITIONS.has(transition ?? '')) return null
  const transitionId = text(payload.transitionId)
  const incidentId = text(payload.incidentId)
  const fingerprint = text(payload.fingerprint)
  const occurredAt = text(payload.occurredAt)
  const severity = text(payload.severity)
  if (!transitionId || !incidentId || !fingerprint || !occurredAt || !ALERT_SEVERITIES.has(severity as ResearchLabAlertSeverity)) return null
  return payload as unknown as ResearchLabAlertDeliveryAttempt['payload']
}

function configForChannel(
  config: ResearchLabAlertChannelConfig,
  channel: ResearchLabAlertDeliveryChannel,
): ResearchLabAlertChannelConfig | null {
  if (channel === 'discord' && config.discord) {
    return { dashboardUrl: config.dashboardUrl, timeoutMs: config.timeoutMs, discord: config.discord }
  }
  if (channel === 'email' && config.email) {
    return { dashboardUrl: config.dashboardUrl, timeoutMs: config.timeoutMs, email: config.email }
  }
  return null
}

function isEvaluatedAlert(value: unknown): value is ResearchLabEvaluatedAlert {
  if (!value || typeof value !== 'object') return false
  const alert = value as Record<string, unknown>
  return Boolean(
    text(alert.fingerprint) &&
    text(alert.signal) &&
    ALERT_SEVERITIES.has(text(alert.severity) as ResearchLabAlertSeverity) &&
    text(alert.scope) &&
    text(alert.entityId) &&
    text(alert.title) &&
    text(alert.detail) &&
    Array.isArray(alert.sources),
  )
}

function isAlertResolution(value: unknown): value is ResearchLabAlertResolution {
  if (!value || typeof value !== 'object') return false
  const resolution = value as Record<string, unknown>
  const metadata = resolution.metadata
  if (!metadata || typeof metadata !== 'object') return false
  const outcome = text((metadata as Record<string, unknown>).outcome)
  return Boolean(
    text(resolution.fingerprint) &&
    text(resolution.title) &&
    text(resolution.detail) &&
    (resolution.observedAt === null || text(resolution.observedAt)) &&
    (metadata as Record<string, unknown>).kind === 'terminal' &&
    ['completed', 'failed', 'cancelled', 'unknown'].includes(outcome ?? '') &&
    text((metadata as Record<string, unknown>).label),
  )
}

function parseMinimumSeverity(value: string | undefined): ResearchLabAlertSeverity {
  const normalized = value?.trim().toLowerCase()
  if (!normalized || normalized === 'warning' || normalized === 'warn') return 'warning'
  if (normalized === 'critical') return 'critical'
  throw new Error('RESEARCH_LAB_ALERT_MINIMUM_SEVERITY must be warning or critical.')
}

function emptyResult(acquired: boolean): ResearchLabAlertMonitorResult {
  return {
    acquired,
    evaluatedAlertCount: 0,
    incidentUpsertCount: 0,
    transitionCount: 0,
    deliveryCount: 0,
    deliveryFailureCount: 0,
    completedAt: null,
  }
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function nullableText(value: unknown): string | null {
  return value === null || value === undefined ? null : text(value)
}

function integer(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isInteger(parsed) ? parsed : fallback
}

function nullableInteger(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isInteger(parsed) ? parsed : null
}

function safeError(value: unknown): string {
  return sanitizeResearchLabProviderError(value ?? 'unknown error')
}
