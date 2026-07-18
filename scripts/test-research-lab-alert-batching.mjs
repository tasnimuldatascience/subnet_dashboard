import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const outDir = await mkdtemp(join(tmpdir(), 'research-lab-alert-batching-'))

try {
  const tsc = spawnSync(process.execPath, [
    resolve('node_modules/typescript/bin/tsc'),
    resolve('src/lib/research-lab-alert-batching.ts'),
    resolve('src/lib/research-lab-alert-delivery.ts'),
    '--target', 'ES2022',
    '--module', 'CommonJS',
    '--moduleResolution', 'Node',
    '--lib', 'ES2022,DOM',
    '--outDir', outDir,
    '--strict',
    '--skipLibCheck',
  ], { stdio: 'inherit' })
  assert.equal(tsc.status, 0, 'research-lab alert batching should compile')

  const require = createRequire(import.meta.url)
  const {
    RESEARCH_LAB_WARNING_COALESCE_MS,
    planResearchLabAlertDeliveryBatches,
    researchLabAlertNotificationFamily,
  } = require(join(outDir, 'research-lab-alert-batching.js'))
  const { buildResearchLabDiscordPayload } = require(join(outDir, 'research-lab-alert-delivery.js'))

  const now = new Date('2026-07-18T00:30:00.000Z')
  const runAlert = (runId, signal, detail, overrides = {}) => ({
    fingerprint: `research-lab:v1:${signal}:run:${runId}`,
    signal,
    severity: 'warning',
    scope: 'run',
    entityId: runId,
    validatorId: `validator-${runId}`,
    title: `Active run ${runId} is ${signal === 'active_run_stale' ? 'stale' : 'blocked'}`,
    detail,
    observedAt: '2026-07-18T00:20:00.000Z',
    ageMs: 20 * 60 * 1_000,
    ageBlocks: null,
    sources: ['research lab blocked-loop telemetry'],
    occurrences: 1,
    ...overrides,
  })
  const intent = (id, alert, overrides = {}) => ({
    intentId: `intent:${id}`,
    idempotencyKey: `idempotency:${id}`,
    attempt: 1,
    isRetry: false,
    dueAt: now.toISOString(),
    retryDelayMs: 0,
    channel: 'discord',
    destination: 'https://discord.com/api/webhooks/123/token',
    destinationHash: 'discord-hash',
    transitionId: `transition:${id}`,
    transition: 'recover',
    incidentId: `incident:${id}`,
    fingerprint: alert.fingerprint,
    payload: {
      transitionId: `transition:${id}`,
      transition: 'recover',
      incidentId: `incident:${id}`,
      fingerprint: alert.fingerprint,
      episode: 1,
      sequence: 2,
      occurredAt: now.toISOString(),
      fromStatus: 'open',
      toStatus: 'resolved',
      fromSeverity: 'warning',
      toSeverity: null,
      severity: alert.severity,
      alert,
    },
    ...overrides,
  })

  const runA = '352628ab-2c57-4957-8652-1edc70b32d1f'
  const runB = 'cc6131f6-0f8b-4cd2-8378-aec9dc2afdf0'
  const related = [
    intent('run-a-blocked', runAlert(runA, 'active_run_blocked', 'Scoring is waiting for the benchmark baseline.')),
    intent('run-a-stale', runAlert(runA, 'active_run_stale', 'The active run has not emitted progress for 21m.')),
    intent('run-b-blocked', runAlert(runB, 'active_run_blocked', 'Scoring is waiting for the benchmark baseline.')),
    intent('run-b-stale', runAlert(runB, 'active_run_stale', 'The active run has not emitted progress for 23m.')),
  ]
  const grouped = planResearchLabAlertDeliveryBatches(related, now)
  assert.equal(grouped.deferredIntentCount, 0)
  assert.equal(grouped.batches.length, 1)
  assert.equal(grouped.batches[0].family, 'research_run_health')
  assert.equal(grouped.batches[0].intents.length, 4)
  assert.match(grouped.batches[0].alert.title, /4 related conditions across 2 runs/)
  assert.match(grouped.batches[0].alert.detail, /Blocked/)
  assert.match(grouped.batches[0].alert.detail, /Stale/)
  assert.match(grouped.batches[0].alert.detail, /352628ab…2d1f/)
  assert.match(grouped.batches[0].alert.detail, /cc6131f6…fdf0/)
  assert.deepEqual(
    grouped.batches[0].intents.map((item) => item.fingerprint).sort(),
    related.map((item) => item.fingerprint).sort(),
    'individual durable incident identities must survive notification grouping',
  )
  const groupedDiscord = buildResearchLabDiscordPayload(
    grouped.batches[0].alert,
    'recover',
    'https://dashboard.example.com/admin?tab=research-lab',
  )
  assert.equal(groupedDiscord.embeds.length, 1, 'related incidents should produce one Discord alert')
  assert.match(groupedDiscord.embeds[0].title, /4 related conditions across 2 runs/)
  assert.match(groupedDiscord.embeds[0].description, /Blocked/)
  assert.match(groupedDiscord.embeds[0].description, /Stale/)

  const weightAlert = {
    ...runAlert('validator-1', 'active_run_stale', 'unused'),
    fingerprint: 'research-lab:v1:onchain_validator_update_stale:validator:validator-1',
    signal: 'onchain_validator_update_stale',
    scope: 'validator',
    entityId: 'validator-1',
    validatorId: 'validator-1',
    title: 'Validator update is stale',
    detail: 'The on-chain validator update is stale.',
  }
  const separated = planResearchLabAlertDeliveryBatches([
    ...related,
    intent('weight-stale', weightAlert, {
      dueAt: new Date(now.getTime() - RESEARCH_LAB_WARNING_COALESCE_MS).toISOString(),
    }),
  ], now)
  assert.equal(separated.batches.length, 2)
  assert.deepEqual(
    separated.batches.map((batch) => batch.family).sort(),
    ['onchain_validator_updates', 'research_run_health'],
    'weight-update and run-health notifications must remain separate',
  )

  const freshWarning = intent('fresh-warning', runAlert('run-single', 'active_run_stale', 'No progress.'))
  const deferred = planResearchLabAlertDeliveryBatches([freshWarning], now)
  assert.equal(deferred.batches.length, 0)
  assert.equal(deferred.deferredIntentCount, 1)
  const mature = planResearchLabAlertDeliveryBatches(
    [{
      ...freshWarning,
      dueAt: new Date(now.getTime() - RESEARCH_LAB_WARNING_COALESCE_MS).toISOString(),
    }],
    now,
  )
  assert.equal(mature.batches.length, 1, 'a solitary warning must send after the short collection window')

  const emailFallback = intent('email-fallback', freshWarning.payload.alert, { channel: 'email' })
  assert.equal(
    planResearchLabAlertDeliveryBatches([emailFallback], now).batches.length,
    1,
    'email fallback must send immediately once its lifecycle policy activates it',
  )

  const critical = intent(
    'critical-run',
    runAlert('run-critical', 'active_run_blocked', 'The run is critically blocked.', {
      severity: 'critical',
    }),
  )
  assert.equal(
    planResearchLabAlertDeliveryBatches([critical], now).batches.length,
    1,
    'critical alerts must never wait for batching',
  )

  const discordAndEmail = planResearchLabAlertDeliveryBatches([
    related[0],
    related[1],
    intent('email-run-a-blocked', related[0].payload.alert, { channel: 'email' }),
    intent('email-run-a-stale', related[1].payload.alert, { channel: 'email' }),
  ], now)
  assert.equal(discordAndEmail.batches.length, 2)
  assert.deepEqual(
    discordAndEmail.batches.map((batch) => batch.intents[0].channel).sort(),
    ['discord', 'email'],
    'provider channels must never share one outbound request',
  )

  const terminal = intent('terminal-run', runAlert('run-terminal', 'active_run_stale', 'The run failed.', {
    resolution: { kind: 'terminal', outcome: 'failed', label: 'No buildable candidate' },
  }))
  const terminalSeparated = planResearchLabAlertDeliveryBatches([related[1], terminal], now)
  assert.equal(terminalSeparated.batches.length, 1)
  assert.equal(terminalSeparated.deferredIntentCount, 1)
  assert.equal(terminalSeparated.batches[0].alert.resolution?.outcome, 'failed')

  assert.equal(researchLabAlertNotificationFamily(related[0].payload.alert), 'research_run_health')
  assert.equal(researchLabAlertNotificationFamily(weightAlert), 'onchain_validator_updates')
  assert.equal(
    researchLabAlertNotificationFamily({
      ...weightAlert,
      signal: 'maintenance_pause_overrun',
    }),
    null,
    'maintenance overruns remain standalone pages',
  )

  console.log('research-lab-alert-batching: explicit families, coalescing, summaries, and separation passed')
} finally {
  await rm(outDir, { recursive: true, force: true })
}
