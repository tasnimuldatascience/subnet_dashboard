'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  ChevronDown,
  Copy,
  RefreshCw,
  Search,
  ShieldCheck,
  Wifi,
} from 'lucide-react'
import type { MetagraphData } from '@/lib/types'
import { shortHotkey } from '@/lib/admin-format'
import { cn } from '@/lib/utils'

const REFRESH_INTERVAL_MS = 30_000
const ACTIVE_VALIDATOR_MAX_BLOCKS = 360
const SUBNET_NETUID = 71
const SUBNET_TEMPO_BLOCKS = 360
const EPOCH_INTERVAL_BLOCKS = SUBNET_TEMPO_BLOCKS + 1
const BLOCK_TIME_SECONDS = 12
const EPOCH_DURATION_MINUTES = 72

type MetagraphPayload = MetagraphData & { cachedAt?: number }
type SortKey =
  | 'uid'
  | 'name'
  | 'stake'
  | 'validatorTrust'
  | 'trust'
  | 'consensus'
  | 'incentive'
  | 'dividends'
  | 'emission'
  | 'updated'
  | 'rank'

type SortDirection = 'asc' | 'desc'

interface ValidatorRow {
  hotkey: string
  coldkey: string
  uid: number
  name: string
  stake: number
  validatorTrust: number
  trust: number
  consensus: number
  incentive: number
  dividends: number
  emission: number
  updated: number | null
  axon: string | null
  rank: number
  isMiner: boolean
}

function validatorRows(data: MetagraphPayload | null): ValidatorRow[] {
  if (!data) return []

  return Object.entries(data.hotkeyToUid)
    .filter(([hotkey]) => data.isValidator[hotkey])
    .map(([hotkey, uid]) => {
      const lastUpdate = data.lastUpdates[hotkey]
      const updated = data.currentBlock !== null && Number.isFinite(lastUpdate)
        ? Math.max(0, data.currentBlock - lastUpdate)
        : null
      const trust = data.trusts[hotkey] ?? 0
      const consensus = data.consensus[hotkey] ?? 0
      const incentive = data.incentives[hotkey] ?? 0

      return {
        hotkey,
        coldkey: data.hotkeyToColdkey[hotkey] ?? '',
        uid,
        name: data.names[hotkey] || shortHotkey(hotkey),
        stake: data.stakes[hotkey] ?? 0,
        validatorTrust: data.validatorTrusts[hotkey] ?? 0,
        trust,
        consensus,
        incentive,
        dividends: data.dividends[hotkey] ?? 0,
        emission: data.emissions[hotkey] ?? 0,
        updated,
        axon: data.axons[hotkey] ?? null,
        rank: data.ranks[hotkey] ?? 0,
        isMiner: trust > 0 || consensus > 0 || incentive > 0,
      }
    })
    .filter((row) => !row.isMiner)
}

function numericValue(row: ValidatorRow, key: SortKey): number | string {
  if (key === 'name') return row.name.toLowerCase()
  if (key === 'updated') return row.updated ?? Number.POSITIVE_INFINITY
  return row[key]
}

function formatAmount(value: number, maximumFractionDigits = 2): string {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits,
  }).format(value)
}

function formatMetric(value: number): string {
  if (!Number.isFinite(value)) return '—'
  return value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '') || '0'
}

function formatEmission(value: number): string {
  if (!Number.isFinite(value)) return '—'
  if (Math.abs(value) >= 1) return formatAmount(value, 5)
  return value.toFixed(6).replace(/0+$/, '').replace(/\.$/, '') || '0'
}

function blocksUntilNextEpoch(currentBlock: number): number {
  const epochPosition = (currentBlock + SUBNET_NETUID + 1) % EPOCH_INTERVAL_BLOCKS
  return epochPosition === 0 ? 0 : EPOCH_INTERVAL_BLOCKS - epochPosition
}

function formatEpochMinutes(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds))
  const minutes = Math.ceil(seconds / 60)
  return `${minutes}m / ${EPOCH_DURATION_MINUTES}m`
}

