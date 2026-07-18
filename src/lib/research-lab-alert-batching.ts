import type {
  ResearchLabAlertScope,
  ResearchLabEvaluatedAlert,
} from './research-lab-alerts'
import type {
  ResearchLabAlertDeliverableTransition,
  ResearchLabAlertDeliveryIntent,
} from './research-lab-alert-lifecycle'

/**
 * Notification-only grouping. Incidents, fingerprints, transitions, and
 * delivery attempts remain independent in durable storage; only the outbound
 * provider request is summarized. Keeping the families explicit prevents an
 * unrelated weight-push problem from being hidden inside a run-health page.
 */
export const RESEARCH_LAB_ALERT_NOTIFICATION_FAMILIES = Object.freeze({
  pcr0_mismatch: 'pcr0_attestation',
  pcr0_missing: 'pcr0_attestation',
  pcr0_stale: 'pcr0_attestation',
  offchain_weight_bundle_missing: 'offchain_weight_bundles',
  offchain_weight_bundle_stale: 'offchain_weight_bundles',
  onchain_validator_update_missing: 'onchain_validator_updates',
  onchain_validator_update_stale: 'onchain_validator_updates',
  benchmark_failed: 'benchmark_health',
  benchmark_stalled: 'benchmark_health',
  active_run_stale: 'research_run_health',
  active_run_blocked: 'research_run_health',
  transparency_checkpoint_stale: 'transparency_health',
  data_freshness: 'data_freshness',
} as const)

export type ResearchLabAlertNotificationFamily =
  (typeof RESEARCH_LAB_ALERT_NOTIFICATION_FAMILIES)[keyof typeof RESEARCH_LAB_ALERT_NOTIFICATION_FAMILIES]

export type ResearchLabAlertDeliveryBatch = Readonly<{
  family: ResearchLabAlertNotificationFamily | null
  intents: readonly ResearchLabAlertDeliveryIntent[]
  alert: ResearchLabEvaluatedAlert
}>

export type ResearchLabAlertDeliveryBatchPlan = Readonly<{
  batches: readonly ResearchLabAlertDeliveryBatch[]
  deferredIntentCount: number
}>

export const RESEARCH_LAB_WARNING_COALESCE_MS = 2 * 60 * 1_000

const FAMILY_LABELS: Readonly<Record<ResearchLabAlertNotificationFamily, string>> = Object.freeze({
  pcr0_attestation: 'PCR0 attestation health',
  offchain_weight_bundles: 'Off-chain weight bundle health',
  onchain_validator_updates: 'On-chain validator update health',
  benchmark_health: 'Benchmark health',
  research_run_health: 'Research run health',
  transparency_health: 'Transparency checkpoint health',
  data_freshness: 'Data freshness',
})

const SIGNAL_LABELS: Readonly<Record<ResearchLabEvaluatedAlert['signal'], string>> = Object.freeze({
  pcr0_mismatch: 'PCR0 mismatch',
  pcr0_missing: 'PCR0 missing',
  pcr0_stale: 'PCR0 stale',
  offchain_weight_bundle_missing: 'Bundle missing',
  offchain_weight_bundle_stale: 'Bundle stale',
  onchain_validator_update_missing: 'Update missing',
  onchain_validator_update_stale: 'Update stale',
  benchmark_failed: 'Failed',
  benchmark_stalled: 'Stalled',
  active_run_stale: 'Stale',
  active_run_blocked: 'Blocked',
  transparency_checkpoint_stale: 'Checkpoint stale',
  data_freshness: 'Data stale',
  maintenance_pause_overrun: 'Maintenance overrun',
})

/**
 * Similar warning transitions wait briefly for siblings. Critical transitions,
 * retries, and unrelated alerts are never delayed. Two or more matching
 * transitions are sent immediately as one provider request.
 */
