import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const outDir = await mkdtemp(join(resolve('.'), '.subnet-epoch-state-'))
const originalFetch = globalThis.fetch

function storageUnsigned(input, byteLength) {
  let value = BigInt(input)
  const bytes = Array.from({ length: byteLength }, () => {
    const byte = Number(value & 255n)
    value >>= 8n
    return byte
  })
  return `0x${bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

function jsonResponse(value, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => value,
  }
}

const HASH_A = `0x${'11'.repeat(32)}`
const HASH_B = `0x${'22'.repeat(32)}`
const HASH_C = `0x${'33'.repeat(32)}`

let scenario = {}
let headCalls = 0
let storageCalls = 0
let observedStorageHashes = []

function useScenario(overrides = {}) {
  scenario = {
    hash: HASH_A,
    currentBlock: 8_637_160,
    tempo: 360,
    lastEpochBlock: 8_637_156,
    pendingEpochAt: 0,
    subnetEpochIndex: 23_927,
    blocksSinceLastStep: 4,
    failStorageIndex: null,
    headGate: null,
    ...overrides,
  }
}

try {
  const tsc = spawnSync(process.execPath, [
    resolve('node_modules/typescript/bin/tsc'),
    resolve('src/lib/subnet-epoch-state.ts'),
    resolve('src/lib/subnet-epoch.ts'),
    resolve('src/lib/single-flight.ts'),
    '--target',
    'ES2022',
    '--module',
    'CommonJS',
    '--moduleResolution',
    'Node',
    '--lib',
    'ES2022,DOM',
    '--outDir',
    outDir,
    '--strict',
    '--skipLibCheck',
    '--esModuleInterop',
  ], { stdio: 'inherit' })
  assert.equal(tsc.status, 0, 'subnet epoch state implementation should compile')

  globalThis.fetch = async (_url, init) => {
    assert.equal(init?.cache, 'no-store', 'every chain request must bypass fetch caching')
    const request = JSON.parse(String(init?.body))

    if (Array.isArray(request)) {
      storageCalls += 1
      assert.equal(request.length, 5, 'all scheduler fields should be read together')
      observedStorageHashes.push(...request.map((entry) => entry.params[1]))
      for (const entry of request) {
        assert.equal(entry.method, 'state_getStorage')
        assert.equal(entry.params[1], scenario.hash, 'storage must use the exact best-head hash')
        assert.match(entry.params[0], /4700$/, 'storage keys must encode SN71 as little-endian u16')
      }

      const values = [
        storageUnsigned(scenario.tempo, 2),
        storageUnsigned(scenario.lastEpochBlock, 8),
        storageUnsigned(scenario.pendingEpochAt, 8),
        storageUnsigned(scenario.subnetEpochIndex, 8),
        storageUnsigned(scenario.blocksSinceLastStep, 8),
      ]
      // Reverse the batch response to prove decoding is keyed by JSON-RPC ID,
      // not by response order.
      return jsonResponse(request.map((entry, index) => (
        index === scenario.failStorageIndex
          ? { jsonrpc: '2.0', id: entry.id, error: { message: 'forced storage failure' } }
          : { jsonrpc: '2.0', id: entry.id, result: values[index] }
      )).reverse())
    }

    if (request.method === 'chain_getHead') {
      headCalls += 1
      if (scenario.headGate) await scenario.headGate
      return jsonResponse({ jsonrpc: '2.0', id: request.id, result: scenario.hash })
    }
    if (request.method === 'chain_getHeader') {
      assert.deepEqual(request.params, [scenario.hash], 'header must be resolved at the selected head')
      return jsonResponse({
        jsonrpc: '2.0',
        id: request.id,
        result: { number: `0x${scenario.currentBlock.toString(16)}` },
      })
    }
    throw new Error(`Unexpected RPC method: ${request.method}`)
  }

  const require = createRequire(import.meta.url)
  const { fetchBestSubnetEpochState } = require(join(outDir, 'subnet-epoch-state.js'))

  useScenario()
  const official = await fetchBestSubnetEpochState()
  assert.equal(official.schemaVersion, 'leadpoet.subnet_epoch_state.v1')
  assert.equal(official.headKind, 'best')
  assert.equal(official.netuid, 71)
  assert.equal(official.currentBlock, 8_637_160)
  assert.equal(official.subnetEpochIndex, 23_927)
  assert.equal(official.blocksElapsed, 4)
  assert.equal(official.nextEpochBlock, 8_637_516)
  assert.equal(official.blocksRemaining, 356)
  assert.equal(official.blocksSinceLastStep, 4)
  assert.equal(official.blockHash, HASH_A)
  assert.ok(Number.isFinite(Date.parse(official.observedAt)))
  assert.deepEqual(new Set(observedStorageHashes), new Set([HASH_A]))

  useScenario({
    hash: HASH_B,
    currentBlock: 8_637_165,
    pendingEpochAt: 8_637_170,
    blocksSinceLastStep: 9,
  })
  const pending = await fetchBestSubnetEpochState()
  assert.equal(pending.subnetEpochIndex, 23_927, 'pending state stays in the current official epoch')
  assert.equal(pending.blocksElapsed, 9)
  assert.equal(pending.nextEpochBlock, 8_637_170)
  assert.equal(pending.blocksRemaining, 5, 'pending epochs can move the boundary earlier')

  useScenario({
    hash: HASH_C,
    currentBlock: 8_637_171,
    pendingEpochAt: 8_637_170,
    blocksSinceLastStep: 15,
  })
  const due = await fetchBestSubnetEpochState()
  assert.equal(due.subnetEpochIndex, 23_927, 'a due/deferred slot does not invent the next epoch ID')
  assert.equal(due.blocksRemaining, 0, 'a reached pending boundary must remain visibly due')

  useScenario({
    hash: HASH_B,
    currentBlock: 8_637_172,
    pendingEpochAt: 0,
    blocksSinceLastStep: 50_399,
  })
  const safetyInTwo = await fetchBestSubnetEpochState()
  assert.equal(safetyInTwo.nextEpochBlock, 8_637_174)
  assert.equal(safetyInTwo.blocksRemaining, 2, '50,399 must fire after two post-snapshot increments')

  useScenario({
    hash: HASH_C,
    currentBlock: 8_637_173,
    pendingEpochAt: 0,
    blocksSinceLastStep: 50_400,
  })
  const safetyNext = await fetchBestSubnetEpochState()
  assert.equal(safetyNext.nextEpochBlock, 8_637_174)
  assert.equal(safetyNext.blocksRemaining, 1, '50,400 must fire after the next increment')

  useScenario({
    hash: HASH_B,
    currentBlock: 8_637_174,
    pendingEpochAt: 0,
    blocksSinceLastStep: 50_401,
  })
  const safetyDue = await fetchBestSubnetEpochState()
  assert.equal(safetyDue.nextEpochBlock, 8_637_174)
  assert.equal(safetyDue.blocksRemaining, 0, 'the MAX_TEMPO safety valve must be visibly due')

  const callsBeforeFailure = headCalls
  useScenario({ hash: HASH_A, failStorageIndex: 3 })
  await assert.rejects(fetchBestSubnetEpochState(), /forced storage failure/)
  assert.equal(headCalls, callsBeforeFailure + 1, 'a failed refresh must perform a new live read')

  useScenario({
    hash: HASH_B,
    currentBlock: 8_637_172,
    lastEpochBlock: 8_637_170,
    pendingEpochAt: 0,
    subnetEpochIndex: 23_928,
    blocksSinceLastStep: 2,
  })
  const recovered = await fetchBestSubnetEpochState()
  assert.equal(recovered.subnetEpochIndex, 23_928)
  assert.equal(recovered.currentBlock, 8_637_172)
  assert.notDeepEqual(recovered, official, 'failure recovery must not return the old successful snapshot')

  let releaseHead
  const headGate = new Promise((resolveGate) => { releaseHead = resolveGate })
  useScenario({ hash: HASH_C, currentBlock: 8_637_173, headGate })
  const headCallsBeforeFlight = headCalls
  const storageCallsBeforeFlight = storageCalls
  const concurrentA = fetchBestSubnetEpochState()
  const concurrentB = fetchBestSubnetEpochState()
  await new Promise((resolveTick) => setImmediate(resolveTick))
  assert.equal(headCalls, headCallsBeforeFlight + 1, 'concurrent requests should share only the in-flight read')
  releaseHead()
  const [flightA, flightB] = await Promise.all([concurrentA, concurrentB])
  assert.deepEqual(flightA, flightB)
  assert.equal(storageCalls, storageCallsBeforeFlight + 1)

  useScenario({ hash: HASH_A, currentBlock: 8_637_174 })
  await fetchBestSubnetEpochState()
  assert.equal(headCalls, headCallsBeforeFlight + 2, 'completed snapshots must never be result-cached')

  const routeSource = await readFile(resolve('src/app/api/admin/subnet-epoch/route.ts'), 'utf8')
  assert.match(routeSource, /dynamic = 'force-dynamic'/)
  assert.match(routeSource, /revalidate = 0/)
  assert.match(routeSource, /fetchCache = 'force-no-store'/)
  assert.match(routeSource, /private, no-store, max-age=0, must-revalidate/)
  assert.match(routeSource, /status: 502/)

  const middlewareSource = await readFile(resolve('src/middleware.ts'), 'utf8')
  assert.match(middlewareSource, /'\/api\/admin\/:path\*'/, 'admin middleware must protect the endpoint')

  const uiSource = await readFile(resolve('src/app/admin/_components/AdminMetagraph.tsx'), 'utf8')
  assert.match(uiSource, /const EPOCH_REFRESH_INTERVAL_MS = 12_000/)
  assert.match(uiSource, /\/api\/admin\/subnet-epoch\?t=/)
  assert.match(uiSource, /cache: 'no-store'/)
  assert.match(uiSource, /setEpochState\(null\)/, 'failed live reads must clear the displayed epoch')
  assert.match(uiSource, /label="Official SN71 Epoch"/)
  assert.match(uiSource, /epochState\.subnetEpochIndex/)
  assert.match(uiSource, /epochState\.blocksElapsed/)
  assert.match(uiSource, /epochState\.blocksRemaining/)
  assert.match(uiSource, /epochState\.observedAt/)
  assert.match(uiSource, /epochState\.blockHash/)
  assert.doesNotMatch(uiSource, /lastEpochBlock: data\?\./, 'epoch cards must not use cached metagraph schedule fields')

  console.log('subnet-epoch-state: exact best-head reads, official vector, pending state, no-store, and no-stale fallback passed')
} finally {
  globalThis.fetch = originalFetch
  await rm(outDir, { recursive: true, force: true })
}
