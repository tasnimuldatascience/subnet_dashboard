import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const outDir = await mkdtemp(join(tmpdir(), 'admin-fulfillment-performance-'))

try {
  const tsc = spawnSync(process.execPath, [
    resolve('node_modules/typescript/bin/tsc'),
    resolve('src/lib/admin-format.ts'),
    '--target', 'ES2022',
    '--module', 'CommonJS',
    '--moduleResolution', 'Node',
    '--outDir', outDir,
    '--strict',
    '--skipLibCheck',
  ], { stdio: 'inherit' })
  assert.equal(tsc.status, 0, 'admin chain helpers should compile')

  const require = createRequire(import.meta.url)
  const { buildChainViews } = require(join(outDir, 'admin-format.js'))
  const rows = Array.from({ length: 5_000 }, (_, index) => ({
    request_id: `request-${index}`,
    internal_label: null,
    company: null,
    status: index === 4_999 ? 'fulfilled' : 'recycled',
    num_leads: 10,
    icp_details: null,
    created_at: new Date(1_700_000_000_000 + index).toISOString(),
    window_start: null,
    window_end: null,
    successor_request_id: index < 4_999 ? `request-${index + 1}` : null,
  }))
  const chains = buildChainViews(rows)
  assert.equal(chains.length, 1)
  assert.equal(chains[0].predecessors.length, 4_999)
  assert.equal(chains[0].leaf.request_id, 'request-4999')

  const requestRoute = await readFile(resolve('src/app/api/admin/requests/route.ts'), 'utf8')
  assert.match(requestRoute, /DEFAULT_PAGE_SIZE = 20/)
  assert.match(requestRoute, /filteredChains\.slice\(from, from \+ pageSize\)/)
  assert.match(requestRoute, /pageChainRequestIds/)
  assert.match(requestRoute, /\.select\('request_id, lead_hashes'\)/)
  assert.doesNotMatch(requestRoute, /\.select\('request_id, submission_id, lead_hashes, lead_data'\)/)

  const submissionRoute = await readFile(
    resolve('src/app/api/admin/fulfillment-submissions/route.ts'),
    'utf8',
  )
  assert.match(submissionRoute, /SUBMISSION_BATCH_SIZE = 1000/)
  assert.match(submissionRoute, /query\.gte\('submitted_at', dateFrom\)/)
  assert.match(submissionRoute, /fetchSubmissionsByIds/)
  assert.match(submissionRoute, /requestIcpById/)
  assert.doesNotMatch(submissionRoute, /\.from\('transparency_log'\)/)

  const component = await readFile(
    resolve('src/app/admin/_components/AdminRequestList.tsx'),
    'utf8',
  )
  assert.match(component, /\/api\/admin\/requests\?\$\{params\.toString\(\)\}/)
  assert.match(component, /matching requests/)

  console.log('admin-fulfillment-performance: pagination, bounded queries, and chain folding checks passed')
} finally {
  await rm(outDir, { recursive: true, force: true })
}