export function planResearchLabAlertDeliveryBatches(
  intents: readonly ResearchLabAlertDeliveryIntent[],
  now: Date,
  warningCoalesceMs = RESEARCH_LAB_WARNING_COALESCE_MS,
): ResearchLabAlertDeliveryBatchPlan {
  const nowMs = now.getTime()
  if (!Number.isFinite(nowMs)) throw new Error('Alert delivery batch time must be valid.')
  if (!Number.isFinite(warningCoalesceMs) || warningCoalesceMs < 0) {
    throw new Error('Alert delivery warning coalesce window must be non-negative.')
  }

  const grouped = new Map<string, {
    family: ResearchLabAlertNotificationFamily | null
    intents: ResearchLabAlertDeliveryIntent[]
  }>()

  for (const intent of intents) {
    const family = researchLabAlertNotificationFamily(intent.payload.alert)
    const key = family
      ? [
          intent.channel,
          family,
          intent.transition,
          intent.payload.severity,
          recoveryClass(intent.transition, intent.payload.alert),
        ].join(':')
      : `individual:${intent.intentId}`
    const current = grouped.get(key)
    if (current) current.intents.push(intent)
    else grouped.set(key, { family, intents: [intent] })
  }

  const batches: ResearchLabAlertDeliveryBatch[] = []
  let deferredIntentCount = 0
  for (const group of [...grouped.values()].sort(compareGroups)) {
    group.intents.sort(compareIntents)
    const first = group.intents[0]
    const shouldDefer = group.family !== null &&
      group.intents.length === 1 &&
      first.attempt === 1 &&
      first.channel === 'discord' &&
      first.payload.severity === 'warning' &&
      first.payload.alert.resolution?.kind !== 'terminal' &&
      Math.max(0, nowMs - timestamp(first.dueAt)) < warningCoalesceMs

    if (shouldDefer) {
      deferredIntentCount += 1
      continue
    }

    batches.push(Object.freeze({
      family: group.family,
      intents: Object.freeze([...group.intents]),
      alert: group.intents.length === 1 || group.family === null
        ? group.intents[0].payload.alert
        : summarizeResearchLabAlertBatch(
            group.family,
            group.intents.map((intent) => intent.payload.alert),
            first.transition,
          ),
    }))
  }

  return Object.freeze({
    batches: Object.freeze(batches),
    deferredIntentCount,
  })
}

export function researchLabAlertNotificationFamily(
  alert: ResearchLabEvaluatedAlert,
): ResearchLabAlertNotificationFamily | null {
  return RESEARCH_LAB_ALERT_NOTIFICATION_FAMILIES[
    alert.signal as keyof typeof RESEARCH_LAB_ALERT_NOTIFICATION_FAMILIES
  ] ?? null
}

export function summarizeResearchLabAlertBatch(
  family: ResearchLabAlertNotificationFamily,
  alerts: readonly ResearchLabEvaluatedAlert[],
  transition: ResearchLabAlertDeliverableTransition,
): ResearchLabEvaluatedAlert {
  if (alerts.length < 2) throw new Error('A grouped alert requires at least two alerts.')
  const severity = sharedValue(alerts.map((alert) => alert.severity), 'severity')
  const scope = sharedValue(alerts.map((alert) => alert.scope), 'scope')
  const entities = [...new Set(alerts.map((alert) => alert.entityId))]
  const visibleAlerts = alerts.slice(0, 12)
  const lines = visibleAlerts.map((alert) => (
    `• ${scopeLabel(alert.scope)} ${shortId(alert.entityId)} · ${SIGNAL_LABELS[alert.signal]} — ${singleLine(alert.detail, 180)}`
  ))
  if (visibleAlerts.length < alerts.length) {
    lines.push(`• Plus ${alerts.length - visibleAlerts.length} more related conditions in the dashboard.`)
  }

  const label = FAMILY_LABELS[family]
  const detailLead = transition === 'recover'
    ? `${alerts.length} related ${label.toLowerCase()} conditions cleared together:`
    : `${alerts.length} related ${label.toLowerCase()} conditions were detected together:`
  const terminalResolution = alerts[0].resolution?.kind === 'terminal'
    ? alerts[0].resolution
    : undefined
  const validatorIds = [...new Set(alerts.map((alert) => alert.validatorId).filter(Boolean))]

  return {
    fingerprint: `research-lab:notification-batch:v1:${family}:${transition}:${severity}`,
    signal: alerts[0].signal,
    severity,
    scope,
    entityId: `${entities.length} ${pluralScope(scope, entities.length)}`,
    validatorId: validatorIds.length === 1 ? validatorIds[0] ?? null : null,
    title: `${label}: ${alerts.length} related conditions across ${entities.length} ${pluralScope(scope, entities.length)}`,
    detail: [detailLead, ...lines].join('\n'),
    observedAt: latestTimestamp(alerts.map((alert) => alert.observedAt)),
    ageMs: maximumNullable(alerts.map((alert) => alert.ageMs)),
    ageBlocks: maximumNullable(alerts.map((alert) => alert.ageBlocks)),
    sources: [...new Set(alerts.flatMap((alert) => alert.sources))].sort(),
    occurrences: alerts.reduce((total, alert) => total + Math.max(1, alert.occurrences), 0),
    ...(terminalResolution ? { resolution: terminalResolution } : {}),
  }
}

