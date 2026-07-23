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
  inFlightStartedAt: number
}

if (!globalForMetagraph.metagraphCache) {
  globalForMetagraph.metagraphCache = null
}
if (!globalForMetagraph.inFlightRequest) {
  globalForMetagraph.inFlightRequest = null
}
if (!globalForMetagraph.inFlightStartedAt) {
  globalForMetagraph.inFlightStartedAt = 0
}

// A refresh that outlives the Python timeout plus the RPC fallback has hung;
// stop treating it as "in flight" so the next request can start a fresh
// refresh instead of the snapshot silently aging toward the stale ceiling.
const IN_FLIGHT_MAX_AGE_MS = 150 * 1000

function inFlightRefresh(): Promise<MetagraphData> | null {
  const pending = globalForMetagraph.inFlightRequest
  if (!pending) return null
  if (Date.now() - globalForMetagraph.inFlightStartedAt > IN_FLIGHT_MAX_AGE_MS) {
    console.warn('[Metagraph] Discarding hung in-flight refresh')
    globalForMetagraph.inFlightRequest = null
    return null
  }
  return pending
}

function trackInFlight(promise: Promise<MetagraphData>): Promise<MetagraphData> {
  globalForMetagraph.inFlightRequest = promise
  globalForMetagraph.inFlightStartedAt = Date.now()
  return promise
}

// One Bittensor block is roughly 12 seconds. A 30-second snapshot keeps the
// admin view operationally useful without turning every browser poll into a
// separate chain query.
const METAGRAPH_TTL = 30 * 1000
// A chain read should never hold a user request hostage once we have a
// successful snapshot. Serve the last good value while a refresh happens in
// the background; the five-minute cache warmer normally replaces it well
// before this safety window expires.
const METAGRAPH_STALE_TTL = 10 * 60 * 1000

export type MetagraphCacheHealth = {
  available: boolean
  ageMs: number | null
  fresh: boolean
  refreshing: boolean
  totalNeurons: number
}

export function getMetagraphCacheHealth(now = Date.now()): MetagraphCacheHealth {
  const entry = globalForMetagraph.metagraphCache
  const ageMs = entry ? Math.max(0, now - entry.timestamp) : null
  return {
    available: Boolean(entry?.data.totalNeurons),
    ageMs,
    fresh: ageMs !== null && ageMs < METAGRAPH_TTL,
    refreshing: Boolean(globalForMetagraph.inFlightRequest),
    totalNeurons: entry?.data.totalNeurons ?? 0,
  }
}

// Cached data can survive a hot reload, so tolerate snapshots created before
// weight-freshness telemetry was added.
function withFreshnessDefaults(data: MetagraphData): MetagraphData {
  const optionalBlockNumber = (value: unknown): number | null =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null

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
    currentBlock: optionalBlockNumber(data.currentBlock),
    tempo: optionalBlockNumber(data.tempo),
    lastEpochBlock: optionalBlockNumber(data.lastEpochBlock),
    subnetEpochIndex: optionalBlockNumber(data.subnetEpochIndex),
    pendingEpochAt: optionalBlockNumber(data.pendingEpochAt),
    lastMechanismStepBlock: optionalBlockNumber(data.lastMechanismStepBlock),
  }
}

// Clear metagraph cache (called by background refresh)
export function clearMetagraphCache(): void {
  globalForMetagraph.metagraphCache = null
}

