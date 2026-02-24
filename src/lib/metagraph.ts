// Metagraph fetching utilities (with caching)
import { exec } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import fs from 'fs'
import { encodeAddress } from '@polkadot/util-crypto'
import type { MetagraphData } from './types'

const execAsync = promisify(exec)

const NETUID = parseInt(process.env.BITTENSOR_NETUID || '71', 10)
const SUBTENSOR_RPC = 'https://entrypoint-finney.opentensor.ai:443'

// Find a working Python path
function findPythonPath(): string {
  const candidates = [
    process.env.PYTHON_PATH,
    process.env.HOME + '/bittensor-venv/bin/python',  // AWS/EC2
    process.env.HOME + '/anaconda3/bin/python3',       // Local anaconda
    '/usr/bin/python3',                                 // System Python
    'python3',                                          // PATH fallback
  ].filter(Boolean) as string[]

  for (const candidate of candidates) {
    if (candidate && (candidate === 'python3' || fs.existsSync(candidate))) {
      return candidate
    }
  }
  return 'python3' // Last resort
}

// Use global to persist metagraph cache across hot reloads
const globalForMetagraph = globalThis as unknown as {
  metagraphCache: { data: MetagraphData; timestamp: number } | null
  inFlightRequest: Promise<MetagraphData> | null
}

if (!globalForMetagraph.metagraphCache) {
  globalForMetagraph.metagraphCache = null
}
if (!globalForMetagraph.inFlightRequest) {
  globalForMetagraph.inFlightRequest = null
}

const METAGRAPH_TTL = 2 * 60 * 1000 // 2 minutes

// Clear metagraph cache (called by background refresh)
export function clearMetagraphCache(): void {
  globalForMetagraph.metagraphCache = null
}

// --- SCALE decoder for NeuronInfoLite ---
class ScaleDecoder {
  private data: Uint8Array
  private offset: number

  constructor(data: Uint8Array) {
    this.data = data
    this.offset = 0
  }

  readByte(): number {
    return this.data[this.offset++]
  }

  readBool(): boolean {
    return this.readByte() !== 0
  }

  readCompact(): number {
    const first = this.readByte()
    const mode = first & 0x03
    if (mode === 0) return first >> 2
    if (mode === 1) return ((this.readByte() << 6) | (first >> 2))
    if (mode === 2) {
      const b1 = this.readByte(), b2 = this.readByte(), b3 = this.readByte()
      return ((b3 << 22) | (b2 << 14) | (b1 << 6) | (first >> 2))
    }
    // Big integer mode
    const len = (first >> 2) + 4
    let val = BigInt(0)
    for (let i = 0; i < len; i++) val = val | (BigInt(this.readByte()) << BigInt(i * 8))
    return Number(val)
  }

  readAccountId(): string {
    const bytes = this.data.slice(this.offset, this.offset + 32)
    this.offset += 32
    return encodeAddress(bytes, 42) // SS58 prefix 42 for bittensor
  }

  readVec<T>(readFn: () => T): T[] {
    const len = this.readCompact()
    const items: T[] = []
    for (let i = 0; i < len; i++) items.push(readFn.call(this))
    return items
  }

  // AxonInfo: block(u64) + version(u32) + ip(u128) + port(u16) + ip_type(u8) + protocol(u8) + placeholder1(u8) + placeholder2(u8)
  skipAxonInfo(): void {
    this.offset += 8 + 4 + 16 + 2 + 1 + 1 + 1 + 1
  }

  // PrometheusInfo: block(u64) + version(u32) + ip(u128) + port(u16) + ip_type(u8)
  skipPrometheusInfo(): void {
    this.offset += 8 + 4 + 16 + 2 + 1
  }

  readNeuronLite() {
    const hotkey = this.readAccountId()
    const coldkey = this.readAccountId()
    const uid = this.readCompact()
    const _netuid = this.readCompact()
    const _active = this.readBool()
    this.skipAxonInfo()
    this.skipPrometheusInfo()
    const stake = this.readVec(() => {
      const _addr = this.readAccountId()
      const amount = this.readCompact()
      return amount
    })
    const _rank = this.readCompact()
    const emission = this.readCompact()
    const incentive = this.readCompact()
    const _consensus = this.readCompact()
    const _trust = this.readCompact()
    const _validator_trust = this.readCompact()
    const _dividends = this.readCompact()
    const _last_update = this.readCompact()
    const validator_permit = this.readBool()
    const _pruning_score = this.readCompact()

    const totalStake = stake.reduce((s, a) => s + a, 0)

    return { hotkey, coldkey, uid, emission, incentive, totalStake, validator_permit }
  }
}

