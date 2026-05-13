'use client'

import { useState, useMemo, useEffect, useRef } from 'react'
import Link from 'next/link'
import {
  Search,
  ChevronRight,
  CircleDot,
  CheckCircle2,
  AlertCircle,
  RotateCw,
  Clock,
  AlertTriangle,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  formatRelative,
  statusLabel,
  statusTone,
} from '@/lib/admin-format'

// Mirrors the API contract in /api/admin/requests
export interface ChainSummary {
  request_id: string
  root_request_id: string
  internal_label: string | null
  company: string | null
  status: string
  target_num_leads: number
  delivered_count: number
  cycle_count: number
  icp_summary: {
    industries: number
    sub_industries: number
    countries: string[]
    intent_signals: number
  }
  created_at: string
  last_activity_at: string
}

type FilterKey = 'all' | 'open' | 'fulfilled' | 'partial' | 'recycled'

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'open', label: 'Open' },
  { key: 'fulfilled', label: 'Fulfilled' },
  { key: 'partial', label: 'Partial' },
  { key: 'recycled', label: 'Recycled' },
]

function StatusPill({ status }: { status: string }) {
  const tone = statusTone(status)
  const Icon =
    tone === 'fulfilled'
      ? CheckCircle2
      : tone === 'open' || tone === 'pending'
      ? CircleDot
      : tone === 'partial'
      ? AlertCircle
      : RotateCw
  const cls =
    tone === 'fulfilled'
      ? 'bg-gold-soft border-gold-soft text-gold'
      : tone === 'open'
      ? 'bg-cream-soft border-cream-soft text-cream'
      : tone === 'pending'
      ? 'bg-amber-warm-soft border-amber-warm-soft text-amber-warm'
      : tone === 'partial'
      ? 'bg-amber-warm-soft border-amber-warm-soft text-amber-warm'
      : tone === 'recycled'
      ? 'bg-burgundy-soft border-burgundy-soft text-burgundy'
      : 'border border-white/10 text-white/60'
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] font-medium',
        cls,
      )}
    >
      <Icon className="h-3 w-3" />
      {statusLabel(status)}
    </span>
  )
}

function ProgressBar({ delivered, target }: { delivered: number; target: number }) {
  const pct = Math.max(0, Math.min(1, target > 0 ? delivered / target : 0))
  const widthPct = `${pct * 100}%`
  const tone = pct >= 1 ? 'gold' : pct >= 0.5 ? 'cream' : 'amber'
  const fillColor =
    tone === 'gold' ? 'var(--brand)' : tone === 'cream' ? '#e8e1d4' : '#cf9d61'
  return (
    <div className="flex items-center gap-2 min-w-[120px]">
      <div
        className="h-1 flex-1 rounded-full overflow-hidden"
        style={{ background: 'rgba(245, 240, 232, 0.06)' }}
      >
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: widthPct, background: fillColor }}
        />
      </div>
      <span
        className="text-[11px] tabular-nums whitespace-nowrap"
        style={{ color: 'var(--text-secondary)' }}
      >
        {delivered}
        <span style={{ color: 'var(--text-tertiary)' }}> / {target}</span>
      </span>
    </div>
  )
}

export function AdminRequestList({
  chains,
  error,
}: {
  chains: ChainSummary[]
  error: string | null
}) {
  const [filter, setFilter] = useState<FilterKey>('all')
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  // "/" keyboard shortcut: focus search (matches public dashboard pattern).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing =
        document.activeElement instanceof HTMLInputElement ||
        document.activeElement instanceof HTMLTextAreaElement
      if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        searchRef.current?.focus()
      }
      if (e.key === 'Escape' && document.activeElement === searchRef.current) {
        searchRef.current?.blur()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return chains.filter((c) => {
      if (filter !== 'all' && statusTone(c.status) !== filter) return false
      if (q) {
        const hay = [
          c.internal_label,
          c.company,
          c.request_id,
          c.root_request_id,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [chains, filter, query])

  const counts = useMemo(() => {
    const c: Record<FilterKey, number> = {
      all: chains.length,
      open: 0,
      fulfilled: 0,
      partial: 0,
      recycled: 0,
    }
    for (const r of chains) {
      const t = statusTone(r.status)
      if (t === 'open' || t === 'pending') c.open += 1
      else if (t === 'fulfilled') c.fulfilled += 1
      else if (t === 'partial') c.partial += 1
      else if (t === 'recycled') c.recycled += 1
    }
    return c
  }, [chains])

  // Roll up topline metrics for the masthead card.
  const totals = useMemo(() => {
    let delivered = 0
    let target = 0
    for (const c of chains) {
      delivered += c.delivered_count
      target += c.target_num_leads
    }
    return { delivered, target, chains: chains.length }
  }, [chains])

  return (
    <div className="space-y-6">
      {/* Headline / topline */}
      <section className="space-y-3">
        <div className="flex items-baseline gap-3 flex-wrap">
          <h1
            className="text-2xl font-medium tracking-tight"
            style={{ color: 'var(--text-primary)' }}
          >
            Client Requests
          </h1>
          <span
            className="text-xs"
            style={{ color: 'var(--text-tertiary)' }}
          >
            Live operator view of every fulfillment request and its delivered leads.
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Tile label="Total requests" value={totals.chains} />
          <Tile
            label="Leads delivered"
            value={totals.delivered}
            accent="gold"
          />
          <Tile
            label="Total quota"
            value={totals.target}
            secondary={`${totals.target > 0 ? Math.round((totals.delivered / totals.target) * 100) : 0}% fulfilled`}
          />
          <Tile
            label="In flight"
            value={counts.open + counts.partial}
            secondary={`${counts.open} open · ${counts.partial} partial`}
          />
        </div>
      </section>

      {/* Filter / search bar */}
      <section className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all whitespace-nowrap border',
                filter === f.key
                  ? 'bg-gold-tint border-gold-strong text-gold'
                  : 'border-white/[0.06] hover-bg-warm text-white/55',
              )}
            >
              {f.label}
              <span className="tabular-nums text-[10px] opacity-70">
                {counts[f.key]}
              </span>
            </button>
          ))}
        </div>
        <div className="relative flex-1 max-w-md ml-auto">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5"
            style={{ color: 'var(--text-tertiary)' }}
          />
          <input
            ref={searchRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by label, company, or request id…"
            className="premium-focus w-full rounded-lg border px-9 py-2 text-sm placeholder:text-white/30 bg-transparent"
            style={{
              borderColor: 'var(--surface-border)',
              background: 'var(--surface)',
              color: 'var(--text-primary)',
            }}
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 kbd-chip pointer-events-none hidden sm:inline-flex">
            /
          </span>
        </div>
      </section>

      {/* Body */}
      {error ? (
        <div
          className="rounded-xl border p-6 flex items-start gap-3"
          style={{
            background: 'rgba(168, 116, 111, 0.10)',
            borderColor: 'rgba(168, 116, 111, 0.30)',
          }}
        >
          <AlertTriangle className="h-5 w-5 text-burgundy flex-shrink-0 mt-0.5" />
          <div>
            <div className="text-sm font-medium text-burgundy">
              Could not load requests
            </div>
            <div
              className="text-xs mt-1 font-mono"
              style={{ color: 'var(--text-secondary)' }}
            >
              {error}
            </div>
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div
          className="rounded-xl border p-12 text-center"
          style={{
            borderColor: 'var(--surface-border)',
            background: 'var(--surface)',
          }}
        >
          <div
            className="text-sm"
            style={{ color: 'var(--text-secondary)' }}
          >
            No requests match the current filter.
          </div>
        </div>
      ) : (
        <div className="space-y-px">
          {filtered.map((c) => (
            <ChainRow key={c.request_id} chain={c} />
          ))}
        </div>
      )}
    </div>
  )
}

