// Metagraph fetching utilities (with caching)
import { exec } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import fs from 'fs'
import {
  blake2AsU8a,
  decodeAddress,
  encodeAddress,
  xxhashAsU8a,
} from '@polkadot/util-crypto'
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

// One Bittensor block is roughly 12 seconds. A 30-second snapshot keeps the
// admin view operationally useful without turning every browser poll into a
// separate chain query.
const METAGRAPH_TTL = 30 * 1000

// Cached data can survive a hot reload, so tolerate snapshots created before
// weight-freshness telemetry was added.
function withFreshnessDefaults(data: MetagraphData): MetagraphData {
  return {
    ...data,
    active: data.active ?? {},
    names: data.names ?? {},
    ranks: data.ranks ?? {},
    trusts: data.trusts ?? {},
    validatorTrusts: data.validatorTrusts ?? {},
    consensus: data.consensus ?? {},
    dividends: data.dividends ?? {},
    axons: data.axons ?? {},
    lastUpdates: data.lastUpdates ?? {},
    currentBlock: typeof data.currentBlock === 'number' &&
      Number.isSafeInteger(data.currentBlock) && data.currentBlock >= 0
      ? data.currentBlock
      : null,
  }
}

// Clear metagraph cache (called by background refresh)
export function clearMetagraphCache(): void {
  globalForMetagraph.metagraphCache = null
}

