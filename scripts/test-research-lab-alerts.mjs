import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const outDir = await mkdtemp(join(tmpdir(), 'research-lab-alerts-'))

try {
  const tsc = spawnSync(process.execPath, [
    resolve('node_modules/typescript/bin/tsc'),
    resolve('src/lib/research-lab-alerts.ts'),
    '--target', 'ES2022',
    '--module', 'CommonJS',
    '--moduleResolution', 'Node',
    '--lib', 'ES2022,DOM',
    '--outDir', outDir,
    '--strict',
    '--skipLibCheck',
  ], { stdio: 'inherit' })

  assert.equal(tsc.status, 0, 'research-lab alert evaluator should compile')

  const require = createRequire(import.meta.url)
  const {
    DEFAULT_RESEARCH_LAB_ALERT_THRESHOLDS,
    RESEARCH_LAB_ALERT_SIGNALS,
    buildResearchLabAlertFingerprint,
    evaluateResearchLabAlerts,
    parseResearchLabAlertSignalAllowlist,
    resolveResearchLabAlertThresholds,
    shouldSuppressResearchLabExecutionAlert,
  } = require(join(outDir, 'research-lab-alerts.js'))

  assert.equal(RESEARCH_LAB_ALERT_SIGNALS.length, 14)
  assert.equal(parseResearchLabAlertSignalAllowlist(undefined), null)
  assert.equal(parseResearchLabAlertSignalAllowlist('  '), null)
  assert.deepEqual(
    [...parseResearchLabAlertSignalAllowlist(
      'pcr0_missing, benchmark_failed;PCR0_MISSING',
    )],
    ['pcr0_missing', 'benchmark_failed'],
  )
  assert.throws(
    () => parseResearchLabAlertSignalAllowlist('pcr0_missing,typo_signal'),
    /unknown signal\(s\): typo_signal/,
  )

  const NOW_MS = Date.parse('2026-07-10T12:00:00.000Z')
  const NOW = new Date(NOW_MS).toISOString()
  const ago = (milliseconds) => new Date(NOW_MS - milliseconds).toISOString()

  assert.equal(shouldSuppressResearchLabExecutionAlert({
    now: NOW,
    controls: [{ state: 'paused', updatedAt: ago(8 * 60 * 60 * 1_000) }],
    status: 'running',
  }), true, 'paused maintenance suppresses stale execution alerts')
  assert.equal(shouldSuppressResearchLabExecutionAlert({
    now: NOW,
    controls: [{ state: 'active', updatedAt: ago(9_000) }],
    status: 'running',
  }), true, 'the observed nine-second restart race gets a projection and worker recovery grace window')
  assert.equal(shouldSuppressResearchLabExecutionAlert({
    now: NOW,
    controls: [{ state: 'active', updatedAt: ago(5 * 60 * 1_000) }],
    status: 'running',
  }), false, 'a genuinely stale run pages again after the resume grace window')
  assert.equal(shouldSuppressResearchLabExecutionAlert({
    now: NOW,
    controls: [{ state: 'unknown' }],
    status: 'checkpointed and paused',
    detail: 'gateway_restart maintenance',
  }), true, 'maintenance evidence suppresses alerts even when control telemetry is unavailable')
  assert.equal(shouldSuppressResearchLabExecutionAlert({
    now: NOW,
    controls: [{ state: 'active', updatedAt: ago(10 * 60 * 1_000) }],
    status: 'checkpointed and paused',
    detail: 'gateway_restart maintenance',
  }), false)
  const thresholds = {
    pcr0Stale: { warnMs: 10, criticalMs: 20 },
    offchainWeightBundleStale: { warnMs: 10, criticalMs: 20 },
    onchainValidatorUpdateStale: { warnMs: 10, criticalMs: 20 },
    benchmarkStalled: { warnMs: 10, criticalMs: 20 },
    activeRunStale: { warnMs: 10, criticalMs: 20 },
    activeRunBlocked: { warnMs: 10, criticalMs: 20 },
    transparencyCheckpointStale: { warnMs: 10, criticalMs: 20 },
    dataFreshness: { warnMs: 10, criticalMs: 20 },
  }
  const evaluate = (observations, overrides = thresholds) => evaluateResearchLabAlerts(
    observations,
    { now: NOW, thresholds: overrides },
  )
  const byFingerprint = (alerts) => new Map(alerts.map((alert) => [alert.fingerprint, alert]))
  const signals = (alerts) => alerts.map((alert) => alert.signal).sort()

  const completeFixture = evaluate({
    validators: [
      {
        validatorId: 'validator-all',
        source: 'ops attestation',
        pcr0: {
          observedPcr0: 'bad-pcr0',
          expectedPcr0: 'good-pcr0',
          observedAt: ago(20),
        },
        offchainWeightBundle: { publishedAt: ago(10), bundleId: 'bundle-1' },
        onchainUpdate: { updatedAt: null, block: null },
      },
      {
        validatorId: 'validator-missing',
        source: 'published bundles',
        pcr0: { observedPcr0: null, observedAt: ago(5) },
        offchainWeightBundle: { publishedAt: null },
        onchainUpdate: { updatedAt: ago(20), block: 42 },
      },
    ],
    benchmarks: [
      {
        benchmarkId: 'benchmark-failed',
        status: 'failed',
        failedAt: ago(2),
        error: 'Provider returned HTTP 503',
      },
      {
        benchmarkId: 'benchmark-stalled',
        validatorId: 'validator-all',
        status: 'running',
        lastActivityAt: ago(10),
      },
      {
        benchmarkId: 'benchmark-fresh',
        status: 'running',
        lastActivityAt: ago(9),
      },
    ],
    activeRuns: [
      { runId: 'run-stale', status: 'scoring', lastActivityAt: ago(20) },
      {
        runId: 'run-blocked-warning',
        status: 'blocked_for_credit',
        blockedAt: ago(10),
        blocker: 'OpenRouter credits exhausted.',
      },
      {
        runId: 'run-blocked-critical',
        status: 'running',
        blocked: true,
        blockedAt: ago(20),
        lastActivityAt: ago(1),
      },
      { runId: 'run-fresh', status: 'running', lastActivityAt: ago(9) },
    ],
    transparencyCheckpoints: [
      { checkpointId: 'netuid-71', checkpointAt: ago(10) },
      { checkpointId: 'archive', checkpointAt: null },
    ],
    dataFreshness: [
      { sourceId: 'loop-events', observedAt: ago(20) },
      { sourceId: 'score-events', observedAt: null },
      { sourceId: 'fresh-events', observedAt: ago(9) },
    ],
  })

  assert.deepEqual(signals(completeFixture), [
    'active_run_blocked',
    'active_run_blocked',
    'active_run_stale',
    'benchmark_failed',
    'benchmark_stalled',
    'data_freshness',
    'data_freshness',
    'offchain_weight_bundle_missing',
    'offchain_weight_bundle_stale',
    'onchain_validator_update_missing',
    'onchain_validator_update_stale',
    'pcr0_mismatch',
    'pcr0_missing',
    'pcr0_stale',
    'transparency_checkpoint_stale',
    'transparency_checkpoint_stale',
  ])

  const completeByFingerprint = byFingerprint(completeFixture)
  const fingerprint = (signal, scope, id) => buildResearchLabAlertFingerprint(signal, scope, id)
  assert.equal(
    completeByFingerprint.get(fingerprint('pcr0_mismatch', 'validator', 'validator-all')).severity,
    'critical',
  )
  assert.equal(
    completeByFingerprint.get(fingerprint('pcr0_stale', 'validator', 'validator-all')).severity,
    'critical',
    'critical boundary is inclusive',
  )
  assert.equal(
    completeByFingerprint.get(fingerprint('offchain_weight_bundle_stale', 'validator', 'validator-all')).severity,
    'warning',
    'warning boundary is inclusive',
  )
  assert.match(
    completeByFingerprint.get(fingerprint('benchmark_failed', 'benchmark', 'benchmark-failed')).detail,
    /HTTP 503/,
  )
  assert.equal(
    completeByFingerprint.get(fingerprint('active_run_blocked', 'run', 'run-blocked-warning')).severity,
    'warning',
  )
  assert.equal(
    completeByFingerprint.get(fingerprint('transparency_checkpoint_stale', 'transparency', 'archive')).severity,
    'critical',
    'a known-missing checkpoint is a critical stale signal',
  )

  const boundaryFixture = evaluate({
    dataFreshness: [
      { sourceId: 'before-warning', observedAt: ago(9) },
      { sourceId: 'at-warning', observedAt: ago(10) },
      { sourceId: 'before-critical', observedAt: ago(19) },
      { sourceId: 'at-critical', observedAt: ago(20) },
      { sourceId: 'future-clock-skew', observedAt: new Date(NOW_MS + 1_000).toISOString() },
    ],
  })
  assert.equal(boundaryFixture.length, 3)
  const boundaryById = new Map(boundaryFixture.map((alert) => [alert.entityId, alert]))
  assert.equal(boundaryById.get('at-warning').severity, 'warning')
  assert.equal(boundaryById.get('before-critical').severity, 'warning')
  assert.equal(boundaryById.get('at-critical').severity, 'critical')
  assert.equal(boundaryById.has('before-warning'), false)
  assert.equal(boundaryById.has('future-clock-skew'), false)

  const maintenanceFixture = evaluateResearchLabAlerts({
    maintenancePauses: [{
      maintenanceId: 'gateway-workflows',
      source: 'gateway controls',
      components: [
        {
          componentId: 'autoresearch',
          label: 'Auto-research loop',
          pausedAt: ago(13 * 60 * 60 * 1_000),
          reason: 'gateway_restart',
          actor: 'ops@example.com',
        },
        {
          componentId: 'scoring',
          label: 'Scoring worker',
          pausedAt: ago(7 * 60 * 60 * 1_000),
          reason: 'planned maintenance',
        },
      ],
    }],
  }, { now: NOW })
  assert.equal(maintenanceFixture.length, 1, 'paused subsystems are consolidated into one incident')
  assert.equal(maintenanceFixture[0].signal, 'maintenance_pause_overrun')
  assert.equal(maintenanceFixture[0].scope, 'maintenance')
  assert.equal(maintenanceFixture[0].severity, 'critical')
  assert.match(maintenanceFixture[0].detail, /Auto-research loop has been paused for 13h/)
  assert.match(maintenanceFixture[0].detail, /Scoring worker has been paused for 7h/)
  assert.match(maintenanceFixture[0].detail, /actor: ops@example\.com/)

  assert.deepEqual(evaluateResearchLabAlerts({
    maintenancePauses: [{
      maintenanceId: 'short-pause',
      components: [{ componentId: 'scoring', label: 'Scoring', pausedAt: ago(5 * 60 * 60 * 1_000) }],
    }],
  }, { now: NOW }), [], 'maintenance shorter than six hours does not page')

  const blockBoundaryFixture = evaluate({
    validators: [
      {
        validatorId: 'block-before-warning',
        onchainUpdate: { lastUpdateBlock: 991, currentBlock: 1_000 },
      },
      {
        validatorId: 'block-at-warning',
        onchainUpdate: { lastUpdateBlock: 990, currentBlock: 1_000 },
      },
      {
        validatorId: 'block-before-critical',
        onchainUpdate: { lastUpdateBlock: 981, currentBlock: 1_000 },
      },
      {
        validatorId: 'block-at-critical',
        onchainUpdate: { lastUpdateBlock: 980, currentBlock: 1_000 },
      },
      {
        validatorId: 'block-head-missing',
        onchainUpdate: { lastUpdateBlock: 980, currentBlock: null },
      },
    ],
  }, {
    ...thresholds,
    onchainValidatorUpdateStale: {
      ...thresholds.onchainValidatorUpdateStale,
      warnBlocks: 10,
      criticalBlocks: 20,
    },
  })
  const blockBoundaryById = new Map(blockBoundaryFixture.map((alert) => [alert.entityId, alert]))
  assert.equal(blockBoundaryFixture.length, 4)
  assert.equal(blockBoundaryById.has('block-before-warning'), false)
  assert.equal(blockBoundaryById.get('block-at-warning').severity, 'warning')
  assert.equal(blockBoundaryById.get('block-before-critical').severity, 'warning')
  assert.equal(blockBoundaryById.get('block-at-critical').severity, 'critical')
  assert.equal(blockBoundaryById.get('block-at-critical').ageBlocks, 20)
  assert.equal(blockBoundaryById.get('block-at-critical').ageMs, null)
  assert.equal(blockBoundaryById.get('block-head-missing').signal, 'onchain_validator_update_missing')

  const dedupeFixture = evaluate({
    validators: [
      {
        validatorId: 'validator/dedupe 1',
        source: 'z-source',
        pcr0: { observedPcr0: 'same', expectedPcr0: 'same', observedAt: ago(10) },
      },
      {
        validatorId: 'validator/dedupe 1',
        source: 'a-source',
        pcr0: { observedPcr0: 'same', expectedPcr0: 'same', observedAt: ago(20) },
      },
      {
        validatorId: 'validator/dedupe 1',
        source: 'a-source',
        pcr0: { observedPcr0: 'same', expectedPcr0: 'same', observedAt: ago(20) },
      },
    ],
  })
  assert.equal(dedupeFixture.length, 1)
  assert.equal(dedupeFixture[0].signal, 'pcr0_stale')
  assert.equal(dedupeFixture[0].severity, 'critical', 'dedupe keeps the most severe observation')
  assert.equal(dedupeFixture[0].ageMs, 20)
  assert.equal(dedupeFixture[0].occurrences, 3)
  assert.deepEqual(dedupeFixture[0].sources, ['a-source', 'z-source'])
  assert.equal(
    dedupeFixture[0].fingerprint,
    'research-lab:v1:pcr0_stale:validator:validator%2Fdedupe%201',
  )

  const mergedSourcesFixture = evaluate({
    validators: [
      {
        validatorId: 'validator-merge',
        source: 'gateway',
        pcr0: { observedPcr0: 'bad', expectedPcr0: 'good', observedAt: ago(1) },
      },
      {
        validatorId: 'validator-merge',
        source: 'published weights',
        offchainWeightBundle: { publishedAt: null },
      },
      {
        validatorId: 'validator-merge',
        source: 'chain',
        onchainUpdate: { updatedAt: null },
      },
    ],
  })
  assert.deepEqual(signals(mergedSourcesFixture), [
    'offchain_weight_bundle_missing',
    'onchain_validator_update_missing',
    'pcr0_mismatch',
  ], 'all source observations are merged without short-circuiting')

  const multiSignalRunFixture = evaluate({
    activeRuns: [{
      runId: 'run-stale-and-blocked',
      status: 'running',
      blocked: true,
      lastActivityAt: ago(20),
      blockedAt: ago(20),
    }],
  })
  assert.deepEqual(
    signals(multiSignalRunFixture),
    ['active_run_blocked', 'active_run_stale'],
    'a blocker does not short-circuit independent stale-run evaluation',
  )

  const explicitMatchFixture = evaluate({
    validators: [{
      validatorId: 'validator-explicit-match',
      pcr0: {
        observedPcr0: 'observed',
        expectedPcr0: 'different',
        matched: true,
        observedAt: ago(1),
      },
    }],
  })
  assert.deepEqual(explicitMatchFixture, [], 'explicit canonical match takes precedence over string comparison')

  assert.deepEqual(
    evaluate({ validators: [{ validatorId: 'validator-unavailable', source: 'partial source' }] }),
    [],
    'unavailable/omitted signals do not become false missing alerts',
  )

  const defaultBlocked = evaluateResearchLabAlerts({
    activeRuns: [{ runId: 'default-blocked', status: 'blocked', blockedAt: NOW }],
  }, { now: NOW })
  assert.equal(defaultBlocked[0].severity, 'warning')
  assert.equal(DEFAULT_RESEARCH_LAB_ALERT_THRESHOLDS.activeRunBlocked.warnMs, 0)
  assert.equal(DEFAULT_RESEARCH_LAB_ALERT_THRESHOLDS.onchainValidatorUpdateStale.warnBlocks, 360)

  const partiallyOverridden = resolveResearchLabAlertThresholds({
    dataFreshness: { warnMs: 123 },
  })
  assert.equal(partiallyOverridden.dataFreshness.warnMs, 123)
  assert.equal(
    partiallyOverridden.dataFreshness.criticalMs,
    DEFAULT_RESEARCH_LAB_ALERT_THRESHOLDS.dataFreshness.criticalMs,
  )
  assert.throws(
    () => resolveResearchLabAlertThresholds({ dataFreshness: { warnMs: -1 } }),
    /non-negative/,
  )
  assert.throws(
    () => resolveResearchLabAlertThresholds({ dataFreshness: { warnMs: 20, criticalMs: 10 } }),
    /greater than or equal/,
  )
  assert.throws(
    () => resolveResearchLabAlertThresholds({
      onchainValidatorUpdateStale: { warnBlocks: 20, criticalBlocks: 10 },
    }),
    /greater than or equal/,
  )
  assert.throws(
    () => evaluateResearchLabAlerts({}, { now: 'not-a-time' }),
    /valid timestamp/,
  )
  assert.throws(
    () => buildResearchLabAlertFingerprint('data_freshness', 'data', '   '),
    /non-empty string/,
  )

  assert.deepEqual(
    evaluate({ dataFreshness: [{ sourceId: 'stable', observedAt: ago(20) }] }),
    evaluate({ dataFreshness: [{ sourceId: 'stable', observedAt: ago(20) }] }),
    'the required now value makes evaluation deterministic',
  )

  console.log('research-lab-alerts: signal coverage, boundaries, merging, and dedupe passed')
} finally {
  await rm(outDir, { recursive: true, force: true })
}
