'use client'

import { useEffect, useMemo, useState } from 'react'
import { Loader2, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatDateTime, formatRelative, shortHotkey } from '@/lib/admin-format'

type LabTimelinePhase =
  | 'ticket'
  | 'queue'
  | 'auto_research'
  | 'candidate'
  | 'scoring'
  | 'promotion'
  | 'public_projection'

type LabTimelineTimestampKind =
  | 'entered_stage'
  | 'projection_written'
  | 'last_activity_represented'

export type AdminLabLoopSummary = {
  cardId: string
  ticketId: string
  runId: string | null
  receiptId: string | null
  minerHotkey: string
  researchArea: string
  researchFocusSummary: string
  topicTags: string[]
  topicSignatureHash: string
  outcomeLabel: string
  outcomeBand: string
  candidateCount: number
  scoredCandidateCount: number
  bestCandidatePublicSummary: string
  lastActivityAt: string
  submittedAt: string
}

export type AdminResearchLabPayload = {
  loops: AdminLabLoopSummary[]
  stats: {
    totalLoops: number
    runningLoops: number
    scoredLoops: number
    failedLoops: number
    uniqueMiners: number
  }
  fetchedAt: string
}

type LabTimelineEvent = {
  id: string
  phase: LabTimelinePhase
  stage: string
  status?: string
  enteredAt: string
  seq?: number
  source?: string
  summary?: string
  metadata?: Record<string, unknown>
  timestampKind?: LabTimelineTimestampKind
  lastActivityAt?: string
  runId?: string
  receiptId?: string
  durationSincePreviousMs?: number
}

type LabTimelineRun = {
  runId?: string
  receiptId?: string
  isCurrent?: boolean
  events: LabTimelineEvent[]
}

type LabTimeline = {
  ticketId: string
  currentRunId?: string
  runs: LabTimelineRun[]
  sourceNotes?: string[]
}

type LabTimelinePayload = {
  loop: AdminLabLoopSummary
  timeline: LabTimeline
  fetchedAt: string
}

