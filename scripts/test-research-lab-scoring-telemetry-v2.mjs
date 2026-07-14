import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const outDir = await mkdtemp(join(tmpdir(), 'research-lab-scoring-v2-'))

try {
  const tsc = spawnSync(process.execPath, [
    resolve('node_modules/typescript/bin/tsc'),
    resolve('src/lib/research-lab-scoring-telemetry.ts'),
    '--target',
    'ES2022',
    '--module',
    'CommonJS',
    '--moduleResolution',
    'Node',
    '--outDir',
    outDir,
    '--strict',
    '--skipLibCheck',
  ], { stdio: 'inherit' })
  assert.equal(tsc.status, 0, 'V2 scoring telemetry helper should compile')

  const require = createRequire(import.meta.url)
  const {
    correlateResearchLabBenchmarkRun,
    normalizeResearchLabScoringExecution,
    sanitizeResearchLabPublicBenchmarkTelemetry,
  } = require(join(outDir, 'research-lab-scoring-telemetry.js'))

  const baseRun = {
    scoring_run_id: '00000000-0000-4000-8000-000000000001',
    scoring_id: `scoring:sha256:${'1'.repeat(64)}`,
    run_type: 'private_baseline_rebenchmark',
    run_attempt: 0,
    expected_icp_count: 20,
    current_run_status: 'completed',
    current_status_at: '2026-07-13T04:10:00Z',
    started_at: '2026-07-13T04:00:00Z',
    finished_at: '2026-07-13T04:10:00Z',
    observed_runtime_seconds: 600,
    worker_ref: 'worker-1',
  }
  const completedRows = Array.from({ length: 20 }, (_, index) => ({
    telemetry_mode: 'v2',
    scoring_id: baseRun.scoring_id,
    scoring_run_id: baseRun.scoring_run_id,
    icp_execution_id: `execution-${index}`,
    icp_ref: `private-ref-${index}`,
    model_role: 'reference',
    status: 'completed',
    retry_round: 0,
    cumulative_spend_usd: 0.25,
    cap_usd: 1,
    expected_units: 20,
  }))
  const providerCostEnrichment = completedRows.slice(0, 7)
  assert.equal(providerCostEnrichment.length, 7)
  const completed = normalizeResearchLabScoringExecution([baseRun], completedRows)
  assert.equal(completed.resolvedUnits, 20, 'provider-cost coverage must not determine progress')
  assert.equal(completed.completedUnits, 20)
  assert.equal(completed.progressPercent, 100)
  assert.equal(completed.spendUsd, 5, 'cumulative spend is counted once per canonical ICP')

  const skippedRows = Array.from({ length: 20 }, (_, index) => ({
    ...completedRows[index],
    status: index < 10 ? 'completed' : 'skipped',
    execution_kind: index < 10 ? 'model_invocation' : 'gate_skip',
  }))
  const skipped = normalizeResearchLabScoringExecution([baseRun], skippedRows)
  assert.equal(skipped.completedUnits, 10)
  assert.equal(skipped.skippedUnits, 10)
  assert.equal(skipped.resolvedUnits, 20)
  assert.equal(skipped.progressPercent, 100)

  const cancelledExecution = normalizeResearchLabScoringExecution([{
    ...baseRun,
    current_run_status: 'cancelled',
    current_failure_category: 'baseline_reference_conflict',
  }], completedRows)
  const publicCancelled = sanitizeResearchLabPublicBenchmarkTelemetry({
    publicationStatus: 'published',
    canonicalPublishedScore: 34.11,
    execution: cancelledExecution,
  })
  assert.equal(publicCancelled.publicationStatus, 'published')
  assert.equal(publicCancelled.canonicalPublishedScore, 34.11)
  assert.equal(publicCancelled.executionStatus, 'cancelled')

  const sameDateBundles = [
    {
      benchmark_bundle_id: 'bundle-a',
      benchmark_date: '2026-07-13',
      rolling_window_hash: `sha256:${'a'.repeat(64)}`,
      private_model_artifact_hash: `sha256:${'b'.repeat(64)}`,
    },
    {
      benchmark_bundle_id: 'bundle-b',
      benchmark_date: '2026-07-13',
      rolling_window_hash: `sha256:${'a'.repeat(64)}`,
      private_model_artifact_hash: `sha256:${'c'.repeat(64)}`,
    },
  ]
  const artifactLinked = correlateResearchLabBenchmarkRun([{
    ...baseRun,
    benchmark_date: '2026-07-13',
    rolling_window_hash: `sha256:${'a'.repeat(64)}`,
    reference_artifact_hash: `sha256:${'c'.repeat(64)}`,
  }], sameDateBundles, new Map())
  assert.equal(artifactLinked.correlation, 'exact_artifacts')
  assert.equal(artifactLinked.bundle.benchmark_bundle_id, 'bundle-b')
  const ambiguous = correlateResearchLabBenchmarkRun([{
    ...baseRun,
    benchmark_date: '2026-07-13',
    rolling_window_hash: `sha256:${'a'.repeat(64)}`,
    reference_artifact_hash: null,
  }], sameDateBundles, new Map())
  assert.equal(ambiguous.correlation, 'unlinked', 'date-only correlation must never guess')

  const retryRows = [
    {
      ...completedRows[0],
      icp_execution_id: 'failed-attempt',
      status: 'failed',
      retry_round: 0,
      cumulative_spend_usd: 1,
    },
    {
      ...completedRows[0],
      icp_execution_id: 'canonical-retry',
      status: 'completed',
      retry_round: 1,
      execution_kind: 'checkpoint_reuse',
      checkpoint_ref: 'scoring_checkpoint:abc',
      cumulative_spend_usd: 2.5,
    },
  ]
  const retried = normalizeResearchLabScoringExecution([
    { ...baseRun, expected_icp_count: 1 },
  ], retryRows)
  assert.equal(retried.resolvedUnits, 1)
  assert.equal(retried.completedUnits, 1)
  assert.equal(retried.failedUnits, 0)
  assert.equal(retried.spendUsd, 2.5)
  assert.equal(retried.maxRetryRound, 1)
  assert.equal(retried.checkpointReuseCount, 1)

  const degraded = normalizeResearchLabScoringExecution([baseRun], [])
  assert.equal(degraded.telemetryMode, 'missing')
  assert.equal(degraded.telemetryDegraded, true)
  assert.equal(degraded.resolvedUnits, null, 'missing telemetry must not become zero progress')
  assert.equal(degraded.progressPercent, null)

  const safeKeys = [
    'publicationStatus',
    'executionStatus',
    'expectedUnits',
    'resolvedUnits',
    'completedUnits',
    'skippedUnits',
    'failedUnits',
    'progressPercent',
    'startedAt',
    'completedAt',
    'durationSeconds',
    'canonicalPublishedScore',
  ].sort()
  assert.deepEqual(Object.keys(publicCancelled).sort(), safeKeys)
  const publicJson = JSON.stringify(publicCancelled)
  assert.doesNotMatch(publicJson, /icp_ref|icp_hash|rolling_window_hash|artifact_hash|checkpoint|worker/i)

  const adminRoute = await readFile(resolve('src/app/api/admin/research-lab/route.ts'), 'utf8')
  const adminComponent = await readFile(resolve('src/app/admin/_components/AdminResearchLabTelemetry.tsx'), 'utf8')
  const publicRoute = await readFile(resolve('src/app/api/research-lab/route.ts'), 'utf8')
  const publicComponent = await readFile(resolve('src/components/dashboard/ResearchLab.tsx'), 'utf8')
  assert.match(adminRoute, /research_lab_scoring_run_current/)
  assert.match(adminRoute, /research_lab_private_benchmark_dashboard_telemetry/)
  assert.match(adminRoute, /fetchHistoricalBenchmarkRuns|buildHistoricalBenchmarkRuns/)
  assert.match(adminComponent, /function HistoricalBenchmarkRuns\(\{ runs \}/)
  assert.match(adminComponent, /function ChampionHistory\(\{ champions \}/)
  assert.doesNotMatch(adminComponent, /function HistoricalBenchmarkRuns\(\{ champions \}/)
  assert.doesNotMatch(adminComponent, /label=\{`Execution \$\{benchmark\.executionStatus/)
  assert.match(publicRoute, /sanitizeResearchLabPublicBenchmarkTelemetry/)
  assert.doesNotMatch(publicRoute, /gatewayScoringStatus\s*\?\?/)
  assert.match(publicComponent, /isBenchmarkExecutionInProgress\(telemetry\.executionStatus\)/)
  assert.match(publicComponent, /function ScoringHero\(/)
  assert.doesNotMatch(publicComponent, /function BenchmarkExecutionSummary\(/)
  assert.doesNotMatch(publicComponent, /Publication \{telemetry\.publicationStatus\}/)

  console.log('research-lab-scoring-telemetry-v2: progress, correlation, retry dedupe, degradation, public safety, history, and active hero semantics passed')
} finally {
  await rm(outDir, { recursive: true, force: true })
}