function ChainRow({ chain }: { chain: ChainSummary }) {
  return (
    <Link
      href={`/admin/requests/${chain.request_id}`}
      className="card-lift block rounded-xl border px-5 py-4 transition-colors group"
      style={{
        borderColor: 'var(--surface-border)',
        background: 'var(--surface)',
      }}
    >
      <div className="flex items-center gap-5 flex-wrap sm:flex-nowrap">
        {/* Label + meta */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <h3
              className="font-medium truncate"
              style={{ color: 'var(--text-primary)' }}
            >
              {chain.internal_label || (
                <span style={{ color: 'var(--text-tertiary)' }}>
                  (no label)
                </span>
              )}
            </h3>
            {chain.cycle_count > 1 && (
              <span
                className="inline-flex items-center gap-1 text-[10px] rounded-full px-2 py-0.5 border whitespace-nowrap"
                style={{
                  borderColor: 'var(--surface-border-strong)',
                  color: 'var(--text-secondary)',
                  background: 'var(--surface-elevated)',
                }}
              >
                <RotateCw className="h-2.5 w-2.5" />
                {chain.cycle_count} cycles
              </span>
            )}
          </div>
          <div
            className="flex items-center gap-3 text-xs flex-wrap"
            style={{ color: 'var(--text-secondary)' }}
          >
            {chain.company && (
              <span className="truncate">
                <span style={{ color: 'var(--text-tertiary)' }}>Client:</span>{' '}
                {chain.company}
              </span>
            )}
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {formatRelative(chain.last_activity_at)}
            </span>
            {chain.icp_summary.countries.length > 0 && (
              <span className="truncate">
                {chain.icp_summary.countries.slice(0, 2).join(', ')}
                {chain.icp_summary.countries.length > 2
                  ? ` +${chain.icp_summary.countries.length - 2}`
                  : ''}
              </span>
            )}
          </div>
        </div>

        {/* Progress */}
        <ProgressBar
          delivered={chain.delivered_count}
          target={chain.target_num_leads}
        />

        {/* Status */}
        <div className="hidden sm:block">
          <StatusPill status={chain.status} />
        </div>

        <ChevronRight
          className="h-4 w-4 flex-shrink-0 transition-transform group-hover:translate-x-0.5"
          style={{ color: 'var(--text-tertiary)' }}
        />
      </div>
      <div className="sm:hidden mt-3">
        <StatusPill status={chain.status} />
      </div>
    </Link>
  )
}

function Tile({
  label,
  value,
  secondary,
  accent,
}: {
  label: string
  value: number
  secondary?: string
  accent?: 'gold'
}) {
  return (
    <div
      className="rounded-xl border px-4 py-3.5"
      style={{
        borderColor: 'var(--surface-border)',
        background: 'var(--surface)',
      }}
    >
      <div
        className="text-[10px] uppercase tracking-[0.14em] mb-1.5"
        style={{ color: 'var(--text-tertiary)' }}
      >
        {label}
      </div>
      <div
        className={cn(
          'tabular-nums text-2xl font-medium leading-none',
          accent === 'gold' ? 'text-gold' : '',
        )}
        style={accent === 'gold' ? undefined : { color: 'var(--text-primary)' }}
      >
        {value.toLocaleString()}
      </div>
      {secondary && (
        <div
          className="text-[11px] mt-1.5"
          style={{ color: 'var(--text-tertiary)' }}
        >
          {secondary}
        </div>
      )}
    </div>
  )
}
