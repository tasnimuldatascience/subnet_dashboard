'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { CheckCircle2, CircleDot, Search, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatDateTime, shortHotkey } from '@/lib/admin-format'

type SubmittedLeadStatus =
  | 'all'
  | 'committed'
  | 'approved'
  | 'denied'
  | 'pending'
  | 'fulfilled'
type ChartRange = '24h' | '7d' | '30d' | 'all'
type SelectedDateRange = ChartRange | 'custom'
type VisualMode = 'chart' | 'table'
type MinerMetricMode = 'total' | 'outcome'

export interface AdminSubmittedLead {
  leadId: string
  submissionId: string
  requestId: string
  requestLabel: string | null
  clientCompany: string | null
  minerHotkey: string
  submittedAt: string | null
  activityAt: string | null
  revealed: boolean
  status: Exclude<SubmittedLeadStatus, 'all' | 'fulfilled'>
  fulfilled: boolean
  company: string | null
  contact: string | null
  email: string | null
  role: string | null
  country: string | null
  score: number | null
  intentScore: number | null
  repScore: number | null
  icpFit: boolean | null
  tier2Passed: boolean | null
  intentDetails: string | null
  consensusAt: string | null
  rejectionReason: string | null
  rejectionDetail: string | null
  requestIcp: Record<string, unknown> | null
  leadData: Record<string, unknown>
}

export interface SubmittedLeadDailyBucket {
  date: string
  submitted: number
  committed: number
  approved: number
  denied: number
  pending: number
  fulfilled: number
}

export interface MinerDailyBucket {
  date: string
  minerHotkey: string
  count: number
  committed: number
  approved: number
  denied: number
  pending: number
  fulfilled: number
}

export interface RejectionDailyBucket {
  date: string
  reason: string
  count: number
}

export interface AdminSubmittedLeadsPayload {
  leads: AdminSubmittedLead[]
  daily: SubmittedLeadDailyBucket[]
  rejectionDaily: RejectionDailyBucket[]
  rejectTypes: Array<{ reason: string; count: number }>
  minerDaily: MinerDailyBucket[]
  minerHotkeys: Array<{ hotkey: string; count: number }>
  requestOptions: Array<{
    requestId: string
    label: string
    company: string | null
  }>
  stats: {
    submissions?: number
    submitted: number
    committed: number
    approved: number
    denied: number
    pending: number
    fulfilled: number
  }
  page: number
  pageSize: number
  totalFiltered: number
  totalPages: number
  maxSubmissions: number
  fetchedAt: string
}

const FILTERS: Array<{ key: SubmittedLeadStatus; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'committed', label: 'Never revealed' },
  { key: 'approved', label: 'Approved' },
  { key: 'denied', label: 'Denied' },
  { key: 'pending', label: 'Awaiting validation' },
  { key: 'fulfilled', label: 'Fulfilled' },
]

const CHART_RANGES: Array<{ key: ChartRange; label: string }> = [
  { key: '24h', label: '24 hours' },
  { key: '7d', label: '1 week' },
  { key: '30d', label: '30 days' },
  { key: 'all', label: 'All time' },
]

function dash(value: string | null | undefined): string {
  return value || '—'
}

function score(value: number | null): string {
  return typeof value === 'number' ? value.toFixed(1) : '—'
}

function truncateHotkey(value: string): string {
  if (!value || value.length <= 12) return value || 'unknown'
  return `${value.slice(0, 6)}...${value.slice(-4)}`
}

function defaultDateRange(payload: AdminSubmittedLeadsPayload | null): {
  from: string
  to: string
} {
  const allDates = [
    ...(payload?.daily ?? []).map((row) => row.date),
    ...(payload?.rejectionDaily ?? []).map((row) => row.date),
    ...(payload?.minerDaily ?? []).map((row) => row.date),
  ]
    .filter(Boolean)
    .sort()
  const newest = allDates[allDates.length - 1]
  if (!newest) return { from: '', to: '' }
  const end = new Date(`${newest}T00:00:00.000Z`)
  const start = new Date(end)
  start.setUTCDate(end.getUTCDate() - 6)
  return { from: start.toISOString().slice(0, 10), to: newest }
}

function statusLabel(lead: AdminSubmittedLead): string {
  if (lead.fulfilled) return 'Fulfilled'
  if (lead.status === 'committed') return 'Never revealed'
  if (lead.status === 'pending') return 'Awaiting validation'
  return lead.status
}

