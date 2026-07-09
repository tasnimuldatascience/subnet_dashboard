'use client'

import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Clock3,
  CircleDollarSign,
  Database,
  Gauge,
  Loader2,
  PauseCircle,
  PlayCircle,
  Search,
  ShieldCheck,
  ShieldX,
  Siren,
} from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
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

type AdminHealthState = 'healthy' | 'degraded' | 'critical' | 'unknown'
type AdminScoringState = 'active' | 'paused' | 'stalled' | 'blocked' | 'idle' | 'unknown'

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
  publicStatus?: string
  paymentState?: string
  executionState?: string
  candidateState?: string
  resultState?: string
  opsReason?: string
  statusDetail?: string
  opsWarnings?: string[]
  statusKey: string
  statusLabel: string
  statusNote?: AdminLoopStatusNote
  actionNote?: AdminLoopStatusNote
  candidateCount: number
  scoredCandidateCount: number
  bestCandidatePublicSummary: string
  lastActivityAt: string
  submittedAt: string
}

type AdminLoopStatusNote = {
  tone: 'info' | 'warning' | 'error'
  label: string
  detail: string
}

type AdminLabHealthSignal = {
  id: string
  label: string
  value: string
  state: AdminHealthState
  detail: string
  updatedAt?: string | null
}

type AdminLabScoringSummary = {
  state: AdminScoringState
  label: string
  detail: string
  source: 'explicit' | 'inferred' | 'missing'
  paused: boolean
  pauseReason: string | null
  controlUpdatedAt: string | null
  activeRuns: number
  scoringRuns: number
  queuedRuns: number
  blockedRuns: number
  staleRuns: number
  candidatesRemaining: number
  icpsRemaining: number | null
  scoreBundlesLastHour: number
  scoreBundlesLast24h: number
  lastScoringAt: string | null
  oldestActiveRunAt: string | null
}

type AdminLabActiveRun = {
  ticketId: string
  runId: string | null
  receiptId: string | null
  minerHotkey: string
  researchFocusSummary: string
  topicTags: string[]
  statusKey: string
  statusLabel: string
  phase: string
  candidateCount: number
  scoredCandidateCount: number
  candidatesRemaining: number
  icpTotal: number | null
  icpsScored: number | null
  icpsRemaining: number | null
  scoreBundleId: string | null
  scoreBundleStatus: string | null
  blocker: string | null
  submittedAt: string
  lastActivityAt: string
  ageMs: number
  idleMs: number
  stale: boolean
}

type AdminLabPipelineStage = {
  id: string
  label: string
  count: number
  staleCount: number
  percent: number
}

type AdminLabBenchmarkSummary = {
  state: AdminHealthState
  reportId: string | null
  benchmarkDate: string | null
  rollingWindowHash: string | null
  aggregateScore: number | null
  itemCount: number
  publicIcpCount: number
  privateHoldoutIcpCount: number
  currentStatusAt: string | null
  ageMs: number | null
  issueCount: number
  topIssues: Array<{ key: string; count: number }>
  detail: string
}

type AdminLabAlertSummary = {
  state: AdminHealthState
  source: 'ops_telemetry' | 'public_transparency_log' | 'none'
  sourceAvailable: boolean
  unavailableReason: string | null
  totalLast24h: number
  criticalLast24h: number
  warningLast24h: number
  activeCount: number
  verifiedEventCount: number
  weightSubmissionCount: number
  epochAuditCount: number
  latestObservedAt: string | null
  latestCheckpointAt: string | null
  latestCheckpointUrl: string | null
  recent: AdminLabAlert[]
}

type AdminLabAlert = {
  id: string
  severity: string
  source: string
  title: string
  fingerprint: string
  status: string
  count: number
  firstSeenAt: string | null
  lastSeenAt: string | null
}

type AdminLabAttestationSummary = {
  state: AdminHealthState
  source: 'ops_attestation_current' | 'published_weight_bundles' | 'none'
  verificationMode: 'expected_match' | 'gateway_acceptance' | 'observation_only'
  sourceAvailable: boolean
  unavailableReason: string | null
  totalNodes: number
  matchedNodes: number
  mismatchedNodes: number
  missingNodes: number
  expectedPcr0: string | null
  latestAttestedAt: string | null
  latestEpoch: number | null
  acceptanceCheckedAt: string | null
  acceptanceDetail: string | null
  nodes: AdminLabAttestationNode[]
}

type AdminLabAttestationNode = {
  id: string
  component: string
  nodeId: string
  hotkey: string | null
  expectedPcr0: string | null
  observedPcr0: string | null
  matched: boolean | null
  buildId: string | null
  gitSha: string | null
  attestedAt: string | null
  epoch: number | null
  transparencyEventHash: string | null
  acceptanceCheckedAt: string | null
  acceptanceDetail: string | null
}

