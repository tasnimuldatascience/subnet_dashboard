import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const outDir = await mkdtemp(join(tmpdir(), 'research-lab-source-commit-'))

try {
  const tsc = spawnSync(process.execPath, [
    resolve('node_modules/typescript/bin/tsc'),
    resolve('src/lib/research-lab-source-commit.ts'),
    '--target', 'ES2022',
    '--module', 'CommonJS',
    '--moduleResolution', 'Node',
    '--lib', 'ES2022,DOM',
    '--outDir', outDir,
    '--strict',
    '--skipLibCheck',
  ], { stdio: 'inherit' })
  assert.equal(tsc.status, 0, 'read-only sourcing-model commit client should compile')

  const require = createRequire(import.meta.url)
  const {
    SOURCING_MODEL_REPOSITORY,
    fetchResearchLabSourceCommit,
  } = require(join(outDir, 'research-lab-source-commit.js'))
  assert.equal(SOURCING_MODEL_REPOSITORY, 'leadpoet/Sourcing_model')

  let missingTokenFetches = 0
  const missingToken = await fetchResearchLabSourceCommit(
    { commitSha: '92db3bd8022c974ee777fc22de240dc3941cab70', token: null },
    { fetch: async () => { missingTokenFetches += 1; throw new Error('should not fetch') } },
  )
  assert.equal(missingToken.available, false)
  assert.match(missingToken.unavailableReason, /SOURCING_MODEL_GITHUB_TOKEN is not configured/)
  assert.equal(missingTokenFetches, 0)

  const calls = []
  let clearedTimer = false
  const longPatch = `@@ -1 +1 @@\n-${'a'.repeat(7_000)}\n+${'b'.repeat(7_000)}`
  const result = await fetchResearchLabSourceCommit(
    {
      commitSha: '92db3bd8022c974ee777fc22de240dc3941cab70',
      token: 'github-read-secret',
    },
    {
      fetch: async (url, init) => {
        calls.push({ url, init })
        return new Response(JSON.stringify({
          sha: '92db3bd8022c974ee777fc22de240dc3941cab70',
          parents: [{ sha: '1111111111111111111111111111111111111111' }],
          commit: { message: 'Improve grounded company-fit evidence' },
          stats: { additions: 12, deletions: 3, total: 15 },
          files: [{
            filename: 'sourcing_model/discovery.py',
            status: 'modified',
            additions: 12,
            deletions: 3,
            changes: 15,
            patch: longPatch,
          }],
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      },
      setTimeout: () => 11,
      clearTimeout: (handle) => { assert.equal(handle, 11); clearedTimer = true },
      now: () => new Date('2026-07-17T12:00:00.000Z'),
    },
  )
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://api.github.com/repos/leadpoet/Sourcing_model/commits/92db3bd8022c974ee777fc22de240dc3941cab70')
  assert.equal(calls[0].init.headers.Authorization, 'Bearer github-read-secret')
  assert.equal(result.available, true)
  assert.deepEqual(result.parentShas, ['1111111111111111111111111111111111111111'])
  assert.equal(result.files[0].filename, 'sourcing_model/discovery.py')
  assert.equal(result.files[0].patch.length, 6_000)
  assert.equal(result.files[0].patchTruncated, true)
  assert.equal(result.truncated, true)
  assert.equal(result.fetchedAt, '2026-07-17T12:00:00.000Z')
  assert.equal(clearedTimer, true)

  const denied = await fetchResearchLabSourceCommit(
    { commitSha: '92db3bd8022c974ee777fc22de240dc3941cab70', token: 'never-echo-token' },
    {
      fetch: async () => new Response(JSON.stringify({ message: 'bad never-echo-token' }), { status: 403 }),
      setTimeout: () => 12,
      clearTimeout: () => undefined,
    },
  )
  assert.equal(denied.available, false)
  assert.match(denied.unavailableReason, /HTTP 403/)
  assert.doesNotMatch(denied.unavailableReason, /never-echo-token/)

  console.log('research-lab-source-commit: scoped GitHub read, bounded patches, and safe failures passed')
} finally {
  await rm(outDir, { recursive: true, force: true })
}
