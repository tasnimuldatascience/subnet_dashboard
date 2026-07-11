import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const outDir = await mkdtemp(join(tmpdir(), 'research-lab-emissions-'))

try {
  const tsc = spawnSync(process.execPath, [
    resolve('node_modules/typescript/bin/tsc'),
    resolve('src/lib/research-lab-emissions.ts'),
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

  assert.equal(tsc.status, 0, 'emission allocation helper should compile')

  const require = createRequire(import.meta.url)
  const {
    buildResearchLabAllocationRollup,
    formatLabAllocationPercent,
    researchLabAllocationEntries,
  } = require(join(outDir, 'research-lab-emissions.js'))

  const snapshot = {
    epoch: 23691,
    allocation_doc: {
      lab_cap_alpha_percent: 10,
      reimbursement_allocations: [
        {
          miner_hotkey: '5miner',
          paid_alpha_percent: 0.2,
          intended_alpha_percent: 0.21,
          overpaid_alpha_percent: 0,
          spend_usd: 1.25,
          reason: 'reimbursement',
        },
      ],
      champion_allocations: [
        {
          miner_hotkey: '5miner',
          paid_alpha_percent: '0.163569',
          intended_alpha_percent: '0.163569',
          overpaid_alpha_percent: 0,
          spend_usd: '0.75',
          reason: 'champion',
        },
      ],
      queued_champion_allocations: [
        {
          miner_hotkey: '5miner',
          paid_alpha_percent: 0.1,
          intended_alpha_percent: 0.1,
          overpaid_alpha_percent: 0,
          spend_usd: 0.5,
          reason: 'queued_champion',
        },
        {
          miner_hotkey: '5other',
          paid_alpha_percent: 0.3,
          spend_usd: 0.25,
        },
      ],
    },
  }

  assert.equal(
    researchLabAllocationEntries(snapshot.allocation_doc).length,
    4,
    'all allocation arrays should feed the same rollup',
  )

  const rollup = buildResearchLabAllocationRollup(snapshot, 'latest_weight_epoch')
  const miner = rollup.byHotkey['5miner']
  assert.ok(miner, 'miner with multiple allocation rows should be present')
  assert.equal(miner.paidAlphaPercent, 0.463569, 'multiple allocation rows for the same miner should be summed')
  assert.equal(miner.spendUsd, 2.5, 'allocation spend_usd should be summed with the same grouping')
  assert.equal(miner.allocationCount, 3)
  assert.equal(miner.labBucketSharePercent, 4.63569)
  assert.equal(formatLabAllocationPercent(miner.paidAlphaPercent), '0.4636%')
  assert.equal(formatLabAllocationPercent(miner.labBucketSharePercent), '4.6357%')

  const componentSource = await readFile(resolve('src/components/dashboard/ResearchLab.tsx'), 'utf8')
  assert.match(componentSource, /Total alpha earned/)
  assert.match(componentSource, /Lab allocation/)
  assert.match(componentSource, /Scored tests/)
  assert.doesNotMatch(componentSource, /Completed tests/)
  assert.match(componentSource, /Model improvements/)
  assert.match(componentSource, /isModelImprovementLoop/)
  assert.match(componentSource, /activityLoops/)
  assert.match(componentSource, /labAllocationPaidAlphaPercent/)
  assert.match(componentSource, /currentAllocationEntry\?\.paidAlphaPercent/)
  assert.match(componentSource, /hasCurrentReward: labAllocationPaidAlphaPercent > 0/)
  assert.match(componentSource, /row\.computeSpendUsd > 0 \|\| row\.hasCurrentReward/)
  assert.doesNotMatch(componentSource, /ActivityPanelStat/)
  assert.doesNotMatch(componentSource, /metagraph\?\.emissions/)
  assert.doesNotMatch(componentSource, /metagraph\?\.incentives/)
  assert.doesNotMatch(componentSource, /metagraphIncentivePct/)
  assert.doesNotMatch(componentSource, /spendHotkeys/)
  assert.doesNotMatch(componentSource, /Lab Emissions/)
  assert.doesNotMatch(componentSource, /of Lab bucket/)
  assert.doesNotMatch(componentSource, /emitted/)

  const routeSource = await readFile(resolve('src/app/api/research-lab/route.ts'), 'utf8')
  assert.match(routeSource, /\.from\('research_lab_emission_allocation_current'\)/)
  assert.match(routeSource, /activityLoops: allLoops/)
  assert.match(routeSource, /activeLoopCount: allLoops\.filter/)
  assert.match(routeSource, /scoredLoopCount: allLoops\.filter\(hasScoredResearchLabCandidate\)\.length/)
  assert.match(routeSource, /numberOr\(loop\.scoredCandidateCount, 0\) > 0/)
  assert.match(routeSource, /promisingLoopCount: allLoops\.filter\(isModelImprovementResearchLabLoop\)\.length/)
  assert.match(routeSource, /statusKey[\s\S]*=== 'promoted'/)
  assert.match(routeSource, /\.from\('published_weight_bundles'\)/)
  assert.match(routeSource, /\.select\('epoch_id'\)/)
  assert.match(routeSource, /\.eq\('netuid', 71\)/)

  console.log('research-lab-emissions: allocation math and display labels passed')
} finally {
  await rm(outDir, { recursive: true, force: true })
}