function StatusPill({ lead }: { lead: AdminSubmittedLead }) {
  if (lead.fulfilled) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-gold-soft bg-gold-soft px-2 py-0.5 text-[9px] font-medium uppercase tracking-[0.12em] text-gold">
        <CheckCircle2 className="h-3 w-3" />
        Fulfilled
      </span>
    )
  }

  const cls =
    lead.status === 'approved'
      ? 'border-cream-soft bg-cream-soft text-cream'
      : lead.status === 'denied'
        ? 'border-burgundy-soft bg-burgundy-soft text-burgundy'
        : lead.status === 'committed'
          ? 'border-white/10 text-white/60'
          : 'border-amber-warm-soft bg-amber-warm-soft text-amber-warm'
  const Icon = lead.status === 'denied' ? XCircle : CircleDot

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-medium uppercase tracking-[0.12em]',
        cls,
      )}
    >
      <Icon className="h-3 w-3" />
      {statusLabel(lead)}
    </span>
  )
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: Array<{ name: string; value: number; color: string }>
  label?: string
}) {
  if (!active || !payload?.length) return null
  const sortedPayload = [...payload].sort((a, b) => {
    const byValue = (b.value ?? 0) - (a.value ?? 0)
    return byValue !== 0 ? byValue : a.name.localeCompare(b.name)
  })
  return (
    <div
      className="rounded-lg border px-3 py-2 text-xs shadow-xl"
      style={{
        borderColor: 'var(--surface-border)',
        background: 'var(--surface)',
        color: 'var(--text-primary)',
      }}
    >
      <div className="mb-1 font-medium">{label}</div>
      <div className="space-y-0.5">
        {sortedPayload.map((entry) => (
          <div key={entry.name} className="flex items-center justify-between gap-5">
            <span style={{ color: entry.color }}>{entry.name}</span>
            <span className="tabular-nums">{entry.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function ViewToggle({
  value,
  onChange,
}: {
  value: VisualMode
  onChange: (value: VisualMode) => void
}) {
  return (
    <div
      className="inline-flex rounded-full border p-0.5"
      style={{
        borderColor: 'var(--surface-border)',
        background: 'var(--surface-elevated)',
      }}
    >
      {(['chart', 'table'] as const).map((mode) => (
        <button
          key={mode}
          type="button"
          onClick={() => onChange(mode)}
          className={cn(
            'rounded-full px-2.5 py-1 text-[11px] font-medium capitalize transition-colors',
            value === mode ? 'bg-gold-soft text-gold' : 'text-white/55 hover:text-white',
          )}
        >
          {mode}
        </button>
      ))}
    </div>
  )
}

function CompactDataTable({
  columns,
  rows,
}: {
  columns: string[]
  rows: Array<Array<string | number>>
}) {
  return (
    <div className="max-h-[320px] overflow-auto rounded-lg border" style={{ borderColor: 'var(--surface-border)' }}>
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr style={{ background: 'var(--surface-elevated)' }}>
            {columns.map((column) => (
              <th
                key={column}
                className="sticky top-0 px-3 py-2 text-left text-[10px] uppercase tracking-[0.14em]"
                style={{
                  background: 'var(--surface-elevated)',
                  color: 'var(--text-tertiary)',
                  borderBottom: '1px solid var(--surface-border)',
                }}
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIdx) => (
            <tr key={rowIdx} className="hover-bg-warm">
              {row.map((cell, cellIdx) => (
                <td
                  key={cellIdx}
                  className="px-3 py-2 align-top tabular-nums"
                  style={{
                    color: cellIdx === 0 ? 'var(--text-primary)' : 'var(--text-secondary)',
                    borderBottom: '1px solid var(--surface-border)',
                  }}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td
                colSpan={columns.length}
                className="px-3 py-8 text-center text-sm"
                style={{ color: 'var(--text-secondary)' }}
              >
                No rows for the current filters.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

export function AdminSubmittedLeads({
  payload,
  error,
}: {
  payload: AdminSubmittedLeadsPayload | null
  error: string | null
}) {
  const initialRange = defaultDateRange(payload)
  const [data, setData] = useState<AdminSubmittedLeadsPayload | null>(payload)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<SubmittedLeadStatus>('all')
  const [rejectReasonFilter, setRejectReasonFilter] = useState('')
  const [requestId, setRequestId] = useState('all')
  const [minerHotkey, setMinerHotkey] = useState('all')
  const [dateFrom, setDateFrom] = useState(initialRange.from)
  const [dateTo, setDateTo] = useState(initialRange.to)
  const [dateRange, setDateRange] = useState<SelectedDateRange>('7d')
  const [visualMode, setVisualMode] = useState<VisualMode>('chart')
  const [rejectType, setRejectType] = useState('all')
  const [minerMetricMode, setMinerMetricMode] = useState<MinerMetricMode>('total')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(error)
  const [selectedLead, setSelectedLead] = useState<AdminSubmittedLead | null>(null)
  const [refreshNonce, setRefreshNonce] = useState(0)
  const lastForcedRefresh = useRef(0)

  useEffect(() => {
    setPage(1)
  }, [query, filter, rejectReasonFilter, requestId, minerHotkey, dateFrom, dateTo])

  useEffect(() => {
    const onRefresh = () => setRefreshNonce(Date.now())
    window.addEventListener('leadpoet-admin-refresh', onRefresh)
    return () => window.removeEventListener('leadpoet-admin-refresh', onRefresh)
  }, [])

  useEffect(() => {
    let cancelled = false
    const timeout = window.setTimeout(() => {
      setLoading(true)
      setLoadError(null)
      const forceRefresh =
        refreshNonce > 0 && refreshNonce !== lastForcedRefresh.current
      const params = new URLSearchParams({
        page: String(page),
        pageSize: '50',
        status: filter,
        q: query,
        rejectReason: rejectReasonFilter,
        requestId,
        minerHotkey,
        from: dateFrom,
        to: dateTo,
      })
      if (forceRefresh) {
        params.set('refresh', '1')
        lastForcedRefresh.current = refreshNonce
      }
      fetch(`/api/admin/fulfillment-submissions?${params.toString()}`, {
        cache: 'no-store',
      })
        .then(async (res) => {
          const body = await res.json().catch(() => ({}))
          if (!res.ok) throw new Error(body.error || `Request failed: ${res.status}`)
          if (!cancelled) setData(body as AdminSubmittedLeadsPayload)
        })
        .catch((e) => {
          if (!cancelled) setLoadError(e instanceof Error ? e.message : 'Failed to load leads')
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }, 250)

    return () => {
      cancelled = true
      window.clearTimeout(timeout)
    }
  }, [page, query, filter, rejectReasonFilter, requestId, minerHotkey, dateFrom, dateTo, refreshNonce])

  const leads = useMemo(() => data?.leads ?? [], [data?.leads])

  const counts = data?.stats ?? {
    submitted: 0,
    committed: 0,
    approved: 0,
    denied: 0,
    pending: 0,
    fulfilled: 0,
  }
  const exportHref = useMemo(() => {
    const params = new URLSearchParams({
      export: 'csv',
      status: filter,
      q: query,
      rejectReason: rejectReasonFilter,
      requestId,
      minerHotkey,
      from: dateFrom,
      to: dateTo,
    })
    return `/api/admin/fulfillment-submissions?${params.toString()}`
  }, [filter, query, rejectReasonFilter, requestId, minerHotkey, dateFrom, dateTo])
  const submissionsChartExportHref = useMemo(() => {
    const params = new URLSearchParams({
      export: 'submissions-by-day',
      requestId,
      minerHotkey,
      from: dateFrom,
      to: dateTo,
    })
    return `/api/admin/fulfillment-submissions?${params.toString()}`
  }, [requestId, minerHotkey, dateFrom, dateTo])
  const rejectsChartExportHref = useMemo(() => {
    const params = new URLSearchParams({
      export: 'rejects-by-day',
      requestId,
      minerHotkey,
      from: dateFrom,
      to: dateTo,
    })
    return `/api/admin/fulfillment-submissions?${params.toString()}`
  }, [requestId, minerHotkey, dateFrom, dateTo])
  const minerChartExportHref = useMemo(() => {
    const params = new URLSearchParams({
      export: 'miner-submissions-by-day',
      requestId,
      minerHotkey,
      from: dateFrom,
      to: dateTo,
    })
    return `/api/admin/fulfillment-submissions?${params.toString()}`
  }, [requestId, minerHotkey, dateFrom, dateTo])
  const chartData = useMemo(() => data?.daily ?? [], [data?.daily])
  function applyDateRange(range: ChartRange) {
    setDateRange(range)
    if (range === 'all') {
      setDateFrom('')
      setDateTo('')
      return
    }
    const allDates = [
      ...(data?.daily ?? []).map((row) => row.date),
      ...(data?.rejectionDaily ?? []).map((row) => row.date),
      ...(data?.minerDaily ?? []).map((row) => row.date),
    ]
      .filter(Boolean)
      .sort()
    const newest = allDates[allDates.length - 1]
    if (!newest) return
    const days = range === '24h' ? 1 : range === '7d' ? 7 : 30
    const end = new Date(`${newest}T00:00:00.000Z`)
    const start = new Date(end)
    start.setUTCDate(end.getUTCDate() - (days - 1))
    setDateFrom(start.toISOString().slice(0, 10))
    setDateTo(newest)
  }
  const rejectReasonsToShow = useMemo(() => {
    if (rejectType === '__all_types__') {
      return (data?.rejectTypes ?? []).map((item) => item.reason)
    }
    if (rejectType !== 'all') return [rejectType]
    const top = (data?.rejectTypes ?? []).slice(0, 8).map((item) => item.reason)
    return (data?.rejectTypes ?? []).length > top.length
      ? [...top, 'Other reject types']
      : top
  }, [data?.rejectTypes, rejectType])
  const rejectChartData = useMemo(() => {
    const rows = data?.rejectionDaily ?? []
    const topReasons =
      rejectType === 'all'
        ? new Set(rejectReasonsToShow.filter((reason) => reason !== 'Other reject types'))
        : new Set(rejectReasonsToShow)
    const byDate = new Map<string, Record<string, string | number>>()
    for (const row of rows) {
      const reason =
        rejectType === 'all' && !topReasons.has(row.reason)
          ? 'Other reject types'
          : row.reason
      if (!topReasons.has(reason) && reason !== 'Other reject types') continue
      const bucket = byDate.get(row.date) ?? { date: row.date }
      bucket[reason] = ((bucket[reason] as number | undefined) ?? 0) + row.count
      byDate.set(row.date, bucket)
    }
    return Array.from(byDate.values()).sort((a, b) =>
      String(a.date) < String(b.date) ? -1 : 1,
    )
  }, [data?.rejectionDaily, rejectReasonsToShow, rejectType])
  const rejectTableRows = useMemo(() => {
    const rows = data?.rejectionDaily ?? []
    const topReasons =
      rejectType === 'all'
        ? new Set(rejectReasonsToShow.filter((reason) => reason !== 'Other reject types'))
        : new Set(rejectReasonsToShow)
    const grouped = new Map<string, number>()
    for (const row of rows) {
      const reason =
        rejectType === 'all' && !topReasons.has(row.reason)
          ? 'Other reject types'
          : row.reason
      if (!topReasons.has(reason) && reason !== 'Other reject types') continue
      const key = `${row.date}|||${reason}`
      grouped.set(key, (grouped.get(key) ?? 0) + row.count)
    }
    return Array.from(grouped.entries())
      .map(([key, count]) => {
        const [date, reason] = key.split('|||')
        return { date, reason, count }
      })
      .sort((a, b) => {
        if (a.date !== b.date) return a.date < b.date ? -1 : 1
        const byCount = b.count - a.count
        return byCount !== 0 ? byCount : a.reason.localeCompare(b.reason)
      })
  }, [data?.rejectionDaily, rejectReasonsToShow, rejectType])
  const minerHotkeysToShow = useMemo(() => {
    if (minerHotkey !== 'all') return [minerHotkey]
    const top = (data?.minerHotkeys ?? []).slice(0, 10).map((item) => item.hotkey)
    return (data?.minerHotkeys ?? []).length > top.length
      ? [...top, 'Other hotkeys']
      : top
  }, [data?.minerHotkeys, minerHotkey])
  const minerChartData = useMemo(() => {
    const rows = data?.minerDaily ?? []
    const topHotkeys =
      minerHotkey === 'all'
        ? new Set(minerHotkeysToShow.filter((hotkey) => hotkey !== 'Other hotkeys'))
        : new Set(minerHotkeysToShow)
    const byDate = new Map<string, Record<string, string | number>>()
    for (const row of rows) {
      const key =
        minerHotkey === 'all' && !topHotkeys.has(row.minerHotkey)
          ? 'Other hotkeys'
          : row.minerHotkey
      if (!topHotkeys.has(key) && key !== 'Other hotkeys') continue
      const bucket = byDate.get(row.date) ?? { date: row.date }
      if (minerMetricMode === 'total') {
        bucket[key] = ((bucket[key] as number | undefined) ?? 0) + row.count
      } else {
        bucket[`${key} · Approved`] =
          ((bucket[`${key} · Approved`] as number | undefined) ?? 0) + row.approved
        bucket[`${key} · Denied`] =
          ((bucket[`${key} · Denied`] as number | undefined) ?? 0) + row.denied
        bucket[`${key} · Fulfilled`] =
          ((bucket[`${key} · Fulfilled`] as number | undefined) ?? 0) + row.fulfilled
        bucket[`${key} · Awaiting validation`] =
          ((bucket[`${key} · Awaiting validation`] as number | undefined) ?? 0) + row.pending
        bucket[`${key} · Never revealed`] =
          ((bucket[`${key} · Never revealed`] as number | undefined) ?? 0) + row.committed
      }
      byDate.set(row.date, bucket)
    }
    return Array.from(byDate.values()).sort((a, b) =>
      String(a.date) < String(b.date) ? -1 : 1,
    )
  }, [data?.minerDaily, minerHotkey, minerHotkeysToShow, minerMetricMode])
  const minerTableRows = useMemo(() => {
    const rows = data?.minerDaily ?? []
    const topHotkeys =
      minerHotkey === 'all'
        ? new Set(minerHotkeysToShow.filter((hotkey) => hotkey !== 'Other hotkeys'))
        : new Set(minerHotkeysToShow)
    const grouped = new Map<string, {
      count: number
      committed: number
      approved: number
      denied: number
      pending: number
      fulfilled: number
    }>()
    for (const row of rows) {
      const keyName =
        minerHotkey === 'all' && !topHotkeys.has(row.minerHotkey)
          ? 'Other hotkeys'
          : row.minerHotkey
      if (!topHotkeys.has(keyName) && keyName !== 'Other hotkeys') continue
      const key = `${row.date}|||${keyName}`
      const bucket =
        grouped.get(key) ??
        { count: 0, committed: 0, approved: 0, denied: 0, pending: 0, fulfilled: 0 }
      bucket.count += row.count
      bucket.committed += row.committed
      bucket.approved += row.approved
      bucket.denied += row.denied
      bucket.pending += row.pending
      bucket.fulfilled += row.fulfilled
      grouped.set(key, bucket)
    }
    return Array.from(grouped.entries())
      .map(([key, values]) => {
        const [date, hotkey] = key.split('|||')
        return { date, hotkey, ...values }
      })
      .sort((a, b) => (a.date === b.date ? a.hotkey.localeCompare(b.hotkey) : a.date < b.date ? -1 : 1))
  }, [data?.minerDaily, minerHotkey, minerHotkeysToShow])

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div className="flex items-baseline gap-3 flex-wrap">
          <h1
            className="text-2xl font-medium tracking-tight"
            style={{ color: 'var(--text-primary)' }}
          >
            Submitted Leads
          </h1>
          <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
            Every lead submission, split between never-revealed commitments and revealed leads awaiting validator consensus.
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
          <Tile label="Submitted" value={counts.submitted} />
          <Tile label="Never revealed" value={counts.committed} />
          <Tile label="Approved" value={counts.approved} accent="cream" />
          <Tile label="Denied" value={counts.denied} accent="burgundy" />
          <Tile label="Awaiting validation" value={counts.pending} accent="amber" />
          <Tile label="Fulfilled" value={counts.fulfilled} accent="gold" />
        </div>
      </section>

      {loadError ? (
        <div className="rounded-xl border border-burgundy-soft bg-burgundy-soft p-4 text-sm text-burgundy">
          {loadError}
        </div>
      ) : null}

      <section
        className="grid gap-3 rounded-xl border p-3 lg:grid-cols-[minmax(220px,1fr)_minmax(180px,240px)_150px_150px_auto_auto]"
        style={{ borderColor: 'var(--surface-border)', background: 'var(--surface)' }}
      >
        <label className="block">
          <span
            className="mb-1 block text-[10px] uppercase tracking-[0.14em]"
            style={{ color: 'var(--text-tertiary)' }}
          >
            Request
          </span>
          <select
            value={requestId}
            onChange={(e) => setRequestId(e.target.value)}
            className="premium-focus w-full rounded-lg border bg-transparent px-3 py-2 text-sm"
            style={{
              borderColor: 'var(--surface-border)',
              color: 'var(--text-primary)',
              background: 'var(--surface-elevated)',
            }}
          >
            <option value="all">All requests</option>
            {(data?.requestOptions ?? []).map((request) => (
              <option key={request.requestId} value={request.requestId}>
                {request.label}
                {request.company ? ` · ${request.company}` : ''}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span
            className="mb-1 block text-[10px] uppercase tracking-[0.14em]"
            style={{ color: 'var(--text-tertiary)' }}
          >
            Miner hotkey
          </span>
          <select
            value={minerHotkey}
            onChange={(e) => setMinerHotkey(e.target.value)}
            className="premium-focus w-full rounded-lg border bg-transparent px-3 py-2 text-sm"
            style={{
              borderColor: 'var(--surface-border)',
              color: 'var(--text-primary)',
              background: 'var(--surface-elevated)',
            }}
          >
            <option value="all">All hotkeys</option>
            {(data?.minerHotkeys ?? []).map((item) => (
              <option key={item.hotkey} value={item.hotkey}>
                {truncateHotkey(item.hotkey)} ({item.count})
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span
            className="mb-1 block text-[10px] uppercase tracking-[0.14em]"
            style={{ color: 'var(--text-tertiary)' }}
          >
            From
          </span>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => {
              setDateFrom(e.target.value)
              setDateRange('custom')
            }}
            className="premium-focus w-full rounded-lg border bg-transparent px-3 py-2 text-sm"
            style={{
              borderColor: 'var(--surface-border)',
              color: 'var(--text-primary)',
              background: 'var(--surface-elevated)',
            }}
          />
        </label>

        <label className="block">
          <span
            className="mb-1 block text-[10px] uppercase tracking-[0.14em]"
            style={{ color: 'var(--text-tertiary)' }}
          >
            To
          </span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => {
              setDateTo(e.target.value)
              setDateRange('custom')
            }}
            className="premium-focus w-full rounded-lg border bg-transparent px-3 py-2 text-sm"
            style={{
              borderColor: 'var(--surface-border)',
              color: 'var(--text-primary)',
              background: 'var(--surface-elevated)',
            }}
          />
        </label>

        <div className="flex flex-col justify-end gap-2">
          <span
            className="text-[10px] uppercase tracking-[0.14em]"
            style={{ color: 'var(--text-tertiary)' }}
          >
            Date range
          </span>
          <div className="flex flex-wrap gap-1">
            {CHART_RANGES.map((range) => (
              <button
                key={range.key}
                type="button"
                onClick={() => applyDateRange(range.key)}
                className={cn(
                  'rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
                  dateRange === range.key
                    ? 'bg-gold-tint border-gold-strong text-gold'
                    : 'border-white/[0.06] hover-bg-warm text-white/55',
                )}
              >
                {range.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-end gap-2">
          <ViewToggle value={visualMode} onChange={setVisualMode} />
          <button
            type="button"
            onClick={() => {
              setRequestId('all')
              setDateFrom('')
              setDateTo('')
              setQuery('')
              setFilter('all')
              setRejectReasonFilter('')
              setMinerHotkey('all')
              setDateRange('all')
            }}
            className="rounded-lg border px-3 py-2 text-sm"
            style={{
              borderColor: 'var(--surface-border)',
              color: 'var(--text-secondary)',
              background: 'var(--surface-elevated)',
            }}
          >
            Clear
          </button>
        </div>
      </section>

      <section
        className="rounded-xl border p-4"
        style={{ borderColor: 'var(--surface-border)', background: 'var(--surface)' }}
      >
        <div className="mb-3 flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
              Submissions by day
            </h2>
            <p className="mt-1 text-xs" style={{ color: 'var(--text-tertiary)' }}>
              Never-revealed commitments and awaiting-validation leads by submit date; approved, denied, and fulfilled activity by consensus date.
            </p>
          </div>
          <div className="flex flex-col items-start gap-2 sm:items-end">
            <a
              href={submissionsChartExportHref}
              className="rounded-full border border-gold-soft bg-gold-soft px-2.5 py-1 text-[11px] font-medium text-gold"
            >
              Export chart CSV
            </a>
            {data?.fetchedAt && (
              <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                Fetched {formatDateTime(data.fetchedAt)}
              </span>
            )}
          </div>
        </div>
        {visualMode === 'chart' ? (
          <div className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid stroke="rgba(245,240,232,0.06)" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }}
                  axisLine={{ stroke: 'var(--surface-border)' }}
                  tickLine={false}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(201,169,110,0.06)' }} />
                <Legend wrapperStyle={{ fontSize: 11, color: 'var(--text-secondary)' }} />
                <Bar dataKey="committed" stackId="submitted" name="Never revealed" fill="rgba(245,240,232,0.24)" />
                <Bar dataKey="approved" stackId="submitted" name="Approved" fill="#e8e1d4" />
                <Bar dataKey="denied" stackId="submitted" name="Denied" fill="#a8746f" />
                <Bar dataKey="pending" stackId="submitted" name="Awaiting validation" fill="#cf9d61" />
                <Bar dataKey="fulfilled" name="Fulfilled" fill="#c9a96e" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <CompactDataTable
            columns={['Date', 'Submitted', 'Never revealed', 'Approved', 'Denied', 'Awaiting validation', 'Fulfilled']}
            rows={chartData.map((row) => [
              row.date,
              row.submitted,
              row.committed,
              row.approved,
              row.denied,
              row.pending,
              row.fulfilled,
            ])}
          />
        )}
      </section>

      <section
        className="rounded-xl border p-4"
        style={{ borderColor: 'var(--surface-border)', background: 'var(--surface)' }}
      >
        <div className="mb-3 flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
              Reject types by day
            </h2>
            <p className="mt-1 text-xs" style={{ color: 'var(--text-tertiary)' }}>
              Rejection reasons grouped by scored date. Uses the same request/date filters as the submitted-leads table.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="block">
              <span
                className="mb-1 block text-[10px] uppercase tracking-[0.14em]"
                style={{ color: 'var(--text-tertiary)' }}
              >
                Reject type
              </span>
              <select
                value={rejectType}
                onChange={(e) => setRejectType(e.target.value)}
                className="premium-focus rounded-lg border bg-transparent px-3 py-1.5 text-xs"
                style={{
                  borderColor: 'var(--surface-border)',
                  color: 'var(--text-primary)',
                  background: 'var(--surface-elevated)',
                }}
              >
                <option value="all">Top reject types</option>
                <option value="__all_types__">Show all reject types</option>
                {(data?.rejectTypes ?? []).map((item) => (
                  <option key={item.reason} value={item.reason}>
                    {item.reason} ({item.count})
                  </option>
                ))}
              </select>
            </label>
            <a
              href={rejectsChartExportHref}
              className="rounded-lg border border-gold-soft bg-gold-soft px-3 py-1.5 text-xs font-medium text-gold"
            >
              Export chart CSV
            </a>
          </div>
        </div>
        {visualMode === 'chart' ? (
          <div className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rejectChartData}>
                <CartesianGrid stroke="rgba(245,240,232,0.06)" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }}
                  axisLine={{ stroke: 'var(--surface-border)' }}
                  tickLine={false}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(201,169,110,0.06)' }} />
                {rejectType !== '__all_types__' && (
                  <Legend wrapperStyle={{ fontSize: 11, color: 'var(--text-secondary)' }} />
                )}
                {rejectReasonsToShow.map((reason, idx) => (
                  <Bar
                    key={reason}
                    dataKey={reason}
                    stackId="rejects"
                    name={reason}
                    fill={[
                      '#a8746f',
                      '#c78f72',
                      '#cf9d61',
                      '#8f6f6a',
                      '#b88984',
                      '#d4a373',
                      '#9d6b66',
                      '#c9a96e',
                    ][idx % 8]}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <CompactDataTable
            columns={['Date', 'Reject type', 'Count']}
            rows={rejectTableRows.map((row) => [row.date, row.reason, row.count])}
          />
        )}
      </section>

      <section
        className="rounded-xl border p-4"
        style={{ borderColor: 'var(--surface-border)', background: 'var(--surface)' }}
      >
        <div className="mb-3 flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
              Miner submissions by day
            </h2>
            <p className="mt-1 text-xs" style={{ color: 'var(--text-tertiary)' }}>
              Lead submission volume grouped by miner hotkey. Uses the same request/date filters as the table.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="block">
              <span
                className="mb-1 block text-[10px] uppercase tracking-[0.14em]"
                style={{ color: 'var(--text-tertiary)' }}
              >
                Metric
              </span>
              <select
                value={minerMetricMode}
                onChange={(e) => setMinerMetricMode(e.target.value as MinerMetricMode)}
                className="premium-focus rounded-lg border bg-transparent px-3 py-1.5 text-xs"
                style={{
                  borderColor: 'var(--surface-border)',
                  color: 'var(--text-primary)',
                  background: 'var(--surface-elevated)',
                }}
              >
                <option value="total">Total submissions</option>
                <option value="outcome">Accepted / rejected / fulfilled</option>
              </select>
            </label>
            <a
              href={minerChartExportHref}
              className="rounded-lg border border-gold-soft bg-gold-soft px-3 py-1.5 text-xs font-medium text-gold"
            >
              Export chart CSV
            </a>
          </div>
        </div>
        {visualMode === 'chart' ? (
          <div className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={minerChartData}>
                <CartesianGrid stroke="rgba(245,240,232,0.06)" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }}
                  axisLine={{ stroke: 'var(--surface-border)' }}
                  tickLine={false}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(201,169,110,0.06)' }} />
                <Legend
                  wrapperStyle={{ fontSize: 11, color: 'var(--text-secondary)' }}
                  formatter={(value) =>
                    value === 'Other hotkeys' ? value : truncateHotkey(String(value))
                  }
                />
                {minerMetricMode === 'total'
                  ? minerHotkeysToShow.map((hotkey, idx) => (
                      <Bar
                        key={hotkey}
                        dataKey={hotkey}
                        stackId="miners"
                        name={hotkey}
                        fill={[
                          '#c9a96e',
                          '#e8e1d4',
                          '#cf9d61',
                          '#a8746f',
                          '#8f6f6a',
                          '#d4a373',
                          '#b88984',
                          '#9d6b66',
                          '#bfa06a',
                          '#f0d9a0',
                          'rgba(245,240,232,0.24)',
                        ][idx % 11]}
                      />
                    ))
                  : minerHotkeysToShow.flatMap((hotkey, idx) =>
                      [
                        ['Approved', '#e8e1d4'],
                        ['Denied', '#a8746f'],
                        ['Fulfilled', '#c9a96e'],
                        ['Awaiting validation', '#cf9d61'],
                        ['Never revealed', 'rgba(245,240,232,0.24)'],
                      ].map(([outcome, color]) => (
                        <Bar
                          key={`${hotkey}-${outcome}`}
                          dataKey={`${hotkey} · ${outcome}`}
                          stackId={`${idx}-${hotkey}`}
                          name={`${hotkey} · ${outcome}`}
                          fill={color}
                        />
                      )),
                    )}
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <CompactDataTable
            columns={['Date', 'Miner hotkey', 'Short', 'Submissions', 'Approved', 'Denied', 'Fulfilled', 'Awaiting validation', 'Never revealed']}
            rows={minerTableRows.map((row) => [
              row.date,
              row.hotkey,
              row.hotkey === 'Other hotkeys' ? row.hotkey : truncateHotkey(row.hotkey),
              row.count,
              row.approved,
              row.denied,
              row.fulfilled,
              row.pending,
              row.committed,
            ])}
          />
        )}
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            Table filters
          </h2>
          <p className="mt-1 text-xs" style={{ color: 'var(--text-tertiary)' }}>
            These controls filter the table below and the table CSV export.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
          {FILTERS.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setFilter(item.key)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all whitespace-nowrap border',
                filter === item.key
                  ? 'bg-gold-tint border-gold-strong text-gold'
                  : 'border-white/[0.06] hover-bg-warm text-white/55',
              )}
            >
              {item.label}
              <span className="tabular-nums text-[10px] opacity-70">
                {item.key === 'all'
                  ? counts.submitted
                  : item.key === 'fulfilled'
                    ? counts.fulfilled
                    : counts[item.key]}
              </span>
            </button>
          ))}
        </div>
        <div className="relative min-w-[220px]">
          <input
            type="text"
            list="reject-reason-options"
            value={rejectReasonFilter}
            onChange={(e) => setRejectReasonFilter(e.target.value)}
            placeholder="Filter reject type..."
            className="premium-focus w-full rounded-lg border px-3 py-2 text-sm placeholder:text-white/30 bg-transparent"
            style={{
              borderColor: 'var(--surface-border)',
              background: 'var(--surface)',
              color: 'var(--text-primary)',
            }}
          />
          <datalist id="reject-reason-options">
            {(data?.rejectTypes ?? []).map((item) => (
              <option key={item.reason} value={item.reason}>
                {item.count}
              </option>
            ))}
          </datalist>
        </div>
        <div className="relative flex-1 max-w-md sm:ml-auto">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5"
            style={{ color: 'var(--text-tertiary)' }}
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search company, contact, miner, request..."
            className="premium-focus w-full rounded-lg border px-9 py-2 text-sm placeholder:text-white/30 bg-transparent"
            style={{
              borderColor: 'var(--surface-border)',
              background: 'var(--surface)',
              color: 'var(--text-primary)',
            }}
          />
        </div>
        <a
          href={exportHref}
          className="inline-flex items-center justify-center rounded-lg border border-gold-strong bg-gold-soft px-3 py-2 text-sm font-medium text-gold transition-colors hover:bg-gold-tint"
        >
          Export table CSV
        </a>
        </div>
      </section>

      <section
        className="rounded-xl border overflow-hidden"
        style={{ borderColor: 'var(--surface-border)', background: 'var(--surface)' }}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr style={{ background: 'var(--surface-elevated)' }}>
                {[
                  'Status',
                  'Lead',
                  'Company',
                  'Role',
                  'Request',
                  'Miner',
                  'Score',
                  'Reject reason',
                  'Activity',
                ].map((header) => (
                  <th
                    key={header}
                    className="px-2 py-2 text-left text-[9px] uppercase tracking-[0.14em] font-medium border-b whitespace-nowrap"
                    style={{
                      borderColor: 'var(--surface-border)',
                      color: 'var(--text-tertiary)',
                    }}
                  >
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {leads.map((lead) => (
                <tr
                  key={`${lead.submissionId}:${lead.leadId}`}
                  onClick={() => setSelectedLead(lead)}
                  className="hover-bg-warm cursor-pointer transition-colors"
                >
                  <td className="px-2 py-2 border-b align-top" style={{ borderColor: 'var(--surface-border)' }}>
                    <StatusPill lead={lead} />
                  </td>
                  <td className="px-2 py-2 border-b align-top min-w-[180px]" style={{ borderColor: 'var(--surface-border)', color: 'var(--text-primary)' }}>
                    <div className="truncate text-xs font-medium">{dash(lead.contact)}</div>
                    <div className="truncate text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                      {dash(lead.email)}
                    </div>
                  </td>
                  <td className="px-2 py-2 border-b align-top min-w-[170px]" style={{ borderColor: 'var(--surface-border)', color: 'var(--text-primary)' }}>
                    <div className="truncate text-xs">{dash(lead.company)}</div>
                    <div className="truncate text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                      {dash(lead.country)}
                    </div>
                  </td>
                  <td className="px-2 py-2 border-b align-top min-w-[140px] max-w-[180px]" style={{ borderColor: 'var(--surface-border)', color: 'var(--text-primary)' }}>
                    <div className="truncate text-xs">{dash(lead.role)}</div>
                  </td>
                  <td className="px-2 py-2 border-b align-top min-w-[170px] max-w-[220px]" style={{ borderColor: 'var(--surface-border)', color: 'var(--text-primary)' }}>
                    <div className="truncate text-xs">{dash(lead.requestLabel)}</div>
                    <div className="truncate text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                      {dash(lead.clientCompany)}
                    </div>
                  </td>
                  <td className="px-2 py-2 border-b align-top font-mono text-[10px] min-w-[100px]" style={{ borderColor: 'var(--surface-border)', color: 'var(--text-secondary)' }}>
                    {shortHotkey(lead.minerHotkey)}
                  </td>
                  <td className="px-2 py-2 border-b align-top tabular-nums min-w-[85px]" style={{ borderColor: 'var(--surface-border)', color: 'var(--text-primary)' }}>
                    <div className="text-xs">{score(lead.score)}</div>
                    <div className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                      intent {score(lead.intentScore)}
                    </div>
                  </td>
                  <td className="px-2 py-2 border-b align-top min-w-[160px] max-w-[220px]" style={{ borderColor: 'var(--surface-border)', color: 'var(--text-primary)' }}>
                    <div className="truncate text-xs">{lead.rejectionReason || '—'}</div>
                    {lead.rejectionDetail && (
                      <div className="truncate text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                        {lead.rejectionDetail}
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-2 border-b align-top min-w-[135px] text-xs" style={{ borderColor: 'var(--surface-border)', color: 'var(--text-primary)' }}>
                    <div>{formatDateTime(lead.activityAt)}</div>
                    {lead.consensusAt && (
                      <div className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                        consensus
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {leads.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-3 py-10 text-center text-sm" style={{ color: 'var(--text-secondary)' }}>
                    {loading ? 'Loading submitted leads...' : 'No submitted leads match the current filters.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
          Showing page {data?.page ?? page} of {data?.totalPages ?? 1} ·{' '}
          {(data?.totalFiltered ?? 0).toLocaleString()} matching leads
          {loading ? ' · loading...' : ''}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1 || loading}
            className="rounded-md border px-3 py-1.5 text-xs disabled:opacity-40"
            style={{
              borderColor: 'var(--surface-border)',
              color: 'var(--text-secondary)',
              background: 'var(--surface)',
            }}
          >
            Previous
          </button>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(data?.totalPages ?? p + 1, p + 1))}
            disabled={loading || page >= (data?.totalPages ?? 1)}
            className="rounded-md border px-3 py-1.5 text-xs disabled:opacity-40"
            style={{
              borderColor: 'var(--surface-border)',
              color: 'var(--text-secondary)',
              background: 'var(--surface)',
            }}
          >
            Next
          </button>
        </div>
      </div>

      {selectedLead && (
        <LeadDetailPanel lead={selectedLead} onClose={() => setSelectedLead(null)} />
      )}
    </div>
  )
}

function LeadDetailPanel({
  lead,
  onClose,
}: {
  lead: AdminSubmittedLead
  onClose: () => void
}) {
  const icp = lead.requestIcp ?? {}
  const submittedFields = submittedLeadFields(lead.leadData)

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80"
      onClick={onClose}
    >
      <div
        className="flex h-screen w-screen flex-col overflow-hidden border p-5 shadow-2xl"
        style={{ borderColor: 'var(--surface-border)', background: 'var(--surface-base)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="mb-4 flex flex-shrink-0 items-start justify-between gap-4 border-b pb-4"
          style={{ borderColor: 'var(--surface-border)' }}
        >
          <div>
            <h2 className="text-lg font-medium" style={{ color: 'var(--text-primary)' }}>
              {dash(lead.contact)} · {dash(lead.company)}
            </h2>
            <div className="mt-1 text-xs font-mono" style={{ color: 'var(--text-tertiary)' }}>
              {lead.leadId}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border px-3 py-1.5 text-xs"
            style={{
              borderColor: 'var(--surface-border)',
              color: 'var(--text-secondary)',
            }}
          >
            Close
          </button>
        </div>

        <div className="grid flex-shrink-0 gap-3 sm:grid-cols-4 xl:grid-cols-6">
          <Detail label="Status" value={lead.fulfilled ? 'fulfilled' : lead.status} />
          <Detail label="Request" value={dash(lead.requestLabel)} />
          <Detail label="Client" value={dash(lead.clientCompany)} />
          <Detail label="Miner" value={lead.minerHotkey} mono />
          <Detail label="Submission" value={lead.submissionId} mono />
          <Detail label="Submitted" value={formatDateTime(lead.submittedAt)} />
          <Detail label="Activity" value={formatDateTime(lead.activityAt)} />
          <Detail label="Consensus" value={formatDateTime(lead.consensusAt)} />
          <Detail label="Final score" value={score(lead.score)} />
          <Detail label="Intent score" value={score(lead.intentScore)} />
          <Detail label="Rep score" value={score(lead.repScore)} />
          <Detail label="Reject reason" value={dash(lead.rejectionReason)} />
        </div>

        <RejectionFocus lead={lead} icp={icp} />

        {lead.intentDetails && (
          <section className="mt-4 flex-shrink-0 rounded-xl border p-4" style={{ borderColor: 'var(--surface-border)' }}>
            <div className="mb-2 text-[10px] uppercase tracking-[0.14em]" style={{ color: 'var(--text-tertiary)' }}>
              Intent details
            </div>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--text-primary)' }}>
              {lead.intentDetails}
            </p>
          </section>
        )}

        <div className="mt-4 grid min-h-0 flex-1 gap-4 xl:grid-cols-2">
          <section className="min-h-0 overflow-hidden rounded-xl border" style={{ borderColor: 'var(--surface-border)', background: 'var(--surface)' }}>
            <div
              className="sticky top-0 z-10 border-b px-4 py-3"
              style={{ borderColor: 'var(--surface-border)', background: 'var(--surface)' }}
            >
              <div className="text-[10px] uppercase tracking-[0.14em]" style={{ color: 'var(--text-tertiary)' }}>
                Request ICP
              </div>
              <div className="mt-1 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                What the request asked miners to find
              </div>
            </div>
            <div className="h-full overflow-auto p-4 pb-24">
              <div className="space-y-4 text-sm">
                <IcpCompare label="Prompt" value={icp.prompt} />
                <IcpCompare label="Product / service" value={icp.product_service} />
                <IcpCompare label="Target roles" value={icp.target_roles} />
                <IcpCompare label="Role types" value={icp.target_role_types} />
                <IcpCompare label="Seniority" value={icp.target_seniority} />
                <IcpCompare label="Industries" value={icp.industry} />
                <IcpCompare label="Sub-industries" value={icp.sub_industry} />
                <IcpCompare label="Employee count" value={icp.employee_count} />
                <IcpCompare label="Countries" value={icp.country} />
                <IcpCompare label="Geography" value={icp.geography} />
                <IcpCompare label="Intent signals" value={icp.intent_signals} />
                <IcpCompare label="Required attributes" value={icp.required_attributes} />
              </div>
              <div className="mt-5">
                <div className="mb-2 text-[10px] uppercase tracking-[0.14em]" style={{ color: 'var(--text-tertiary)' }}>
                  Raw request ICP
                </div>
                <pre
                  className="max-h-[360px] overflow-auto rounded-lg p-3 text-[11px]"
                  style={{ background: 'var(--surface-base)', color: 'var(--text-secondary)' }}
                >
                  {JSON.stringify(lead.requestIcp, null, 2)}
                </pre>
              </div>
            </div>
          </section>

          <section className="min-h-0 overflow-hidden rounded-xl border" style={{ borderColor: 'var(--surface-border)', background: 'var(--surface)' }}>
            <div
              className="sticky top-0 z-10 border-b px-4 py-3"
              style={{ borderColor: 'var(--surface-border)', background: 'var(--surface)' }}
            >
              <div className="text-[10px] uppercase tracking-[0.14em]" style={{ color: 'var(--text-tertiary)' }}>
                Submitted lead
              </div>
              <div className="mt-1 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                What the miner submitted
              </div>
            </div>
            <div className="h-full overflow-auto p-4 pb-24">
              <div className="space-y-3 text-sm">
                {submittedFields.map(({ label, value }) => (
                  <IcpCompare key={label} label={label} value={value} />
                ))}
              </div>
              <div className="mt-5">
                <div className="mb-2 text-[10px] uppercase tracking-[0.14em]" style={{ color: 'var(--text-tertiary)' }}>
                  Raw submitted lead
                </div>
            <pre
              className="max-h-[420px] overflow-auto rounded-lg p-3 text-[11px]"
              style={{ background: 'var(--surface-base)', color: 'var(--text-secondary)' }}
            >
              {JSON.stringify(lead.leadData, null, 2)}
            </pre>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

function renderIcpValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === 'string') return item
        if (item && typeof item === 'object' && 'text' in item) {
          return String((item as { text?: unknown }).text ?? '')
        }
        return JSON.stringify(item)
      })
      .filter(Boolean)
      .join(', ')
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    return Object.entries(obj)
      .flatMap(([key, val]) => {
        if (!Array.isArray(val) || val.length === 0) return []
        return `${key}: ${renderIcpValue(val)}`
      })
      .join(' | ')
  }
  return typeof value === 'string' && value.trim() ? value : '—'
}

function submittedLeadFields(data: Record<string, unknown>): Array<{ label: string; value: unknown }> {
  const priority = [
    ['full_name', 'Full name'],
    ['email', 'Email'],
    ['phone', 'Phone'],
    ['role', 'Role'],
    ['role_type', 'Role type'],
    ['seniority', 'Seniority'],
    ['business', 'Company'],
    ['description', 'Description'],
    ['industry', 'Industry'],
    ['sub_industry', 'Sub-industry'],
    ['employee_count', 'Employee count'],
    ['country', 'Contact country'],
    ['state', 'Contact state'],
    ['city', 'Contact city'],
    ['company_hq_country', 'HQ country'],
    ['company_hq_state', 'HQ state'],
    ['company_hq_city', 'HQ city'],
    ['company_website', 'Company website'],
    ['company_linkedin', 'Company LinkedIn'],
    ['linkedin_url', 'Person LinkedIn'],
    ['intent_signals', 'Submitted intent signals'],
  ] as const
  const used = new Set<string>(priority.map(([key]) => key))
  const rows: Array<{ label: string; value: unknown }> = priority
    .filter(([key]) => data[key] !== undefined && data[key] !== null && data[key] !== '')
    .map(([key, label]) => ({ label, value: data[key] }))

  for (const [key, value] of Object.entries(data)) {
    if (used.has(key)) continue
    if (value === undefined || value === null || value === '') continue
    rows.push({
      label: key
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (char) => char.toUpperCase()),
      value,
    })
  }

  return rows
}

function submittedHq(data: Record<string, unknown>): string {
  return [
    data.company_hq_city,
    data.company_hq_state,
    data.company_hq_country,
  ]
    .filter(Boolean)
    .join(', ') || '—'
}

function rejectionFocus(lead: AdminSubmittedLead, icp: Record<string, unknown>): {
  expectedLabel: string
  expected: unknown
  submittedLabel: string
  submitted: unknown
} {
  const reason = lead.rejectionReason ?? ''
  const data = lead.leadData

  if (reason.includes('geography') || reason.includes('location')) {
    return {
      expectedLabel: 'Expected location',
      expected: {
        geography: icp.geography,
        countries: icp.country,
      },
      submittedLabel: 'Submitted HQ / country',
      submitted: {
        hq: submittedHq(data),
        contact_country: data.country,
      },
    }
  }
  if (reason.includes('role_type')) {
    return {
      expectedLabel: 'Expected role types',
      expected: icp.target_role_types,
      submittedLabel: 'Submitted role / role type',
      submitted: {
        role: data.role,
        role_type: data.role_type,
      },
    }
  }
  if (reason.includes('role')) {
    return {
      expectedLabel: 'Expected roles',
      expected: icp.target_roles,
      submittedLabel: 'Submitted role',
      submitted: data.role,
    }
  }
  if (reason.includes('sub_industry')) {
    return {
      expectedLabel: 'Expected sub-industries',
      expected: icp.sub_industry,
      submittedLabel: 'Submitted sub-industry',
      submitted: data.sub_industry,
    }
  }
  if (reason.includes('industry')) {
    return {
      expectedLabel: 'Expected industries',
      expected: icp.industry,
      submittedLabel: 'Submitted industry',
      submitted: data.industry,
    }
  }
  if (reason.includes('employee')) {
    return {
      expectedLabel: 'Expected employee count',
      expected: icp.employee_count,
      submittedLabel: 'Submitted employee count',
      submitted: data.employee_count,
    }
  }
  if (reason.includes('seniority')) {
    return {
      expectedLabel: 'Expected seniority',
      expected: icp.target_seniority,
      submittedLabel: 'Submitted seniority',
      submitted: data.seniority,
    }
  }
  if (reason.includes('required_attribute')) {
    return {
      expectedLabel: 'Required attributes',
      expected: icp.required_attributes,
      submittedLabel: 'Submitted lead evidence',
      submitted: {
        company: data.business,
        role: data.role,
        description: data.description,
        intent_signals: data.intent_signals,
      },
    }
  }
  if (reason.includes('email')) {
    return {
      expectedLabel: 'Expected email',
      expected: 'Valid, deliverable, person-matching email',
      submittedLabel: 'Submitted email',
      submitted: data.email,
    }
  }
  if (reason.includes('company')) {
    return {
      expectedLabel: 'Company requirements',
      expected: {
        industries: icp.industry,
        sub_industries: icp.sub_industry,
        required_attributes: icp.required_attributes,
      },
      submittedLabel: 'Submitted company',
      submitted: {
        business: data.business,
        website: data.company_website,
        linkedin: data.company_linkedin,
        description: data.description,
      },
    }
  }

  return {
    expectedLabel: 'Request target',
    expected: icp,
    submittedLabel: 'Submitted lead',
    submitted: data,
  }
}

function RejectionFocus({
  lead,
  icp,
}: {
  lead: AdminSubmittedLead
  icp: Record<string, unknown>
}) {
  const focus = rejectionFocus(lead, icp)
  return (
    <section
      className="mt-4 flex-shrink-0 rounded-xl border p-4"
      style={{ borderColor: 'rgba(168, 116, 111, 0.35)', background: 'rgba(168, 116, 111, 0.08)' }}
    >
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.14em]" style={{ color: 'var(--text-tertiary)' }}>
            Rejection focus
          </div>
          <div className="mt-1 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            {dash(lead.rejectionReason)}
          </div>
        </div>
        <div className="max-w-2xl text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          {dash(lead.rejectionDetail)}
        </div>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-lg border p-3" style={{ borderColor: 'var(--surface-border)', background: 'var(--surface)' }}>
          <IcpCompare label={focus.expectedLabel} value={focus.expected} />
        </div>
        <div className="rounded-lg border p-3" style={{ borderColor: 'var(--surface-border)', background: 'var(--surface)' }}>
          <IcpCompare label={focus.submittedLabel} value={focus.submitted} />
        </div>
      </div>
    </section>
  )
}

function IcpCompare({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[130px_minmax(0,1fr)]">
      <div className="text-[10px] uppercase tracking-[0.12em]" style={{ color: 'var(--text-tertiary)' }}>
        {label}
      </div>
      <div className="leading-relaxed" style={{ color: 'var(--text-primary)' }}>
        {renderIcpValue(value)}
      </div>
    </div>
  )
}

function Detail({
  label,
  value,
  mono,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className="rounded-lg border px-3 py-2" style={{ borderColor: 'var(--surface-border)', background: 'var(--surface-elevated)' }}>
      <div className="text-[10px] uppercase tracking-[0.12em]" style={{ color: 'var(--text-tertiary)' }}>
        {label}
      </div>
      <div
        className={cn('mt-1 break-words text-xs', mono ? 'font-mono' : '')}
        style={{ color: 'var(--text-primary)' }}
      >
        {value}
      </div>
    </div>
  )
}

function Tile({
  label,
  value,
  accent,
}: {
  label: string
  value: number
  accent?: 'gold' | 'cream' | 'amber' | 'burgundy'
}) {
  const color =
    accent === 'gold'
      ? 'var(--brand)'
      : accent === 'cream'
        ? '#e8e1d4'
        : accent === 'amber'
          ? 'var(--amber-warm)'
          : accent === 'burgundy'
            ? 'var(--burgundy)'
            : 'var(--text-primary)'

  return (
    <div
      className="rounded-xl border px-4 py-3.5"
      style={{ borderColor: 'var(--surface-border)', background: 'var(--surface)' }}
    >
      <div className="mb-1.5 text-[10px] uppercase tracking-[0.14em]" style={{ color: 'var(--text-tertiary)' }}>
        {label}
      </div>
      <div className="text-2xl font-medium leading-none tabular-nums" style={{ color }}>
        {value.toLocaleString()}
      </div>
    </div>
  )
}