// Set metagraph cache directly (for atomic swap during refresh). Validator
// identities are a separate best-effort RPC enrichment, so a transient miss
// must not erase names that were present in the previous good snapshot.
export function setMetagraphCache(data: MetagraphData): MetagraphData {
  const normalized = withFreshnessDefaults(data)
  const previousNames = globalForMetagraph.metagraphCache?.data.names ?? {}
  const names = Object.fromEntries(
    Object.keys(normalized.hotkeyToUid).flatMap((hotkey) => {
      const name = normalized.names[hotkey] || previousNames[hotkey]
      return name ? [[hotkey, name]] : []
    }),
  )
  const preserved = { ...normalized, names }
  globalForMetagraph.metagraphCache = {
    data: { ...preserved, currentBlock: null },
    timestamp: Date.now(),
  }
  return preserved
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

  readCompactBigInt(): bigint {
    const first = this.readByte()
    const mode = first & 0x03
    if (mode === 0) return BigInt(first >> 2)
    if (mode === 1) return BigInt((this.readByte() << 6) | (first >> 2))
    if (mode === 2) {
      const b1 = this.readByte(), b2 = this.readByte(), b3 = this.readByte()
      return BigInt(
        (b3 * 4_194_304) +
        (b2 * 16_384) +
        (b1 * 64) +
        (first >> 2),
      )
    }
    // Big integer mode
    const len = (first >> 2) + 4
    let val = BigInt(0)
    for (let i = 0; i < len; i++) val = val | (BigInt(this.readByte()) << BigInt(i * 8))
    return val
  }

  readCompact(): number {
    const value = this.readCompactBigInt()
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error(`SCALE compact value ${value} exceeds JavaScript's safe integer range`)
    }
    return Number(value)
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

// SubnetState SCALE layout:
// Option<SubnetState> + netuid + hotkeys + coldkeys + active +
// validator_permit + 12 compact-number vectors. The final three vectors are
// alpha stake, root TAO stake, and the effective stake used by consensus.
// See Subtensor's rpc_info/show_subnet.rs.
export function decodeSubnetStateTotalStakeRao(payload: number[]): number[] {
  const decoder = new ScaleDecoder(new Uint8Array(payload))
  const option = decoder.readByte()
  if (option === 0) throw new Error(`Subnet ${NETUID} does not exist`)
  if (option !== 1) throw new Error(`Invalid subnet-state option tag ${option}`)

  const netuid = decoder.readCompact()
  if (netuid !== NETUID) {
    throw new Error(`Subnet-state response was for netuid ${netuid}, expected ${NETUID}`)
  }

  const hotkeys = decoder.readVec(() => decoder.readAccountId())
  const coldkeys = decoder.readVec(() => decoder.readAccountId())
  const active = decoder.readVec(() => decoder.readBool())
  const validatorPermits = decoder.readVec(() => decoder.readBool())

  if (
    coldkeys.length !== hotkeys.length ||
    active.length !== hotkeys.length ||
    validatorPermits.length !== hotkeys.length
  ) {
    throw new Error('Subnet-state identity and status vectors have inconsistent lengths')
  }

  const skipCompactVector = () => {
    decoder.readVec(() => decoder.readCompactBigInt())
  }

  skipCompactVector() // pruning_score
  skipCompactVector() // last_update
  skipCompactVector() // emission
  skipCompactVector() // dividends
  skipCompactVector() // incentives
  skipCompactVector() // consensus
  skipCompactVector() // trust
  skipCompactVector() // rank
  skipCompactVector() // block_at_registration
  skipCompactVector() // alpha_stake
  skipCompactVector() // tao_stake
  const totalStake = decoder.readVec(() => decoder.readCompactBigInt())

  if (totalStake.length !== hotkeys.length) {
    throw new Error(
      `Subnet-state returned ${totalStake.length} stake weights for ${hotkeys.length} neurons`,
    )
  }

  return totalStake.map((rao) => {
    if (rao > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error(`Stake weight ${rao} exceeds JavaScript's safe integer range`)
    }
    return Number(rao)
  })
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

function netuidStorageKey(storageName: string, netuid: number): string {
  const netuidBytes = new Uint8Array([netuid & 0xff, (netuid >> 8) & 0xff])
  const parts = [
    xxhashAsU8a('SubtensorModule', 128),
    xxhashAsU8a(storageName, 128),
    netuidBytes,
  ]
  const key = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) {
    key.set(part, offset)
    offset += part.length
  }
  return toHex(key)
}

function decodeStorageUnsigned(value: string | null | undefined): number | null {
  if (!value) return null
  const bytes = fromHex(value)
  if (bytes.length === 0 || bytes.length > 8) return null

  let decoded = BigInt(0)
  for (let index = 0; index < bytes.length; index++) {
    decoded |= BigInt(bytes[index]) << BigInt(index * 8)
  }
  return decoded <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(decoded) : null
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
  id?: number | string
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

interface ChainTelemetry {
  currentBlock: number | null
  tempo: number | null
  lastEpochBlock: number | null
  subnetEpochIndex: number | null
  pendingEpochAt: number | null
  lastMechanismStepBlock: number | null
}

const EMPTY_CHAIN_TELEMETRY: ChainTelemetry = {
  currentBlock: null,
  tempo: null,
  lastEpochBlock: null,
  subnetEpochIndex: null,
  pendingEpochAt: null,
  lastMechanismStepBlock: null,
}

async function fetchChainTelemetryFromRPC(): Promise<ChainTelemetry> {
  let currentBlock: number | null = null
  let blockHash: string | null = null

  // Prefer one finalized state snapshot so the head and epoch fields cannot
  // straddle an epoch boundary or flap during a short reorg.
  try {
    const finalizedHead = await subtensorRpc<string>('chain_getFinalizedHead', [], 2)
    const header = await subtensorRpc<{ number?: unknown }>('chain_getHeader', [finalizedHead], 3)
    currentBlock = parseBlockNumber(header.number)
    if (currentBlock !== null) blockHash = finalizedHead
  } catch (error) {
    console.warn('[Metagraph] Finalized block lookup failed, trying best head:', error)
  }

  if (currentBlock === null) {
    // Some providers disable finalized-head queries. Use a best-head snapshot
    // when possible and resolve its hash so storage is read at the same block.
    try {
      const header = await subtensorRpc<{ number?: unknown }>('chain_getHeader', [], 4)
      currentBlock = parseBlockNumber(header.number)
      if (currentBlock !== null) {
        try {
          blockHash = await subtensorRpc<string>('chain_getBlockHash', [currentBlock], 5)
        } catch (error) {
          console.warn('[Metagraph] Best-head hash lookup unavailable:', error)
        }
      }
    } catch (error) {
      console.warn('[Metagraph] Current block lookup unavailable:', error)
    }
  }

  if (currentBlock === null) return EMPTY_CHAIN_TELEMETRY

  const storageFields = [
    { field: 'tempo', storage: 'Tempo' },
    { field: 'lastEpochBlock', storage: 'LastEpochBlock' },
    { field: 'subnetEpochIndex', storage: 'SubnetEpochIndex' },
    { field: 'pendingEpochAt', storage: 'PendingEpochAt' },
    { field: 'lastMechanismStepBlock', storage: 'LastMechansimStepBlock' },
  ] as const

  try {
    const requests = storageFields.map((entry, index) => ({
      jsonrpc: '2.0',
      method: 'state_getStorage',
      params: blockHash
        ? [netuidStorageKey(entry.storage, NETUID), blockHash]
        : [netuidStorageKey(entry.storage, NETUID)],
      id: 2000 + index,
    }))
    const response = await fetch(SUBTENSOR_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requests),
      signal: AbortSignal.timeout(15000),
    })
    if (!response.ok) throw new Error(`epoch storage returned HTTP ${response.status}`)

    const entries = await response.json() as Array<RpcResponse<string | null>>
    if (!Array.isArray(entries)) throw new Error('epoch storage returned a non-array response')
    const valuesById = new Map(entries.map((entry) => [entry.id, entry.result]))
    const decoded = Object.fromEntries(storageFields.map((entry, index) => [
      entry.field,
      decodeStorageUnsigned(valuesById.get(2000 + index)),
    ])) as Omit<ChainTelemetry, 'currentBlock'>

    return { currentBlock, ...decoded }
  } catch (error) {
    console.warn('[Metagraph] Subnet epoch telemetry unavailable:', error)
    return { ...EMPTY_CHAIN_TELEMETRY, currentBlock }
  }
}