type AdminLabDataFreshness = {
  state: AdminHealthState
  latestActivityAt: string | null
  ageMs: number | null
  loopCount: number
}

type AdminLabComputeSpendPoint = {
  date: string
  spendUsd: number
  runCount: number
}

type AdminLabComputeSpendSummary = {
  sourceAvailable: boolean
  unavailableReason: string | null
  days: number
  points: AdminLabComputeSpendPoint[]
  totalUsd: number
  averageDailyUsd: number
  latestDayUsd: number
  runCount: number
  reconciliation: {
    sourceAvailable: boolean
    unavailableReason: string | null
    reachedScoringCount: number
    candidateNotScoredCount: number
    noCandidateCount: number
    noCandidateFailedCount: number
    noCandidateCompletedCount: number
  }
}

type AdminLabOpsSummary = {
  state: AdminHealthState
  healthSignals: AdminLabHealthSignal[]
  dataFreshness: AdminLabDataFreshness
  scoring: AdminLabScoringSummary
  activeRuns: AdminLabActiveRun[]
  pipeline: AdminLabPipelineStage[]
  benchmark: AdminLabBenchmarkSummary
  alerts: AdminLabAlertSummary
  attestation: AdminLabAttestationSummary
  computeSpend: AdminLabComputeSpendSummary
}

export type AdminResearchLabPayload = {
  loops: AdminLabLoopSummary[]
  ops: AdminLabOpsSummary
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
  const ops = payload?.ops ?? null
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
        loop.statusKey,
        loop.statusLabel,
        loop.opsReason ?? '',
        loop.statusDetail ?? '',
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

      {ops ? (
        <>
          <OpsHealthStrip ops={ops} />

          <ComputeSpendPanel spend={ops.computeSpend} />

          <section className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.7fr)]">
            <ScoringPanel scoring={ops.scoring} />
            <PipelinePanel stages={ops.pipeline} />
          </section>

          <ActiveRunsPanel
            runs={ops.activeRuns}
            selectedTicketId={selectedLoop?.ticketId ?? null}
            onSelect={(ticketId) => setSelectedTicketId(ticketId)}
          />

          <section className="grid gap-4 xl:grid-cols-3">
            <BenchmarkPanel benchmark={ops.benchmark} />
            <AlertsPanel alerts={ops.alerts} />
            <AttestationPanel attestation={ops.attestation} />
          </section>
        </>
      ) : null}

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

function OpsHealthStrip({ ops }: { ops: AdminLabOpsSummary }) {
  return (
    <section
      className="rounded-xl border"
      style={{
        borderColor: 'var(--surface-border)',
        background: 'var(--surface)',
      }}
    >
      <div
        className="flex flex-col gap-3 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
        style={{ borderColor: 'var(--surface-border)' }}
      >
        <div className="flex items-center gap-2">
          <Activity className={cn('h-4 w-4', stateTextClass(ops.state))} />
          <div>
            <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
              Lab Ops
            </div>
            <div suppressHydrationWarning className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
              {ops.dataFreshness.latestActivityAt
                ? `Latest activity ${formatRelative(ops.dataFreshness.latestActivityAt)}`
                : 'No Lab activity returned'}
            </div>
          </div>
        </div>
        <StatePill state={ops.state} label={stateLabel(ops.state)} />
      </div>
      <div className="grid gap-px p-1 sm:grid-cols-2 lg:grid-cols-5">
        {ops.healthSignals.map((signal) => (
          <HealthSignalCard key={signal.id} signal={signal} />
        ))}
      </div>
    </section>
  )
}

