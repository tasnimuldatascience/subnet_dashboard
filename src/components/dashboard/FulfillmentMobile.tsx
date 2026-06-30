'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { X, RefreshCw } from 'lucide-react'

/* ------------------------------------------------------------------
 * Shared types (kept in this file to keep the mobile view standalone)
 * ------------------------------------------------------------------ */

interface IcpDetails {
  prompt?: string
  company_country?: string | string[]
  company_region?: string
  contact_country?: string | string[]
  contact_region?: string
  country?: string
  geography?: string
  industry?: string
  sub_industry?: string
  target_roles?: string[]
  target_role_types?: string[]
  company_stage?: string
  employee_count?: string
  intent_signals?: Array<string | { text?: string; evidence_type?: string | null; recency_cap_days?: number | null; required?: boolean }>
  product_service?: string
  target_seniority?: string
  num_leads?: number
}

interface ActiveRequest {
  request_id: string
  icp_details: IcpDetails
  num_leads: number
  window_start: string | null
  window_end: string | null
  status: string
  created_at: string
  held_count?: number
}

interface ConsensusResult {
  consensus_id: string
  request_id: string
  miner_hotkey: string
  lead_id: string
  is_winner: boolean
}

interface LeaderboardEntry {
  rank: number
  hotkey: string
  wins: number
  bonusPct: number
}

interface RejectionEntry {
  reason: string
  count: number
}

type FilterMode = 'all' | 'pending' | 'completed'

const PENDING_STATUSES = ['pending', 'open', 'continued_open', 'commit_closed', 'scoring']

interface Props {
  activeRequests: ActiveRequest[]
  allConsensus: ConsensusResult[]
  leaderboard: LeaderboardEntry[]
  leaderboardWindowDays: number
  totalSubmittedLeads: number
  totalDeliveredLeads: number
  rejectionBreakdown: RejectionEntry[]
  scoreTotals: { passed: number; failed: number; sampleSize?: number }
  filter: FilterMode
  setFilter: (f: FilterMode) => void
  searchQuery: string
  setSearchQuery: (q: string) => void
  focusedMinerHotkey: string | null
  onMinerSelect: (hotkey: string) => void
  onRequestSelect: (req: ActiveRequest) => void
  onRefresh: () => Promise<void> | void
  readableReason: (reason: string) => string
  readableStatus: (status: string) => string
  truncateHotkey: (hotkey: string) => string
  asText: (v: unknown) => string
  formatDate: (s: string) => string
}

/* ------------------------------------------------------------------
 * Pull-to-refresh hook
 * Triggers `onRefresh` when the user pulls down past a threshold while
 * at the very top of the scroll container.
 * ------------------------------------------------------------------ */
function usePullToRefresh(
  scrollRef: React.RefObject<HTMLDivElement | null>,
  onRefresh: () => Promise<void> | void
) {
  const [pulled, setPulled] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const startY = useRef(0)
  const pulling = useRef(false)
  const onRefreshRef = useRef(onRefresh)
  onRefreshRef.current = onRefresh

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    const THRESHOLD = 80
    const MAX_PULL = 120

    const onStart = (e: TouchEvent) => {
      if (el.scrollTop > 0 || refreshing) return
      startY.current = e.touches[0].clientY
      pulling.current = true
    }

    const onMove = (e: TouchEvent) => {
      if (!pulling.current) return
      const dy = e.touches[0].clientY - startY.current
      if (dy > 0 && el.scrollTop <= 0) {
        const damped = Math.min(MAX_PULL, dy * 0.5)
        setPulled(damped)
        if (dy > 8) e.preventDefault()
      } else {
        pulling.current = false
        setPulled(0)
      }
    }

    const onEnd = async () => {
      if (!pulling.current) {
        setPulled(0)
        return
      }
      pulling.current = false
      const reached = pulled >= THRESHOLD
      setPulled(0)
      if (reached) {
        setRefreshing(true)
        try {
          await onRefreshRef.current()
        } finally {
          // brief visible spinner even on fast networks
          setTimeout(() => setRefreshing(false), 350)
        }
      }
    }

    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onEnd, { passive: true })
    el.addEventListener('touchcancel', onEnd, { passive: true })
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
      el.removeEventListener('touchcancel', onEnd)
    }
  }, [scrollRef, pulled, refreshing])

  return { pulled, refreshing }
}

