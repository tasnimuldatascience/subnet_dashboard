import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const outDir = await mkdtemp(join(tmpdir(), 'research-lab-status-'))

try {
  const tsc = spawnSync(process.execPath, [
    resolve('node_modules/typescript/bin/tsc'),
    resolve('src/lib/research-lab-status.ts'),
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

  assert.equal(tsc.status, 0, 'status helper should compile')

  const require = createRequire(import.meta.url)
  const {
    deriveResearchLabLoopStatus,
    filterResearchLabActivityLoops,
    RESEARCH_LAB_STATUS_FILTER_OPTIONS,
    researchLabStatusFilterOptionsWithCounts,
  } = require(join(outDir, 'research-lab-status.js'))

  const cases = [
    {
      name: 'canonical no payment renders Awaiting payment',
      input: {
        publicStatus: 'awaiting_payment',
        paymentState: 'no_payment',
        runId: null,
        receiptId: null,
      },
      expected: {
        key: 'awaiting_payment',
        label: 'Awaiting payment',
        band: 'pending',
        active: false,
        scoring: false,
        actionLabel: 'Payment pending',
        actionDetail: 'No payment has been recorded for this research loop yet.',
      },
    },
    {
      name: 'canonical paid loop with no worker run renders Paid, not started',
      input: {
        publicStatus: 'paid_not_started',
        paymentState: 'paid',
        executionState: 'not_started',
        runId: null,
        receiptId: 'receipt-paid',
      },
      expected: {
        key: 'paid_not_started',
        label: 'Paid, not started',
        band: 'pending',
        active: false,
        scoring: false,
      },
    },
    {
      name: 'canonical OpenRouter 402 renders Waiting for credits',
      input: {
        publicStatus: 'running',
        paymentState: 'paid',
        executionState: 'failed',
        opsReason: 'openrouter_402',
        statusDetail: 'OpenRouter 402 insufficient credits',
      },
      expected: {
        key: 'blocked_for_credit',
        label: 'Waiting for credits',
        band: 'blocked',
        active: false,
        scoring: false,
        actionLabel: 'Retry available',
        actionDetail: 'OpenRouter 402 insufficient credits',
      },
    },
    {
      name: 'canonical scored no gain with failed receipt warning keeps model result primary',
      input: {
        publicStatus: 'scored_no_gain',
        paymentState: 'paid',
        executionState: 'completed',
        candidateState: 'scored',
        resultState: 'scored_no_gain',
        currentReceiptStatus: 'failed',
        opsWarnings: ['Queue receipt failed after scoring'],
        scoredCandidateCount: 1,
      },
      expected: {
        key: 'scored_no_gain',
        label: 'No gain',
        band: 'no_gain',
        active: false,
        scoring: false,
        detail: 'Final outcome: scoring did not produce a promoted candidate.',
        actionLabel: 'Review recommended',
        actionDetail: 'Queue receipt failed after scoring',
      },
    },
    {
      name: 'canonical terminal stale scoring retry failure renders Scoring failed',
      input: {
        publicStatus: 'failed',
        paymentState: 'paid',
        executionState: 'failed',
        candidateState: 'failed',
        resultState: 'failed',
        opsReason: 'stale_scoring_retry_failed',
        candidateCount: 1,
        scoredCandidateCount: 0,
      },
      expected: {
        key: 'scoring_failed',
        label: 'Scoring failed',
        band: 'failed',
        active: false,
        scoring: false,
        detail: 'Final outcome: candidate scoring exhausted retry budget.',
      },
    },
    {
      name: 'canonical stale parent rebase unavailable renders Stale with recovery action',
      input: {
        publicStatus: 'failed',
        paymentState: 'paid',
        resultState: 'failed',
        candidateState: 'failed',
        opsReason: 'stale_parent_rebase_unavailable',
      },
      expected: {
        key: 'stale',
        label: 'Stale',
        band: 'stale',
        active: false,
        scoring: false,
        actionLabel: 'Stale recovery needed',
        actionDetail: 'Stale Parent Rebase Unavailable',
      },
    },
    {
      name: 'active scoring candidate renders Scoring, not Waiting for baseline',
      input: {
        outcomeLabel: 'scoring',
        outcomeBand: 'running',
        currentCandidateStatus: 'evaluating',
        currentReason: 'gateway_qualification_worker_heartbeat',
        candidateCount: 1,
        scoredCandidateCount: 0,
        runId: 'run-0',
        receiptId: 'receipt-0',
      },
      expected: {
        key: 'scoring',
        label: 'Scoring',
        band: 'running',
        active: true,
        scoring: true,
      },
    },
    {
      name: 'baseline_not_ready candidate renders Waiting for baseline',
      input: {
        outcomeLabel: 'scoring',
        outcomeBand: 'running',
        currentCandidateStatus: 'queued',
        currentReason: 'baseline_not_ready',
        currentQueueStatus: 'queued',
        runId: 'run-1',
        receiptId: 'receipt-1',
      },
      expected: {
        key: 'waiting_for_baseline',
        label: 'Waiting for baseline',
        band: 'pending',
        active: false,
        scoring: false,
        detail: 'Scoring is waiting for the benchmark baseline to become ready.',
      },
    },
    {
      name: 'explicit waiting_for_baseline outcome renders Waiting for baseline',
      input: {
        outcomeLabel: 'waiting_for_baseline',
        outcomeBand: 'pending',
        currentCandidateStatus: 'evaluating',
        currentReason: 'gateway_qualification_worker_heartbeat',
        candidateCount: 1,
        scoredCandidateCount: 0,
        runId: 'run-1a',
        receiptId: 'receipt-1a',
      },
      expected: {
        key: 'waiting_for_baseline',
        label: 'Waiting for baseline',
        band: 'pending',
        active: false,
        scoring: false,
        detail: 'Scoring is waiting for the benchmark baseline to become ready.',
      },
    },
    {
      name: 'completed queue with baseline_not_ready unscored candidate renders Waiting for baseline',
      input: {
        outcomeLabel: 'completed',
        outcomeBand: 'completed',
        currentCandidateStatus: 'queued',
        currentReason: 'baseline_not_ready',
        currentQueueStatus: 'completed',
        candidateCount: 1,
        scoredCandidateCount: 0,
        runId: 'run-1b',
        receiptId: 'receipt-1b',
      },
      expected: {
        key: 'waiting_for_baseline',
        label: 'Waiting for baseline',
        band: 'pending',
        active: false,
        scoring: false,
        detail: 'Candidate generation completed, but scoring is waiting for the benchmark baseline.',
      },
    },
    {
      name: 'stale_parent_needs_rescore renders Stale with recovery action',
      input: {
        outcomeLabel: 'needs_rescore',
        outcomeBand: 'stale',
        currentCandidateStatus: 'queued',
        currentReason: 'stale_parent_needs_rescore',
        runId: 'run-2',
        receiptId: 'receipt-2',
      },
      expected: {
        key: 'stale',
        label: 'Stale',
        band: 'stale',
        active: false,
        scoring: false,
        actionLabel: 'Stale recovery needed',
        actionDetail: 'Candidate was created against an older parent model and needs to be rebased or rescored against the current parent.',
      },
    },
    {
      name: 'terminal failed queue does not become primary failed without canonical failed outcome',
      input: {
        outcomeLabel: 'running',
        outcomeBand: 'stale',
        currentCandidateStatus: 'needs_rescore',
        currentReason: 'stale_parent',
        currentQueueStatus: 'failed',
        runId: 'run-3',
        receiptId: 'receipt-3',
      },
      expected: {
        key: 'stale',
        label: 'Stale',
        band: 'stale',
        active: false,
        scoring: false,
      },
    },
    {
      name: 'scored candidate with no benchmark gain renders No gain',
      input: {
        outcomeLabel: 'running',
        outcomeBand: 'no_gain',
        currentCandidateStatus: 'scored',
        currentQueueStatus: 'completed',
        scoredCandidateCount: 1,
        runId: 'run-4',
        receiptId: 'receipt-4',
      },
      expected: {
        key: 'scored_no_gain',
        label: 'No gain',
        band: 'no_gain',
        active: false,
        scoring: false,
        detail: 'Final outcome: scoring did not produce a promoted candidate.',
      },
    },
    {
      name: 'raw scored_no_gain renders No gain even with unscored candidate counts',
      input: {
        outcomeLabel: 'scored_no_gain',
        outcomeBand: 'no_gain',
        currentCandidateStatus: 'queued',
        candidateCount: 1,
        scoredCandidateCount: 0,
        runId: 'run-4b',
        receiptId: 'receipt-4b',
      },
      expected: {
        key: 'scored_no_gain',
        label: 'No gain',
        band: 'no_gain',
        active: false,
        scoring: false,
        detail: 'Final outcome: scoring did not produce a promoted candidate.',
      },
    },
    {
      name: 'scored_promising small_gain renders Promising',
      input: {
        outcomeLabel: 'scored_promising',
        outcomeBand: 'small_gain',
        currentCandidateStatus: 'scored',
        improvementGateDecision: 'not_eligible',
        runId: 'run-small-gain',
        receiptId: 'receipt-small-gain',
      },
      expected: {
        key: 'scored_promising',
        label: 'Promising',
        band: 'small_gain',
        active: false,
        scoring: false,
        promising: true,
      },
    },
    {
      name: 'passed threshold band renders Promising unless promoted',
      input: {
        outcomeLabel: 'scored_promising',
        outcomeBand: 'passed_threshold',
        currentCandidateStatus: 'scored',
        runId: 'run-passed-threshold',
        receiptId: 'receipt-passed-threshold',
      },
      expected: {
        key: 'scored_promising',
        label: 'Promising',
        band: 'passed_threshold',
        active: false,
        scoring: false,
        promising: true,
      },
    },
    {
      name: 'rejected below-threshold promotion event stays Promising',
      input: {
        outcomeLabel: 'scored_promising',
        outcomeBand: 'small_gain',
        currentCandidateStatus: 'scored',
        promotionStatus: 'rejected',
        promotionEventType: 'below_threshold',
        runId: 'run-rejected-promotion',
        receiptId: 'receipt-rejected-promotion',
      },
      expected: {
        key: 'scored_promising',
        label: 'Promising',
        band: 'small_gain',
        active: false,
        scoring: false,
        promising: true,
      },
    },
    {
      name: 'not eligible improvement gate stays Promising',
      input: {
        outcomeLabel: 'scored_promising',
        outcomeBand: 'small_gain',
        currentCandidateStatus: 'scored',
        improvementGateDecision: 'not_eligible',
        runId: 'run-not-eligible',
        receiptId: 'receipt-not-eligible',
      },
      expected: {
        key: 'scored_promising',
        label: 'Promising',
        band: 'small_gain',
        active: false,
        scoring: false,
        promising: true,
      },
    },
    {
      name: 'promotion pass event keeps scored_promising primary unless outcome is promoted',
      input: {
        outcomeLabel: 'scored_promising',
        outcomeBand: 'pending',
        currentCandidateStatus: 'scored',
        promotionEventType: 'active_version_created',
        runId: 'run-active-version',
        receiptId: 'receipt-active-version',
      },
      expected: {
        key: 'scored_promising',
        label: 'Promising',
        band: 'small_gain',
        active: false,
        scoring: false,
        promising: true,
      },
    },
    {
      name: 'scored_no_gain with failed band and failed queue stays No gain',
      input: {
        outcomeLabel: 'scored_no_gain',
        outcomeBand: 'failed',
        currentCandidateStatus: 'scored',
        currentQueueStatus: 'failed',
        currentReceiptStatus: 'failed',
        candidateCount: 1,
        scoredCandidateCount: 1,
        runId: 'a45c7b0d-e2db-4933-b214-8afe6f80e21f',
        receiptId: 'receipt-ef544527',
      },
      expected: {
        key: 'scored_no_gain',
        label: 'No gain',
        band: 'no_gain',
        active: false,
        scoring: false,
        detail: 'Final outcome: scoring did not produce a promoted candidate.',
        actionLabel: 'Review recommended',
        actionDetail: 'Queue or receipt state is terminal failed, but the final model outcome is preserved.',
      },
    },
    {
      name: 'terminal failed after scoring renders Failed after scoring',
      input: {
        outcomeLabel: 'failed',
        outcomeBand: 'failed',
        currentCandidateStatus: 'scored',
        currentQueueStatus: 'completed',
        candidateCount: 1,
        scoredCandidateCount: 1,
        runId: 'run-failed',
        receiptId: 'receipt-failed',
      },
      expected: {
        key: 'failed_after_scoring',
        label: 'Failed after scoring',
        band: 'failed',
        active: false,
        scoring: false,
        detail: 'Final outcome: scoring did not produce a promoted candidate.',
      },
    },
    {
      name: 'raw submitted without run stays a neutral Submitted fallback',
      input: {
        outcomeLabel: 'submitted',
        outcomeBand: 'pending',
        runId: null,
        receiptId: null,
      },
      expected: {
        key: 'submitted',
        label: 'Submitted',
        band: 'pending',
        active: false,
        scoring: false,
      },
    },
  ]

  for (const fixture of cases) {
    const actual = deriveResearchLabLoopStatus(fixture.input)
    assert.equal(actual.key, fixture.expected.key, fixture.name)
    assert.equal(actual.label, fixture.expected.label, fixture.name)
    assert.equal(actual.band, fixture.expected.band, fixture.name)
    assert.equal(actual.active, fixture.expected.active, fixture.name)
    assert.equal(actual.scoring, fixture.expected.scoring, fixture.name)
    if ('promising' in fixture.expected) {
      assert.equal(actual.promising, fixture.expected.promising, fixture.name)
    }
    if (fixture.expected.detail) {
      assert.equal(actual.note?.detail, fixture.expected.detail, fixture.name)
    }
    if (fixture.expected.actionLabel) {
      assert.equal(actual.action?.label, fixture.expected.actionLabel, fixture.name)
    }
    if (fixture.expected.actionDetail) {
      assert.equal(actual.action?.detail, fixture.expected.actionDetail, fixture.name)
    }
  }

  const optionValues = RESEARCH_LAB_STATUS_FILTER_OPTIONS.map((option) => option.value)
  assert.deepEqual(optionValues, [
    'all',
    'active',
    'promoted',
    'scored',
    'completed_no_candidate',
    'failed',
    'awaiting_payment',
  ], 'status filter options should include requested public outcome buckets')

  const activityLoops = [
    {
      id: 'scoring-alpha-a',
      minerHotkey: 'alpha-hotkey',
      topicSignatureHash: 'direction-a',
      topicTags: ['intent_quality', 'query_generation'],
      researchArea: 'ops',
      outcomeLabel: 'scoring',
      statusKey: 'scoring',
      lastActivityAt: '2026-01-04T00:00:00Z',
    },
    {
      id: 'awaiting-payment-alpha',
      minerHotkey: 'alpha-hotkey',
      topicSignatureHash: 'billing',
      topicTags: ['payment_state'],
      researchArea: 'ops',
      outcomeLabel: 'submitted',
      statusKey: deriveResearchLabLoopStatus({
        publicStatus: 'awaiting_payment',
        paymentState: 'no_payment',
      }).key,
      lastActivityAt: '2026-01-08T00:00:00Z',
    },
    {
      id: 'paid-not-started-beta',
      minerHotkey: 'beta-hotkey',
      topicSignatureHash: 'billing',
      topicTags: ['payment_state'],
      researchArea: 'ops',
      outcomeLabel: 'submitted',
      statusKey: deriveResearchLabLoopStatus({
        publicStatus: 'paid_not_started',
        paymentState: 'paid',
        executionState: 'not_started',
      }).key,
      lastActivityAt: '2026-01-07T00:00:00Z',
    },
    {
      id: 'running-delta',
      minerHotkey: 'delta-hotkey',
      topicSignatureHash: 'worker-lifecycle',
      topicTags: ['worker_lifecycle'],
      researchArea: 'ops',
      outcomeLabel: 'running',
      statusKey: deriveResearchLabLoopStatus({
        publicStatus: 'running',
        paymentState: 'paid',
        executionState: 'running',
      }).key,
      lastActivityAt: '2026-01-06T00:00:00Z',
    },
    {
      id: 'blocked-credit-delta',
      minerHotkey: 'delta-hotkey',
      topicSignatureHash: 'credit-block',
      topicTags: ['ops_reliability'],
      researchArea: 'ops',
      outcomeLabel: 'running',
      statusKey: deriveResearchLabLoopStatus({
        publicStatus: 'running',
        paymentState: 'paid',
        executionState: 'failed',
        opsReason: 'openrouter_402',
        statusDetail: 'OpenRouter 402 insufficient credits',
      }).key,
      lastActivityAt: '2026-01-05T00:00:00Z',
    },
    {
      id: 'needs-rescore-epsilon',
      minerHotkey: 'epsilon-hotkey',
      topicSignatureHash: 'model-staleness',
      topicTags: ['model_staleness'],
      researchArea: 'ops',
      outcomeLabel: 'needs_rescore',
      statusKey: deriveResearchLabLoopStatus({
        publicStatus: 'needs_rescore',
        candidateState: 'needs_rescore',
        opsReason: 'stale_parent_needs_rescore',
      }).key,
      lastActivityAt: '2026-01-04T12:00:00Z',
    },
    {
      id: 'completed-no-candidate-zeta',
      minerHotkey: 'zeta-hotkey',
      topicSignatureHash: 'candidate-generation',
      topicTags: ['candidate_generation'],
      researchArea: 'ops',
      outcomeLabel: 'completed_no_candidate',
      statusKey: deriveResearchLabLoopStatus({
        publicStatus: 'completed_no_candidate',
        resultState: 'completed_no_candidate',
      }).key,
      lastActivityAt: '2026-01-03T18:00:00Z',
    },
    {
      id: 'scored-no-gain-failed-ops',
      minerHotkey: 'alpha-hotkey',
      topicSignatureHash: 'direction-a',
      topicTags: ['intent_quality', 'evidence_freshness'],
      researchArea: 'ops',
      outcomeLabel: 'scored_no_gain',
      statusKey: deriveResearchLabLoopStatus({
        publicStatus: 'scored_no_gain',
        resultState: 'scored_no_gain',
        candidateState: 'scored',
        currentQueueStatus: 'failed',
        opsWarnings: ['Queue receipt failed after scoring'],
        scoredCandidateCount: 1,
      }).key,
      opsWarnings: ['Queue receipt failed after scoring'],
      lastActivityAt: '2026-01-03T12:00:00Z',
    },
    {
      id: 'waiting-alpha-a',
      minerHotkey: 'alpha-hotkey',
      topicSignatureHash: 'direction-a',
      topicTags: ['intent_quality'],
      researchArea: 'ops',
      outcomeLabel: 'scoring',
      statusKey: 'waiting_for_baseline',
      lastActivityAt: '2026-01-03T00:00:00Z',
    },
    {
      id: 'small-gain-beta-a',
      minerHotkey: 'beta-hotkey',
      topicSignatureHash: 'direction-a',
      topicTags: ['query_generation'],
      researchArea: 'ops',
      outcomeLabel: 'scored_promising',
      outcomeBand: 'small_gain',
      statusKey: 'scored_promising',
      lastActivityAt: '2026-01-02T00:00:00Z',
    },
    {
      id: 'improved-beta-a',
      minerHotkey: 'beta-hotkey',
      topicSignatureHash: 'direction-a',
      topicTags: ['query_generation'],
      researchArea: 'ops',
      outcomeLabel: 'scored_promising',
      outcomeBand: 'passed_threshold',
      statusKey: 'scored_promising',
      lastActivityAt: '2026-01-02T01:00:00Z',
    },
    {
      id: 'promoted-eta',
      minerHotkey: 'eta-hotkey',
      topicSignatureHash: 'promotion',
      topicTags: ['promotion'],
      researchArea: 'ops',
      outcomeLabel: 'promoted',
      outcomeBand: 'promoted',
      statusKey: deriveResearchLabLoopStatus({
        outcomeLabel: 'promoted',
        outcomeBand: 'promoted',
      }).key,
      lastActivityAt: '2026-01-02T02:00:00Z',
    },
    {
      id: 'scoring-alpha-b',
      minerHotkey: 'alpha-hotkey',
      topicSignatureHash: 'direction-b',
      topicTags: ['revops', 'intent_quality'],
      researchArea: 'ops',
      outcomeLabel: 'scoring',
      statusKey: 'scoring',
      lastActivityAt: '2026-01-01T00:00:00Z',
    },
    {
      id: 'failed-gamma-b',
      minerHotkey: 'gamma-hotkey',
      topicSignatureHash: 'direction-b',
      topicTags: ['revops'],
      researchArea: 'ops',
      outcomeLabel: 'failed',
      statusKey: 'failed',
      lastActivityAt: '2025-12-31T00:00:00Z',
    },
    {
      id: 'failed-alpha-a',
      minerHotkey: 'alpha-hotkey',
      topicSignatureHash: 'direction-a',
      topicTags: ['intent_quality'],
      researchArea: 'ops',
      outcomeLabel: 'failed',
      statusKey: deriveResearchLabLoopStatus({
        outcomeLabel: 'failed',
        outcomeBand: 'failed',
        currentCandidateStatus: 'scored',
        candidateCount: 1,
        scoredCandidateCount: 1,
      }).key,
      lastActivityAt: '2025-12-30T00:00:00Z',
    },
  ]

  const byId = (loops) => loops.map((loop) => loop.id)
  assert.deepEqual(
    byId(filterResearchLabActivityLoops(activityLoops, { status: 'awaiting_payment' })),
    ['awaiting-payment-alpha'],
    'status filter should find awaiting payment loops'
  )
  assert.deepEqual(
    byId(filterResearchLabActivityLoops(activityLoops, { status: 'active' })),
    ['running-delta', 'scoring-alpha-a', 'scoring-alpha-b'],
    'Active filter should find queued/running/scoring loops'
  )
  assert.deepEqual(
    byId(filterResearchLabActivityLoops(activityLoops, { status: 'promoted' })),
    ['promoted-eta'],
    'Promoted filter should find promoted loops'
  )
  assert.deepEqual(
    byId(filterResearchLabActivityLoops(activityLoops, { status: 'completed_no_candidate' })),
    ['completed-no-candidate-zeta'],
    'No Candidate filter should find no-candidate terminal loops'
  )
  assert.deepEqual(
    byId(filterResearchLabActivityLoops(activityLoops, { status: 'failed' })),
    ['failed-gamma-b', 'failed-alpha-a'],
    'Failed filter should exclude scored_no_gain rows even if ops failed'
  )
  assert.deepEqual(
    byId(filterResearchLabActivityLoops(activityLoops, { status: 'scored' })),
    ['scored-no-gain-failed-ops', 'improved-beta-a', 'small-gain-beta-a'],
    'Scored / No Gain filter should include promising and no-gain records'
  )
  assert.deepEqual(
    byId(filterResearchLabActivityLoops(activityLoops, { direction: 'query_generation' })),
    ['scoring-alpha-a', 'improved-beta-a', 'small-gain-beta-a'],
    'direction filter should match loops where the selected tag is one of several tags'
  )
  assert.deepEqual(
    byId(filterResearchLabActivityLoops(activityLoops, { direction: 'evidence_freshness' })),
    ['scored-no-gain-failed-ops'],
    'direction filter should expose isolated tags instead of combined signatures'
  )
  assert.deepEqual(
    byId(filterResearchLabActivityLoops(activityLoops, {
      minerQuery: 'alpha',
      direction: 'query_generation',
      status: 'active',
    })),
    ['scoring-alpha-a'],
    'miner, direction, and status filters should combine'
  )

  const countedStatusOptions = researchLabStatusFilterOptionsWithCounts(activityLoops, {
    minerQuery: 'alpha',
    direction: 'intent_quality',
  })
  const countedStatusValues = countedStatusOptions.map((option) => option.value)
  const countByValue = Object.fromEntries(
    countedStatusOptions.map((option) => [option.value, option.count])
  )
  assert.deepEqual(
    countedStatusValues,
    ['all', 'active', 'scored', 'failed'],
    'status dropdown should hide empty requested buckets'
  )
  assert.equal(countByValue.all, 5, 'All statuses count should match visible miner+direction records')
  for (const value of countedStatusValues.filter((value) => value !== 'all')) {
    assert.equal(
      countByValue[value],
      filterResearchLabActivityLoops(activityLoops, {
        minerQuery: 'alpha',
        direction: 'intent_quality',
        status: value,
      }).length,
      `${value} count should match visible filtered records`
    )
  }

  console.log(`research-lab-status: ${cases.length} status fixtures and filter fixtures passed`)
} finally {
  await rm(outDir, { recursive: true, force: true })
}