function recoveryClass(
  transition: ResearchLabAlertDeliverableTransition,
  alert: ResearchLabEvaluatedAlert,
): string {
  if (transition !== 'recover') return 'active'
  return alert.resolution?.kind === 'terminal'
    ? `terminal:${alert.resolution.outcome}`
    : 'condition-cleared'
}

function compareGroups(
  left: { family: ResearchLabAlertNotificationFamily | null; intents: ResearchLabAlertDeliveryIntent[] },
  right: { family: ResearchLabAlertNotificationFamily | null; intents: ResearchLabAlertDeliveryIntent[] },
): number {
  return compareIntents(left.intents[0], right.intents[0])
}

function compareIntents(
  left: ResearchLabAlertDeliveryIntent,
  right: ResearchLabAlertDeliveryIntent,
): number {
  return timestamp(left.dueAt) - timestamp(right.dueAt) ||
    left.intentId.localeCompare(right.intentId)
}

function sharedValue<T>(values: readonly T[], label: string): T {
  const first = values[0]
  if (values.some((value) => value !== first)) {
    throw new Error(`Grouped alerts must share one ${label}.`)
  }
  return first
}

function timestamp(value: string): number {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) throw new Error(`Invalid alert delivery timestamp: ${value}`)
  return parsed
}

function latestTimestamp(values: readonly (string | null)[]): string | null {
  const parsed = values
    .filter((value): value is string => value !== null)
    .map((value) => ({ value, time: Date.parse(value) }))
    .filter((item) => Number.isFinite(item.time))
    .sort((left, right) => right.time - left.time)
  return parsed[0]?.value ?? null
}

function maximumNullable(values: readonly (number | null)[]): number | null {
  const finite = values.filter((value): value is number => value !== null && Number.isFinite(value))
  return finite.length > 0 ? Math.max(...finite) : null
}

function shortId(value: string): string {
  const normalized = singleLine(value, 120)
  return normalized.length <= 20
    ? `\`${normalized}\``
    : `\`${normalized.slice(0, 8)}…${normalized.slice(-4)}\``
}

function singleLine(value: string, limit: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length <= limit ? normalized : `${normalized.slice(0, Math.max(0, limit - 1))}…`
}

function scopeLabel(scope: ResearchLabAlertScope): string {
  return scope === 'run' ? 'Run' : scope === 'benchmark' ? 'Benchmark' : scope === 'validator' ? 'Validator' : 'Item'
}

function pluralScope(scope: ResearchLabAlertScope, count: number): string {
  const label = scope === 'run'
    ? 'run'
    : scope === 'benchmark'
      ? 'benchmark'
      : scope === 'validator'
        ? 'validator'
        : scope === 'transparency'
          ? 'checkpoint'
          : scope === 'data'
            ? 'data source'
            : 'maintenance group'
  return count === 1 ? label : `${label}s`
}
