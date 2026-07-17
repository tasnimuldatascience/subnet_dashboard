'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, ShieldCheck } from 'lucide-react'
import type { MetagraphData } from '@/lib/types'
import { cn } from '@/lib/utils'

const REFRESH_INTERVAL_MS = 30_000
const EPOCH_LENGTH = 360
// A validator that sets weights every epoch shows at most ~374 blocks
// between sets (pos 345 one epoch, pos 359 the next). Anything past 380
// means the previous submission window was missed. Mirrors the Discord
// weights watch running on the validator host.
const STALE_BLOCKS = 380

const WATCHED_UIDS: Array<{ uid: number; label: string }> = [
  { uid: 0, label: 'primary (Leadpoet)' },
  { uid: 202, label: 'auditor (TAO.com)' },
  { uid: 142, label: 'auditor (Yuma)' },
  { uid: 179, label: 'auditor (Rizzo)' },
  { uid: 62, label: 'auditor (Opentensor Fdn)' },
]

type MetagraphPayload = MetagraphData & { cachedAt?: number }

interface WatchRow {
  uid: number
  label: string
  lastSetEpoch: number | null
  blocksSince: number | null
  stale: boolean
}

function buildRows(data: MetagraphPayload | null): WatchRow[] {
  if (!data || data.currentBlock === null) return []
  const block = data.currentBlock
  return WATCHED_UIDS.map(({ uid, label }) => {
    const hotkey = data.uidToHotkey?.[uid]
    const lastUpdate = hotkey !== undefined ? data.lastUpdates?.[hotkey] : undefined
    if (lastUpdate === undefined || !Number.isFinite(lastUpdate)) {
      return { uid, label, lastSetEpoch: null, blocksSince: null, stale: false }
    }
    const blocksSince = block - lastUpdate
    return {
      uid,
      label,
      lastSetEpoch: Math.floor(lastUpdate / EPOCH_LENGTH),
      blocksSince,
      stale: blocksSince > STALE_BLOCKS,
    }
  })
}

export function AdminWeightsAlerts() {
  const [data, setData] = useState<MetagraphPayload | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`/api/metagraph?t=${Date.now()}`, { cache: 'no-store' })
      if (!response.ok) throw new Error(`Metagraph API returned ${response.status}`)
      const payload = (await response.json()) as MetagraphPayload
      if (payload.error) throw new Error(payload.error)
      setData(payload)
      setError(null)
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : 'Failed to load weights watch')
    }
  }, [])

  useEffect(() => {
    void refresh()
    const timer = setInterval(() => void refresh(), REFRESH_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [refresh])

  const rows = buildRows(data)
  const stale = rows.filter((row) => row.stale)
  const epoch = data?.currentBlock !== null && data?.currentBlock !== undefined
    ? Math.floor(data.currentBlock / EPOCH_LENGTH)
    : null

  if (error && !data) {
    return (
      <div
        className="rounded-xl border px-4 py-3 text-xs"
        style={{ borderColor: 'var(--surface-border)', background: 'var(--surface)', color: 'var(--text-tertiary)' }}
      >
        Weights watch unavailable: {error}
      </div>
    )
  }

  if (rows.length === 0) return null

  return (
    <div
      className={cn('rounded-xl border px-4 py-3', stale.length > 0 && 'border-red-500/40')}
      style={{
        borderColor: stale.length > 0 ? undefined : 'var(--surface-border)',
        background: stale.length > 0 ? 'rgba(239, 68, 68, 0.06)' : 'var(--surface)',
      }}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-1.5 text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
          {stale.length > 0 ? (
            <AlertTriangle className="h-3.5 w-3.5 text-red-400" />
          ) : (
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
          )}
          Weights watch
          {epoch !== null && (
            <span style={{ color: 'var(--text-tertiary)' }}>· epoch {epoch}</span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {rows.map((row) => (
            <span
              key={row.uid}
              title={
                row.blocksSince === null
                  ? 'No on-chain last_update for this UID'
                  : `Last set epoch ${row.lastSetEpoch}, ${row.blocksSince} blocks since last update`
              }
              className={cn(
                'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium',
                row.stale
                  ? 'border-red-500/50 bg-red-500/10 text-red-300'
                  : 'border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-300/90',
              )}
            >
              UID {row.uid}
              <span className={row.stale ? 'text-red-300/70' : 'text-emerald-300/60'}>
                {row.blocksSince === null ? '—' : `${row.blocksSince} blk`}
              </span>
            </span>
          ))}
        </div>
      </div>
      {stale.length > 0 && (
        <div className="mt-2 space-y-1 text-xs text-red-300/90">
          <div className="font-semibold">
            Missed weight set (epoch {epoch !== null ? epoch - 1 : '—'})
          </div>
          {stale.map((row) => (
            <div key={row.uid}>
              UID {row.uid} {row.label}: last set epoch {row.lastSetEpoch}, {row.blocksSince} blocks
              since last update
            </div>
          ))}
          <div style={{ color: 'var(--text-tertiary)' }}>
            Primary miss means auditors have no bundle to copy — check gateway /weights/submit
            responses and the validator log.
          </div>
        </div>
      )}
    </div>
  )
}
