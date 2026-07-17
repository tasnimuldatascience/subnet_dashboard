import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const outDir = await mkdtemp(join(tmpdir(), 'research-lab-alert-lifecycle-'))

try {
  const tsc = spawnSync(process.execPath, [
    resolve('node_modules/typescript/bin/tsc'),
    resolve('src/lib/research-lab-alert-lifecycle.ts'),
    resolve('src/lib/research-lab-alerts.ts'),
    '--target', 'ES2022',
    '--module', 'CommonJS',
    '--moduleResolution', 'Node',
    '--lib', 'ES2022,DOM',
    '--outDir', outDir,
    '--strict',
    '--skipLibCheck',
  ], { stdio: 'inherit' })

  assert.equal(tsc.status, 0, 'research-lab alert lifecycle planner should compile')

  const require = createRequire(import.meta.url)
  const {
    hashResearchLabAlertDestination,
    planResearchLabAlertLifecycle,
    researchLabAlertRetryDelayMs,
  } = require(join(outDir, 'research-lab-alert-lifecycle.js'))

  const START_MS = Date.parse('2026-07-10T12:00:00.000Z')
  const at = (offsetMs) => new Date(START_MS + offsetMs).toISOString()
  const emailDestination = { channel: 'email', destination: 'Ops@Example.com' }
  const alert = (fingerprint, severity = 'warning') => ({
    fingerprint,
    signal: 'data_freshness',
    severity,
    scope: 'data',
    entityId: fingerprint.split(':').at(-1),
    validatorId: null,
    title: `Alert ${fingerprint}`,
    detail: `${severity} fixture`,
    observedAt: at(0),
    ageMs: 1_000,
    ageBlocks: null,
    sources: ['fixture'],
    occurrences: 1,
  })
  const policy = (overrides = {}) => ({
    debounceMs: 0,
    cooldownMs: 0,
    retry: { maxAttempts: 3, baseDelayMs: 1_000, maxDelayMs: 1_500 },
    ...overrides,
  })
  const attemptFrom = (intent, status, attemptedAt, error = null, providerHttpStatus = null) => ({
    intentId: intent.intentId,
    idempotencyKey: intent.idempotencyKey,
    attempt: intent.attempt,
    status,
    attemptedAt,
    channel: intent.channel,
    destinationHash: intent.destinationHash,
    transitionId: intent.transitionId,
    transition: intent.transition,
    incidentId: intent.incidentId,
    fingerprint: intent.fingerprint,
    payload: intent.payload,
    error,
    providerHttpStatus,
  })

  const fingerprint = 'research-lab:v1:data_freshness:data:events'
  const warning = alert(fingerprint)

  // A continuously observed warning must survive its debounce window before it
  // opens. Merely entering pending never pages anyone.
  const firstObservation = planResearchLabAlertLifecycle({
    now: at(0),
    evaluatedAlerts: [warning],
    destinations: [emailDestination],
    policy: policy({ debounceMs: { warning: 1_000, critical: 0 } }),
  })
  assert.equal(firstObservation.incidentUpserts[0].status, 'pending')
  assert.equal(firstObservation.transitionEvents.length, 0)
  assert.equal(firstObservation.deliveryIntents.length, 0)

  const beforeDebounce = planResearchLabAlertLifecycle({
    now: at(999),
    previousIncidents: firstObservation.incidentUpserts,
    evaluatedAlerts: [warning],
    destinations: [emailDestination],
    policy: policy({ debounceMs: { warning: 1_000, critical: 0 } }),
  })
  assert.equal(beforeDebounce.incidentUpserts[0].status, 'pending')
  assert.equal(beforeDebounce.transitionEvents.length, 0)

  const opened = planResearchLabAlertLifecycle({
    now: at(1_000),
    previousIncidents: beforeDebounce.incidentUpserts,
    evaluatedAlerts: [warning],
    destinations: [emailDestination],
    policy: policy({ debounceMs: { warning: 1_000, critical: 0 } }),
  })
  assert.equal(opened.incidentUpserts[0].status, 'open')
  assert.equal(opened.transitionEvents[0].transition, 'open')
  assert.equal(opened.deliveryIntents.length, 1)
  assert.equal(opened.deliveryIntents[0].attempt, 1)
  assert.equal(opened.deliveryIntents[0].destination, 'ops@example.com')
  assert.doesNotMatch(opened.deliveryIntents[0].idempotencyKey, /ops@example\.com/i)

  // A replay from identical persisted pre-transition state produces identical
  // event and delivery keys, while the normally persisted open state produces
  // no second page at all.
  const replayedOpen = planResearchLabAlertLifecycle({
    now: at(1_000),
    previousIncidents: beforeDebounce.incidentUpserts,
    evaluatedAlerts: [warning],
    destinations: [emailDestination],
    policy: policy({ debounceMs: { warning: 1_000, critical: 0 } }),
  })
  assert.equal(replayedOpen.transitionEvents[0].eventId, opened.transitionEvents[0].eventId)
  assert.equal(replayedOpen.deliveryIntents[0].idempotencyKey, opened.deliveryIntents[0].idempotencyKey)

  const repeatEvaluation = planResearchLabAlertLifecycle({
    now: at(1_001),
    previousIncidents: opened.incidentUpserts,
    evaluatedAlerts: [warning],
    destinations: [emailDestination],
    policy: policy(),
  })
  assert.equal(repeatEvaluation.transitionEvents.length, 0)
  assert.equal(repeatEvaluation.deliveryIntents.length, 0, 'repeat evaluations must not duplicate pages')

  // Escalation is a distinct append-only transition and pages independently of
  // an earlier warning notification.
  const openSucceeded = attemptFrom(opened.deliveryIntents[0], 'succeeded', at(1_010))
  const replayAfterSuccess = planResearchLabAlertLifecycle({
    now: at(1_000),
    previousIncidents: beforeDebounce.incidentUpserts,
    evaluatedAlerts: [warning],
    destinations: [emailDestination],
    priorDeliveryAttempts: [openSucceeded],
    policy: policy({ debounceMs: { warning: 1_000, critical: 0 } }),
  })
  assert.equal(replayAfterSuccess.transitionEvents.length, 1, 'append-only event replay keeps its stable identity')
  assert.equal(replayAfterSuccess.deliveryIntents.length, 0, 'a recorded success is never delivered again')

  const escalated = planResearchLabAlertLifecycle({
    now: at(2_000),
    previousIncidents: opened.incidentUpserts,
    evaluatedAlerts: [alert(fingerprint, 'critical')],
    destinations: [emailDestination],
    priorDeliveryAttempts: [openSucceeded],
    policy: policy({ cooldownMs: 60_000 }),
  })
  assert.equal(escalated.transitionEvents[0].transition, 'escalate')
  assert.equal(escalated.incidentUpserts[0].severity, 'critical')
  assert.equal(escalated.deliveryIntents.length, 1)
  assert.notEqual(escalated.deliveryIntents[0].idempotencyKey, opened.deliveryIntents[0].idempotencyKey)

  const failedEscalation = attemptFrom(
    escalated.deliveryIntents[0],
    'failed',
    at(2_010),
    'provider unavailable',
  )
  const deescalated = planResearchLabAlertLifecycle({
    now: at(2_500),
    previousIncidents: escalated.incidentUpserts,
    evaluatedAlerts: [warning],
    destinations: [emailDestination],
    priorDeliveryAttempts: [failedEscalation],
    policy: policy(),
  })
  assert.equal(deescalated.transitionEvents[0].transition, 'deescalate')
  assert.equal(deescalated.deliveryIntents.length, 0, 'deescalation neither pages nor retries obsolete escalation')

  const escalationSucceeded = attemptFrom(escalated.deliveryIntents[0], 'succeeded', at(2_010))
  const recovered = planResearchLabAlertLifecycle({
    now: at(3_000),
    previousIncidents: escalated.incidentUpserts,
    evaluatedAlerts: [],
    destinations: [emailDestination],
    priorDeliveryAttempts: [openSucceeded, escalationSucceeded],
    policy: policy({ cooldownMs: 60_000 }),
  })
  assert.equal(recovered.incidentUpserts[0].status, 'resolved')
  assert.equal(recovered.incidentUpserts[0].severity, null)
  assert.equal(recovered.resolvedTransitions.length, 1)
  assert.equal(recovered.resolvedTransitions[0].transition, 'recover')
  assert.equal(recovered.deliveryIntents.length, 1)
  assert.equal(recovered.deliveryIntents[0].transition, 'recover')
  assert.equal(recovered.deliveryIntents[0].payload.severity, 'critical')

  const terminalClosure = planResearchLabAlertLifecycle({
    now: at(3_000),
    previousIncidents: escalated.incidentUpserts,
    evaluatedAlerts: [],
    resolutions: [{
      fingerprint,
      title: 'Run run-7 ended: No buildable candidate',
      detail: 'The run failed terminally; this is not a successful recovery.',
      observedAt: at(2_900),
      metadata: { kind: 'terminal', outcome: 'failed', label: 'No buildable candidate' },
    }],
    destinations: [emailDestination],
    priorDeliveryAttempts: [openSucceeded, escalationSucceeded],
    policy: policy({ cooldownMs: 0 }),
  })
  assert.equal(terminalClosure.transitionEvents[0].alert.title, 'Run run-7 ended: No buildable candidate')
  assert.equal(terminalClosure.transitionEvents[0].alert.resolution.outcome, 'failed')
  assert.match(terminalClosure.deliveryIntents[0].payload.alert.detail, /not a successful recovery/)

  const repeatRecovery = planResearchLabAlertLifecycle({
    now: at(3_001),
    previousIncidents: recovered.incidentUpserts,
    evaluatedAlerts: [],
    destinations: [emailDestination],
    policy: policy(),
  })
  assert.equal(repeatRecovery.incidentUpserts.length, 0)
  assert.equal(repeatRecovery.transitionEvents.length, 0)
  assert.equal(repeatRecovery.deliveryIntents.length, 0)

  // A recovered fingerprint starts a new episode. With cooldown disabled, the
  // reopen notification has a different transition/idempotency identity.
  const reopened = planResearchLabAlertLifecycle({
    now: at(4_000),
    previousIncidents: recovered.incidentUpserts,
    evaluatedAlerts: [warning],
    destinations: [emailDestination],
    priorDeliveryAttempts: [openSucceeded],
    policy: policy(),
  })
  assert.equal(reopened.transitionEvents[0].transition, 'open')
  assert.equal(reopened.incidentUpserts[0].episode, 2)
  assert.equal(reopened.deliveryIntents.length, 1)
  assert.notEqual(reopened.deliveryIntents[0].idempotencyKey, opened.deliveryIntents[0].idempotencyKey)

  const failedRecovery = attemptFrom(recovered.deliveryIntents[0], 'failed', at(3_010), 'provider unavailable')
  const reopenedAfterFailedRecovery = planResearchLabAlertLifecycle({
    now: at(4_000),
    previousIncidents: recovered.incidentUpserts,
    evaluatedAlerts: [warning],
    destinations: [emailDestination],
    priorDeliveryAttempts: [failedRecovery],
    policy: policy(),
  })
  assert.deepEqual(
    reopenedAfterFailedRecovery.deliveryIntents.map((intent) => intent.transition),
    ['open'],
    'a new episode invalidates retries for the previous recovery',
  )

  // The same rapid reopen still records the lifecycle transition, but cooldown
  // suppresses only its delivery intent.
  const cooldownReopen = planResearchLabAlertLifecycle({
    now: at(4_000),
    previousIncidents: recovered.incidentUpserts,
    evaluatedAlerts: [warning],
    destinations: [emailDestination],
    priorDeliveryAttempts: [openSucceeded],
    policy: policy({ cooldownMs: { open: 10_000, escalate: 0, recover: 0 } }),
  })
  assert.equal(cooldownReopen.transitionEvents[0].transition, 'open')
  assert.equal(cooldownReopen.deliveryIntents.length, 0)
  assert.equal(cooldownReopen.deliverySuppressions[0].reason, 'cooldown')
  assert.equal(cooldownReopen.deliverySuppressions[0].eligibleAt, at(11_010))

  // A pending alert that clears during debounce is resolved for persistence and
  // audit, but never emits a recovery page because it was never opened.
  const cancelledPending = planResearchLabAlertLifecycle({
    now: at(500),
    previousIncidents: firstObservation.incidentUpserts,
    evaluatedAlerts: [],
    destinations: [emailDestination],
    policy: policy({ debounceMs: 1_000 }),
  })
  assert.equal(cancelledPending.resolvedTransitions[0].transition, 'debounce_cancel')
  assert.equal(cancelledPending.deliveryIntents.length, 0)

  // Failed deliveries retain one idempotency key across bounded, exponentially
  // delayed attempts. Future `dueAt` is planned deterministically; the planner
  // does not sleep or read the wall clock.
  const retryFingerprint = 'research-lab:v1:pcr0_mismatch:validator:validator-1'
  const retryOpened = planResearchLabAlertLifecycle({
    now: at(100_000),
    evaluatedAlerts: [alert(retryFingerprint, 'critical')],
    destinations: [emailDestination],
    policy: policy(),
  })
  const initialIntent = retryOpened.deliveryIntents[0]
  const failedOne = attemptFrom(initialIntent, 'failed', at(100_100), 'SMTP timeout')

  const succeededOne = attemptFrom(initialIntent, 'succeeded', at(100_050))
  const conflictingOutcomes = planResearchLabAlertLifecycle({
    now: at(100_200),
    previousIncidents: retryOpened.incidentUpserts,
    evaluatedAlerts: [alert(retryFingerprint, 'critical')],
    destinations: [emailDestination],
    priorDeliveryAttempts: [succeededOne, failedOne],
    policy: policy(),
  })
  assert.equal(
    conflictingOutcomes.deliveryIntents.length,
    0,
    'provider success is sticky even if a racing worker appends failure later',
  )

  const retryTwoPlan = planResearchLabAlertLifecycle({
    now: at(100_200),
    previousIncidents: retryOpened.incidentUpserts,
    evaluatedAlerts: [alert(retryFingerprint, 'critical')],
    destinations: [emailDestination],
    priorDeliveryAttempts: [failedOne],
    policy: policy(),
  })
  assert.equal(retryTwoPlan.transitionEvents.length, 0)
  assert.equal(retryTwoPlan.deliveryIntents.length, 1)
  assert.equal(retryTwoPlan.deliveryIntents[0].attempt, 2)
  assert.equal(retryTwoPlan.deliveryIntents[0].isRetry, true)
  assert.equal(retryTwoPlan.deliveryIntents[0].retryDelayMs, 1_000)
  assert.equal(retryTwoPlan.deliveryIntents[0].dueAt, at(101_100))
  assert.equal(retryTwoPlan.deliveryIntents[0].idempotencyKey, initialIntent.idempotencyKey)
  assert.notEqual(retryTwoPlan.deliveryIntents[0].intentId, initialIntent.intentId)

  const filteredRetry = planResearchLabAlertLifecycle({
    now: at(100_200),
    previousIncidents: opened.incidentUpserts,
    evaluatedAlerts: [warning],
    destinations: [{ ...emailDestination, minimumSeverity: 'critical' }],
    priorDeliveryAttempts: [attemptFrom(opened.deliveryIntents[0], 'failed', at(1_010))],
    policy: policy(),
  })
  assert.equal(filteredRetry.deliveryIntents.length, 0, 'retries honor current destination severity policy')

  const failedTwo = attemptFrom(retryTwoPlan.deliveryIntents[0], 'failed', at(101_100), 'SMTP timeout')
  const retryThreePlan = planResearchLabAlertLifecycle({
    now: at(101_200),
    previousIncidents: retryTwoPlan.incidentUpserts,
    evaluatedAlerts: [alert(retryFingerprint, 'critical')],
    destinations: [emailDestination],
    priorDeliveryAttempts: [failedOne, failedTwo],
    policy: policy(),
  })
  assert.equal(retryThreePlan.deliveryIntents[0].attempt, 3)
  assert.equal(retryThreePlan.deliveryIntents[0].retryDelayMs, 1_500, 'retry delay is capped')
  assert.equal(retryThreePlan.deliveryIntents[0].dueAt, at(102_600))
  assert.equal(researchLabAlertRetryDelayMs(10, policy().retry), 1_500)

  const failedThree = attemptFrom(retryThreePlan.deliveryIntents[0], 'failed', at(102_600), 'SMTP timeout')
  const exhausted = planResearchLabAlertLifecycle({
    now: at(102_700),
    previousIncidents: retryThreePlan.incidentUpserts,
    evaluatedAlerts: [alert(retryFingerprint, 'critical')],
    destinations: [emailDestination],
    priorDeliveryAttempts: [failedOne, failedTwo, failedThree],
    policy: policy(),
  })
  assert.equal(exhausted.deliveryIntents.length, 0)
  assert.equal(exhausted.retryExhaustions.length, 1)
  assert.equal(exhausted.retryExhaustions[0].attempts, 3)
  assert.equal(exhausted.retryExhaustions[0].maxAttempts, 3)

  // Critical maintenance pauses produce a durable reminder every 12 hours.
  // Other critical incidents remain quiet until their state changes.
  const TWELVE_HOURS_MS = 12 * 60 * 60 * 1_000
  const maintenanceFingerprint = 'research-lab:v1:maintenance_pause_overrun:maintenance:gateway-workflows'
  const maintenanceCritical = {
    ...alert(maintenanceFingerprint, 'critical'),
    signal: 'maintenance_pause_overrun',
    scope: 'maintenance',
  }
  const maintenanceOpened = planResearchLabAlertLifecycle({
    now: at(200_000),
    evaluatedAlerts: [maintenanceCritical],
    destinations: [emailDestination],
    policy: policy(),
  })
  const beforeReminder = planResearchLabAlertLifecycle({
    now: at(200_000 + TWELVE_HOURS_MS - 1),
    previousIncidents: maintenanceOpened.incidentUpserts,
    evaluatedAlerts: [maintenanceCritical],
    destinations: [emailDestination],
    policy: policy(),
  })
  assert.equal(beforeReminder.transitionEvents.length, 0)
  const reminded = planResearchLabAlertLifecycle({
    now: at(200_000 + TWELVE_HOURS_MS),
    previousIncidents: maintenanceOpened.incidentUpserts,
    evaluatedAlerts: [maintenanceCritical],
    destinations: [emailDestination],
    policy: policy(),
  })
  assert.equal(reminded.transitionEvents[0].transition, 'remind')
  assert.equal(reminded.deliveryIntents[0].transition, 'remind')
  const remindedAgain = planResearchLabAlertLifecycle({
    now: at(200_000 + (2 * TWELVE_HOURS_MS)),
    previousIncidents: reminded.incidentUpserts,
    evaluatedAlerts: [maintenanceCritical],
    destinations: [emailDestination],
    policy: policy(),
  })
  assert.equal(remindedAgain.transitionEvents[0].transition, 'remind')

  const ordinaryCriticalOpened = planResearchLabAlertLifecycle({
    now: at(300_000),
    evaluatedAlerts: [alert('research-lab:v1:data_freshness:data:no-reminder', 'critical')],
    destinations: [emailDestination],
    policy: policy(),
  })
  const ordinaryLater = planResearchLabAlertLifecycle({
    now: at(300_000 + TWELVE_HOURS_MS),
    previousIncidents: ordinaryCriticalOpened.incidentUpserts,
    evaluatedAlerts: [alert('research-lab:v1:data_freshness:data:no-reminder', 'critical')],
    destinations: [emailDestination],
    policy: policy(),
  })
  assert.equal(ordinaryLater.transitionEvents.length, 0, 'reminders are limited to maintenance overruns')

  // Resend is a fallback, not a parallel page: critical alerts activate it
  // after two Discord failures, warnings after retry exhaustion, and an invalid
  // webhook response immediately. Closure email is sent only for an episode
  // that previously used email fallback.
  const discordDestination = {
    channel: 'discord',
    destination: 'https://discord.com/api/webhooks/123/token',
  }
  const fallbackEmailDestination = {
    ...emailDestination,
    fallbackFor: 'discord',
  }
  const fallbackFingerprint = 'research-lab:v1:pcr0_mismatch:validator:fallback-test'
  const fallbackOpened = planResearchLabAlertLifecycle({
    now: at(400_000),
    evaluatedAlerts: [alert(fallbackFingerprint, 'critical')],
    destinations: [discordDestination, fallbackEmailDestination],
    policy: policy(),
  })
  assert.deepEqual(fallbackOpened.deliveryIntents.map((intent) => intent.channel), ['discord'])
  const discordFailureOne = attemptFrom(
    fallbackOpened.deliveryIntents[0], 'failed', at(400_100), 'HTTP 503', 503,
  )
  const afterOneCriticalFailure = planResearchLabAlertLifecycle({
    now: at(400_200),
    previousIncidents: fallbackOpened.incidentUpserts,
    evaluatedAlerts: [alert(fallbackFingerprint, 'critical')],
    destinations: [discordDestination, fallbackEmailDestination],
    priorDeliveryAttempts: [discordFailureOne],
    policy: policy(),
  })
  assert.deepEqual(afterOneCriticalFailure.deliveryIntents.map((intent) => intent.channel), ['discord'])
  const discordFailureTwo = attemptFrom(
    afterOneCriticalFailure.deliveryIntents[0], 'failed', at(401_100), 'HTTP 503', 503,
  )
  const criticalFallback = planResearchLabAlertLifecycle({
    now: at(401_200),
    previousIncidents: fallbackOpened.incidentUpserts,
    evaluatedAlerts: [alert(fallbackFingerprint, 'critical')],
    destinations: [discordDestination, fallbackEmailDestination],
    priorDeliveryAttempts: [discordFailureOne, discordFailureTwo],
    policy: policy(),
  })
  assert.deepEqual(
    criticalFallback.deliveryIntents.map((intent) => intent.channel).sort(),
    ['discord', 'email'],
  )

  const hardFailureOpened = planResearchLabAlertLifecycle({
    now: at(500_000),
    evaluatedAlerts: [alert('research-lab:v1:pcr0_missing:validator:invalid-webhook', 'warning')],
    destinations: [discordDestination, fallbackEmailDestination],
    policy: policy(),
  })
  const hardDiscordFailure = attemptFrom(
    hardFailureOpened.deliveryIntents[0], 'failed', at(500_100), 'HTTP 404', 404,
  )
  const hardFailureFallback = planResearchLabAlertLifecycle({
    now: at(500_200),
    previousIncidents: hardFailureOpened.incidentUpserts,
    evaluatedAlerts: [alert('research-lab:v1:pcr0_missing:validator:invalid-webhook', 'warning')],
    destinations: [discordDestination, fallbackEmailDestination],
    priorDeliveryAttempts: [hardDiscordFailure],
    policy: policy(),
  })
  assert.deepEqual(
    hardFailureFallback.deliveryIntents.map((intent) => intent.channel),
    ['email'],
    'an invalid Discord webhook falls back immediately without retrying the bad endpoint',
  )

  const warningFallbackFingerprint = 'research-lab:v1:pcr0_missing:validator:warning-fallback'
  const warningFallbackOpened = planResearchLabAlertLifecycle({
    now: at(600_000),
    evaluatedAlerts: [alert(warningFallbackFingerprint, 'warning')],
    destinations: [discordDestination, fallbackEmailDestination],
    policy: policy(),
  })
  const warningFailureOne = attemptFrom(
    warningFallbackOpened.deliveryIntents[0], 'failed', at(600_100), 'HTTP 503', 503,
  )
  const warningRetryTwo = planResearchLabAlertLifecycle({
    now: at(600_200),
    previousIncidents: warningFallbackOpened.incidentUpserts,
    evaluatedAlerts: [alert(warningFallbackFingerprint, 'warning')],
    destinations: [discordDestination, fallbackEmailDestination],
    priorDeliveryAttempts: [warningFailureOne],
    policy: policy(),
  })
  const warningFailureTwo = attemptFrom(
    warningRetryTwo.deliveryIntents[0], 'failed', at(601_100), 'HTTP 503', 503,
  )
  const warningRetryThree = planResearchLabAlertLifecycle({
    now: at(601_200),
    previousIncidents: warningFallbackOpened.incidentUpserts,
    evaluatedAlerts: [alert(warningFallbackFingerprint, 'warning')],
    destinations: [discordDestination, fallbackEmailDestination],
    priorDeliveryAttempts: [warningFailureOne, warningFailureTwo],
    policy: policy(),
  })
  assert.deepEqual(warningRetryThree.deliveryIntents.map((intent) => intent.channel), ['discord'])
  const warningFailureThree = attemptFrom(
    warningRetryThree.deliveryIntents[0], 'failed', at(602_600), 'HTTP 503', 503,
  )
  const warningFallback = planResearchLabAlertLifecycle({
    now: at(602_700),
    previousIncidents: warningFallbackOpened.incidentUpserts,
    evaluatedAlerts: [alert(warningFallbackFingerprint, 'warning')],
    destinations: [discordDestination, fallbackEmailDestination],
    priorDeliveryAttempts: [warningFailureOne, warningFailureTwo, warningFailureThree],
    policy: policy(),
  })
  assert.deepEqual(warningFallback.deliveryIntents.map((intent) => intent.channel), ['email'])

  const fallbackEmailIntent = criticalFallback.deliveryIntents.find((intent) => intent.channel === 'email')
  const fallbackEmailSuccess = attemptFrom(fallbackEmailIntent, 'succeeded', at(401_300))
  const recoveredAfterFallback = planResearchLabAlertLifecycle({
    now: at(402_000),
    previousIncidents: fallbackOpened.incidentUpserts,
    evaluatedAlerts: [],
    destinations: [discordDestination, fallbackEmailDestination],
    priorDeliveryAttempts: [discordFailureOne, discordFailureTwo, fallbackEmailSuccess],
    policy: policy(),
  })
  assert.deepEqual(
    recoveredAfterFallback.deliveryIntents.map((intent) => intent.channel).sort(),
    ['discord', 'email'],
    'recovery email closes an episode that used the fallback channel',
  )

  const recoveredWithoutFallback = planResearchLabAlertLifecycle({
    now: at(402_000),
    previousIncidents: fallbackOpened.incidentUpserts,
    evaluatedAlerts: [],
    destinations: [discordDestination, fallbackEmailDestination],
    policy: policy(),
  })
  assert.deepEqual(recoveredWithoutFallback.deliveryIntents.map((intent) => intent.channel), ['discord'])

  // Once the incident recovers, its failed open attempt is obsolete and is not
  // retried alongside the new recovery notification.
  const recoveredWithOldFailure = planResearchLabAlertLifecycle({
    now: at(100_500),
    previousIncidents: retryOpened.incidentUpserts,
    evaluatedAlerts: [],
    destinations: [emailDestination],
    priorDeliveryAttempts: [failedOne],
    policy: policy(),
  })
  assert.deepEqual(
    recoveredWithOldFailure.deliveryIntents.map((intent) => intent.transition),
    ['recover'],
  )

  assert.equal(
    hashResearchLabAlertDestination('email', ' OPS@example.com '),
    hashResearchLabAlertDestination('email', 'ops@EXAMPLE.com'),
    'email destination hashes are normalized and stable',
  )

  const channelPlan = planResearchLabAlertLifecycle({
    now: at(200_000),
    evaluatedAlerts: [alert('research-lab:v1:data_freshness:data:channel-test', 'critical')],
    destinations: [
      emailDestination,
      { channel: 'email', destination: 'ops@example.com' },
      { channel: 'discord', destination: 'https://discord.com/api/webhooks/123/token' },
    ],
    policy: policy(),
  })
  assert.deepEqual(
    channelPlan.deliveryIntents.map((intent) => intent.channel).sort(),
    ['discord', 'email'],
    'each normalized channel/destination pair receives exactly one intent',
  )
  assert.equal(new Set(channelPlan.deliveryIntents.map((intent) => intent.idempotencyKey)).size, 2)
  assert.doesNotMatch(
    channelPlan.deliveryIntents.find((intent) => intent.channel === 'discord').idempotencyKey,
    /discord\.com|webhooks|token/,
  )

  console.log('research-lab-alert-lifecycle: debounce, transitions, cooldown, idempotency, and retries passed')
} finally {
  await rm(outDir, { recursive: true, force: true })
}
