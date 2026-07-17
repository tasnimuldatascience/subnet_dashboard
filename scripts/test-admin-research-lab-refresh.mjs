import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const outDir = await mkdtemp(join(tmpdir(), 'admin-research-lab-refresh-'))

try {
  const tsc = spawnSync(process.execPath, [
    resolve('node_modules/typescript/bin/tsc'),
    resolve('src/lib/admin-research-lab-refresh.ts'),
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

  assert.equal(tsc.status, 0, 'admin refresh response decoder should compile')

  const require = createRequire(import.meta.url)
  const {
    adminLabOverviewResponseKeys,
    classifyAdminLabOverviewResponse,
  } = require(join(outDir, 'admin-research-lab-refresh.js'))

  const common = {
    ops: {},
    stats: {},
    fetchedAt: '2026-07-17T04:00:00.000Z',
    loopPagination: {},
    loopStatusOptions: [],
  }

  assert.equal(
    classifyAdminLabOverviewResponse({
      ...common,
      recentLoops: [],
      loopStates: [],
    }),
    'refresh',
    'the compact polling response should be accepted',
  )
  assert.equal(
    classifyAdminLabOverviewResponse({
      ...common,
      loops: [],
    }),
    'full',
    'the full overview response should be accepted during deployment skew',
  )
  assert.equal(
    classifyAdminLabOverviewResponse({ ...common }),
    'invalid',
    'a successful response without either loop array should be rejected',
  )
  assert.equal(
    classifyAdminLabOverviewResponse({
      ...common,
      recentLoops: undefined,
      loopStates: [],
    }),
    'invalid',
    'a refresh response with a missing recentLoops array should be rejected',
  )
  assert.equal(classifyAdminLabOverviewResponse(null), 'invalid')
  assert.equal(classifyAdminLabOverviewResponse([]), 'invalid')
  assert.equal(classifyAdminLabOverviewResponse('not-json-object'), 'invalid')
  assert.deepEqual(
    adminLabOverviewResponseKeys({ secret: 'redacted', loops: [] }),
    ['loops', 'secret'],
    'diagnostics should expose field names only',
  )

  const componentSource = await readFile(
    resolve('src/app/admin/_components/AdminResearchLab.tsx'),
    'utf8',
  )
  assert.match(componentSource, /classifyAdminLabOverviewResponse\(body\)/)
  assert.match(componentSource, /refreshPayloadFromAdminResearchLabOverview\(fullOverview\)/)
  assert.match(componentSource, /The server returned an incomplete Lab refresh response/)
  assert.match(componentSource, /if \(!cancelled && !controller\.signal\.aborted\)/)
  assert.match(componentSource, /document\.hidden[\s\S]{0,120}controller\?\.abort\(\)/)
  assert.match(componentSource, /else \{\s*void refresh\(\)\s*\}/)

  console.log('admin-research-lab-refresh: response skew and tab resume guards passed')
} finally {
  await rm(outDir, { recursive: true, force: true })
}