/* ------------------------------------------------------------------ */

export function FulfillmentMobile({
  activeRequests,
  allConsensus,
  leaderboard,
  leaderboardWindowDays,
  totalSubmittedLeads,
  totalDeliveredLeads,
  rejectionBreakdown,
  scoreTotals,
  filter,
  setFilter,
  searchQuery,
  setSearchQuery,
  focusedMinerHotkey,
  onMinerSelect,
  onRequestSelect,
  onRefresh,
  readableReason,
  readableStatus,
  truncateHotkey,
  asText,
  formatDate,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const { pulled, refreshing } = usePullToRefresh(scrollRef, onRefresh)

  // Filter counts
  const counts = useMemo(() => {
    return {
      all: activeRequests.length,
      pending: activeRequests.filter((r) => PENDING_STATUSES.includes(r.status)).length,
      completed: activeRequests.filter((r) => r.status === 'fulfilled').length,
    }
  }, [activeRequests])

  // At-a-glance stat strip values (always from full data, not filtered)
  const stats = useMemo(() => {
    // Count unique miners that have shown up in any consensus row in the
    // current snapshot. This reflects "miners actively contributing".
    const miners = new Set(
      allConsensus.map((c) => c.miner_hotkey).filter((h): h is string => Boolean(h)),
    ).size
    return {
      fulfilledLeads: totalDeliveredLeads,
      miners,
      submittedLeads: totalSubmittedLeads,
    }
  }, [allConsensus, totalDeliveredLeads, totalSubmittedLeads])

  // Filtered + sorted request list
  const filteredRequests = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return activeRequests
      .filter((r) => {
        if (filter === 'pending') return PENDING_STATUSES.includes(r.status)
        if (filter === 'completed') return r.status === 'fulfilled'
        return true
      })
      .filter((r) => {
        if (!q) return true
        return (
          r.request_id.toLowerCase().includes(q) ||
          asText(r.icp_details?.industry).toLowerCase().includes(q) ||
          asText(r.icp_details?.sub_industry).toLowerCase().includes(q) ||
          asText(r.icp_details?.country).toLowerCase().includes(q)
        )
      })
      .slice()
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  }, [activeRequests, filter, searchQuery, asText])

  // Winner counts per request, used by the leads column on each card
  const winnersByRequest = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of allConsensus) {
      if (!c.is_winner) continue
      m.set(c.request_id, (m.get(c.request_id) || 0) + 1)
    }
    return m
  }, [allConsensus])

  return (
    <div
      ref={scrollRef}
      className="relative h-[calc(100vh-3.5rem)] overflow-y-auto overflow-x-hidden overscroll-y-contain"
      style={{ WebkitOverflowScrolling: 'touch' }}
    >
      {/* Pull-to-refresh indicator */}
      {(pulled > 0 || refreshing) && (
        <div
          className="absolute top-0 left-0 right-0 flex items-center justify-center pointer-events-none"
          style={{
            height: `${pulled || 48}px`,
            transition: refreshing ? 'none' : pulled === 0 ? 'height 200ms ease-out' : 'none',
          }}
        >
          <RefreshCw
            className={cn(
              'h-4 w-4 text-gold',
              refreshing ? 'animate-spin' : ''
            )}
            style={{
              transform: refreshing ? undefined : `rotate(${Math.min(pulled * 4, 360)}deg)`,
              opacity: Math.min(1, pulled / 80),
            }}
          />
        </div>
      )}

      {/* Body sections: comfortable spacing. The redundant "Fulfillment"
          masthead is omitted on mobile because the tab bar already labels
          this view. The sync indicator lives in the global masthead. */}
      <div className="px-4 pt-4 pb-4 space-y-4 safe-bottom safe-top">
        {/* At-a-glance stat strip */}
        <section className="mobile-section">
          <div className="grid grid-cols-3 divide-x divide-slate-800/60">
            <StatCell label="Miners" value={stats.miners} tone="default" />
            <StatCell label="Submitted" value={stats.submittedLeads} tone="default" />
            <StatCell label="Fulfilled" value={stats.fulfilledLeads} tone="gold" />
          </div>
        </section>

        {/* Filter pills */}
        <div className="-mx-1 overflow-x-auto no-scrollbar">
          <div className="flex items-center gap-2 px-1">
            <MobilePill
              active={filter === 'all'}
              onClick={() => setFilter('all')}
              label="All"
              count={counts.all}
              tone="neutral"
            />
            <MobilePill
              active={filter === 'pending'}
              onClick={() => setFilter('pending')}
              label="Pending"
              count={counts.pending}
              tone="pending"
            />
            <MobilePill
              active={filter === 'completed'}
              onClick={() => setFilter('completed')}
              label="Completed"
              count={counts.completed}
              tone="completed"
            />
          </div>
        </div>

        {/* Top miners */}
        {leaderboard.length > 0 && (
          <section className="mobile-section">
            <SectionHeader title="Top miners" subtitle={`Last ${leaderboardWindowDays}d`} />
            <div className="divide-y divide-slate-800/60">
              {leaderboard.slice(0, 5).map((entry) => {
                const isFocused = focusedMinerHotkey === entry.hotkey
                return (
                  <button
                    key={entry.hotkey}
                    onClick={() => onMinerSelect(entry.hotkey)}
                    // Match desktop order: rank · hotkey · bonus% · fulfilled count.
                    className={cn(
                      'w-full grid grid-cols-[1.75rem_minmax(0,1fr)_3.5rem_5.75rem] items-center gap-2 px-4 py-3 transition-colors text-left active:bg-slate-800/60',
                      isFocused ? 'bg-gold-soft' : 'hover-bg-warm'
                    )}
                  >
                    <span className="text-xs font-mono text-slate-500 text-right tabular-nums">
                      {String(entry.rank).padStart(2, '0')}
                    </span>
                    <code
                      className="text-xs font-mono text-slate-200 truncate"
                      title={entry.hotkey}
                    >
                      {truncateHotkey(entry.hotkey)}
                    </code>
                    <span className="text-[10px] font-mono text-amber-warm tabular-nums text-right opacity-90">
                      {entry.bonusPct > 0 ? `+${entry.bonusPct}%` : ''}
                    </span>
                    <div className="flex flex-col items-end justify-center leading-none">
                      <span className="text-sm font-semibold text-gold tabular-nums">
                        {entry.wins}
                      </span>
                      <span className="mt-1 text-[8px] text-slate-500 uppercase tracking-[0.08em]">
                        fulfilled
                      </span>
                    </div>
                  </button>
                )
              })}
            </div>
          </section>
        )}

        {/* Not fulfilled reasons */}
        <section className="mobile-section">
          <SectionHeader title="Not fulfilled reasons" subtitle="Evaluated leads" />
          {rejectionBreakdown.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-slate-500">
              No rejection data.
            </div>
          ) : (
            <div className="px-4 py-3 space-y-3">
              {rejectionBreakdown.slice(0, 6).map((entry, idx) => {
                const maxCount = Math.max(1, ...rejectionBreakdown.slice(0, 6).map((r) => r.count))
                const pct = (entry.count / maxCount) * 100
                const ofTotal = scoreTotals.failed > 0
                  ? (entry.count / scoreTotals.failed) * 100
                  : 0
                const severity = 1 - (idx / 5) * 0.45
                return (
                  <div key={entry.reason}>
                    <div className="flex items-center justify-between mb-1.5 text-xs">
                      <span className="text-slate-200 truncate" title={readableReason(entry.reason)}>
                        {readableReason(entry.reason)}
                      </span>
                      <span className="flex items-center gap-2.5 text-slate-500 font-mono shrink-0 ml-2 tabular-nums">
                        <span>{ofTotal.toFixed(0)}%</span>
                        <span className="text-slate-300 w-6 text-right">{entry.count}</span>
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-slate-800/60 overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          // Monochrome: brighter for the top entries, fades for the tail.
                          width: `${pct}%`,
                          background: `linear-gradient(90deg, rgba(236, 234, 230, ${0.26 + severity * 0.2}) 0%, rgba(236, 234, 230, ${0.16 + severity * 0.16}) 100%)`,
                          transition: 'width 320ms cubic-bezier(0.16, 1, 0.3, 1)',
                        }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>

        {/* Request history. The header (title + count + search) is sticky
            just under the masthead so users can keep filtering as they
            scroll through long request lists. We render the sticky header
            OUTSIDE the rounded card because `overflow: hidden` (used to
            clip rounded corners on `mobile-section`) breaks descendants
            with `position: sticky`. The bg colors mirror `mobile-section`
            so this section reads as a peer to "Top miners" and "Rejection
            reasons" rather than a different visual layer. */}
        <section>
          <div className="sticky top-0 z-20 rounded-t-[0.875rem] border border-b-0 border-[var(--surface-border)] bg-[rgba(16,16,19,0.92)] backdrop-blur-md overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-2.5 bg-slate-900/40 border-b border-slate-800/60">
              <span className="text-xs font-semibold text-slate-100">Request history</span>
              <span className="ml-auto text-[10px] text-slate-500 font-mono tabular-nums">
                {filteredRequests.length}
              </span>
            </div>
            <div className="relative px-4 py-2.5">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter by request id, industry, or country"
                className="w-full pl-3 pr-9 h-9 bg-slate-900/80 border border-slate-700/50 rounded-lg text-xs font-mono text-slate-100 placeholder:text-slate-500 outline-none premium-focus transition-colors"
                inputMode="search"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-6 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-200 transition-colors p-1"
                  aria-label="Clear search"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
          <div className="rounded-b-[0.875rem] border border-t-0 border-[var(--surface-border)] bg-[rgba(16,16,19,0.65)] overflow-hidden">
            {filteredRequests.length === 0 ? (
              <div className="px-4 py-10 text-center text-xs text-slate-500">
                No requests match the current filter.
              </div>
            ) : (
              <div className="divide-y divide-slate-800/60">
                {filteredRequests.map((req) => (
                  <RequestMobileCard
                    key={req.request_id}
                    request={req}
                    winners={winnersByRequest.get(req.request_id) || 0}
                    onSelect={() => onRequestSelect(req)}
                    readableStatus={readableStatus}
                    asText={asText}
                    formatDate={formatDate}
                  />
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------
 * Sub-components
 * ------------------------------------------------------------------ */

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-800/60 bg-slate-900/40">
      <span className="text-xs font-semibold text-slate-100">{title}</span>
      {subtitle && (
        <span className="ml-auto text-[10px] text-slate-500 font-mono tabular-nums">
          {subtitle}
        </span>
      )}
    </div>
  )
}

function StatCell({
  label,
  value,
  tone,
}: {
  label: string
  value: string | number
  tone: 'default' | 'gold'
}) {
  const valueColor = tone === 'gold' ? 'text-gold' : 'text-slate-100'
  return (
    <div className="px-3 py-2.5 text-center">
      <div className={cn('text-lg font-semibold tabular-nums leading-tight', valueColor)}>
        {value}
      </div>
      <div className="text-[9px] text-slate-500 uppercase tracking-[0.1em] mt-0.5">
        {label}
      </div>
    </div>
  )
}

function MobilePill({
  active,
  onClick,
  label,
  count,
  tone,
}: {
  active: boolean
  onClick: () => void
  label: string
  count: number
  tone: 'neutral' | 'pending' | 'completed'
}) {
  const activeBg =
    tone === 'pending'
      ? 'bg-amber-warm-soft text-amber-warm border-amber-warm-soft'
      : tone === 'completed'
        ? 'bg-cream-soft text-cream border-cream-soft'
        : 'bg-slate-700/60 text-slate-100 border-slate-500/40'
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 h-9 px-3 rounded-full text-xs font-medium border whitespace-nowrap transition-all min-w-[44px]',
        active
          ? activeBg
          : 'bg-slate-900/60 text-slate-400 border-slate-700/50 hover:text-slate-200'
      )}
    >
      <span>{label}</span>
      <span
        className={cn(
          'text-[10px] font-mono tabular-nums',
          active ? 'text-current/70' : 'text-slate-500'
        )}
      >
        {count}
      </span>
    </button>
  )
}

function RequestMobileCard({
  request,
  winners,
  onSelect,
  readableStatus,
  asText,
  formatDate,
}: {
  request: ActiveRequest
  winners: number
  onSelect: () => void
  readableStatus: (s: string) => string
  asText: (v: unknown) => string
  formatDate: (s: string) => string
}) {
  const isFulfilled = request.status === 'fulfilled'
  const isPending = PENDING_STATUSES.includes(request.status)
  const isCommitClosed = request.status === 'commit_closed'
  const heldCount = request.held_count ?? 0
  const icp = request.icp_details
  const industry = asText(icp?.industry)
  const subIndustry = asText(icp?.sub_industry)
  const role = Array.isArray(icp?.target_roles)
    ? icp.target_roles.find((x) => typeof x === 'string' && x.length > 0)
    : undefined
  const industryLine = [industry, subIndustry].filter(Boolean).join(' / ')

  return (
    <button
      onClick={onSelect}
      className="w-full text-left px-4 py-3.5 active:bg-slate-800/60 hover:bg-slate-800/40 transition-colors min-h-[68px]"
    >
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          {/* Top line: status + time */}
          <div className="flex items-center gap-2 mb-1.5">
            <span
              className={cn(
                'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-1 text-[10px] font-medium leading-none',
                isFulfilled
                  ? 'bg-cream-soft text-cream border-cream-soft'
                  : isCommitClosed
                    ? 'bg-cream-soft text-cream border-cream-soft'
                    : isPending
                    ? 'bg-amber-warm-soft text-amber-warm border-amber-warm-soft'
                    : 'bg-slate-700/40 text-slate-300 border-slate-600/40'
              )}
            >
              {(isPending || isCommitClosed) && (
                <span
                  className={cn(
                    'inline-block h-1.5 w-1.5 rounded-full dot-amber',
                    !isCommitClosed && 'live-pulse'
                  )}
                />
              )}
              {readableStatus(request.status)}
            </span>
            {request.window_start && (
              <span className="text-[10px] text-slate-500 font-mono tabular-nums">
                {formatDate(request.window_start)}
              </span>
            )}
          </div>
          {/* Industry */}
          <div className="text-sm font-medium text-slate-100 truncate" title={industryLine}>
            {industryLine || <span className="text-slate-500">·</span>}
          </div>
          {/* Role */}
          {role && (
            <div className="text-[11px] text-slate-500 truncate mt-0.5">{role}</div>
          )}
          {/* Leads / counts */}
          <div className="flex items-baseline gap-2 mt-2 text-[11px] font-mono tabular-nums">
            <span className="text-slate-300">
              <span className="text-slate-100 font-semibold">{request.num_leads}</span>
              <span className="text-slate-500"> leads</span>
            </span>
            {isFulfilled
              ? winners > 0 && (
                  <span className="text-gold">
                    {winners} won
                  </span>
                )
              : heldCount > 0 && (
                  <span className="text-gold">
                    {heldCount} approved
                  </span>
                )}
          </div>
        </div>
      </div>
    </button>
  )
}
