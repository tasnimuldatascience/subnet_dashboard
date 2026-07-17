import { xxhashAsU8a } from '@polkadot/util-crypto'
import { runSingleFlight, type SingleFlightState } from './single-flight'
import {
  deriveSubnetEpochPosition,
  type SubnetEpochSnapshot,
} from './subnet-epoch'

const DEFAULT_SUBTENSOR_RPC = 'https://entrypoint-finney.opentensor.ai:443'
const RPC_TIMEOUT_MS = 8_000

type RpcResponse<T> = {
  id?: number | string
  result?: T
  error?: { code?: number; message?: string }
}

const globalForSubnetEpoch = globalThis as unknown as {
  subnetEpochFlight?: SingleFlightState<SubnetEpochSnapshot>
}

if (!globalForSubnetEpoch.subnetEpochFlight) {
  globalForSubnetEpoch.subnetEpochFlight = { current: null }
}

function configuredNetuid(): number {
  const rawNetuid = (process.env.BITTENSOR_NETUID || '71').trim()
  const netuid = /^\d+$/.test(rawNetuid) ? Number(rawNetuid) : Number.NaN
  if (!Number.isSafeInteger(netuid) || netuid <= 0 || netuid > 0xffff) {
    throw new Error('BITTENSOR_NETUID must be an integer between 1 and 65535')
  }
  return netuid
}

function subtensorRpcUrl(): string {
  return process.env.BITTENSOR_RPC_URL?.trim() || DEFAULT_SUBTENSOR_RPC
}

function toHex(bytes: Uint8Array): string {
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

function fromHex(value: string): Uint8Array {
  const hex = value.startsWith('0x') ? value.slice(2) : value
  if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) {
    throw new Error('Storage returned invalid hex')
  }
  const bytes = new Uint8Array(hex.length / 2)
  for (let index = 0; index < bytes.length; index++) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16)
  }
  return bytes
}

function netuidStorageKey(storageName: string, netuid: number): string {
  const netuidBytes = new Uint8Array([netuid & 0xff, (netuid >> 8) & 0xff])
  const parts = [
    xxhashAsU8a('SubtensorModule', 128),
    xxhashAsU8a(storageName, 128),
    netuidBytes,
  ]
  const key = new Uint8Array(parts.reduce((length, part) => length + part.length, 0))
  let offset = 0
  for (const part of parts) {
    key.set(part, offset)
    offset += part.length
  }
  return toHex(key)
}

function decodeStorageUnsigned(value: unknown, field: string): number {
  if (typeof value !== 'string') throw new Error(`${field} returned no storage value`)
  const bytes = fromHex(value)
  if (bytes.length > 8) throw new Error(`${field} exceeded an unsigned 64-bit value`)

  let decoded = BigInt(0)
  for (let index = 0; index < bytes.length; index++) {
    decoded |= BigInt(bytes[index]) << BigInt(index * 8)
  }
  if (decoded > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${field} exceeded JavaScript's safe integer range`)
  }
  return Number(decoded)
}

function parseBlockNumber(value: unknown): number {
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new Error('Best-head header returned an invalid block number')
  }
  const parsed = typeof value === 'number'
    ? value
    : Number.parseInt(value, value.startsWith('0x') ? 16 : 10)
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error('Best-head header returned an invalid block number')
  }
  return parsed
}

function parseBlockHash(value: unknown): string {
  if (typeof value !== 'string' || !/^0x[0-9a-f]{64}$/i.test(value)) {
    throw new Error('chain_getHead returned an invalid block hash')
  }
  return value.toLowerCase()
}

async function postRpc(body: unknown, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(subtensorRpcUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
    },
    body: JSON.stringify(body),
    cache: 'no-store',
    signal,
  })
  if (!response.ok) throw new Error(`Subtensor RPC returned HTTP ${response.status}`)
  return response.json()
}

async function rpc<T>(method: string, params: unknown[], id: number, signal: AbortSignal): Promise<T> {
  const response = await postRpc({ jsonrpc: '2.0', method, params, id }, signal) as RpcResponse<T>
  if (response.error || response.result === undefined || response.result === null) {
    throw new Error(response.error?.message || `${method} returned an empty result`)
  }
  return response.result
}

async function readBestSubnetEpochState(): Promise<SubnetEpochSnapshot> {
  // One deadline covers head selection, header resolution, and every storage
  // field so a failing provider cannot outlive the 12-second browser cadence.
  const signal = AbortSignal.timeout(RPC_TIMEOUT_MS)
  const netuid = configuredNetuid()
  const blockHash = parseBlockHash(await rpc<unknown>('chain_getHead', [], 1, signal))
  const header = await rpc<{ number?: unknown }>('chain_getHeader', [blockHash], 2, signal)
  const currentBlock = parseBlockNumber(header.number)

  const storageFields = [
    { field: 'tempo', storage: 'Tempo' },
    { field: 'lastEpochBlock', storage: 'LastEpochBlock' },
    { field: 'pendingEpochAt', storage: 'PendingEpochAt' },
    { field: 'subnetEpochIndex', storage: 'SubnetEpochIndex' },
    { field: 'blocksSinceLastStep', storage: 'BlocksSinceLastStep' },
  ] as const
  const requests = storageFields.map((entry, index) => ({
    jsonrpc: '2.0',
    method: 'state_getStorage',
    params: [netuidStorageKey(entry.storage, netuid), blockHash],
    id: 100 + index,
  }))
  const response = await postRpc(requests, signal)
  if (!Array.isArray(response)) throw new Error('Subnet epoch storage returned a non-array response')

  const entries = new Map<number | string | undefined, RpcResponse<unknown>>(
    (response as Array<RpcResponse<unknown>>).map((entry) => [entry.id, entry]),
  )
  const values = Object.fromEntries(storageFields.map((entry, index) => {
    const rpcEntry = entries.get(100 + index)
    if (!rpcEntry || rpcEntry.error || rpcEntry.result === undefined || rpcEntry.result === null) {
      throw new Error(rpcEntry?.error?.message || `${entry.storage} returned an empty result`)
    }
    return [entry.field, decodeStorageUnsigned(rpcEntry.result, entry.storage)]
  })) as Record<(typeof storageFields)[number]['field'], number>

  if (values.tempo <= 0) throw new Error('Tempo must be greater than zero')
  const position = deriveSubnetEpochPosition({
    currentBlock,
    tempo: values.tempo,
    lastEpochBlock: values.lastEpochBlock,
    pendingEpochAt: values.pendingEpochAt,
    blocksSinceLastStep: values.blocksSinceLastStep,
  })
  if (!position) throw new Error('Subnet epoch storage returned an inconsistent schedule')

  return {
    schemaVersion: 'leadpoet.subnet_epoch_state.v1',
    headKind: 'best',
    netuid,
    blockHash,
    currentBlock,
    tempo: values.tempo,
    lastEpochBlock: values.lastEpochBlock,
    pendingEpochAt: values.pendingEpochAt,
    subnetEpochIndex: values.subnetEpochIndex,
    blocksSinceLastStep: values.blocksSinceLastStep,
    ...position,
    observedAt: new Date().toISOString(),
  }
}

/**
 * Read one internally consistent best-head snapshot. Concurrent requests share
 * only the active RPC read; a completed value is never retained or served as a
 * stale fallback.
 */
export function fetchBestSubnetEpochState(): Promise<SubnetEpochSnapshot> {
  return runSingleFlight(globalForSubnetEpoch.subnetEpochFlight!, readBestSubnetEpochState)
}