function SummaryCard({
  label,
  value,
  detail,
  progress,
}: {
  label: string
  value: string
  detail?: string
  progress?: number
}) {
  const progressPercent = progress === undefined ? null : Math.min(100, Math.max(0, progress))
  return (
    <div
      className="rounded-lg border px-4 py-3"
      style={{ borderColor: 'var(--surface-border)', background: 'var(--surface-base)' }}
    >
      <div className="text-[10px] uppercase tracking-[0.16em]" style={{ color: 'var(--text-tertiary)' }}>
        {label}
      </div>
      <div className="mt-1.5 text-2xl font-medium tabular-nums" style={{ color: 'var(--text-primary)' }}>{value}</div>
      {progressPercent !== null && (
        <div
          role="progressbar"
          aria-label={`${label}: ${value}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progressPercent)}
          className="mt-3 h-2 overflow-hidden rounded-full"
          style={{ background: 'var(--surface-border-strong)' }}
        >
          <div
            className="h-full rounded-full transition-[width] duration-300"
            style={{
              width: `${progressPercent}%`,
              background: 'var(--accent-positive)',
              boxShadow: '0 0 10px rgba(232, 240, 255, 0.2)',
            }}
          />
        </div>
      )}
      {detail && <div className="mt-1 text-[11px]" style={{ color: 'var(--text-secondary)' }}>{detail}</div>}
    </div>
  )
}

function CopyKey({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className="group inline-flex items-center gap-1.5 font-mono text-[11px] transition-colors hover:text-gold"
      style={{ color: 'var(--text-secondary)' }}
      title={value}
      aria-label={`Copy ${label}`}
      onClick={async () => {
        await navigator.clipboard.writeText(value)
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1200)
      }}
    >
      <span>{shortHotkey(value, 7, 5)}</span>
      {copied ? <Check className="h-3 w-3 text-gold" /> : <Copy className="h-3 w-3 opacity-50 group-hover:opacity-100" />}
    </button>
  )
}

function SortButton({
  column,
  label,
  active,
  direction,
  onSort,
}: {
  column: SortKey
  label?: string
  active: SortKey
  direction: SortDirection
  onSort: (column: SortKey) => void
}) {
  const Icon = active !== column ? ArrowUpDown : direction === 'asc' ? ArrowUp : ArrowDown
  return (
    <button
      type="button"
      className={cn(
        'inline-flex items-center gap-1 transition-colors hover:text-white',
        active === column ? 'text-gold' : '',
      )}
      onClick={() => onSort(column)}
    >
      <span>{label ?? (column === 'validatorTrust' ? 'VTrust' : column.charAt(0).toUpperCase() + column.slice(1))}</span>
      <Icon className="h-3 w-3" />
    </button>
  )
}

export function AdminMetagraph() {
  const [data, setData] = useState<MetagraphPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null)
  const [countdownTick, setCountdownTick] = useState(0)
  const [search, setSearch] = useState('')
  const [detailsExpanded, setDetailsExpanded] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>('stake')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')

  const fetchMetagraph = useCallback(async () => {
    setRefreshing(true)
    try {
      const response = await fetch(`/api/metagraph?t=${Date.now()}`, { cache: 'no-store' })
      if (!response.ok) throw new Error(`Metagraph API returned ${response.status}`)
      const payload = await response.json() as MetagraphPayload
      if (payload.error) throw new Error(payload.error)
      setData(payload)
      setLastSyncedAt(Date.now())
      setCountdownTick(0)
      setError(null)
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : 'Failed to refresh the metagraph')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void fetchMetagraph()
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void fetchMetagraph()
    }, REFRESH_INTERVAL_MS)
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void fetchMetagraph()
    }
    const handleAdminRefresh = () => void fetchMetagraph()
    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('leadpoet-admin-refresh', handleAdminRefresh)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('leadpoet-admin-refresh', handleAdminRefresh)
    }
  }, [fetchMetagraph])

  useEffect(() => {
    const interval = window.setInterval(() => setCountdownTick((tick) => tick + 1), 1000)
    return () => window.clearInterval(interval)
  }, [])

  const rows = useMemo(() => validatorRows(data), [data])
  const visibleRows = useMemo(() => {
    const query = search.trim().toLowerCase()
    return rows
      .filter((row) => !query || [row.name, row.hotkey, row.coldkey, String(row.uid), row.axon ?? '']
        .some((value) => value.toLowerCase().includes(query)))
      .sort((a, b) => {
        const left = numericValue(a, sortKey)
        const right = numericValue(b, sortKey)
        const result = typeof left === 'string' && typeof right === 'string'
          ? left.localeCompare(right)
          : Number(left) - Number(right)
        return sortDirection === 'asc' ? result : -result
      })
  }, [rows, search, sortDirection, sortKey])

  const freshnessAvailable = data?.currentBlock !== null && data?.currentBlock !== undefined
  const activeRows = rows.filter((row) => row.updated !== null && row.updated < ACTIVE_VALIDATOR_MAX_BLOCKS)
  const estimatedCurrentBlock = data?.currentBlock === null || data?.currentBlock === undefined
    ? null
    : data.currentBlock + Math.floor(countdownTick / BLOCK_TIME_SECONDS)
  const nextEpochBlocks = estimatedCurrentBlock === null ? null : blocksUntilNextEpoch(estimatedCurrentBlock)
  const nextEpochSeconds = nextEpochBlocks === null
    ? null
    : Math.max(0, (nextEpochBlocks * BLOCK_TIME_SECONDS) - (countdownTick % BLOCK_TIME_SECONDS))
  const blockRemainingPercent = nextEpochBlocks === null
    ? undefined
    : (nextEpochBlocks / SUBNET_TEMPO_BLOCKS) * 100
  const timeRemainingPercent = nextEpochSeconds === null
    ? undefined
    : (nextEpochSeconds / (EPOCH_DURATION_MINUTES * 60)) * 100

  const handleSort = (column: SortKey) => {
    if (column === sortKey) {
      setSortDirection((current) => current === 'asc' ? 'desc' : 'asc')
      return
    }
    setSortKey(column)
    setSortDirection(column === 'name' || column === 'uid' ? 'asc' : 'desc')
  }

  return (
    <section
      className="overflow-hidden rounded-xl border"
      style={{ borderColor: 'var(--surface-border)', background: 'var(--surface)' }}
    >
      <div
        className="flex flex-col gap-3 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
        style={{ borderColor: 'var(--surface-border)' }}
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
              Metagraph
            </h2>
            <span className="rounded-full border border-white/[0.08] px-2 py-0.5 text-[10px] uppercase tracking-[0.14em]" style={{ color: 'var(--text-secondary)' }}>
              SN71
            </span>
          </div>
          <p className="mt-0.5 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
            Validator weights and trust · refreshes every 30 seconds
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div
            className="inline-flex h-8 items-center gap-2 rounded-lg border px-2.5 text-[10px]"
            style={{ borderColor: 'var(--surface-border)', background: 'var(--surface)', color: 'var(--text-secondary)' }}
          >
            <Wifi className="h-3.5 w-3.5 text-gold" />
            <span>{lastSyncedAt ? new Date(lastSyncedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'Syncing…'}</span>
          </div>
          <button
            type="button"
            onClick={() => void fetchMetagraph()}
            disabled={refreshing}
            className="inline-flex h-8 items-center gap-2 rounded-lg border px-2.5 text-[11px] transition-colors hover:text-gold disabled:opacity-60"
            style={{ borderColor: 'var(--surface-border)', background: 'var(--surface)', color: 'var(--text-secondary)' }}
          >
            <RefreshCw className={cn('h-3.5 w-3.5', refreshing ? 'animate-spin' : '')} />
            Refresh now
          </button>
        </div>
      </div>

      <div className="grid gap-2 p-3 md:grid-cols-3">
        <SummaryCard
          label="Blocks Until Next Epoch"
          value={loading || nextEpochBlocks === null ? '—' : `${formatAmount(nextEpochBlocks, 0)} / ${SUBNET_TEMPO_BLOCKS}`}
          progress={blockRemainingPercent}
        />
        <SummaryCard
          label="Time Until Next Epoch"
          value={loading || nextEpochSeconds === null ? '—' : formatEpochMinutes(nextEpochSeconds)}
          progress={timeRemainingPercent}
        />
        <SummaryCard
          label="Active validators"
          value={loading || !freshnessAvailable ? '—' : `${formatAmount(activeRows.length, 0)}/${formatAmount(rows.length, 0)}`}
          detail={`Weight updated < ${ACTIVE_VALIDATOR_MAX_BLOCKS} blocks ago`}
        />
      </div>

      {error && (
        <div className="mx-3 mb-3 rounded-lg border border-burgundy-soft bg-burgundy-soft px-3 py-2 text-xs text-burgundy">
          Refresh failed: {error}. Showing the last successful snapshot when available.
        </div>
      )}

      <div className="border-t" style={{ borderColor: 'var(--surface-border)' }}>
        <div className="flex flex-col gap-2 border-b px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between" style={{ borderColor: 'var(--surface-border)' }}>
          <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            {visibleRows.length === rows.length ? `${rows.length} validators` : `${visibleRows.length} of ${rows.length} validators`}
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
            {detailsExpanded && (
              <label className="relative block w-full sm:w-80">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2" style={{ color: 'var(--text-tertiary)' }} />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search name, UID, key, or axon"
                  className="h-8 w-full rounded-lg border bg-transparent pl-9 pr-3 text-xs outline-none transition-colors focus:border-gold-strong"
                  style={{ borderColor: 'var(--surface-border-strong)', color: 'var(--text-primary)' }}
                />
              </label>
            )}
            <button
              type="button"
              aria-expanded={detailsExpanded}
              aria-controls="metagraph-validator-details"
              onClick={() => setDetailsExpanded((expanded) => !expanded)}
              className="inline-flex h-8 shrink-0 items-center justify-center gap-2 rounded-lg border px-3 text-[11px] font-medium transition-colors hover:text-gold"
              style={{ borderColor: 'var(--surface-border-strong)', color: 'var(--text-secondary)' }}
            >
              {detailsExpanded ? 'Hide validator details' : 'Show validator details'}
              <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', detailsExpanded ? 'rotate-180' : '')} />
            </button>
          </div>
        </div>

        {detailsExpanded && <div id="metagraph-validator-details" className="overflow-x-auto">
          <table className="min-w-[1900px] w-full border-collapse text-left text-xs">
            <thead style={{ background: 'var(--surface)' }}>
              <tr className="border-b" style={{ borderColor: 'var(--surface-border)' }}>
                <th className="px-4 py-3 font-medium" style={{ color: 'var(--text-tertiary)' }}>Pos</th>
                <th className="px-3 py-3 font-medium" style={{ color: 'var(--text-tertiary)' }}>Type</th>
                <th className="px-3 py-3 font-medium" style={{ color: 'var(--text-tertiary)' }}><SortButton column="uid" active={sortKey} direction={sortDirection} onSort={handleSort} /></th>
                <th className="px-3 py-3 font-medium" style={{ color: 'var(--text-tertiary)' }}><SortButton column="name" active={sortKey} direction={sortDirection} onSort={handleSort} /></th>
                <th className="px-3 py-3 text-right font-medium" style={{ color: 'var(--text-tertiary)' }}><SortButton column="stake" label="Stake weight (α)" active={sortKey} direction={sortDirection} onSort={handleSort} /></th>
                <th className="px-3 py-3 text-right font-medium" style={{ color: 'var(--text-tertiary)' }}><SortButton column="validatorTrust" active={sortKey} direction={sortDirection} onSort={handleSort} /></th>
                <th className="px-3 py-3 text-right font-medium" style={{ color: 'var(--text-tertiary)' }}><SortButton column="updated" label="Updated (blocks)" active={sortKey} direction={sortDirection} onSort={handleSort} /></th>
                <th className="px-3 py-3 text-right font-medium" style={{ color: 'var(--text-tertiary)' }}><SortButton column="trust" active={sortKey} direction={sortDirection} onSort={handleSort} /></th>
                <th className="px-3 py-3 text-right font-medium" style={{ color: 'var(--text-tertiary)' }}><SortButton column="consensus" active={sortKey} direction={sortDirection} onSort={handleSort} /></th>
                <th className="px-3 py-3 text-right font-medium" style={{ color: 'var(--text-tertiary)' }}><SortButton column="incentive" active={sortKey} direction={sortDirection} onSort={handleSort} /></th>
                <th className="px-3 py-3 text-right font-medium" style={{ color: 'var(--text-tertiary)' }}><SortButton column="dividends" active={sortKey} direction={sortDirection} onSort={handleSort} /></th>
                <th className="px-3 py-3 text-right font-medium" style={{ color: 'var(--text-tertiary)' }}><SortButton column="emission" label="Emission (α/epoch)" active={sortKey} direction={sortDirection} onSort={handleSort} /></th>
                <th className="px-3 py-3 font-medium" style={{ color: 'var(--text-tertiary)' }}>Axon</th>
                <th className="px-3 py-3 font-medium" style={{ color: 'var(--text-tertiary)' }}>Hotkey</th>
                <th className="px-3 py-3 font-medium" style={{ color: 'var(--text-tertiary)' }}>Coldkey</th>
                <th className="px-3 py-3 text-right font-medium" style={{ color: 'var(--text-tertiary)' }}><SortButton column="rank" active={sortKey} direction={sortDirection} onSort={handleSort} /></th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row, index) => (
                <tr key={row.hotkey} className="border-b transition-colors hover-bg-warm" style={{ borderColor: 'var(--surface-border)' }}>
                  <td className="px-4 py-3.5 font-medium" style={{ color: 'var(--text-secondary)' }}>{index + 1}</td>
                  <td className="px-3 py-3.5">
                    <span className="inline-flex items-center gap-1.5" title="Validator">
                      <ShieldCheck className="h-4 w-4 text-gold" />
                    </span>
                  </td>
                  <td className="px-3 py-3.5 font-mono text-gold">{row.uid}</td>
                  <td className="max-w-56 px-3 py-3.5">
                    <div className="truncate font-medium" style={{ color: data?.names[row.hotkey] ? 'var(--text-primary)' : 'var(--text-secondary)' }} title={data?.names[row.hotkey] || row.hotkey}>
                      {row.name}
                    </div>
                  </td>
                  <td className="px-3 py-3.5 text-right font-medium text-gold-bright">{formatAmount(row.stake, 2)}</td>
                  <td className="px-3 py-3.5 text-right" style={{ color: 'var(--text-primary)' }}>{formatMetric(row.validatorTrust)}</td>
                  <td
                    className={cn('px-3 py-3.5 text-right font-medium', row.updated !== null && row.updated >= ACTIVE_VALIDATOR_MAX_BLOCKS ? 'text-amber-warm' : '')}
                    style={row.updated !== null && row.updated < ACTIVE_VALIDATOR_MAX_BLOCKS ? { color: 'var(--text-primary)' } : undefined}
                  >
                    {row.updated === null ? '—' : formatAmount(row.updated, 0)}
                  </td>
                  <td className="px-3 py-3.5 text-right" style={{ color: 'var(--text-primary)' }}>{formatMetric(row.trust)}</td>
                  <td className="px-3 py-3.5 text-right" style={{ color: 'var(--text-primary)' }}>{formatMetric(row.consensus)}</td>
                  <td className="px-3 py-3.5 text-right" style={{ color: 'var(--text-primary)' }}>{formatMetric(row.incentive)}</td>
                  <td className="px-3 py-3.5 text-right" style={{ color: 'var(--text-primary)' }}>{formatMetric(row.dividends)}</td>
                  <td className="px-3 py-3.5 text-right" style={{ color: 'var(--text-primary)' }}>{formatEmission(row.emission)}</td>
                  <td className="px-3 py-3.5 font-mono text-[11px]" style={{ color: row.axon ? 'var(--text-primary)' : 'var(--text-tertiary)' }}>{row.axon ?? 'Not serving'}</td>
                  <td className="px-3 py-3.5"><CopyKey value={row.hotkey} label="hotkey" /></td>
                  <td className="px-3 py-3.5"><CopyKey value={row.coldkey} label="coldkey" /></td>
                  <td className="px-3 py-3.5 text-right" style={{ color: 'var(--text-primary)' }}>{formatMetric(row.rank)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {!loading && visibleRows.length === 0 && (
            <div className="px-6 py-16 text-center text-sm" style={{ color: 'var(--text-secondary)' }}>
              {rows.length === 0 ? 'No active validators were returned by the latest metagraph.' : 'No validators match this search.'}
            </div>
          )}
          {loading && (
            <div className="flex items-center justify-center gap-2 px-6 py-16 text-sm" style={{ color: 'var(--text-secondary)' }}>
              <RefreshCw className="h-4 w-4 animate-spin" />
              Reading the latest metagraph…
            </div>
          )}
        </div>}
      </div>
    </section>
  )
}