// Set metagraph cache directly (for atomic swap during refresh)
export function setMetagraphCache(data: MetagraphData): void {
  globalForMetagraph.metagraphCache = { data: withFreshnessDefaults(data), timestamp: Date.now() }
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

  readFixedUnsigned(byteLength: number): bigint {
    let value = BigInt(0)
    for (let i = 0; i < byteLength; i++) {
      value |= BigInt(this.readByte()) << BigInt(i * 8)
    }
    return value
  }

  readBytes(): Uint8Array {
    const length = this.readCompact()
    const bytes = this.data.slice(this.offset, this.offset + length)
    this.offset += length
    return bytes
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

  // AxonInfo: block(u64) + version(u32) + ip(u128) + port(u16) +
  // ip_type(u8) + protocol(u8) + placeholder1(u8) + placeholder2(u8)
  readAxonInfo(): string | null {
    this.readFixedUnsigned(8) // serving block
    this.readFixedUnsigned(4) // version
    const ip = this.readFixedUnsigned(16)
    const port = Number(this.readFixedUnsigned(2))
    const ipType = this.readByte()
    this.offset += 3 // protocol + two reserved bytes

    if (ip === BigInt(0) || port === 0) return null
    const host = formatIpAddress(ip, ipType)
    return host ? `${host}:${port}` : null
  }

  // PrometheusInfo: block(u64) + version(u32) + ip(u128) + port(u16) + ip_type(u8)
  skipPrometheusInfo(): void {
    this.offset += 8 + 4 + 16 + 2 + 1
  }

  readNeuronLite() {
    const hotkey = this.readAccountId()
    const coldkey = this.readAccountId()
    const uid = this.readCompact()
    this.readCompact() // netuid
    const active = this.readBool()
    const axon = this.readAxonInfo()
    this.skipPrometheusInfo()
    const stake = this.readVec(() => {
      this.readAccountId() // staking account
      const amount = this.readCompact()
      return amount
    })
    const rank = this.readCompact()
    const emission = this.readCompact()
    const incentive = this.readCompact()
    const consensus = this.readCompact()
    const trust = this.readCompact()
    const validatorTrust = this.readCompact()
    const dividends = this.readCompact()
    const lastUpdate = this.readCompact()
    const validator_permit = this.readBool()
    this.readCompact() // pruning score

    const totalStake = stake.reduce((s, a) => s + a, 0)

    return {
      hotkey,
      coldkey,
      uid,
      active,
      axon,
      rank,
      emission,
      incentive,
      consensus,
      trust,
      validatorTrust,
      dividends,
      totalStake,
      lastUpdate,
      validator_permit,
    }
  }
}

function formatIpAddress(ip: bigint, ipType: number): string | null {
  if (ipType === 4) {
    return [BigInt(24), BigInt(16), BigInt(8), BigInt(0)]
      .map((shift) => Number((ip >> shift) & BigInt(255)))
      .join('.')
  }
  if (ipType === 6) {
    const groups: string[] = []
    for (let shift = BigInt(112); shift >= BigInt(0); shift -= BigInt(16)) {
      groups.push(((ip >> shift) & BigInt(65535)).toString(16))
    }
    return groups.join(':')
  }
  return null
}

function toHex(bytes: Uint8Array): string {
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

function fromHex(value: string): Uint8Array {
  const hex = value.startsWith('0x') ? value.slice(2) : value
  const bytes = new Uint8Array(Math.floor(hex.length / 2))
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

function identityStorageKey(coldkey: string): string {
  const account = decodeAddress(coldkey)
  const parts = [
    xxhashAsU8a('SubtensorModule', 128),
    xxhashAsU8a('IdentitiesV2', 128),
    blake2AsU8a(account, 128),
    account,
  ]
  const length = parts.reduce((sum, part) => sum + part.length, 0)
  const key = new Uint8Array(length)
  let offset = 0
  for (const part of parts) {
    key.set(part, offset)
    offset += part.length
  }
  return toHex(key)
}

function decodeIdentityName(value: string | null | undefined): string | null {
  if (!value) return null
  try {
    const decoder = new ScaleDecoder(fromHex(value))
    const name = new TextDecoder().decode(decoder.readBytes()).trim()
    return name || null
  } catch {
    return null
  }
}

async function fetchValidatorNamesFromRPC(
  validators: Array<{ hotkey: string; coldkey: string }>,
): Promise<Record<string, string>> {
  const uniqueColdkeys = Array.from(new Set(validators.map((validator) => validator.coldkey)))
  if (uniqueColdkeys.length === 0) return {}

  try {
    const requests = uniqueColdkeys.map((coldkey, index) => ({
      jsonrpc: '2.0',
      method: 'state_getStorage',
      params: [identityStorageKey(coldkey)],
      id: 1000 + index,
    }))
    const response = await fetch(SUBTENSOR_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requests),
      signal: AbortSignal.timeout(15000),
    })
    if (!response.ok) return {}

    const entries = await response.json() as Array<RpcResponse<string | null>>
    if (!Array.isArray(entries)) return {}
    const nameByColdkey = new Map<string, string>()
    entries.forEach((entry, index) => {
      const name = decodeIdentityName(entry.result)
      if (name) nameByColdkey.set(uniqueColdkeys[index], name)
    })

    return Object.fromEntries(
      validators.flatMap((validator) => {
        const name = nameByColdkey.get(validator.coldkey)
        return name ? [[validator.hotkey, name]] : []
      }),
    )
  } catch (error) {
    console.warn('[Metagraph] Validator identity lookup unavailable:', error)
    return {}
  }
}

type RpcResponse<T> = {
  result?: T
  error?: { message?: string }
}

function parseBlockNumber(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null

  const parsed = typeof value === 'number'
    ? value
    : Number.parseInt(value, value.startsWith('0x') ? 16 : 10)

  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null
}

async function subtensorRpc<T>(method: string, params: unknown[], id: number): Promise<T> {
  const response = await fetch(SUBTENSOR_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method, params, id }),
    signal: AbortSignal.timeout(15000),
  })

  if (!response.ok) {
    throw new Error(`${method} returned HTTP ${response.status}`)
  }

  const json = await response.json() as RpcResponse<T>
  if (json.error || json.result === undefined || json.result === null) {
    throw new Error(json.error?.message || `${method} returned an empty result`)
  }

  return json.result
}