async function fetchSubnetStateTotalStakeFromRPC(): Promise<number[]> {
  const response = await fetch(SUBTENSOR_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'subnetInfo_getSubnetState',
      params: [NETUID],
      id: 6,
    }),
    signal: AbortSignal.timeout(60000),
  })

  if (!response.ok) {
    throw new Error(`subnetInfo_getSubnetState returned HTTP ${response.status}`)
  }

  const json = await response.json() as RpcResponse<number[]>
  if (json.error || !json.result) {
    throw new Error(json.error?.message || 'subnetInfo_getSubnetState returned an empty result')
  }

  return decodeSubnetStateTotalStakeRao(json.result)
}

// Fetch metagraph via subtensor RPC (pure TypeScript, no Python dependency)
// Note: RPC fallback doesn't include alphaPrice - that requires Python/bittensor
async function fetchMetagraphFromRPC(): Promise<MetagraphData> {
  console.log('[Metagraph] Fetching from subtensor RPC...')
  const startTime = Date.now()
  const chainTelemetryPromise = fetchChainTelemetryFromRPC()

  const [resp, totalStakeRao] = await Promise.all([
    fetch(SUBTENSOR_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'neuronInfo_getNeuronsLite',
        params: [NETUID],
        id: 1
      }),
      signal: AbortSignal.timeout(60000)
    }),
    fetchSubnetStateTotalStakeFromRPC(),
  ])

  if (!resp.ok) {
    throw new Error(`neuronInfo_getNeuronsLite returned HTTP ${resp.status}`)
  }

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

  if (totalStakeRao.length !== numNeurons) {
    throw new Error(
      `Subnet-state returned ${totalStakeRao.length} stake weights for ${numNeurons} neuron-lite rows`,
    )
  }
  for (const [hotkey, uid] of Object.entries(hotkeyToUid)) {
    // SubnetState.total_stake is alpha stake plus root TAO stake weighted by
    // the on-chain TaoWeight. This is the effective stake shown by explorers.
    stakes[hotkey] = totalStakeRao[uid] / 1e9
  }

  const [chainTelemetry, names] = await Promise.all([
    chainTelemetryPromise,
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
    ...chainTelemetry,
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

  const chainTelemetry = await fetchChainTelemetryFromRPC()
  data.currentBlock = chainTelemetry.currentBlock ?? data.currentBlock
  data.tempo = chainTelemetry.tempo
  data.lastEpochBlock = chainTelemetry.lastEpochBlock
  data.subnetEpochIndex = chainTelemetry.subnetEpochIndex
  data.pendingEpochAt = chainTelemetry.pendingEpochAt
  data.lastMechanismStepBlock = chainTelemetry.lastMechanismStepBlock

  console.log(`[Metagraph] Python fetch completed in ${Date.now() - startTime}ms`)
  return data
}

// Fetch metagraph: try Python first, fall back to RPC
// When the Python fetch fails it burns its full 120s timeout before the RPC
// fallback even starts, so consecutive failures stretched snapshot staleness
// to many minutes. After a failure, skip straight to RPC for a cooldown
// window instead of re-paying the timeout on every refresh.
const PYTHON_FAILURE_COOLDOWN_MS = 10 * 60 * 1000
let pythonFailedAt = 0

async function fetchMetagraphFromBittensor(): Promise<MetagraphData> {
  // Try Python script first (more complete data including alpha price)
  if (Date.now() - pythonFailedAt > PYTHON_FAILURE_COOLDOWN_MS) {
    try {
      const data = await fetchMetagraphFromPython()
      pythonFailedAt = 0
      return data
    } catch (error) {
      pythonFailedAt = Date.now()
      console.log(
        '[Metagraph] Python unavailable, falling back to RPC (cooldown 10m):',
        error instanceof Error ? error.message.slice(0, 200) : error,
      )
    }
  } else {
    console.log('[Metagraph] Python in failure cooldown - using RPC directly')
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
      tempo: null,
      lastEpochBlock: null,
      subnetEpochIndex: null,
      pendingEpochAt: null,
      lastMechanismStepBlock: null,
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

// The block/epoch clock must never be served from the cached snapshot: the
// validator submits weights against the live best head
// (self.subtensor.block in neurons/validator.py), and the snapshot lagged it
// by 30+ blocks, which misled an operator about the remaining submission
// window. Fetch the best head (NOT the finalized head, to match the
// validator's view) with a short timeout on every cached read. If that live
// read fails, return no block instead of silently presenting the snapshot's
// cached head as current.
const LIVE_BLOCK_TIMEOUT_MS = 4000
const LIVE_BLOCK_ATTEMPTS = 2

async function fetchLiveBlockNumber(): Promise<number | null> {
  let lastError: unknown = null

  for (let attempt = 1; attempt <= LIVE_BLOCK_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(SUBTENSOR_RPC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'chain_getHeader',
          params: [],
          id: 90,
        }),
        signal: AbortSignal.timeout(LIVE_BLOCK_TIMEOUT_MS),
      })
      if (!response.ok) {
        throw new Error(`chain_getHeader returned HTTP ${response.status}`)
      }

      const json = await response.json() as RpcResponse<{ number?: unknown }>
      if (json.error || !json.result) {
        throw new Error(json.error?.message || 'chain_getHeader returned an empty result')
      }

      const block = parseBlockNumber(json.result.number)
      if (block === null) throw new Error('chain_getHeader returned an invalid block number')
      return block
    } catch (error) {
      lastError = error
    }
  }

  console.warn(
    `[Metagraph] Live best-head lookup failed after ${LIVE_BLOCK_ATTEMPTS} attempts:`,
    lastError,
  )
  return null
}

