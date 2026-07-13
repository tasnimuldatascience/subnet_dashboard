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
    ...compact(7),
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

try {
  const tsc = spawnSync(process.execPath, [
    resolve('node_modules/typescript/bin/tsc'),
    resolve('src/lib/metagraph.ts'),
    resolve('src/lib/types.ts'),
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
  const payload = neuronLitePayload()
  globalThis.fetch = async (_url, init) => {
    const request = JSON.parse(String(init?.body))

    if (Array.isArray(request)) {
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
      const result = blockMode === 'unavailable'
        ? null
        : { number: isFinalizedHeader ? '0x10f447' : '0x10f44a' }
      return { ok: true, status: 200, json: async () => ({ result }) }
    }

    throw new Error(`Unexpected RPC method: ${request.method}`)
  }

  const require = createRequire(import.meta.url)
  const { fetchMetagraphFresh } = require(join(outDir, 'metagraph.js'))

  const finalized = await fetchMetagraphFresh()
  const [hotkey] = Object.keys(finalized.hotkeyToUid)
  assert.ok(hotkey, 'synthetic neuron should decode to a hotkey')
  assert.equal(finalized.hotkeyToUid[hotkey], 7)
  assert.equal(finalized.active[hotkey], true)
  assert.equal(finalized.names[hotkey], 'Test Validator')
  assert.equal(finalized.axons[hotkey], '100.59.201.156:8093')
  assert.ok(Math.abs(finalized.validatorTrusts[hotkey] - (60_000 / 65_535)) < 1e-10)
  assert.ok(Math.abs(finalized.dividends[hotkey] - (20_000 / 65_535)) < 1e-10)
  assert.equal(finalized.lastUpdates[hotkey], 987_654, 'SCALE last_update should be retained')
  assert.equal(finalized.currentBlock, 1_111_111, 'finalized block should be preferred')

  blockMode = 'best'
  const best = await fetchMetagraphFresh()
  assert.equal(best.currentBlock, 1_111_114, 'best head should be used when finalized lookup fails')
  assert.equal(best.lastUpdates[hotkey], 987_654)

  blockMode = 'unavailable'
  const withoutBlock = await fetchMetagraphFresh()
  assert.equal(withoutBlock.currentBlock, null, 'block lookup failure should not fail metagraph data')
  assert.equal(withoutBlock.totalNeurons, 1)

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
  assert.match(metagraphUiSource, /const SUBNET_NETUID = 71/)
  assert.match(metagraphUiSource, /const SUBNET_TEMPO_BLOCKS = 360/)
  assert.match(metagraphUiSource, /const EPOCH_DURATION_MINUTES = 72/)
  assert.match(metagraphUiSource, /currentBlock \+ SUBNET_NETUID \+ 1/)
  assert.match(metagraphUiSource, /const BLOCK_TIME_SECONDS = 12/)
  assert.match(metagraphUiSource, /Math\.ceil\(seconds \/ 60\)/)
  assert.match(metagraphUiSource, /`\$\{minutes\}m \/ \$\{EPOCH_DURATION_MINUTES\}m`/)
  assert.match(metagraphUiSource, /`\$\{formatAmount\(nextEpochBlocks, 0\)\} \/ \$\{SUBNET_TEMPO_BLOCKS\}`/)
  assert.match(metagraphUiSource, /background: 'var\(--accent-positive\)'/)
  assert.match(metagraphUiSource, /role="progressbar"/)
  assert.match(metagraphUiSource, /nextEpochSeconds \/ \(EPOCH_DURATION_MINUTES \* 60\)/)
  assert.match(metagraphUiSource, /label="Blocks Until Next Epoch"/)
  assert.match(metagraphUiSource, /label="Time Until Next Epoch"/)
  assert.doesNotMatch(metagraphUiSource, /label="Average VTrust"/)
  const blocksCard = metagraphUiSource.indexOf('label="Blocks Until Next Epoch"')
  const timeCard = metagraphUiSource.indexOf('label="Time Until Next Epoch"')
  const activeCard = metagraphUiSource.indexOf('label="Active validators"')
  assert.ok(blocksCard < timeCard && timeCard < activeCard, 'epoch and validator cards should render in the requested order')
  assert.match(metagraphUiSource, /\.filter\(\(row\) => !row\.isMiner\)/)
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

  console.log('metagraph-weight-freshness: telemetry, freshness callouts, column order, and Lab placement passed')
} finally {
  globalThis.fetch = originalFetch
  if (originalPythonPath === undefined) delete process.env.PYTHON_PATH
  else process.env.PYTHON_PATH = originalPythonPath
  await rm(outDir, { recursive: true, force: true })
}