// Fetch metagraph via subtensor RPC (pure TypeScript, no Python dependency)
// Note: RPC fallback doesn't include alphaPrice - that requires Python/bittensor
async function fetchMetagraphFromRPC(): Promise<MetagraphData> {
  console.log('[Metagraph] Fetching from subtensor RPC...')
  const startTime = Date.now()

  const resp = await fetch(SUBTENSOR_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'neuronInfo_getNeuronsLite',
      params: [NETUID],
      id: 1
    }),
    signal: AbortSignal.timeout(60000)
  })

  const json = await resp.json() as { result?: number[], error?: { message: string } }

  if (json.error || !json.result) {
    throw new Error(json.error?.message || 'Empty RPC response')
  }

  const bytes = new Uint8Array(json.result)
  const decoder = new ScaleDecoder(bytes)
  const numNeurons = decoder.readCompact()

  const hotkeyToUid: Record<string, number> = {}
  const uidToHotkey: Record<number, string> = {}
  const hotkeyToColdkey: Record<string, string> = {}
  const coldkeyToHotkeys: Record<string, string[]> = {}
  const incentives: Record<string, number> = {}
  const emissions: Record<string, number> = {}
  const stakes: Record<string, number> = {}
  const isValidator: Record<string, boolean> = {}

  for (let i = 0; i < numNeurons; i++) {
    const n = decoder.readNeuronLite()

    hotkeyToUid[n.hotkey] = n.uid
    uidToHotkey[n.uid] = n.hotkey
    hotkeyToColdkey[n.hotkey] = n.coldkey

    if (!coldkeyToHotkeys[n.coldkey]) coldkeyToHotkeys[n.coldkey] = []
    coldkeyToHotkeys[n.coldkey].push(n.hotkey)

    // Incentive is u16 (0-65535), normalize to 0-1
    incentives[n.hotkey] = n.incentive / 65535
    // Emission in rao (convert to TAO: divide by 1e9)
    emissions[n.hotkey] = n.emission / 1e9
    // Stake in rao (convert to TAO: divide by 1e9)
    stakes[n.hotkey] = n.totalStake / 1e9
    isValidator[n.hotkey] = n.validator_permit
  }

  console.log(`[Metagraph] RPC fetch completed in ${Date.now() - startTime}ms (${numNeurons} neurons)`)

  return {
    hotkeyToUid,
    uidToHotkey,
    hotkeyToColdkey,
    coldkeyToHotkeys,
    incentives,
    emissions,
    stakes,
    isValidator,
    totalNeurons: numNeurons,
    alphaPrice: null, // Not available via RPC, requires Python/bittensor
    error: null
  }
}

// Fetch metagraph from bittensor Python script
async function fetchMetagraphFromPython(): Promise<MetagraphData> {
  console.log('[Metagraph] Fetching from bittensor Python...')
  const startTime = Date.now()
  const scriptPath = path.join(process.cwd(), 'scripts', 'fetch_metagraph.py')
  const pythonPath = findPythonPath()

  const { stdout, stderr } = await execAsync(
    `${pythonPath} ${scriptPath}`,
    {
      timeout: 120000,
      env: { ...process.env }
    }
  )

  if (stderr) {
    console.error('Python stderr:', stderr)
  }

  const data = JSON.parse(stdout) as MetagraphData

  // Check if the Python script returned an error (e.g. missing bittensor module)
  if (data.error || data.totalNeurons === 0) {
    throw new Error(data.error || 'Python returned empty metagraph')
  }

  console.log(`[Metagraph] Python fetch completed in ${Date.now() - startTime}ms`)
  return data
}

// Fetch metagraph: try Python first, fall back to RPC
async function fetchMetagraphFromBittensor(): Promise<MetagraphData> {
  // Try Python script first (more complete data including alpha price)
  try {
    return await fetchMetagraphFromPython()
  } catch {
    console.log('[Metagraph] Python unavailable, falling back to RPC...')
  }

  // Fallback: direct RPC query (works without Python/bittensor)
  try {
    return await fetchMetagraphFromRPC()
  } catch (error) {
    console.error('[Metagraph] RPC fetch failed:', error)
    return {
      hotkeyToUid: {},
      uidToHotkey: {},
      hotkeyToColdkey: {},
      coldkeyToHotkeys: {},
      incentives: {},
      emissions: {},
      stakes: {},
      isValidator: {},
      totalNeurons: 0,
      alphaPrice: null,
      error: error instanceof Error ? error.message : 'Failed to fetch metagraph data'
    }
  }
}

// Cached metagraph fetch (handles 1000s of concurrent requests)
export async function fetchMetagraph(): Promise<MetagraphData> {
  const now = Date.now()

  // Return cached if available and fresh (and not an error result)
  if (
    globalForMetagraph.metagraphCache &&
    now - globalForMetagraph.metagraphCache.timestamp < METAGRAPH_TTL &&
    globalForMetagraph.metagraphCache.data.totalNeurons > 0
  ) {
    console.log('[Metagraph] Cache HIT')
    return globalForMetagraph.metagraphCache.data
  }

  // If a request is already in flight, wait for it (deduplication)
  if (globalForMetagraph.inFlightRequest) {
    console.log('[Metagraph] Waiting for in-flight request')
    return globalForMetagraph.inFlightRequest
  }

  // Fetch fresh data with deduplication
  const fetchPromise = (async () => {
    try {
      const data = await fetchMetagraphFromBittensor()
      // Only cache successful results
      if (data.totalNeurons > 0) {
        globalForMetagraph.metagraphCache = { data, timestamp: Date.now() }
      }
      return data
    } finally {
      globalForMetagraph.inFlightRequest = null
    }
  })()

  globalForMetagraph.inFlightRequest = fetchPromise
  return fetchPromise
}