async function withLiveBlock(data: MetagraphData): Promise<MetagraphData> {
  const liveBlock = await fetchLiveBlockNumber()
  if (liveBlock === null) return { ...data, currentBlock: null }
  if (data.currentBlock !== null && liveBlock < data.currentBlock) {
    // Never move the clock backwards (an RPC replica briefly behind the
    // snapshot's head).
    return data
  }
  return { ...data, currentBlock: liveBlock }
}

// Cached metagraph fetch (handles 1000s of concurrent requests)
export async function fetchMetagraph(): Promise<MetagraphData> {
  const now = Date.now()
  const cached = globalForMetagraph.metagraphCache
  const cacheAge = cached ? now - cached.timestamp : Number.POSITIVE_INFINITY

  // Return cached if available and fresh (and not an error result)
  if (
    cached &&
    cacheAge < METAGRAPH_TTL &&
    cached.data.totalNeurons > 0
  ) {
    console.log('[Metagraph] Cache HIT')
    const data = withFreshnessDefaults(cached.data)
    cached.data = data
    return withLiveBlock(data)
  }

  // Once a successful snapshot exists, return it immediately and refresh in
  // the background. This keeps a slow Python/RPC call off the request path.
  if (cached && cacheAge < METAGRAPH_STALE_TTL && cached.data.totalNeurons > 0) {
    if (!inFlightRefresh()) {
      const refreshPromise = (async () => {
        try {
          const data = await fetchMetagraphFromBittensor()
          if (data.totalNeurons > 0) {
            return setMetagraphCache(data)
          }
          return data
        } finally {
          globalForMetagraph.inFlightRequest = null
        }
      })()
      trackInFlight(refreshPromise)
      void refreshPromise.catch((error) => {
        console.warn('[Metagraph] Background refresh failed; keeping stale snapshot', error)
      })
    }
    console.log(
      `[Metagraph] Cache STALE (${Math.round(cacheAge / 1000)}s old) - serving snapshot while refreshing`,
    )
    return withLiveBlock(withFreshnessDefaults(cached.data))
  }

  // If a request is already in flight, wait for it (deduplication)
  const pending = inFlightRefresh()
  if (pending) {
    console.log('[Metagraph] Waiting for in-flight request')
    return pending.then((data) => withLiveBlock(data))
  }

  // Fetch fresh data with deduplication
  const fetchPromise = (async () => {
    try {
      const data = await fetchMetagraphFromBittensor()
      // Only cache successful results
      if (data.totalNeurons > 0) {
        return setMetagraphCache(data)
      }
      return data
    } finally {
      globalForMetagraph.inFlightRequest = null
    }
  })()

  trackInFlight(fetchPromise)
  return fetchPromise.then((data) => withLiveBlock(data))
}
