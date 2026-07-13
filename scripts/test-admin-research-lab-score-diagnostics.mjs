import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const outDir = await mkdtemp(join(tmpdir(), 'admin-score-bundle-diagnostics-'))

try {
  const tsc = spawnSync(process.execPath, [
    resolve('node_modules/typescript/bin/tsc'),
    resolve('src/lib/admin-research-lab-telemetry.ts'),
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

  assert.equal(tsc.status, 0, 'score-bundle diagnostics parser should compile')

  const require = createRequire(import.meta.url)
  const { parseAdminLabScoreBundleDiagnostics } = require(
    join(outDir, 'admin-research-lab-telemetry.js'),
  )

  const observedBundle = {
    aggregates: {
      per_icp_results: [
        {
          icp_ref: ' qualification_private_icp_sets:20260701:icp_011 ',
          status: ' completed ',
          failure_reason:
            'candidate_model_runtime_provider_error;candidate_model_zero_companies',
          failure_class: 'candidate_model_runtime_provider_error',
        },
        {
          icp_ref: 'qualification_private_icp_sets:20260701:icp_012',
          status: 'failed',
          failure_reason: 'Provider returned malformed output after retries',
          failure_classes: [
            'candidate_model_invalid_output',
            'candidate_model_invalid_output',
            'provider_cost_cap_blocked;provider_cost_tracking_failed',
          ],
        },
        null,
        [],
        {},
        'not-an-object',
      ],
    },
    improvement_gate: {
      decision: 'not_applicable',
      reason: 'daily baseline has no paired per-ICP scores',
      blockers: [
        'superseded_metric_daily_baseline_reference',
        ' ',
        'superseded_metric_daily_baseline_reference',
      ],
      policy: {
        min_delta: '1',
        min_delta_lcb: 0.5,
        min_candidate_score: 0,
        min_successful_icps: '20',
        max_hard_failures: 0,
        max_cost_usd: null,
      },
      eligible_for_probation: 'false',
      advisory_basis: 'superseded_metric_not_applicable',
      reference_evaluation_mode: 'stored_daily_baseline',
    },
    private_holdout_gate: {
      decision: 'rejected_before_private_holdout',
      reason: 'public score below baseline',
      blockers: ['public_score_below_baseline'],
      gate_type: 'public_score_before_private_holdout',
      schema_version: '1.0',
      public_icp_count: 10,
      private_holdout_icp_count: '10',
      private_holdout_evaluated: false,
      candidate_public_score: '5.4',
      baseline_public_score: 15.986667,
      baseline_private_score: 32.94,
      baseline_aggregate_score: 24.463333,
      paired_base_public_score: null,
      candidate_delta_vs_daily_baseline: null,
      provider_excluded_icp_ids: ['icp_007', 'icp_007', ' '],
      baseline_benchmark_bundle_id: 'private_benchmark:87cf',
      reference_evaluation_mode: 'stored_daily_baseline',
    },
    scoring_health: {
      health_status: 'degraded',
      schema_version: '1.0',
      icp_count: 10,
      failure_class_counts: {
        candidate_model_zero_companies: 9,
        candidate_model_runtime_provider_error: '9',
        ignored_negative: -1,
        ignored_fraction: 1.5,
        ignored_text: 'many',
      },
      provider_error_count: '9',
      provider_error_rate: 0.9,
      timeout_count: 1,
      timeout_rate: '0.1',
      invalid_output_count: 2,
      invalid_output_rate: 0.2,
      skipped_candidate_count: 3,
      skipped_candidate_rate: 0.3,
      candidate_runtime_failure_count: 9,
      candidate_runtime_success_rate: 0.1,
      reference_runtime_failure_count: 0,
      reference_runtime_success_rate: 1,
      candidate_zero_company_count: 9,
      candidate_zero_company_rate: 0.9,
      reference_zero_company_count: 0,
      reference_zero_company_rate: 0,
      sourced_zero_no_error_count: 4,
      sourced_zero_no_error_rate: 0.4,
      provider_excluded_icp_count: 2,
      provider_excluded_icp_rate: 0.2,
      provider_cost_cap_blocked_icp_count: 3,
      provider_cost_cap_blocked_icp_rate: 0.3,
      provider_cost_tracking_failed_icp_count: 4,
      provider_cost_tracking_failed_icp_rate: 0.4,
      public_holdout_decision: 'rejected_before_private_holdout',
      baseline_bundle_id: 'private_benchmark:87cf',
      baseline_bundle_hash: 'sha256:8307',
      private_holdout_gate: {
        candidate_total_score: '18.2',
        paired_base_total_score: 24.4,
        baseline_benchmark_hash: 'sha256:8307',
      },
    },
  }
  const originalObservedBundle = structuredClone(observedBundle)
  const diagnostics = parseAdminLabScoreBundleDiagnostics(observedBundle)

  assert.deepEqual(
    observedBundle,
    originalObservedBundle,
    'the pure parser must not mutate its input',
  )
  assert.deepEqual(diagnostics.perIcpResults, [
    {
      icpRef: 'qualification_private_icp_sets:20260701:icp_011',
      status: 'completed',
      failureReason:
        'candidate_model_runtime_provider_error;candidate_model_zero_companies',
      failureClass: 'candidate_model_runtime_provider_error',
      failureClasses: [
        'candidate_model_runtime_provider_error',
        'candidate_model_zero_companies',
      ],
    },
    {
      icpRef: 'qualification_private_icp_sets:20260701:icp_012',
      status: 'failed',
      failureReason: 'Provider returned malformed output after retries',
      failureClass: 'candidate_model_invalid_output',
      failureClasses: [
        'candidate_model_invalid_output',
        'provider_cost_cap_blocked',
        'provider_cost_tracking_failed',
      ],
    },
  ])
  assert.deepEqual(diagnostics.improvementGate, {
    decision: 'not_applicable',
    reason: 'daily baseline has no paired per-ICP scores',
    blockers: ['superseded_metric_daily_baseline_reference'],
    policy: {
      minDelta: 1,
      minDeltaLcb: 0.5,
      minCandidateScore: 0,
      minSuccessfulIcps: 20,
      maxHardFailures: 0,
      maxCostUsd: null,
    },
    eligibleForProbation: false,
    advisoryBasis: 'superseded_metric_not_applicable',
    referenceEvaluationMode: 'stored_daily_baseline',
  })
  assert.deepEqual(diagnostics.privateHoldoutGate, {
    decision: 'rejected_before_private_holdout',
    reason: 'public score below baseline',
    blockers: ['public_score_below_baseline'],
    gateType: 'public_score_before_private_holdout',
    schemaVersion: '1.0',
    publicIcpCount: 10,
    privateHoldoutIcpCount: 10,
    privateHoldoutEvaluated: false,
    candidatePublicScore: 5.4,
    baselinePublicScore: 15.986667,
    candidateTotalScore: 18.2,
    baselinePrivateScore: 32.94,
    baselineAggregateScore: 24.463333,
    pairedBasePublicScore: null,
    pairedBaseTotalScore: 24.4,
    candidateDeltaVsDailyBaseline: null,
    providerExcludedIcpIds: ['icp_007'],
    baselineBenchmarkBundleId: 'private_benchmark:87cf',
    baselineBenchmarkHash: 'sha256:8307',
    referenceEvaluationMode: 'stored_daily_baseline',
  })
  assert.deepEqual(diagnostics.scoringHealth, {
    healthStatus: 'degraded',
    schemaVersion: '1.0',
    icpCount: 10,
    failureClassCounts: {
      candidate_model_zero_companies: 9,
      candidate_model_runtime_provider_error: 9,
    },
    providerErrorCount: 9,
    providerErrorRate: 0.9,
    timeoutCount: 1,
    timeoutRate: 0.1,
    invalidOutputCount: 2,
    invalidOutputRate: 0.2,
    skippedCandidateCount: 3,
    skippedCandidateRate: 0.3,
    candidateRuntimeFailureCount: 9,
    candidateRuntimeSuccessRate: 0.1,
    referenceRuntimeFailureCount: 0,
    referenceRuntimeSuccessRate: 1,
    candidateZeroCompanyCount: 9,
    candidateZeroCompanyRate: 0.9,
    referenceZeroCompanyCount: 0,
    referenceZeroCompanyRate: 0,
    sourcedZeroNoErrorCount: 4,
    sourcedZeroNoErrorRate: 0.4,
    providerExcludedIcpCount: 2,
    providerExcludedIcpRate: 0.2,
    providerCostCapBlockedIcpCount: 3,
    providerCostCapBlockedIcpRate: 0.3,
    providerCostTrackingFailedIcpCount: 4,
    providerCostTrackingFailedIcpRate: 0.4,
    publicHoldoutDecision: 'rejected_before_private_holdout',
    baselineBundleId: 'private_benchmark:87cf',
    baselineBundleHash: 'sha256:8307',
  })

  const camelCaseAndNestedFallback = parseAdminLabScoreBundleDiagnostics({
    perIcpResults: [
      {
        icpRef: 'icp:camel',
        status: 'failed',
        failureClass: 'candidate_timeout',
      },
    ],
    improvementGate: {
      decision: 'blocked',
      blockers: 'not_enough_successful_icps',
      policy: { minSuccessfulIcps: '20' },
      eligibleForProbation: true,
    },
    scoringHealth: {
      healthStatus: 'healthy',
      failureClassCounts: { candidate_timeout: '0' },
      privateHoldoutGate: {
        decision: 'evaluated',
        privateHoldoutEvaluated: 'true',
        privateHoldoutIcpCount: '10',
      },
    },
  })
  assert.deepEqual(camelCaseAndNestedFallback.perIcpResults, [
    {
      icpRef: 'icp:camel',
      status: 'failed',
      failureReason: null,
      failureClass: 'candidate_timeout',
      failureClasses: ['candidate_timeout'],
    },
  ])
  assert.equal(camelCaseAndNestedFallback.improvementGate.policy.minSuccessfulIcps, 20)
  assert.deepEqual(camelCaseAndNestedFallback.privateHoldoutGate, {
    decision: 'evaluated',
    reason: null,
    blockers: [],
    gateType: null,
    schemaVersion: null,
    publicIcpCount: null,
    privateHoldoutIcpCount: 10,
    privateHoldoutEvaluated: true,
    candidatePublicScore: null,
    baselinePublicScore: null,
    candidateTotalScore: null,
    baselinePrivateScore: null,
    baselineAggregateScore: null,
    pairedBasePublicScore: null,
    pairedBaseTotalScore: null,
    candidateDeltaVsDailyBaseline: null,
    providerExcludedIcpIds: [],
    baselineBenchmarkBundleId: null,
    baselineBenchmarkHash: null,
    referenceEvaluationMode: null,
  })

  const emptyDiagnostics = {
    perIcpResults: [],
    improvementGate: null,
    privateHoldoutGate: null,
    scoringHealth: null,
  }
  for (const malformed of [null, undefined, false, 0, '', [], { aggregates: [] }]) {
    assert.deepEqual(parseAdminLabScoreBundleDiagnostics(malformed), emptyDiagnostics)
  }
  assert.deepEqual(
    parseAdminLabScoreBundleDiagnostics({
      aggregates: {
        per_icp_results: [
          {},
          { icp_ref: 7, status: false, failure_reason: [] },
        ],
      },
      improvement_gate: { blockers: [null, 7], policy: { min_delta: false } },
      private_holdout_gate: { private_holdout_evaluated: 1 },
      scoring_health: {
        failure_class_counts: {
          missing: null,
          negative: -1,
          fractional: 1.5,
          valid: '2',
        },
      },
    }),
    {
      perIcpResults: [],
      improvementGate: null,
      privateHoldoutGate: null,
      scoringHealth: {
        healthStatus: null,
        schemaVersion: null,
        icpCount: null,
        failureClassCounts: { valid: 2 },
        providerErrorCount: null,
        providerErrorRate: null,
        timeoutCount: null,
        timeoutRate: null,
        invalidOutputCount: null,
        invalidOutputRate: null,
        skippedCandidateCount: null,
        skippedCandidateRate: null,
        candidateRuntimeFailureCount: null,
        candidateRuntimeSuccessRate: null,
        referenceRuntimeFailureCount: null,
        referenceRuntimeSuccessRate: null,
        candidateZeroCompanyCount: null,
        candidateZeroCompanyRate: null,
        referenceZeroCompanyCount: null,
        referenceZeroCompanyRate: null,
        sourcedZeroNoErrorCount: null,
        sourcedZeroNoErrorRate: null,
        providerExcludedIcpCount: null,
        providerExcludedIcpRate: null,
        providerCostCapBlockedIcpCount: null,
        providerCostCapBlockedIcpRate: null,
        providerCostTrackingFailedIcpCount: null,
        providerCostTrackingFailedIcpRate: null,
        publicHoldoutDecision: null,
        baselineBundleId: null,
        baselineBundleHash: null,
      },
    },
  )

  console.log(
    'admin-research-lab-score-diagnostics: observed, fallback, immutable, and malformed fixtures passed',
  )
} finally {
  await rm(outDir, { recursive: true, force: true })
}