function HealthSignalCard({ signal }: { signal: AdminLabHealthSignal }) {
  const Icon = signalIcon(signal.id, signal.state)
  const emphasizedMismatch = signal.id === 'pcr0' && signal.value === 'Mismatch'
  return (
    <div
      className="rounded-lg border p-3"
      style={{
        borderColor: emphasizedMismatch ? 'rgba(232, 240, 255, 0.34)' : 'var(--surface-border)',
        background: emphasizedMismatch ? 'rgba(232, 240, 255, 0.075)' : 'var(--surface-base)',
        boxShadow: emphasizedMismatch ? 'inset 2px 0 0 rgba(232, 240, 255, 0.9)' : undefined,
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Icon
              className={cn('h-3.5 w-3.5 shrink-0', stateTextClass(signal.state))}
              style={emphasizedMismatch ? { color: 'var(--white)' } : undefined}
            />
            <div className="truncate text-[10px] uppercase tracking-[0.14em]" style={{ color: 'var(--text-tertiary)' }}>
              {signal.label}
            </div>
          </div>
          <div className="mt-2 truncate text-lg font-medium tabular-nums" style={{ color: emphasizedMismatch ? 'var(--white)' : 'var(--text-primary)' }}>
            {signal.value}
          </div>
        </div>
        <span
          className={cn('mt-1 h-2 w-2 shrink-0 rounded-full', stateDotClass(signal.state))}
          style={emphasizedMismatch ? { background: 'var(--white)' } : undefined}
        />
      </div>
      <div className="mt-2 line-clamp-2 text-[11px] leading-relaxed" style={{ color: emphasizedMismatch ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
        {signal.detail}
      </div>
      {signal.updatedAt ? (
        <div suppressHydrationWarning className="mt-2 font-mono text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
          {formatRelative(signal.updatedAt)}
        </div>
      ) : null}
    </div>
  )
}

function ComputeSpendPanel({ spend }: { spend: AdminLabComputeSpendSummary }) {
  return (
    <section
      className="rounded-xl border"
      style={{
        borderColor: 'var(--surface-border)',
        background: 'var(--surface)',
      }}
    >
      <PanelHeader
        icon={<CircleDollarSign className="h-4 w-4 text-gold" />}
        title="Daily compute spend"
        aside={(
          <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
            UTC · last {spend.days} days
          </span>
        )}
      />
      {!spend.sourceAvailable ? (
        <div className="p-6 text-sm" style={{ color: 'var(--text-secondary)' }}>
          Finalized compute-cost ledgers are not available.
        </div>
      ) : (
        <div className="grid gap-5 p-4 xl:grid-cols-[minmax(0,1fr)_220px]">
          <div className="min-w-0">
            <div className="h-[260px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={spend.points} margin={{ top: 12, right: 12, bottom: 4, left: 0 }}>
                  <CartesianGrid vertical={false} stroke="rgba(245, 240, 232, 0.07)" />
                  <XAxis
                    dataKey="date"
                    axisLine={false}
                    tickLine={false}
                    minTickGap={28}
                    tick={{ fill: 'var(--text-tertiary)', fontSize: 10 }}
                    tickFormatter={formatChartDate}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    width={54}
                    tick={{ fill: 'var(--text-tertiary)', fontSize: 10 }}
                    tickFormatter={formatCompactUsd}
                  />
                  <Tooltip
                    cursor={{ fill: 'rgba(245, 240, 232, 0.035)' }}
                    contentStyle={{
                      border: '1px solid var(--surface-border-strong)',
                      borderRadius: 8,
                      background: 'var(--surface-elevated)',
                      color: 'var(--text-primary)',
                      fontSize: 12,
                    }}
                    labelStyle={{ color: 'var(--text-secondary)', marginBottom: 4 }}
                    formatter={(value) => [formatUsd(Number(value)), 'Compute spent']}
                    labelFormatter={(value) => formatChartTooltipDate(String(value))}
                  />
                  <Bar
                    dataKey="spendUsd"
                    name="Compute spent"
                    fill="var(--accent-positive)"
                    fillOpacity={0.72}
                    maxBarSize={42}
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>
              Finalized OpenRouter cost from completed and failed receipt events, assigned to the UTC day the run ended.
            </p>
          </div>
          <div className="self-start">
            <div className="grid grid-cols-2 gap-2 xl:grid-cols-1">
              <MetricBox label={`${spend.days}d spend`} value={formatUsd(spend.totalUsd)} />
              <MetricBox label="Daily average" value={formatUsd(spend.averageDailyUsd)} />
              <MetricBox label="Today (UTC)" value={formatUsd(spend.latestDayUsd)} />
              <MetricBox label="Finalized runs" value={spend.runCount} />
            </div>
            <FinalizedRunReconciliation reconciliation={spend.reconciliation} />
          </div>
        </div>
      )}
    </section>
  )
}

function FinalizedRunReconciliation({
  reconciliation,
}: {
  reconciliation: AdminLabComputeSpendSummary['reconciliation']
}) {
  return (
    <div
      className="mt-2 rounded-lg border px-3 py-3"
      style={{ borderColor: 'var(--surface-border)', background: 'var(--surface-base)' }}
    >
      <div className="text-[10px] uppercase tracking-[0.12em]" style={{ color: 'var(--text-tertiary)' }}>
        Finalized run outcomes
      </div>
      {!reconciliation.sourceAvailable ? (
        <p className="mt-2 text-[11px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          Outcome reconciliation is unavailable.
        </p>
      ) : (
        <>
          <div className="mt-2 divide-y" style={{ borderColor: 'var(--surface-border)' }}>
            <ReconciliationRow
              label="Reached scoring"
              value={reconciliation.reachedScoringCount}
              tone="positive"
            />
            <ReconciliationRow
              label="Candidate, not scored"
              value={reconciliation.candidateNotScoredCount}
            />
            <ReconciliationRow label="No candidate" value={reconciliation.noCandidateCount} />
          </div>
          <div
            className="mt-2 flex items-center justify-between gap-3 border-t pt-2 text-[10px] xl:block"
            style={{ borderColor: 'var(--surface-border)', color: 'var(--text-tertiary)' }}
          >
            <span>No-candidate split</span>
            <span className="shrink-0 tabular-nums xl:mt-1 xl:block">
              {reconciliation.noCandidateFailedCount.toLocaleString()} failed ·{' '}
              {reconciliation.noCandidateCompletedCount.toLocaleString()} completed
            </span>
          </div>
        </>
      )}
    </div>
  )
}

function ReconciliationRow({
  label,
  value,
  tone = 'neutral',
}: {
  label: string
  value: number
  tone?: 'neutral' | 'positive'
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 text-[11px]">
      <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
      <span
        className="font-mono font-medium tabular-nums"
        style={{ color: tone === 'positive' ? 'var(--accent-positive)' : 'var(--text-primary)' }}
      >
        {value.toLocaleString()}
      </span>
    </div>
  )
}

function ScoringPanel({ scoring }: { scoring: AdminLabScoringSummary }) {
  const Icon = scoring.paused ? PauseCircle : scoring.state === 'active' ? PlayCircle : Gauge
  return (
    <section
      className="rounded-xl border"
      style={{
        borderColor: 'var(--surface-border)',
        background: 'var(--surface)',
      }}
    >
      <PanelHeader
        icon={<Icon className={cn('h-4 w-4', stateTextClass(healthStateForScoring(scoring.state)))} />}
        title="Scoring"
        aside={<StatePill state={healthStateForScoring(scoring.state)} label={scoring.label} />}
      />
      <div className="space-y-4 p-4">
        <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          {scoring.detail}
        </p>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <MetricBox label="Active runs" value={scoring.activeRuns} />
          <MetricBox label="Scoring" value={scoring.scoringRuns} />
          <MetricBox label="Queued" value={scoring.queuedRuns} />
          <MetricBox label="Stale" value={scoring.staleRuns} tone={scoring.staleRuns > 0 ? 'critical' : 'neutral'} />
          <MetricBox label="ICPs left" value={scoring.icpsRemaining ?? '—'} />
          <MetricBox label="Candidates left" value={scoring.candidatesRemaining} />
          <MetricBox label="Score bundles 1h" value={scoring.scoreBundlesLastHour} />
          <MetricBox label="Score bundles 24h" value={scoring.scoreBundlesLast24h} />
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <MiniMeta label="Source" value={readableTag(scoring.source)} />
          <MiniMeta label="Last scoring" value={scoring.lastScoringAt ? formatRelative(scoring.lastScoringAt) : '—'} />
          <MiniMeta label="Oldest active" value={scoring.oldestActiveRunAt ? formatRelative(scoring.oldestActiveRunAt) : '—'} />
        </div>
      </div>
    </section>
  )
}

function PipelinePanel({ stages }: { stages: AdminLabPipelineStage[] }) {
  const max = Math.max(1, ...stages.map((stage) => stage.count))
  return (
    <section
      className="rounded-xl border"
      style={{
        borderColor: 'var(--surface-border)',
        background: 'var(--surface)',
      }}
    >
      <PanelHeader
        icon={<BarChart3 className="h-4 w-4 text-gold" />}
        title="Pipeline"
        aside={<span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>{stages.reduce((sum, stage) => sum + stage.count, 0)} stage hits</span>}
      />
      <div className="space-y-3 p-4">
        {stages.map((stage) => (
          <div key={stage.id}>
            <div className="mb-1 flex items-center justify-between gap-3 text-xs">
              <span style={{ color: 'var(--text-secondary)' }}>{stage.label}</span>
              <span className="font-mono" style={{ color: stage.staleCount > 0 ? 'var(--accent-negative)' : 'var(--text-tertiary)' }}>
                {stage.count}{stage.staleCount > 0 ? ` · ${stage.staleCount} stale` : ''}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full" style={{ background: 'rgba(245, 240, 232, 0.06)' }}>
              <div
                className={cn('h-full rounded-full', stage.staleCount > 0 ? 'bg-burgundy-soft' : 'bg-gold-soft')}
                style={{
                  width: `${Math.max(3, Math.round((stage.count / max) * 100))}%`,
                  backgroundColor: stage.staleCount > 0 ? 'rgba(168, 116, 111, 0.55)' : 'rgba(201, 169, 110, 0.55)',
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function ActiveRunsPanel({
  runs,
  selectedTicketId,
  onSelect,
}: {
  runs: AdminLabActiveRun[]
  selectedTicketId: string | null
  onSelect: (ticketId: string) => void
}) {
  return (
    <section
      className="rounded-xl border"
      style={{
        borderColor: 'var(--surface-border)',
        background: 'var(--surface)',
      }}
    >
      <PanelHeader
        icon={<Clock3 className="h-4 w-4 text-gold" />}
        title="Current Runs"
        aside={<span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>{runs.length} visible</span>}
      />
      {runs.length === 0 ? (
        <div className="p-6 text-sm" style={{ color: 'var(--text-secondary)' }}>
          No active or blocked Lab runs are visible in the current window.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left text-xs">
            <thead
              className="border-b"
              style={{ borderColor: 'var(--surface-border)', color: 'var(--text-tertiary)' }}
            >
              <tr>
                <th className="px-4 py-3 font-medium">Run</th>
                <th className="px-3 py-3 font-medium">Phase</th>
                <th className="px-3 py-3 text-right font-medium">ICPs left</th>
                <th className="px-3 py-3 text-right font-medium">Candidates</th>
                <th className="px-3 py-3 font-medium">Bundle</th>
                <th className="px-3 py-3 font-medium">Idle</th>
                <th className="px-4 py-3 font-medium">Blocker</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => {
                const active = selectedTicketId === run.ticketId
                return (
                  <tr
                    key={`${run.ticketId}:${run.runId ?? 'ticket'}`}
                    onClick={() => onSelect(run.ticketId)}
                    className={cn('cursor-pointer border-b transition-colors hover-bg-warm', active ? 'bg-gold-soft' : '')}
                    style={{ borderColor: 'var(--surface-border)' }}
                  >
                    <td className="max-w-[320px] px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className={cn('h-2 w-2 shrink-0 rounded-full', run.stale ? 'bg-burgundy-soft' : 'bg-gold-soft')} style={{ backgroundColor: run.stale ? 'var(--accent-negative)' : 'var(--accent-positive)' }} />
                        <span className="truncate font-medium" style={{ color: 'var(--text-primary)' }}>
                          {run.researchFocusSummary || 'No focus summary'}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                        <span>{shortHotkey(run.minerHotkey)}</span>
                        <span>Ticket {shortId(run.ticketId)}</span>
                        {run.runId ? <span>Run {shortId(run.runId)}</span> : null}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <StatusPill label={run.statusLabel || run.statusKey} band={run.stale ? 'failed' : 'running'} compact />
                      <div className="mt-1 text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                        {readableTag(run.phase)}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right font-mono" style={{ color: 'var(--text-primary)' }}>
                      {run.icpsRemaining === null ? '—' : run.icpsRemaining}
                      <div className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                        {run.icpTotal === null ? 'unknown total' : `${run.icpsScored ?? 0}/${run.icpTotal}`}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right font-mono" style={{ color: 'var(--text-primary)' }}>
                      {run.candidatesRemaining}
                      <div className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                        {run.scoredCandidateCount}/{run.candidateCount}
                      </div>
                    </td>
                    <td className="max-w-[170px] px-3 py-3">
                      <div className="truncate font-mono text-[11px]" style={{ color: 'var(--text-secondary)' }} title={run.scoreBundleId ?? undefined}>
                        {run.scoreBundleId ? shortId(run.scoreBundleId) : '—'}
                      </div>
                      <div className="mt-1 truncate text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                        {run.scoreBundleStatus ? readableTag(run.scoreBundleStatus) : 'No bundle yet'}
                      </div>
                    </td>
                    <td className="px-3 py-3 font-mono" style={{ color: run.stale ? 'var(--accent-negative)' : 'var(--text-secondary)' }}>
                      {formatDurationMs(run.idleMs)}
                      <div className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                        age {formatDurationMs(run.ageMs)}
                      </div>
                    </td>
                    <td className="max-w-[260px] px-4 py-3">
                      <div className="line-clamp-2 text-[11px] leading-relaxed" style={{ color: run.blocker ? 'var(--text-secondary)' : 'var(--text-tertiary)' }}>
                        {run.blocker || 'No blocker reported'}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function BenchmarkPanel({ benchmark }: { benchmark: AdminLabBenchmarkSummary }) {
  return (
    <section className="rounded-xl border" style={{ borderColor: 'var(--surface-border)', background: 'var(--surface)' }}>
      <PanelHeader
        icon={<Database className={cn('h-4 w-4', stateTextClass(benchmark.state))} />}
        title="Benchmark"
        aside={<StatePill state={benchmark.state} label={stateLabel(benchmark.state)} />}
      />
      <div className="space-y-4 p-4">
        <div className="grid grid-cols-2 gap-2">
          <MetricBox label="Score" value={benchmark.aggregateScore === null ? '—' : benchmark.aggregateScore.toFixed(2)} />
          <MetricBox label="ICPs" value={benchmark.itemCount} />
          <MetricBox label="Public" value={benchmark.publicIcpCount} />
          <MetricBox label="Holdout" value={benchmark.privateHoldoutIcpCount} />
        </div>
        <MiniMeta label="Date" value={benchmark.benchmarkDate ?? '—'} />
        <MiniMeta label="Updated" value={benchmark.currentStatusAt ? formatRelative(benchmark.currentStatusAt) : '—'} />
        {benchmark.topIssues.length > 0 ? (
          <div className="space-y-1">
            {benchmark.topIssues.slice(0, 3).map((issue) => (
              <div key={issue.key} className="flex items-center justify-between gap-3 text-xs">
                <span className="truncate" style={{ color: 'var(--text-secondary)' }}>{readableTag(issue.key)}</span>
                <span className="font-mono" style={{ color: 'var(--text-tertiary)' }}>{issue.count}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            {benchmark.detail}
          </p>
        )}
      </div>
    </section>
  )
}

function AlertsPanel({ alerts }: { alerts: AdminLabAlertSummary }) {
  const sourceLabel = alerts.source === 'public_transparency_log'
    ? 'Public signed logs'
    : alerts.source === 'ops_telemetry'
      ? 'Ops telemetry'
      : 'Unavailable'

  return (
    <section className="rounded-xl border" style={{ borderColor: 'var(--surface-border)', background: 'var(--surface)' }}>
      <PanelHeader
        icon={<Siren className={cn('h-4 w-4', stateTextClass(alerts.state))} />}
        title="Alerts"
        aside={<StatePill state={alerts.state} label={alerts.sourceAvailable ? stateLabel(alerts.state) : 'Not wired'} />}
      />
      <div className="space-y-4 p-4">
        <div className="grid grid-cols-3 gap-2">
          <MetricBox label="24h" value={alerts.totalLast24h} />
          <MetricBox label="Critical" value={alerts.criticalLast24h} tone={alerts.criticalLast24h > 0 ? 'critical' : 'neutral'} />
          <MetricBox label="Active" value={alerts.activeCount} />
        </div>
        <MiniMeta label="Source" value={sourceLabel} />
        {alerts.source === 'public_transparency_log' ? (
          <div className="grid grid-cols-2 gap-2">
            <MiniMeta label="Signed events" value={String(alerts.verifiedEventCount)} />
            <MiniMeta
              label="Arweave checkpoint"
              value={alerts.latestCheckpointAt ? formatRelative(alerts.latestCheckpointAt) : 'Missing'}
              title={alerts.latestCheckpointAt ?? undefined}
            />
          </div>
        ) : null}
        {alerts.latestCheckpointUrl ? (
          <a
            href={alerts.latestCheckpointUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex text-xs underline decoration-white/20 underline-offset-4 transition-colors hover:text-white"
            style={{ color: 'var(--text-secondary)' }}
          >
            Open latest public Arweave checkpoint
          </a>
        ) : null}
        {!alerts.sourceAvailable ? (
          <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            Supabase could not read alert telemetry or the signed public <span className="font-mono">transparency_log</span> fallback.
          </p>
        ) : alerts.recent.length === 0 ? (
          <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            {alerts.source === 'public_transparency_log'
              ? `${alerts.weightSubmissionCount} weight submissions and ${alerts.epochAuditCount} matching epoch audits were checked. No derived issues.`
              : 'No recent alerts in the telemetry source.'}
          </p>
        ) : (
          <div className="space-y-2">
            {alerts.recent.slice(0, 4).map((alert) => (
              <div key={alert.id} className="border-t pt-2" style={{ borderColor: 'var(--surface-border)' }}>
                <div className="flex items-center justify-between gap-3">
                  <span className="truncate text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{alert.title}</span>
                  <span className="font-mono text-[10px]" style={{ color: alert.severity === 'critical' ? 'var(--accent-negative)' : 'var(--text-tertiary)' }}>
                    {readableTag(alert.severity)}
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between gap-3 text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                  <span className="truncate">{alert.source}</span>
                  <span suppressHydrationWarning>{alert.lastSeenAt ? formatRelative(alert.lastSeenAt) : '—'}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

function AttestationPanel({ attestation }: { attestation: AdminLabAttestationSummary }) {
  const observationOnly = attestation.verificationMode === 'observation_only'
  const gatewayAcceptance = attestation.verificationMode === 'gateway_acceptance'
  const hasMismatch = attestation.mismatchedNodes > 0
  const observedNodes = attestation.totalNodes - attestation.missingNodes
  const latestNode = attestation.nodes[0] ?? null
  const sourceLabel = gatewayAcceptance
    ? 'Production gateway readiness'
    : attestation.source === 'published_weight_bundles'
      ? 'Published weight bundles'
    : attestation.source === 'ops_attestation_current'
      ? 'Attestation comparison'
      : 'Unavailable'
  const statusLabel = !attestation.sourceAvailable
    ? 'Not wired'
    : hasMismatch
      ? 'Mismatch'
      : gatewayAcceptance
        ? 'Match'
        : stateLabel(attestation.state)

  return (
    <section
      className="rounded-xl border"
      style={{
        borderColor: hasMismatch ? 'rgba(232, 240, 255, 0.24)' : 'var(--surface-border)',
        background: 'var(--surface)',
      }}
    >
      <PanelHeader
        icon={attestation.state === 'critical' ? <ShieldX className="h-4 w-4 text-burgundy" /> : <ShieldCheck className={cn('h-4 w-4', stateTextClass(attestation.state))} />}
        title="PCR0"
        aside={<StatePill state={attestation.state} label={statusLabel} emphasized={hasMismatch} />}
      />
      <div className="space-y-4 p-4">
        {hasMismatch ? (
          <div
            role="alert"
            className="rounded-lg border p-3"
            style={{
              borderColor: 'rgba(232, 240, 255, 0.42)',
              background: 'rgba(232, 240, 255, 0.09)',
              boxShadow: 'inset 3px 0 0 var(--white)',
              color: 'var(--text-primary)',
            }}
          >
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <div className="text-xs font-semibold">PCR0 mismatch — weight publication blocked</div>
                <p className="mt-1 text-[11px] leading-relaxed">
                  The production gateway rejects the validator&apos;s published PCR0. Validators that require audited gateway publication will not submit chain weights until the gateway accepts this PCR0.
                </p>
              </div>
            </div>
          </div>
        ) : null}
        <div className="grid grid-cols-3 gap-2">
          <MetricBox label="Nodes" value={attestation.totalNodes} />
          <MetricBox
            label={gatewayAcceptance ? 'Accepted' : observationOnly ? 'Observed' : 'Matched'}
            value={observationOnly ? observedNodes : attestation.matchedNodes}
          />
          <MetricBox
            label={gatewayAcceptance ? 'Rejected' : observationOnly ? 'Missing' : 'Mismatch'}
            value={observationOnly ? attestation.missingNodes : attestation.mismatchedNodes}
            tone={(observationOnly ? attestation.missingNodes : attestation.mismatchedNodes) > 0 ? 'critical' : 'neutral'}
          />
        </div>
        <MiniMeta label="Source" value={sourceLabel} />
        {attestation.expectedPcr0 ? (
          <MiniMeta label="Expected PCR0" value={compactHash(attestation.expectedPcr0)} title={attestation.expectedPcr0} />
        ) : null}
        {attestation.source === 'published_weight_bundles' && latestNode?.observedPcr0 ? (
          <MiniMeta label="Observed PCR0" value={compactHash(latestNode.observedPcr0)} title={latestNode.observedPcr0} />
        ) : null}
        {attestation.source === 'published_weight_bundles' && (attestation.latestEpoch !== null || latestNode?.gitSha) ? (
          <div className="grid grid-cols-2 gap-2">
            <MiniMeta label="Epoch" value={attestation.latestEpoch === null ? '—' : String(Math.round(attestation.latestEpoch))} />
            <MiniMeta
              label="PCR0 commit"
              value={latestNode?.gitSha ? compactHash(latestNode.gitSha) : '—'}
              title={latestNode?.gitSha ?? undefined}
            />
          </div>
        ) : null}
        {gatewayAcceptance && attestation.acceptanceDetail ? (
          <p className="text-xs leading-relaxed" style={{ color: hasMismatch ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
            {attestation.acceptanceDetail}
          </p>
        ) : null}
        {observationOnly && attestation.sourceAvailable ? (
          <div className="rounded-lg border border-gold-soft bg-gold-soft p-3 text-xs leading-relaxed text-gold">
            Gateway comparison unavailable. {attestation.acceptanceDetail ?? 'The dashboard cannot verify whether the published PCR0 is accepted.'}
          </div>
        ) : null}
        {!attestation.sourceAvailable ? (
          <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            Supabase could not read <span className="font-mono">ops_attestation_current</span> or the published weight-bundle PCR0 fallback.
          </p>
        ) : attestation.nodes.length === 0 ? (
          <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            No attestation rows are reporting.
          </p>
        ) : (
          <div className="space-y-2">
            {attestation.nodes.slice(0, 5).map((node) => (
              <div key={node.id} className="flex items-center justify-between gap-3 border-t pt-2" style={{ borderColor: 'var(--surface-border)' }}>
                <div className="min-w-0">
                  <div className="truncate text-xs" title={node.nodeId} style={{ color: 'var(--text-primary)' }}>{node.component} · {compactHash(node.nodeId)}</div>
                  <div className="mt-1 truncate font-mono text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                    {node.observedPcr0 ? compactHash(node.observedPcr0) : 'missing PCR0'}
                    {node.epoch !== null ? ` · epoch ${Math.round(node.epoch)}` : ''}
                  </div>
                </div>
                <StatePill
                  state={observationOnly
                    ? node.observedPcr0 ? 'healthy' : 'critical'
                    : node.matched === false ? 'critical' : node.matched === null ? 'degraded' : 'healthy'}
                  label={observationOnly
                    ? node.observedPcr0 ? 'Unverified' : 'Missing'
                    : node.matched === false ? 'Mismatch' : node.matched === null ? 'Unverified' : 'Match'}
                  emphasized={node.matched === false}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

function PanelHeader({
  icon,
  title,
  aside,
}: {
  icon: ReactNode
  title: string
  aside?: ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b px-4 py-3" style={{ borderColor: 'var(--surface-border)' }}>
      <div className="flex min-w-0 items-center gap-2">
        {icon}
        <h2 className="truncate text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
          {title}
        </h2>
      </div>
      {aside ? <div className="shrink-0">{aside}</div> : null}
    </div>
  )
}

function MetricBox({
  label,
  value,
  tone = 'neutral',
}: {
  label: string
  value: number | string
  tone?: 'neutral' | 'critical'
}) {
  return (
    <div className="rounded-lg border px-3 py-2" style={{ borderColor: 'var(--surface-border)', background: 'var(--surface-base)' }}>
      <div className="text-[10px] uppercase tracking-[0.12em]" style={{ color: 'var(--text-tertiary)' }}>
        {label}
      </div>
      <div className="mt-1 text-lg font-medium tabular-nums" style={{ color: tone === 'critical' ? 'var(--white)' : 'var(--text-primary)' }}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </div>
    </div>
  )
}

function MiniMeta({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="min-w-0 rounded-lg border px-3 py-2" style={{ borderColor: 'var(--surface-border)', background: 'var(--surface-base)' }}>
      <div className="text-[10px] uppercase tracking-[0.12em]" style={{ color: 'var(--text-tertiary)' }}>{label}</div>
      <div suppressHydrationWarning className="mt-1 truncate font-mono text-[11px]" title={title ?? value} style={{ color: 'var(--text-secondary)' }}>{value}</div>
    </div>
  )
}

function StatePill({
  state,
  label,
  emphasized = false,
}: {
  state: AdminHealthState
  label: string
  emphasized?: boolean
}) {
  return (
    <span
      className={cn('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em]', statePillClass(state))}
      style={emphasized ? {
        borderColor: 'rgba(232, 240, 255, 0.42)',
        background: 'rgba(232, 240, 255, 0.10)',
        color: 'var(--white)',
      } : undefined}
    >
      <span
        className={cn('h-1.5 w-1.5 rounded-full', stateDotClass(state))}
        style={emphasized ? { background: 'var(--white)' } : undefined}
      />
      {label}
    </span>
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
          <div suppressHydrationWarning className="font-mono text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
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

function healthStateForScoring(state: AdminScoringState): AdminHealthState {
  if (state === 'active' || state === 'idle') return 'healthy'
  if (state === 'paused' || state === 'stalled' || state === 'blocked') return 'degraded'
  if (state === 'unknown') return 'unknown'
  return 'degraded'
}

function stateLabel(state: AdminHealthState): string {
  switch (state) {
    case 'healthy':
      return 'Healthy'
    case 'degraded':
      return 'Degraded'
    case 'critical':
      return 'Critical'
    default:
      return 'Unknown'
  }
}

function statePillClass(state: AdminHealthState): string {
  switch (state) {
    case 'healthy':
      return 'border-gold-soft bg-gold-soft text-gold'
    case 'degraded':
      return 'border-amber-warm-soft bg-amber-warm-soft text-amber-warm'
    case 'critical':
      return 'border-burgundy-soft bg-burgundy-soft text-burgundy'
    default:
      return 'border-white/10 text-white/55'
  }
}

function stateTextClass(state: AdminHealthState): string {
  switch (state) {
    case 'healthy':
      return 'text-gold'
    case 'degraded':
      return 'text-amber-warm'
    case 'critical':
      return 'text-burgundy'
    default:
      return 'text-white/45'
  }
}

function stateDotClass(state: AdminHealthState): string {
  switch (state) {
    case 'healthy':
      return 'bg-[var(--accent-positive)]'
    case 'degraded':
      return 'bg-[var(--accent-pending)]'
    case 'critical':
      return 'bg-[var(--accent-negative)]'
    default:
      return 'bg-white/30'
  }
}

function signalIcon(id: string, state: AdminHealthState) {
  if (id === 'pcr0') return state === 'critical' ? ShieldX : ShieldCheck
  if (id === 'alerts') return state === 'critical' || state === 'degraded' ? AlertTriangle : Siren
  if (id === 'benchmark') return Database
  if (id === 'freshness') return Clock3
  if (id === 'scoring') return Gauge
  return Activity
}

function compactHash(value: string): string {
  if (!value) return '—'
  if (value.length <= 18) return value
  return `${value.slice(0, 10)}…${value.slice(-6)}`
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

function formatUsd(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0)
}

function formatCompactUsd(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(Number.isFinite(Number(value)) ? Number(value) : 0)
}

function formatChartDate(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${value}T00:00:00Z`))
}

function formatChartTooltipDate(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${value}T00:00:00Z`))
}

function readableTag(value: string): string {
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function shortId(value: string): string {
  if (!value) return '—'
  if (value.length <= 12) return value
  return `${value.slice(0, 8)}…${value.slice(-4)}`
}
