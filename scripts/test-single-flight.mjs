import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const outDir = await mkdtemp(join(tmpdir(), 'single-flight-'))

try {
  const tsc = spawnSync(process.execPath, [
    resolve('node_modules/typescript/bin/tsc'),
    resolve('src/lib/single-flight.ts'),
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

  assert.equal(tsc.status, 0, 'single-flight helper should compile')

  const require = createRequire(import.meta.url)
  const { runSingleFlight } = require(join(outDir, 'single-flight.js'))
  const state = { current: null }

  let resolveFirst
  let calls = 0
  const first = runSingleFlight(state, () => {
    calls += 1
    return new Promise((resolve) => {
      resolveFirst = resolve
    })
  })
  const concurrent = runSingleFlight(state, () => {
    calls += 1
    return Promise.resolve('duplicate')
  })

  assert.strictEqual(first, concurrent, 'concurrent callers should share the same promise')
  await Promise.resolve()
  assert.equal(calls, 1, 'the guarded operation should run only once')
  resolveFirst('ready')
  assert.deepEqual(await Promise.all([first, concurrent]), ['ready', 'ready'])
  await Promise.resolve()
  assert.equal(state.current, null, 'a successful flight should clear')

  const expectedFailure = new Error('refresh failed')
  await assert.rejects(
    runSingleFlight(state, async () => {
      calls += 1
      throw expectedFailure
    }),
    expectedFailure,
  )
  await Promise.resolve()
  assert.equal(state.current, null, 'a failed flight should clear for retry')

  assert.equal(await runSingleFlight(state, async () => {
    calls += 1
    return 'recovered'
  }), 'recovered')
  assert.equal(calls, 3, 'a later caller should retry after failure')

  console.log('single-flight: concurrency, cleanup, and retry checks passed')
} finally {
  await rm(outDir, { recursive: true, force: true })
}