async function fetchCurrentBlockFromRPC(): Promise<number | null> {
  // Prefer finalized state so freshness alerts do not flap during a short reorg.
  try {
    const finalizedHead = await subtensorRpc<string>('chain_getFinalizedHead', [], 2)
    const header = await subtensorRpc<{ number?: unknown }>('chain_getHeader', [finalizedHead], 3)
    const finalizedBlock = parseBlockNumber(header.number)
    if (finalizedBlock !== null) return finalizedBlock
  } catch (error) {
    console.warn('[Metagraph] Finalized block lookup failed, trying best head:', error)
  }

  // Some RPC providers disable finalized-head queries. A best-head block is
  // still useful telemetry and is preferable to failing the metagraph fetch.
  try {
    const header = await subtensorRpc<{ number?: unknown }>('chain_getHeader', [], 4)
    return parseBlockNumber(header.number)
  } catch (error) {
    console.warn('[Metagraph] Current block lookup unavailable:', error)
    return null
  }
}

// Fetch metagraph via subtensor RPC (pure TypeScript, no Python dependency)
// Note: RPC fallback doesn't include alphaPrice - that requires Python/bittensor
async function fetchMetagraphFromRPC(): Promise<MetagraphData> {
  console.log('[Metagraph] Fetching from subtensor RPC...')
  const startTime = Date.now()
  const currentBlockPromise = fetchCurrentBlockFromRPC()

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
  const active: Record<string, boolean> = {}
  const ranks: Record<string, number> = {}
  const trusts: Record<string, number> = {}
  const validatorTrusts: Record<string, number> = {}
  const consensus: Record<string, number> = {}
  const dividends: Record<string, number> = {}
  const axons: Record<string, string | null> = {}
  const lastUpdates: Record<string, number> = {}
  const validatorKeys: Array<{ hotkey: string; coldkey: string }> = []

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
    active[n.hotkey] = n.active
    ranks[n.hotkey] = n.rank / 65535
    trusts[n.hotkey] = n.trust / 65535
    validatorTrusts[n.hotkey] = n.validatorTrust / 65535
    consensus[n.hotkey] = n.consensus / 65535
    dividends[n.hotkey] = n.dividends / 65535
    axons[n.hotkey] = n.axon
    lastUpdates[n.hotkey] = n.lastUpdate
    if (n.validator_permit && n.active) {
      validatorKeys.push({ hotkey: n.hotkey, coldkey: n.coldkey })
    }
  }

  const [currentBlock, names] = await Promise.all([
    currentBlockPromise,
    fetchValidatorNamesFromRPC(validatorKeys),
  ])

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
    active,
    names,
    ranks,
    trusts,
    validatorTrusts,
    consensus,
    dividends,
    axons,
    lastUpdates,
    currentBlock,
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
    console.log('Python stderr:', stderr)
  }

  const data = withFreshnessDefaults(JSON.parse(stdout) as MetagraphData)

  // Check if the Python script returned an error (e.g. missing bittensor module)
  if (data.error || data.totalNeurons === 0) {
    throw new Error(data.error || 'Python returned empty metagraph')
  }

  if (Object.keys(data.names).length === 0) {
    const validators = Object.entries(data.isValidator)
      .filter(([hotkey, validator]) => validator && data.active[hotkey] !== false)
      .map(([hotkey]) => ({
        hotkey,
        coldkey: data.hotkeyToColdkey[hotkey],
      }))
      .filter((entry) => Boolean(entry.coldkey))
    data.names = await fetchValidatorNamesFromRPC(validators)
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
      active: {},
      names: {},
      ranks: {},
      trusts: {},
      validatorTrusts: {},
      consensus: {},
      dividends: {},
      axons: {},
      lastUpdates: {},
      currentBlock: null,
      totalNeurons: 0,
      alphaPrice: null,
      error: error instanceof Error ? error.message : 'Failed to fetch metagraph data'
    }
  }
}

// Fetch metagraph fresh, bypassing cache (used by background refresh)
export async function fetchMetagraphFresh(): Promise<MetagraphData> {
  console.log('[Metagraph] Fetching fresh (bypassing cache)...')
  return fetchMetagraphFromBittensor()
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
    const data = withFreshnessDefaults(globalForMetagraph.metagraphCache.data)
    globalForMetagraph.metagraphCache.data = data
    return data
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
