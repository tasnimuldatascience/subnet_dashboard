import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { delimiter, join, resolve } from 'node:path'

// Keep compiled output below the repository so Node resolves project dependencies.
const outDir = await mkdtemp(join(resolve('.'), '.metagraph-weight-freshness-'))
const originalFetch = globalThis.fetch
const originalPythonPath = process.env.PYTHON_PATH

function compact(input) {
  const value = BigInt(input)
  if (value < 64n) return [Number(value << 2n)]
  if (value < 16_384n) {
    return [Number(((value & 63n) << 2n) | 1n), Number(value >> 6n)]
  }
  if (value < 1_073_741_824n) {
    return [
      Number(((value & 63n) << 2n) | 2n),
      Number((value >> 6n) & 255n),
      Number((value >> 14n) & 255n),
      Number((value >> 22n) & 255n),
    ]
  }

  const littleEndian = []
  let remaining = value
  while (remaining > 0n) {
    littleEndian.push(Number(remaining & 255n))
    remaining >>= 8n
  }
  while (littleEndian.length < 4) littleEndian.push(0)
  return [((littleEndian.length - 4) << 2) | 3, ...littleEndian]
}

function fixedLittleEndian(input, length) {
  let value = BigInt(input)
  return Array.from({ length }, () => {
    const byte = Number(value & 255n)
    value >>= 8n
    return byte
  })
}

