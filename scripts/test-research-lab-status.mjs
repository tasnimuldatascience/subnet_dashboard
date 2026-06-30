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
  } = require(join(outDir, 'research-lab-status.js'))

  const cases = [
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
        detail: 'Candidate is queued, but scoring is waiting for the benchmark baseline to become ready.',
      },
    },
    {
      name: 'stale_parent_needs_rescore renders Needs rescore',
      input: {
        outcomeLabel: 'needs_rescore',
        outcomeBand: 'stale',
        currentCandidateStatus: 'queued',
        currentReason: 'stale_parent_needs_rescore',
        runId: 'run-2',
        receiptId: 'receipt-2',
      },
      expected: {
        key: 'needs_rescore',
        label: 'Needs rescore',
        band: 'stale',
        active: false,
        scoring: false,
        detail: 'Candidate was created against an older parent model and needs to be rebased or rescored against the current parent.',
      },
    },
    {
      name: 'terminal failed queue overrides stale loop running',
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
        key: 'failed',
        label: 'Failed',
        band: 'failed',
        active: false,
        scoring: false,
      },
    },
    {
      name: 'scored candidate with no benchmark gain renders Scored, no gain',
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
        label: 'Scored, no gain',
        band: 'no_gain',
        active: false,
        scoring: false,
      },
    },
    {
      name: 'no run id renders Not started',
      input: {
        outcomeLabel: 'submitted',
        outcomeBand: 'pending',
        runId: null,
        receiptId: null,
      },
      expected: {
        key: 'not_started',
        label: 'Not started',
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
    if (fixture.expected.detail) {
      assert.equal(actual.note?.detail, fixture.expected.detail, fixture.name)
    }
  }

  console.log(`research-lab-status: ${cases.length} fixtures passed`)
} finally {
  await rm(outDir, { recursive: true, force: true })
}
