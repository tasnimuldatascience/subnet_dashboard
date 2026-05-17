'use client'

import { useEffect, useMemo, useState } from 'react'
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
  { key: 'committed', label: 'Committed' },
  { key: 'approved', label: 'Approved' },
  { key: 'denied', label: 'Denied' },
  { key: 'pending', label: 'Pending validator' },
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
      {lead.status}
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
        {payload.map((entry) => (
          <div key={entry.name} className="flex items-center justify-between gap-5">
            <span style={{ color: entry.color }}>{entry.name}</span>
            <span className="tabular-nums">{entry.value}</span>
          </div>
        ))}
      </div>
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
  const [data, setData] = useState<AdminSubmittedLeadsPayload | null>(payload)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<SubmittedLeadStatus>('all')
  const [requestId, setRequestId] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [chartRange, setChartRange] = useState<ChartRange>('all')
  const [rejectType, setRejectType] = useState('all')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(error)
  const [selectedLead, setSelectedLead] = useState<AdminSubmittedLead | null>(null)

  useEffect(() => {
    setPage(1)
  }, [query, filter, requestId, dateFrom, dateTo])

  useEffect(() => {
    let cancelled = false
    const timeout = window.setTimeout(() => {
      setLoading(true)
      setLoadError(null)
      const params = new URLSearchParams({
        page: String(page),
        pageSize: '50',
        status: filter,
        q: query,
        requestId,
        from: dateFrom,
        to: dateTo,
      })
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
  }, [page, query, filter, requestId, dateFrom, dateTo])

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
      requestId,
      from: dateFrom,
      to: dateTo,
    })
    return `/api/admin/fulfillment-submissions?${params.toString()}`
  }, [filter, query, requestId, dateFrom, dateTo])
  const submissionsChartExportHref = useMemo(() => {
    const params = new URLSearchParams({
      export: 'submissions-by-day',
      requestId,
      from: dateFrom,
      to: dateTo,
    })
    return `/api/admin/fulfillment-submissions?${params.toString()}`
  }, [requestId, dateFrom, dateTo])
  const rejectsChartExportHref = useMemo(() => {
    const params = new URLSearchParams({
      export: 'rejects-by-day',
      requestId,
      from: dateFrom,
      to: dateTo,
    })
    return `/api/admin/fulfillment-submissions?${params.toString()}`
  }, [requestId, dateFrom, dateTo])
  const chartData = useMemo(() => {
    const daily = data?.daily ?? []
    if (chartRange === 'all') return daily

    const days = chartRange === '24h' ? 1 : chartRange === '7d' ? 7 : 30
    const newest = daily.reduce((max, bucket) => {
      const time = Date.parse(bucket.date)
      return Number.isFinite(time) && time > max ? time : max
    }, 0)
    if (!newest) return daily

    const cutoff = newest - (days - 1) * 24 * 60 * 60 * 1000
    return daily.filter((bucket) => {
      const time = Date.parse(bucket.date)
      return Number.isFinite(time) && time >= cutoff
    })
  }, [data?.daily, chartRange])
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
            Every revealed or committed lead, with validation activity plotted by the day it happened.
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
          <Tile label="Submitted" value={counts.submitted} />
          <Tile label="Committed" value={counts.committed} />
          <Tile label="Approved" value={counts.approved} accent="cream" />
          <Tile label="Denied" value={counts.denied} accent="burgundy" />
          <Tile label="Pending" value={counts.pending} accent="amber" />
          <Tile label="Fulfilled" value={counts.fulfilled} accent="gold" />
        </div>
      </section>

      {loadError ? (
        <div className="rounded-xl border border-burgundy-soft bg-burgundy-soft p-4 text-sm text-burgundy">
          {loadError}
        </div>
      ) : null}

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
              Submitted and committed volume by submit date; approved, denied, and fulfilled activity by consensus date.
            </p>
          </div>
          <div className="flex flex-col items-start gap-2 sm:items-end">
            <div className="flex flex-wrap gap-1">
              {CHART_RANGES.map((range) => (
                <button
                  key={range.key}
                  type="button"
                  onClick={() => setChartRange(range.key)}
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
                    chartRange === range.key
                      ? 'bg-gold-tint border-gold-strong text-gold'
                      : 'border-white/[0.06] hover-bg-warm text-white/55',
                  )}
                >
                  {range.label}
                </button>
              ))}
            </div>
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
              <Bar dataKey="committed" stackId="submitted" name="Committed" fill="rgba(245,240,232,0.24)" />
              <Bar dataKey="approved" stackId="submitted" name="Approved" fill="#e8e1d4" />
              <Bar dataKey="denied" stackId="submitted" name="Denied" fill="#a8746f" />
              <Bar dataKey="pending" stackId="submitted" name="Pending" fill="#cf9d61" />
              <Bar dataKey="fulfilled" name="Fulfilled" fill="#c9a96e" />
            </BarChart>
          </ResponsiveContainer>
        </div>
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
              <Legend wrapperStyle={{ fontSize: 11, color: 'var(--text-secondary)' }} />
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
        </div>
      </section>

      <section
        className="grid gap-3 rounded-xl border p-3 sm:grid-cols-[minmax(220px,1fr)_160px_160px_auto]"
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
            From
          </span>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
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
            onChange={(e) => setDateTo(e.target.value)}
            className="premium-focus w-full rounded-lg border bg-transparent px-3 py-2 text-sm"
            style={{
              borderColor: 'var(--surface-border)',
              color: 'var(--text-primary)',
              background: 'var(--surface-elevated)',
            }}
          />
        </label>

        <div className="flex items-end gap-2">
          <button
            type="button"
            onClick={() => {
              setRequestId('all')
              setDateFrom('')
              setDateTo('')
              setQuery('')
              setFilter('all')
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
  return (
    <div
      className="fixed inset-0 z-50 flex items-end bg-black/60 sm:items-center sm:justify-center"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full overflow-auto rounded-t-2xl border p-5 shadow-2xl sm:max-w-4xl sm:rounded-2xl"
        style={{ borderColor: 'var(--surface-border)', background: 'var(--surface)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
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

        <div className="grid gap-3 sm:grid-cols-3">
          <Detail label="Status" value={lead.fulfilled ? 'fulfilled' : lead.status} />
          <Detail label="Request" value={dash(lead.requestLabel)} />
          <Detail label="Client" value={dash(lead.clientCompany)} />
          <Detail label="Miner" value={lead.minerHotkey} mono />
          <Detail label="Submission" value={lead.submissionId} mono />
          <Detail label="Submitted" value={formatDateTime(lead.submittedAt)} />
          <Detail label="Activity" value={formatDateTime(lead.activityAt)} />
          <Detail label="Consensus" value={formatDateTime(lead.consensusAt)} />
          <Detail label="Email" value={dash(lead.email)} />
          <Detail label="Role" value={dash(lead.role)} />
          <Detail label="Country" value={dash(lead.country)} />
          <Detail label="Final score" value={score(lead.score)} />
          <Detail label="Intent score" value={score(lead.intentScore)} />
          <Detail label="Rep score" value={score(lead.repScore)} />
          <Detail label="Reject reason" value={dash(lead.rejectionReason)} />
          <Detail label="Extended reject reason" value={dash(lead.rejectionDetail)} />
        </div>

        {lead.intentDetails && (
          <section className="mt-4 rounded-xl border p-4" style={{ borderColor: 'var(--surface-border)' }}>
            <div className="mb-2 text-[10px] uppercase tracking-[0.14em]" style={{ color: 'var(--text-tertiary)' }}>
              Intent details
            </div>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--text-primary)' }}>
              {lead.intentDetails}
            </p>
          </section>
        )}

        <section className="mt-4 rounded-xl border p-4" style={{ borderColor: 'var(--surface-border)' }}>
          <div className="mb-2 text-[10px] uppercase tracking-[0.14em]" style={{ color: 'var(--text-tertiary)' }}>
            Raw lead data
          </div>
          <pre
            className="max-h-[420px] overflow-auto rounded-lg p-3 text-[11px]"
            style={{ background: 'var(--surface-base)', color: 'var(--text-secondary)' }}
          >
            {JSON.stringify(lead.leadData, null, 2)}
          </pre>
        </section>
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