function storageUnsigned(input, length) {
  const bytes = fixedLittleEndian(input, length)
  return `0x${bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

function identityPayload(name) {
  const encoder = new TextEncoder()
  const fields = [encoder.encode(name), ...Array.from({ length: 6 }, () => new Uint8Array())]
  const bytes = fields.flatMap((field) => [...compact(field.length), ...field])
  return `0x${bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

function neuronLitePayload() {
  const hotkey = Array.from({ length: 32 }, (_, index) => index + 1)
  const coldkey = Array.from({ length: 32 }, (_, index) => index + 33)
  const zeros = (length) => Array.from({ length }, () => 0)

  return new Uint8Array([
    ...compact(1),
    ...hotkey,
    ...coldkey,
    ...compact(0),
    ...compact(71),
    1,
    ...fixedLittleEndian(100, 8), // axon serving block
    ...fixedLittleEndian(1, 4), // axon version
    ...fixedLittleEndian(0x643bc99c, 16), // 100.59.201.156
    ...fixedLittleEndian(8093, 2),
    4, 0, 0, 0, // ipv4 + protocol/reserved
    ...zeros(31), // PrometheusInfo
    ...compact(1),
    ...coldkey,
    ...compact(2_000_000_000),
    ...compact(16_384), // rank
    ...compact(1_000_000_000),
    ...compact(32_768),
    ...compact(8_192), // consensus
    ...compact(4_096), // trust
    ...compact(60_000), // validator trust
    ...compact(20_000), // dividends
    ...compact(987_654),
    1,
    ...compact(0), // pruning score
  ])
}

function compactVector(values) {
  return [
    ...compact(values.length),
    ...values.flatMap((value) => compact(value)),
  ]
}

function accountVector(length, seed) {
  return [
    ...compact(length),
    ...Array.from({ length }, (_, accountIndex) =>
      Array.from(
        { length: 32 },
        (_, byteIndex) => (seed + accountIndex + byteIndex) % 256,
      ),
    ).flat(),
  ]
}

function boolVector(values) {
  return [...compact(values.length), ...values.map((value) => value ? 1 : 0)]
}

function subnetStatePayload(totalStakeRao) {
  const length = totalStakeRao.length
  const zeroes = Array.from({ length }, () => 0)
  const active = Array.from({ length }, () => true)
  const permits = Array.from({ length }, () => true)

  return new Uint8Array([
    1, // Some(SubnetState)
    ...compact(71),
    ...accountVector(length, 1),
    ...accountVector(length, 65),
    ...boolVector(active),
    ...boolVector(permits),
    ...compactVector([]), // pruning_score
    ...compactVector(zeroes), // last_update
    ...compactVector(zeroes), // emission
    ...compactVector(zeroes), // dividends
    ...compactVector(zeroes), // incentives
    ...compactVector(zeroes), // consensus
    ...compactVector([]), // trust
    ...compactVector([]), // rank
    ...compactVector(zeroes), // block_at_registration
    ...compactVector(totalStakeRao), // alpha_stake
    ...compactVector(zeroes), // tao_stake
    ...compactVector(totalStakeRao), // total_stake
    ...compactVector([]), // emission_history
  ])
}

try {
  const tsc = spawnSync(process.execPath, [
    resolve('node_modules/typescript/bin/tsc'),
    resolve('src/lib/metagraph.ts'),
    resolve('src/lib/metagraph-validator-roster.ts'),
    resolve('src/lib/types.ts'),
    resolve('src/lib/subnet-epoch.ts'),
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

  assert.equal(tsc.status, 0, 'metagraph telemetry implementation should compile')

  const unavailablePython = join(outDir, 'python-unavailable')
  await writeFile(unavailablePython, '#!/bin/sh\nexit 1\n')
  await chmod(unavailablePython, 0o755)
  process.env.PYTHON_PATH = unavailablePython

  let blockMode = 'finalized'
  let liveBestHeadCalls = 0
  const payload = neuronLitePayload()
  const effectiveStakeRao = 9_876_543_210_000n
  const subnetPayload = subnetStatePayload([effectiveStakeRao])
  const epochStorageValues = [
    storageUnsigned(360, 2),
    storageUnsigned(1_111_080, 8),
    storageUnsigned(23_853, 8),
    storageUnsigned(0, 8),
    storageUnsigned(1_111_080, 8),
  ]
  globalThis.fetch = async (_url, init) => {
    const request = JSON.parse(String(init?.body))

    if (Array.isArray(request)) {
      if (request[0]?.id >= 2000) {
        return {
          ok: true,
          status: 200,
          json: async () => request.map((entry, index) => ({
            jsonrpc: '2.0',
            id: entry.id,
            result: epochStorageValues[index],
          })),
        }
      }
      return {
        ok: true,
        status: 200,
        json: async () => request.map((entry) => ({
          jsonrpc: '2.0',
          id: entry.id,
          result: identityPayload('Test Validator'),
        })),
      }
    }

    if (request.method === 'neuronInfo_getNeuronsLite') {
      return {
        ok: true,
        status: 200,
        json: async () => ({ result: Array.from(payload) }),
      }
    }

    if (request.method === 'subnetInfo_getSubnetState') {
      return {
        ok: true,
        status: 200,
        json: async () => ({ result: Array.from(subnetPayload) }),
      }
    }

    if (request.method === 'chain_getFinalizedHead') {
      return {
        ok: true,
        status: 200,
        json: async () => blockMode === 'finalized'
          ? { result: '0xfinalized' }
          : { error: { message: 'finalized head disabled' } },
      }
    }

    if (request.method === 'chain_getHeader') {
      const isFinalizedHeader = request.params.length === 1
      if (!isFinalizedHeader) liveBestHeadCalls += 1
      const liveAttemptUnavailable = !isFinalizedHeader && (
        blockMode === 'unavailable' || (blockMode === 'flaky-live' && liveBestHeadCalls === 1)
      )
      const result = liveAttemptUnavailable
        ? null
        : { number: isFinalizedHeader ? '0x10f447' : '0x10f44a' }
      return { ok: true, status: 200, json: async () => ({ result }) }
    }

    if (request.method === 'chain_getBlockHash') {
      return { ok: true, status: 200, json: async () => ({ result: '0xbest' }) }
    }

    throw new Error(`Unexpected RPC method: ${request.method}`)
  }

  const require = createRequire(import.meta.url)
  const {
    clearMetagraphCache,
    fetchMetagraph,
    fetchMetagraphFresh,
    setMetagraphCache,
    decodeSubnetStateTotalStakeRao,
  } = require(join(outDir, 'metagraph.js'))
  const { validatorRosterUids } = require(join(outDir, 'metagraph-validator-roster.js'))

  const finalized = await fetchMetagraphFresh()
  const [hotkey] = Object.keys(finalized.hotkeyToUid)
  assert.ok(hotkey, 'synthetic neuron should decode to a hotkey')
  assert.equal(finalized.hotkeyToUid[hotkey], 0)
  assert.equal(finalized.active[hotkey], true)
  assert.equal(
    finalized.stakes[hotkey],
    Number(effectiveStakeRao) / 1e9,
    'RPC fallback should use SubnetState.total_stake instead of neuron-lite direct stake',
  )
  assert.equal(finalized.names[hotkey], 'Test Validator')
  assert.equal(finalized.axons[hotkey], '100.59.201.156:8093')
  assert.ok(Math.abs(finalized.validatorTrusts[hotkey] - (60_000 / 65_535)) < 1e-10)
  assert.ok(Math.abs(finalized.dividends[hotkey] - (20_000 / 65_535)) < 1e-10)
  assert.equal(finalized.lastUpdates[hotkey], 987_654, 'SCALE last_update should be retained')
  assert.equal(finalized.currentBlock, 1_111_111, 'finalized block should be preferred')
  assert.equal(finalized.tempo, 360, 'on-chain tempo should be retained')
  assert.equal(finalized.lastEpochBlock, 1_111_080, 'last epoch block should be retained')
  assert.equal(finalized.subnetEpochIndex, 23_853, 'subnet epoch index should be retained')
  assert.equal(finalized.pendingEpochAt, 0, 'zero should represent no pending manual epoch')
  assert.equal(finalized.lastMechanismStepBlock, 1_111_080, 'last mechanism step should be retained')

  const permittedUids = [0, 3, 28, 62, 100, 155, 202, 216, 224]
  const hotkeyToUid = Object.fromEntries(permittedUids.map((uid) => [`hotkey-${uid}`, uid]))
  const isValidator = Object.fromEntries(permittedUids.map((uid) => [`hotkey-${uid}`, true]))
  const trusts = Object.fromEntries(permittedUids.map((uid) => [`hotkey-${uid}`, 0]))
  const consensus = Object.fromEntries(permittedUids.map((uid) => [`hotkey-${uid}`, 0]))
  const incentives = Object.fromEntries(permittedUids.map((uid) => [`hotkey-${uid}`, 0]))
  consensus['hotkey-0'] = 0.365
  consensus['hotkey-28'] = 0.039
  incentives['hotkey-216'] = 0.008

  const roster = validatorRosterUids({
    hotkeyToUid,
    isValidator,
    trusts,
    consensus,
    incentives,
  }).sort((left, right) => left - right)
  assert.deepEqual(
    roster,
    [0, 3, 62, 100, 155, 202, 224],
    'validator roster should keep seven expected UIDs and exclude non-owner miner activity',
  )
  assert.ok(
    roster.includes(0),
    'the subnet owner should remain in the validator roster when it also has miner metrics',
  )

  const taoStatsStakeRao = Array.from({ length: 225 }, () => 0n)
  taoStatsStakeRao[0] = 1_755_655_861_661_019n
  taoStatsStakeRao[202] = 1_008_004_298_105_023n
  taoStatsStakeRao[3] = 829_685_776_356_653n
  taoStatsStakeRao[155] = 280_737_350_154_398n
  taoStatsStakeRao[100] = 178_557_253_754_481n
  taoStatsStakeRao[62] = 106_906_309_488_308n
  taoStatsStakeRao[224] = 1_375_087_005_248n
  const decodedStakeRao = decodeSubnetStateTotalStakeRao(
    Array.from(subnetStatePayload(taoStatsStakeRao)),
  )
  assert.ok(
    Math.abs((decodedStakeRao[0] / 1e9) - 1_755_655.861661019) < 1e-9,
    'effective stake decoder should retain the TaoStats-equivalent owner value',
  )
  assert.deepEqual(
    [...roster].sort((left, right) => decodedStakeRao[right] - decodedStakeRao[left]),
    [0, 202, 3, 155, 100, 62, 224],
    'effective stake should reproduce the TaoStats validator ordering',
  )

  blockMode = 'best'
  const best = await fetchMetagraphFresh()
  assert.equal(best.currentBlock, 1_111_114, 'best head should be used when finalized lookup fails')
  assert.equal(best.lastUpdates[hotkey], 987_654)
  assert.equal(best.tempo, 360)

  blockMode = 'unavailable'
  const withoutBlock = await fetchMetagraphFresh()
  assert.equal(withoutBlock.currentBlock, null, 'block lookup failure should not fail metagraph data')
  assert.equal(withoutBlock.tempo, null, 'epoch state should be unavailable without a chain snapshot')
  assert.equal(withoutBlock.totalNeurons, 1)

  clearMetagraphCache()
  blockMode = 'finalized'
  const liveCachedRead = await fetchMetagraph()
  assert.equal(liveCachedRead.currentBlock, 1_111_114, 'cached metagraph reads should overlay the live best head')
  const missingIdentityRefresh = setMetagraphCache({ ...liveCachedRead, names: {} })
  assert.equal(
    missingIdentityRefresh.names[hotkey],
    'Test Validator',
    'an empty identity refresh should preserve the last-known validator name',
  )
  const renamedIdentityRefresh = setMetagraphCache({
    ...missingIdentityRefresh,
    names: { [hotkey]: 'Renamed Validator' },
  })
  assert.equal(
    renamedIdentityRefresh.names[hotkey],
    'Renamed Validator',
    'a new on-chain validator name should replace the retained value',
  )

  blockMode = 'flaky-live'
  liveBestHeadCalls = 0
  const recoveredLiveCachedRead = await fetchMetagraph()
  assert.equal(recoveredLiveCachedRead.currentBlock, 1_111_114, 'live best-head reads should retry once')
  assert.equal(liveBestHeadCalls, 2, 'a failed live best-head read should be retried exactly once')

  blockMode = 'unavailable'
  liveBestHeadCalls = 0
  const failedLiveCachedRead = await fetchMetagraph()
  assert.equal(
    failedLiveCachedRead.currentBlock,
    null,
    'a failed live best-head read must not fall back to the cached snapshot block',
  )
  assert.equal(liveBestHeadCalls, 2, 'live best-head unavailability should stop after two attempts')

  const { blocksUntilNextSubnetEpoch } = require(join(outDir, 'subnet-epoch.js'))
  assert.equal(blocksUntilNextSubnetEpoch({
    currentBlock: 8_610_875,
    tempo: 360,
    lastEpochBlock: 8_610_516,
    pendingEpochAt: 0,
    blocksSinceLastStep: 359,
  }), 1, 'one block should remain immediately before the observed SN71 boundary')
  assert.equal(blocksUntilNextSubnetEpoch({
    currentBlock: 8_610_876,
    tempo: 360,
    lastEpochBlock: 8_610_876,
    pendingEpochAt: 0,
    blocksSinceLastStep: 0,
  }), 360, 'the countdown should reset to the on-chain tempo at the new epoch')
  assert.equal(blocksUntilNextSubnetEpoch({
    currentBlock: 8_610_876,
    tempo: 360,
    lastEpochBlock: 8_610_876,
    pendingEpochAt: 8_610_900,
    blocksSinceLastStep: 0,
  }), 24, 'a pending manual epoch should move the boundary earlier')

  const python = spawnSync('python3', ['--version'], { encoding: 'utf8' })
  if (python.status === 0) {
    const mockBittensor = `
class Scalar:
    def __init__(self, value): self.value = value
    def item(self): return self.value

class Metagraph:
    n = Scalar(2)
    block = Scalar(2000000)
    hotkeys = ['hotkey-a', 'hotkey-b']
    coldkeys = ['coldkey-a', 'coldkey-b']
    incentive = [Scalar(0.25), Scalar(0.75)]
    emission = [Scalar(1.5), Scalar(2.5)]
    alpha_stake = [Scalar(10), Scalar(20)]
    total_stake = [Scalar(30), Scalar(40)]
    validator_permit = [Scalar(True), Scalar(False)]
    last_update = [Scalar(1999900), Scalar(1999950)]

class Subnet:
    price = 1.25

class Subtensor:
    def __init__(self, network): pass
    def metagraph(self, netuid): return Metagraph()
    def subnet(self, netuid): return Subnet()
`
    await writeFile(join(outDir, 'bittensor.py'), mockBittensor)
    const pythonResult = spawnSync('python3', [resolve('scripts/fetch_metagraph.py')], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PYTHONPATH: `${outDir}${process.env.PYTHONPATH ? delimiter + process.env.PYTHONPATH : ''}`,
      },
    })
    assert.equal(pythonResult.status, 0, pythonResult.stderr)
    const data = JSON.parse(pythonResult.stdout)
    assert.deepEqual(data.lastUpdates, { 'hotkey-a': 1_999_900, 'hotkey-b': 1_999_950 })
    assert.deepEqual(data.stakes, { 'hotkey-a': 30, 'hotkey-b': 40 })
    assert.equal(data.currentBlock, 2_000_000)
  } else {
    const pythonSource = await readFile(resolve('scripts/fetch_metagraph.py'), 'utf8')
    assert.match(pythonSource, /'lastUpdates': last_updates/)
    assert.match(pythonSource, /'currentBlock': current_block/)
  }

  const metagraphUiSource = await readFile(resolve('src/app/admin/_components/AdminMetagraph.tsx'), 'utf8')
  assert.match(metagraphUiSource, /const ACTIVE_VALIDATOR_MAX_BLOCKS = 360/)
  assert.match(metagraphUiSource, /row\.updated < ACTIVE_VALIDATOR_MAX_BLOCKS/)
  assert.match(metagraphUiSource, /Weight updated < \$\{ACTIVE_VALIDATOR_MAX_BLOCKS\} blocks ago/)
  assert.match(metagraphUiSource, /label="Updated \(blocks\)"/)
  assert.match(metagraphUiSource, /const \[detailsExpanded, setDetailsExpanded\] = useState\(false\)/)
  assert.match(metagraphUiSource, /aria-expanded=\{detailsExpanded\}/)
  assert.match(metagraphUiSource, /Show validator details/)
  assert.match(metagraphUiSource, /Hide validator details/)
  assert.match(metagraphUiSource, /\/api\/admin\/subnet-epoch\?t=/)
  assert.match(metagraphUiSource, /displayedEpochState\.subnetEpochIndex/)
  assert.match(metagraphUiSource, /displayedEpochState\.blocksElapsed/)
  assert.match(metagraphUiSource, /displayedEpochState\.blocksRemaining/)
  assert.doesNotMatch(metagraphUiSource, /lastEpochBlock: data\?\.lastEpochBlock \?\? null/)
  assert.doesNotMatch(metagraphUiSource, /pendingEpochAt: data\?\.pendingEpochAt \?\? null/)
  assert.doesNotMatch(metagraphUiSource, /currentBlock \+ SUBNET_NETUID \+ 1/)
  assert.doesNotMatch(metagraphUiSource, /SUBNET_TEMPO_BLOCKS \+ 1/)
  assert.match(metagraphUiSource, /const BLOCK_TIME_SECONDS = 12/)
  assert.match(metagraphUiSource, /Math\.ceil\(seconds \/ 60\)/)
  assert.match(metagraphUiSource, /`\$\{minutes\}m`/)
  assert.match(metagraphUiSource, /formatAmount\(displayedEpochState\.blocksRemaining, 0\)/)
  assert.doesNotMatch(metagraphUiSource, /`\$\{minutes\}m \/ \$\{EPOCH_DURATION_MINUTES\}m`/)
  assert.doesNotMatch(metagraphUiSource, /`\$\{formatAmount\(nextEpochBlocks, 0\)\} \/ \$\{SUBNET_TEMPO_BLOCKS\}`/)
  assert.match(metagraphUiSource, /background: 'var\(--accent-positive\)'/)
  assert.match(metagraphUiSource, /role="progressbar"/)
  assert.match(metagraphUiSource, /nextEpochSeconds \/ \(displayedEpochState\.tempo \* BLOCK_TIME_SECONDS\)/)
  assert.match(metagraphUiSource, /label="Official SN71 Epoch"/)
  assert.match(metagraphUiSource, /label="Epoch Blocks Remaining"/)
  assert.match(metagraphUiSource, /displayedEpochState\.blocksRemaining, 0\)\} remaining/)
  assert.match(metagraphUiSource, /label="Time Until Next Epoch"/)
  assert.doesNotMatch(metagraphUiSource, /label="Average VTrust"/)

  const metagraphRouteSource = await readFile(resolve('src/app/api/metagraph/route.ts'), 'utf8')
  assert.match(metagraphRouteSource, /private, no-store, max-age=0/)
  assert.doesNotMatch(metagraphRouteSource, /stale-while-revalidate/)
  const cacheSource = await readFile(resolve('src/lib/cache.ts'), 'utf8')
  assert.match(cacheSource, /const newMetagraph = setMetagraphCache\(refreshedMetagraph\)/)
  assert.doesNotMatch(cacheSource, /clearMetagraphCache\(\)\s*setMetagraphCache/)
  const weightsAlertsSource = await readFile(resolve('src/app/admin/_components/AdminWeightsAlerts.tsx'), 'utf8')
  assert.match(weightsAlertsSource, /const CONSECUTIVE_FAILURES_BEFORE_ALERT = 2/)
  assert.match(weightsAlertsSource, /payload\.subnetEpochIndex === null/)
  assert.match(weightsAlertsSource, /payload\.tempo === null/)
  assert.match(weightsAlertsSource, /const epoch = data\?\.subnetEpochIndex \?\? null/)
  assert.match(weightsAlertsSource, /data\.tempo \+ WEIGHT_SUBMISSION_GRACE_BLOCKS/)
  assert.doesNotMatch(weightsAlertsSource, /Math\.floor\(.*\/ EPOCH_LENGTH\)/)
  assert.doesNotMatch(weightsAlertsSource, /lastSetEpoch/)
  assert.doesNotMatch(weightsAlertsSource, /epoch - 1/)
  assert.match(weightsAlertsSource, /consecutiveFailures >= CONSECUTIVE_FAILURES_BEFORE_ALERT/)
  const officialEpochCard = metagraphUiSource.indexOf('label="Official SN71 Epoch"')
  const blocksCard = metagraphUiSource.indexOf('label="Epoch Blocks Remaining"')
  const timeCard = metagraphUiSource.indexOf('label="Time Until Next Epoch"')
  const activeCard = metagraphUiSource.indexOf('label="Active validators"')
  assert.ok(
    blocksCard < timeCard && timeCard < officialEpochCard && officialEpochCard < activeCard,
    'epoch position, timing, official identity, and validators should render in order',
  )
  const blocksCardSource = metagraphUiSource.slice(blocksCard, timeCard)
  assert.match(
    blocksCardSource,
    /progress=\{timeRemainingPercent\}/,
    'blocks and time vials should count down on the same remaining-time basis',
  )
  assert.match(blocksCardSource, /displayedEpochState\.blocksElapsed, 0\)\} elapsed/)
  assert.doesNotMatch(blocksCardSource, /displayedEpochState\.subnetEpochIndex/)
  assert.match(metagraphUiSource, /isValidatorRosterMember\(data, hotkey, uid\)/)
  assert.match(metagraphUiSource, /const activeRows = rows\.filter\(\(row\) => row\.updated !== null && row\.updated < ACTIVE_VALIDATOR_MAX_BLOCKS\)/)
  assert.match(metagraphUiSource, /formatAmount\(activeRows\.length, 0\)\}\/\$\{formatAmount\(rows\.length, 0\)/)
  const tableHead = metagraphUiSource.slice(
    metagraphUiSource.indexOf('<thead'),
    metagraphUiSource.indexOf('</thead>'),
  )
  const stakeColumn = tableHead.indexOf('column="stake"')
  const vTrustColumn = tableHead.indexOf('column="validatorTrust"')
  const updatedColumn = tableHead.indexOf('column="updated"')
  const trustColumn = tableHead.indexOf('column="trust"')
  assert.ok(
    stakeColumn < vTrustColumn && vTrustColumn < updatedColumn && updatedColumn < trustColumn,
    'Updated should appear immediately after Stake weight and VTrust',
  )

  const labUiSource = await readFile(resolve('src/app/admin/_components/AdminResearchLab.tsx'), 'utf8')
  const labOps = labUiSource.indexOf('<OpsHealthStrip ops={ops} />')
  const metagraph = labUiSource.indexOf('<AdminMetagraph />')
  const dailyBenchmark = labUiSource.indexOf('<DailyBenchmarkTelemetry')
  assert.ok(
    labOps < metagraph && metagraph < dailyBenchmark,
    'Metagraph should render between Lab Ops and Daily Benchmark',
  )

  console.log('metagraph-weight-freshness: effective stake, seven-UID roster, owner inclusion, telemetry, and UI wiring passed')
} finally {
  globalThis.fetch = originalFetch
  if (originalPythonPath === undefined) delete process.env.PYTHON_PATH
  else process.env.PYTHON_PATH = originalPythonPath
  await rm(outDir, { recursive: true, force: true })
}
