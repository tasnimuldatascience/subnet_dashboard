'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import type { MetagraphData } from '@/lib/types'
import registry from '../../../../validator_registry.json'

const REFRESH_INTERVAL_MS = 30_000
// A single best-head RPC miss is common enough that it should not page an
// operator. Two consecutive misses still surface a real outage within ~30s.
const CONSECUTIVE_FAILURES_BEFORE_ALERT = 2
const WEIGHT_SUBMISSION_GRACE_BLOCKS = 20

// Watched validators are identified by hotkey (the stable identity) and
// their UIDs are resolved live from the metagraph, so a re-registration
// that moves a validator to a new UID is followed automatically. A hotkey
// rotation is a deliberate operator event handled by a reviewed edit to
// validator_registry.json — never by silently following names or coldkeys.
interface WatchedValidator {
  id: string
  label: string
  hotkey: string
  expectedColdkey: string
}

const WATCHED_VALIDATORS: WatchedValidator[] = registry.validators

type MetagraphPayload = MetagraphData & { cachedAt?: number }

interface WatchRow {
  id: string
  label: string
  hotkey: string
  uid: number | null
  lastSetBlock: number | null
  blocksSince: number | null
  notRegistered: boolean
  permitLost: boolean
  coldkeyMismatch: boolean
  inactive: boolean
  stale: boolean
  unavailable: boolean
}

function buildRows(data: MetagraphPayload | null): WatchRow[] {
  if (!data || data.currentBlock === null) return []
  const block = data.currentBlock
  const staleBlocks = data.tempo !== null && Number.isSafeInteger(data.tempo) && data.tempo > 0
    ? data.tempo + WEIGHT_SUBMISSION_GRACE_BLOCKS
    : null
  return WATCHED_VALIDATORS.map(({ id, label, hotkey, expectedColdkey }) => {
    const uid = data.hotkeyToUid?.[hotkey]
    const row: WatchRow = {
      id,
      label,
      hotkey,
      uid: uid ?? null,
      lastSetBlock: null,
      blocksSince: null,
      notRegistered: uid === undefined,
      permitLost: false,
      coldkeyMismatch: false,
      inactive: false,
      stale: false,
      unavailable: false,
    }
    if (uid === undefined) return row
    const coldkey = data.hotkeyToColdkey?.[hotkey]
    row.coldkeyMismatch = coldkey !== undefined && coldkey !== expectedColdkey
    row.permitLost = data.isValidator?.[hotkey] === false
    row.inactive = data.active?.[hotkey] === false
    const lastUpdate = data.lastUpdates?.[hotkey]
    if (lastUpdate === undefined || !Number.isFinite(lastUpdate)) {
      row.unavailable = true
      return row
    }
    row.lastSetBlock = lastUpdate
    row.blocksSince = block - lastUpdate
    row.stale = staleBlocks !== null && row.blocksSince > staleBlocks
    return row
  })
}

function rowProblems(row: WatchRow): string[] {
  const problems: string[] = []
  if (row.notRegistered) problems.push('hotkey no longer registered')
  if (row.coldkeyMismatch) problems.push('unexpected coldkey')
  if (row.permitLost) problems.push('validator permit lost')
  if (row.inactive) problems.push('validator inactive')
  if (row.unavailable) problems.push('no on-chain last_update')
  if (row.stale) problems.push(`weight update stale (${row.blocksSince} blocks since last set)`)
  return problems
}

export function AdminWeightsAlerts() {
  const [data, setData] = useState<MetagraphPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [consecutiveFailures, setConsecutiveFailures] = useState(0)

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`/api/metagraph?t=${Date.now()}`, { cache: 'no-store' })
      if (!response.ok) throw new Error(`Metagraph API returned ${response.status}`)
      const payload = (await response.json()) as MetagraphPayload
      if (payload.error) throw new Error(payload.error)
      setData(payload)
      setError(null)
      const authorityUnavailable = (
        payload.currentBlock === null ||
        payload.tempo === null ||
        payload.subnetEpochIndex === null
      )
      setConsecutiveFailures((count) => authorityUnavailable ? count + 1 : 0)
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : 'Failed to load weights watch')
      setConsecutiveFailures((count) => count + 1)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const timer = setInterval(() => void refresh(), REFRESH_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [refresh])

  const rows = buildRows(data)
  const issues = rows.filter((row) => rowProblems(row).length > 0)
  const epoch = data?.subnetEpochIndex ?? null
  const currentMonitorError = error ?? (
    data?.currentBlock === null ||
    data?.tempo === null ||
    data?.subnetEpochIndex === null
      ? 'Official subnet epoch authority unavailable; weight freshness cannot be verified.'
      : null
  )
  const monitorError = consecutiveFailures >= CONSECUTIVE_FAILURES_BEFORE_ALERT
    ? currentMonitorError
    : null

  if (monitorError) {
    return (
      <div
        role="alert"
        className="rounded-xl border border-red-500/40 bg-red-500/[0.06] px-4 py-3 text-xs text-red-300/90"
      >
        <div className="flex items-center gap-1.5 font-semibold">
          <AlertTriangle className="h-3.5 w-3.5 text-red-400" />
          Weights watch unavailable
        </div>
        <div className="mt-1">{monitorError}</div>
      </div>
    )
  }

  // This area is reserved for actionable system faults, not healthy telemetry.
  if (issues.length === 0) return null

  return (
    <div
      role="alert"
      className="rounded-xl border border-red-500/40 bg-red-500/[0.06] px-4 py-3"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-red-300/90">
          <AlertTriangle className="h-3.5 w-3.5 text-red-400" />
          Weights watch
          {epoch !== null && (
            <span style={{ color: 'var(--text-tertiary)' }}>· epoch {epoch}</span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {issues.map((row) => (
            <span
              key={row.id}
              title={rowProblems(row).join('; ')}
              className="inline-flex items-center gap-1 rounded-full border border-red-500/50 bg-red-500/10 px-2 py-0.5 text-[11px] font-medium text-red-300"
            >
              {row.label}
              <span className="text-red-300/70">
                {row.notRegistered ? 'not registered' : `UID ${row.uid}`}
              </span>
            </span>
          ))}
        </div>
      </div>
      <div className="mt-2 space-y-1 text-xs text-red-300/90">
        <div className="font-semibold">Weight set issue</div>
        {issues.map((row) => (
          <div key={row.id}>
            {row.label}
            {row.uid !== null ? ` · current UID ${row.uid}` : ''}
            {row.lastSetBlock !== null ? ` · last set ${row.blocksSince} blocks ago` : ''}
            {': '}
            {rowProblems(row).join('; ')}
          </div>
        ))}
        <div style={{ color: 'var(--text-tertiary)' }}>
          Primary miss means auditors have no bundle to copy — check gateway /weights/submit
          responses and the validator log.
        </div>
      </div>
    </div>
  )
}