export function AdminResearchLab({
  payload,
  error,
}: {
  payload: AdminResearchLabPayload | null
  error: string | null
}) {
  const loops = useMemo(() => payload?.loops ?? [], [payload?.loops])
  const [query, setQuery] = useState('')
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(loops[0]?.ticketId ?? null)
  const [timelineByTicket, setTimelineByTicket] = useState<Record<string, LabTimelinePayload | null>>({})
  const [loadingTicketId, setLoadingTicketId] = useState<string | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)

  useEffect(() => {
    if (selectedTicketId || loops.length === 0) return
    setSelectedTicketId(loops[0].ticketId)
  }, [loops, selectedTicketId])

  const filteredLoops = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return loops
    return loops.filter((loop) =>
      [
        loop.ticketId,
        loop.runId ?? '',
        loop.receiptId ?? '',
        loop.minerHotkey,
        loop.researchArea,
        loop.researchFocusSummary,
        loop.outcomeLabel,
        ...loop.topicTags,
      ].some((value) => value.toLowerCase().includes(q)),
    )
  }, [loops, query])

  const selectedLoop =
    loops.find((loop) => loop.ticketId === selectedTicketId) ??
    filteredLoops[0] ??
    loops[0] ??
    null
  const selectedTimeline = selectedLoop ? timelineByTicket[selectedLoop.ticketId] ?? null : null
  const loadingSelected = Boolean(selectedLoop && loadingTicketId === selectedLoop.ticketId)
  const eventCount = selectedTimeline?.timeline.runs.reduce((sum, run) => sum + run.events.length, 0) ?? 0

  useEffect(() => {
    if (!selectedLoop) return
    if (Object.prototype.hasOwnProperty.call(timelineByTicket, selectedLoop.ticketId)) return

    const controller = new AbortController()
    let cancelled = false
    setLoadingTicketId(selectedLoop.ticketId)
    setDetailError(null)

    fetch(`/api/admin/research-lab?ticketId=${encodeURIComponent(selectedLoop.ticketId)}`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(body.error || `Timeline request failed with ${res.status}`)
        return body as LabTimelinePayload
      })
      .then((body) => {
        if (!cancelled) {
          setTimelineByTicket((prev) => ({ ...prev, [selectedLoop.ticketId]: body }))
        }
      })
      .catch((e) => {
        if (cancelled || controller.signal.aborted) return
        setDetailError(e instanceof Error ? e.message : 'Could not load Lab timeline')
        setTimelineByTicket((prev) => ({ ...prev, [selectedLoop.ticketId]: null }))
      })
      .finally(() => {
        if (!cancelled) setLoadingTicketId(null)
      })

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [selectedLoop, timelineByTicket])

  return (
    <div className="space-y-6">
      <section>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1
              className="text-2xl font-medium tracking-tight"
              style={{ color: 'var(--text-primary)' }}
            >
              Lab Activity
            </h1>
            <p
              className="mt-1 max-w-2xl text-sm"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Internal Research Lab execution stream with every ticket, queue, auto-research, candidate, scoring, promotion, and public projection event.
            </p>
          </div>
          {payload?.fetchedAt && (
            <div
              className="rounded-lg border px-3 py-2 text-[11px]"
              style={{
                borderColor: 'var(--surface-border)',
                background: 'var(--surface)',
                color: 'var(--text-tertiary)',
              }}
            >
              Fetched {formatDateTime(payload.fetchedAt)}
            </div>
          )}
        </div>
      </section>

      {error ? (
        <div className="rounded-xl border border-burgundy-soft bg-burgundy-soft p-4 text-sm text-burgundy">
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="Loops" value={payload?.stats.totalLoops ?? 0} />
        <Stat label="Running" value={payload?.stats.runningLoops ?? 0} />
        <Stat label="Scored" value={payload?.stats.scoredLoops ?? 0} accent="gold" />
        <Stat label="Failed" value={payload?.stats.failedLoops ?? 0} />
        <Stat label="Miners" value={payload?.stats.uniqueMiners ?? 0} />
      </div>

      <section className="grid min-h-[640px] gap-4 xl:grid-cols-[420px_minmax(0,1fr)]">
        <div className="space-y-3">
          <div className="relative">
            <Search
              className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2"
              style={{ color: 'var(--text-tertiary)' }}
            />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search ticket, run, hotkey, topic..."
              className="premium-focus w-full rounded-lg border px-9 py-2 text-sm placeholder:text-white/30 bg-transparent"
              style={{
                borderColor: 'var(--surface-border)',
                background: 'var(--surface)',
                color: 'var(--text-primary)',
              }}
            />
          </div>

          <div
            className="max-h-[740px] overflow-auto rounded-xl border"
            style={{
              borderColor: 'var(--surface-border)',
              background: 'var(--surface-base)',
            }}
          >
            {filteredLoops.length === 0 ? (
              <div className="p-8 text-center text-sm" style={{ color: 'var(--text-secondary)' }}>
                No Lab loops match the current search.
              </div>
            ) : (
              <div className="space-y-px p-1">
                {filteredLoops.map((loop) => (
                  <LoopButton
                    key={loop.cardId}
                    loop={loop}
                    active={selectedLoop?.ticketId === loop.ticketId}
                    onSelect={() => setSelectedTicketId(loop.ticketId)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        <div
          className="min-w-0 rounded-xl border"
          style={{
            borderColor: 'var(--surface-border)',
            background: 'var(--surface)',
          }}
        >
          {!selectedLoop ? (
            <div className="p-12 text-center text-sm" style={{ color: 'var(--text-secondary)' }}>
              Select a Lab loop to inspect its run logs.
            </div>
          ) : (
            <div className="min-w-0">
              <div
                className="border-b p-5"
                style={{ borderColor: 'var(--surface-border)' }}
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusPill label={selectedLoop.outcomeLabel} band={selectedLoop.outcomeBand} />
                      <span className="font-mono text-xs" style={{ color: 'var(--text-tertiary)' }}>
                        Ticket {shortId(selectedLoop.ticketId)}
                      </span>
                      {selectedLoop.runId ? (
                        <span className="font-mono text-xs" style={{ color: 'var(--text-tertiary)' }}>
                          Run {shortId(selectedLoop.runId)}
                        </span>
                      ) : null}
                    </div>
                    <h2
                      className="mt-3 text-lg font-medium leading-snug"
                      style={{ color: 'var(--text-primary)' }}
                    >
                      {selectedLoop.researchFocusSummary || 'No focus summary published'}
                    </h2>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {(selectedLoop.topicTags.length ? selectedLoop.topicTags : [selectedLoop.researchArea]).slice(0, 6).map((tag) => (
                        <Tag key={tag}>{readableTag(tag)}</Tag>
                      ))}
                    </div>
                  </div>
                  <div className="grid min-w-[280px] grid-cols-2 gap-2">
                    <Meta label="Miner" value={shortHotkey(selectedLoop.minerHotkey)} title={selectedLoop.minerHotkey} />
                    <Meta label="Events" value={loadingSelected ? 'Loading' : String(eventCount)} />
                    <Meta label="Submitted" value={formatDateTime(selectedLoop.submittedAt)} />
                    <Meta label="Last activity" value={formatDateTime(selectedLoop.lastActivityAt)} />
                  </div>
                </div>
              </div>

              <div className="max-h-[720px] overflow-auto p-5">
                {loadingSelected ? (
                  <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
                    <Loader2 className="h-5 w-5 animate-spin text-gold" />
                    Loading detailed run activity...
                  </div>
                ) : detailError ? (
                  <div className="rounded-lg border border-burgundy-soft bg-burgundy-soft p-5 text-sm text-burgundy">
                    {detailError}
                  </div>
                ) : !selectedTimeline || eventCount === 0 ? (
                  <div className="rounded-lg border p-8 text-center text-sm" style={{ borderColor: 'var(--surface-border)', color: 'var(--text-secondary)' }}>
                    No detailed events are available for this loop.
                  </div>
                ) : (
                  <TimelineView timeline={selectedTimeline.timeline} />
                )}
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

function LoopButton({
  loop,
  active,
  onSelect,
}: {
  loop: AdminLabLoopSummary
  active: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'block w-full rounded-lg border px-4 py-3 text-left transition-colors',
        active ? 'border-gold-soft bg-gold-soft' : 'border-transparent hover-bg-warm',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate font-mono text-xs" style={{ color: active ? 'var(--gold)' : 'var(--text-secondary)' }}>
              {shortHotkey(loop.minerHotkey)}
            </span>
            <StatusPill label={loop.outcomeLabel} band={loop.outcomeBand} compact />
          </div>
          <div className="mt-2 line-clamp-2 text-sm" style={{ color: 'var(--text-primary)' }}>
            {loop.researchFocusSummary || 'No focus summary'}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {(loop.topicTags.length ? loop.topicTags : [loop.researchArea]).slice(0, 3).map((tag) => (
              <Tag key={tag}>{readableTag(tag)}</Tag>
            ))}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="font-mono text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
            {formatRelative(loop.lastActivityAt)}
          </div>
          <div className="mt-1 font-mono text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
            {loop.candidateCount} cand · {loop.scoredCandidateCount} scored
          </div>
        </div>
      </div>
    </button>
  )
}

function TimelineView({ timeline }: { timeline: LabTimeline }) {
  return (
    <div className="space-y-5">
      {timeline.runs.map((run, index) => (
        <section
          key={run.runId ?? `ticket-${index}`}
          className="rounded-lg border"
          style={{
            borderColor: 'var(--surface-border)',
            background: 'var(--surface-base)',
          }}
        >
          <div
            className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3"
            style={{ borderColor: 'var(--surface-border)' }}
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[10px] uppercase tracking-[0.14em]" style={{ color: 'var(--text-tertiary)' }}>
                  {run.runId ? 'Run activity' : 'Ticket activity'}
                </span>
                {run.isCurrent ? (
                  <span className="rounded-full border border-gold-soft bg-gold-soft px-2 py-0.5 text-[10px] uppercase tracking-[0.1em] text-gold">
                    Current run
                  </span>
                ) : null}
              </div>
              <div className="mt-1 truncate font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>
                {run.runId ?? 'Ticket-level events'}
              </div>
              {run.receiptId ? (
                <div className="mt-1 truncate font-mono text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                  Receipt {run.receiptId}
                </div>
              ) : null}
            </div>
            <div className="font-mono text-xs" style={{ color: 'var(--text-tertiary)' }}>
              {run.events.length} logs
            </div>
          </div>
          <div className="border-l px-4 py-2 sm:ml-6" style={{ borderColor: 'var(--surface-border)' }}>
            {run.events.map((event) => (
              <TimelineEvent key={`${event.source ?? 'event'}:${event.id}:${event.enteredAt}`} event={event} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

function TimelineEvent({ event }: { event: LabTimelineEvent }) {
  const metadata = event.metadata ? JSON.stringify(event.metadata, null, 2) : ''
  return (
    <div className="relative py-3 pl-3">
      <span
        className="absolute -left-[21px] top-5 h-2.5 w-2.5 rounded-full border"
        style={{ borderColor: 'var(--surface-border-strong)', background: 'var(--surface-base)' }}
      />
      <div className="grid gap-3 lg:grid-cols-[190px_minmax(0,1fr)]">
        <div className="font-mono text-[11px] leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>
          <div className="uppercase tracking-[0.12em]">{timestampKindLabel(event.timestampKind)}</div>
          <time className="mt-1 block" dateTime={event.enteredAt} style={{ color: 'var(--text-secondary)' }}>
            {formatDateTime(event.enteredAt)}
          </time>
          {event.durationSincePreviousMs !== undefined ? (
            <div className="mt-1" style={{ color: 'var(--text-secondary)' }}>
              +{formatDurationMs(event.durationSincePreviousMs)}
            </div>
          ) : null}
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Tag>{phaseLabel(event.phase)}</Tag>
            {event.status ? <Tag>{readableTag(event.status)}</Tag> : null}
            {event.source ? (
              <span className="font-mono text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                {event.source}
              </span>
            ) : null}
          </div>
          <div className="mt-2 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            {event.stage}
          </div>
          {event.summary ? (
            <p className="mt-1 text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              {event.summary}
            </p>
          ) : null}
          {event.timestampKind === 'projection_written' && event.lastActivityAt ? (
            <p className="mt-1 font-mono text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
              Last activity represented {formatDateTime(event.lastActivityAt)}
            </p>
          ) : null}
          {metadata ? (
            <details className="mt-2">
              <summary className="cursor-pointer text-[11px] font-medium" style={{ color: 'var(--text-tertiary)' }}>
                Raw event detail
              </summary>
              <pre
                className="mt-2 max-h-64 overflow-auto rounded-lg border p-3 text-[11px] leading-relaxed"
                style={{
                  borderColor: 'var(--surface-border)',
                  background: 'rgba(0, 0, 0, 0.22)',
                  color: 'var(--text-secondary)',
                }}
              >
                {metadata}
              </pre>
            </details>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: 'gold' }) {
  return (
    <div
      className="rounded-xl border p-4"
      style={{
        borderColor: 'var(--surface-border)',
        background: 'var(--surface)',
      }}
    >
      <div className="text-[10px] uppercase tracking-[0.14em]" style={{ color: 'var(--text-tertiary)' }}>
        {label}
      </div>
      <div className={cn('mt-2 text-2xl font-medium leading-none tabular-nums', accent === 'gold' ? 'text-gold' : '')} style={accent ? undefined : { color: 'var(--text-primary)' }}>
        {value.toLocaleString()}
      </div>
    </div>
  )
}

function Meta({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div
      className="min-w-0 rounded-lg border px-3 py-2"
      style={{
        borderColor: 'var(--surface-border)',
        background: 'var(--surface-elevated)',
      }}
    >
      <div className="text-[10px] uppercase tracking-[0.12em]" style={{ color: 'var(--text-tertiary)' }}>
        {label}
      </div>
      <div className="mt-1 truncate font-mono text-[11px]" title={title ?? value} style={{ color: 'var(--text-secondary)' }}>
        {value}
      </div>
    </div>
  )
}

function StatusPill({ label, band, compact = false }: { label: string; band: string; compact?: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border font-medium uppercase tracking-[0.12em]',
        compact ? 'px-1.5 py-0.5 text-[9px]' : 'px-2.5 py-1 text-[10px]',
        statusTone(label, band),
      )}
    >
      {readableTag(label || band || 'unknown')}
    </span>
  )
}

function Tag({ children }: { children: string }) {
  return (
    <span
      className="inline-flex max-w-full rounded-md border px-1.5 py-0.5 text-[10px]"
      style={{
        borderColor: 'var(--surface-border)',
        background: 'var(--surface-elevated)',
        color: 'var(--text-secondary)',
      }}
    >
      <span className="truncate">{children}</span>
    </span>
  )
}

function statusTone(label: string, band: string): string {
  const value = `${label} ${band}`.toLowerCase()
  if (value.includes('promoted') || value.includes('gain') || value.includes('scored')) {
    return 'border-gold-soft bg-gold-soft text-gold'
  }
  if (value.includes('running') || value.includes('queued') || value.includes('scoring')) {
    return 'border-amber-warm-soft bg-amber-warm-soft text-amber-warm'
  }
  if (value.includes('failed') || value.includes('cancelled')) {
    return 'border-burgundy-soft bg-burgundy-soft text-burgundy'
  }
  return 'border-white/10 text-white/60'
}

function timestampKindLabel(kind: LabTimelineTimestampKind | undefined): string {
  if (kind === 'projection_written') return 'Projection written'
  if (kind === 'last_activity_represented') return 'Last activity represented'
  return 'Entered stage'
}

function phaseLabel(phase: LabTimelinePhase): string {
  if (phase === 'auto_research') return 'Auto research'
  if (phase === 'public_projection') return 'Public projection'
  return readableTag(phase)
}

function formatDurationMs(value: number): string {
  const totalSeconds = Math.max(0, Math.round(value / 1000))
  if (totalSeconds < 60) return `${totalSeconds}s`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes < 60) return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  if (hours < 24) return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`
  const days = Math.floor(hours / 24)
  const remainingHours = hours % 24
  return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`
}

function readableTag(value: string): string {
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function shortId(value: string): string {
  if (!value) return '—'
  if (value.length <= 12) return value
  return `${value.slice(0, 8)}…${value.slice(-4)}`
}
