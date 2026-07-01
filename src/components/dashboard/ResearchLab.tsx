'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, Copy, Search, X } from 'lucide-react'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import {
  filterResearchLabActivityLoops,
  isActiveResearchLabLoopStatus,
  isPromisingResearchLabLoopStatus,
  isScoredResearchLabLoopStatus,
  researchLabLoopDirectionKeys as getResearchLabLoopDirectionKeys,
  researchLabStatusFilterOptionsWithCounts,
} from '@/lib/research-lab-status'
import type { MetagraphData } from '@/lib/types'

type ResearchLabData = {
  benchmark: BenchmarkReport | null
  loops: ResearchLoop[]
  topicGroups: TopicGroup[]
  labMinerSpend?: LabMinerSpendRollup | null
  stats: {
    activeLoopCount: number
    opsPendingLoopCount: number
    scoredLoopCount: number
    promisingLoopCount: number
    totalBenchmarkIcpCount: number
  }
  fetchedAt: string
}

type LabMinerSpendRollup = {
  window: LabMinerSpendWindow
  byHotkey: Record<string, LabMinerSpendEntry>
}

type LabMinerSpendWindow = {
  latestEpoch: number | null
  epochCount: number | null
  activeScheduleCount: number
}

type LabMinerSpendEntry = {
  computeSpendUsd: number
  scheduledReimbursementUsd: number
  activeAwardCount: number
  reimbursementEpochs: number | null
}

type BenchmarkReport = {
  reportId: string
  benchmarkDate: string
  rollingWindowHash: string
  aggregateScore: number
  aggregateScoreBand: string
  itemCount: number
  publicIcpCount: number
  privateHoldoutIcpCount: number
  scoreBandCounts: Record<string, number>
  failureCategoryCounts: Record<string, number>
  issues: BenchmarkIssue[]
  publicIcps: PublicIcp[]
  aggregateFunnel: LeadFunnel | null
  sourcingFailedCount: number
  intentTypes: IntentTypeRollup[]
  discovery: DiscoverySummary | null
  currentStatusAt: string | null
}

type DiscoverySummary = {
  totalIcps: number
  noCompanies: number
  weak: number
  healthy: number
  totalDiscovered: number
  totalScored: number
  floor: number
}

type IntentTypeRollup = {
  evidence_type: string
  fulfilled: number
  icp_count: number
  expected: number
  pass_pct: number
  avg_score: number
}

type LeadFunnel = {
  sourced: number
  fit_pass: number
  verified: number
  intent_valid: number
  scored: number
}

type PerSignalStat = {
  signal_index: number
  evidence_type: string
  companies_submitted: number
  companies_passed: number
  signals_submitted: number
  signals_passed: number
  avg_score: number
  sum_score: number
  max_score: number
}

type BenchmarkIssue = {
  key: string
  label: string
  count: number
  severity: 'high' | 'medium' | 'low'
  description: string
  icps?: ModelIssueIcpEntry[]
}

type ModelIssueIcpEntry = {
  item_rank?: number
  icp_ref?: string
  icp_hash?: string
  set_id?: number
  day_index?: number
  day_rank?: number
  industry_bucket?: string
  score?: number
  company_count?: number
}

type PublicIcp = {
  item_rank?: number
  icp_ref?: string
  icp_hash?: string
  set_id?: number
  day_index?: number
  day_rank?: number
  score?: number
  company_count?: number
  icp?: Record<string, unknown>
  diagnostics?: {
    failure_categories?: string[]
    avg_icp_fit?: number
    avg_intent_signal_final?: number
    sourcing_failed?: boolean
    funnel?: LeadFunnel
    per_signal?: Record<string, PerSignalStat>
    rejection_reasons?: Record<string, number>
  }
}

type ResearchLoop = {
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
  publicStatus?: string
  paymentState?: string
  executionState?: string
  candidateState?: string
  resultState?: string
  opsReason?: string
  statusDetail?: string
  opsWarnings?: string[]
  statusKey?: string
  statusLabel: string
  outcomeBand: string
  candidateCount: number
  scoredCandidateCount: number
  bestCandidatePublicSummary: string
  lastActivityAt: string
  submittedAt: string
  statusNote?: LoopStatusNote
}

type LoopStatusNote = {
  tone: 'info' | 'warning' | 'error'
  label: string
  detail: string
}

type TopicGroup = {
  topicSignatureHash: string
  topicTags: string[]
  total: number
  running: number
  completed: number
  scored: number
  promisingOrPromoted: number
  noGainOrFailed: number
  latestActivityAt: string
}

const ACTIVITY_PAGE_SIZE = 20

export function ResearchLab({
  onSync,
  metagraph,
}: { onSync?: () => void; metagraph?: MetagraphData | null } = {}) {
  const [data, setData] = useState<ResearchLabData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activityOpen, setActivityOpen] = useState(false)
  const [selectedEmissionHotkey, setSelectedEmissionHotkey] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/research-lab?t=${Date.now()}`, { cache: 'no-store' })
      if (!res.ok) throw new Error(`Request failed (${res.status})`)
      const json = await res.json()
      if (!json.success) throw new Error(json.error || 'Research Lab data unavailable')
      setData(json.data)
      setError(null)
      onSync?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch Research Lab data')
    } finally {
      setLoading(false)
    }
  }, [onSync])

  useEffect(() => {
    fetchData()
    const interval = window.setInterval(fetchData, 60_000)
    return () => window.clearInterval(interval)
  }, [fetchData])

  const benchmark = data?.benchmark ?? null
  const loops = data?.loops ?? []
  const topicGroups = data?.topicGroups ?? []
  const stats = data?.stats ?? {
    activeLoopCount: 0,
    opsPendingLoopCount: 0,
    scoredLoopCount: 0,
    promisingLoopCount: 0,
    totalBenchmarkIcpCount: 0,
  }

  if (loading && !data) return <ResearchLabLoading />

  if (error && !data) {
    return (
      <div className="w-full">
        <div className="border-l-2 border-l-[var(--line-3)] pl-5 py-6">
          <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[var(--muted-2)]">
            Research Lab
          </div>
          <p className="mt-3 text-[14px] text-[var(--muted)]">{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="w-full">
      <header className="pt-8 md:pt-10">
        <div className="flex items-center justify-between gap-3">
          <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--muted-2)]">
            Research Lab
          </div>
          <button
            type="button"
            onClick={() => setActivityOpen(true)}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-[var(--line-2)] bg-[rgba(236,234,230,0.025)] px-2.5 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--muted)] transition-colors hover:border-[var(--line-3)] hover:bg-[rgba(236,234,230,0.045)] hover:text-[var(--platinum)] premium-focus"
            title="Open research activity panel"
            aria-label="Open research activity panel"
          >
            <span>Activity panel</span>
          </button>
        </div>
        <h2 className="mt-3 max-w-[600px] font-display text-[26px] font-medium leading-[1.12] tracking-[-0.025em] text-[var(--platinum)] md:text-[30px]">
          Current model benchmark and research directions
        </h2>
      </header>

      <Hero benchmark={benchmark} />

      <KpiRail stats={stats} />

      <LabEmissionSplit
        loops={loops}
        metagraph={metagraph}
        spend={data?.labMinerSpend ?? null}
        selectedHotkey={selectedEmissionHotkey}
        onSelectHotkey={setSelectedEmissionHotkey}
      />

      <BenchmarkSection benchmark={benchmark} />

      <ModelIssuesSection issues={benchmark?.issues ?? []} />

      <DirectionsSection groups={topicGroups} />

      <ResearchActivityDialog
        open={activityOpen}
        loops={loops}
        onOpenChange={setActivityOpen}
      />

      <MethodologyFooter />
    </div>
  )
}

/* ============================================================
 * Loading
 * ============================================================ */
function ResearchLabLoading() {
  return (
    <div className="w-full">
      <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--muted-2)]">
        Research Lab
      </div>
      <div className="mt-10 space-y-4">
        <div className="h-20 w-48 shimmer rounded-md" />
        <div className="h-4 w-96 max-w-full shimmer rounded" />
      </div>
    </div>
  )
}

/* ============================================================
 * Hero — the benchmark score, bound to real data only.
 * ============================================================ */
function Hero({ benchmark }: { benchmark: BenchmarkReport | null }) {
  if (!benchmark) {
    return (
      <section className="pt-12 pb-14">
        <div className="font-display font-medium leading-[0.84] tracking-[-0.045em] text-[clamp(40px,6vw,72px)] text-[var(--faint)]">
          Pending
        </div>
        <p className="mt-7 max-w-[560px] text-[14px] leading-[1.7] text-[var(--muted)]">
          No benchmark has been published yet. When the first Research Lab benchmark is
          published, the model score and the ideal customer profiles it was measured on
          will appear here.
        </p>
      </section>
    )
  }

  const score = numberOr(benchmark.aggregateScore, 0)
  const tone = scoreTone(score)
  const splitSummary = benchmark.itemCount > 0
    ? benchmark.publicIcpCount > 0 || benchmark.privateHoldoutIcpCount > 0
      ? `${benchmark.itemCount} ICP benchmark, ${benchmark.publicIcpCount} shown and ${benchmark.privateHoldoutIcpCount} withheld`
      : `${benchmark.itemCount} ICP benchmark`
    : ''

  return (
    <section className="pt-12 pb-14">
      <div className="flex items-end gap-5">
        <div
          className="font-display font-medium leading-[0.84] tracking-[-0.045em] text-[clamp(52px,9vw,104px)]"
          style={{ color: tone }}
        >
          <CountUp value={score} decimals={1} />
          <span className="ml-3.5 align-baseline font-display text-[22px] md:text-[26px] tracking-normal text-[var(--faint)]">
            /100
          </span>
        </div>
      </div>

      <p className="mt-7 max-w-[560px] text-[14px] leading-[1.7] text-[var(--muted)]">
        The current benchmark score for Leadpoet&apos;s sales agent
        {splitSummary ? (
          <>
            , measured on a{' '}
            <b className="font-medium text-[var(--platinum)]">{splitSummary}</b>
          </>
        ) : null}
        . Research loops are scored against this baseline.
      </p>

      <div className="mt-6 font-mono text-[11px] text-[var(--muted-2)]">
        Published {formatDate(benchmark.benchmarkDate)}
      </div>
    </section>
  )
}

/* ============================================================
 * KPI rail — real stats only, hairline-separated.
 * ============================================================ */
function KpiRail({ stats }: { stats: ResearchLabData['stats'] }) {
  const items = [
    { label: 'Active loops', value: stats.activeLoopCount, sub: 'research runs in progress' },
    { label: 'Scored loops', value: stats.scoredLoopCount, sub: 'evaluated against benchmark' },
    { label: 'Promising loops', value: stats.promisingLoopCount, sub: 'matched or beat baseline' },
  ]
  return (
    <section className="grid grid-cols-3 border-y border-[var(--line)]">
      {items.map((it, i) => (
        <div
          key={it.label}
          className={cn(
            'px-4 py-5 md:px-7 md:py-6',
            i !== 0 && 'border-l border-[var(--line)]'
          )}
        >
          <div className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-[var(--muted-2)]">
            {it.label}
          </div>
          <div className="mt-4 font-display text-[34px] font-medium leading-none tracking-[-0.03em] text-[var(--platinum)] md:text-[40px]">
            <CountUp value={it.value} />
          </div>
          <div className="mt-3 font-mono text-[10.5px] text-[var(--faint)]">{it.sub}</div>
        </div>
      ))}
    </section>
  )
}

type LabMinerRow = {
  hotkey: string
  count: number
  active: number
  scored: number
  promising: number
  emission: number
  activeSubnetPct: number
  labEmissionPct: number
  computeSpendUsd: number
  scheduledReimbursementUsd: number
  activeAwardCount: number
  reimbursementEpochs: number | null
  lastActivityAt: string
}

function LabEmissionSplit({
  loops,
  metagraph,
  spend,
  selectedHotkey,
  onSelectHotkey,
}: {
  loops: ResearchLoop[]
  metagraph?: MetagraphData | null
  spend?: LabMinerSpendRollup | null
  selectedHotkey: string | null
  onSelectHotkey: (hotkey: string | null) => void
}) {
  const emissions = useMemo(() => metagraph?.emissions ?? {}, [metagraph?.emissions])
  const validatorMap = useMemo(() => metagraph?.isValidator ?? {}, [metagraph?.isValidator])
  const activeSubnetEmission = useMemo(() => {
    return Object.entries(emissions).reduce((sum, [hotkey, emission]) => {
      if (!Number.isFinite(emission) || emission <= 0) return sum
      if (validatorMap[hotkey] === true) return sum
      return sum + emission
    }, 0)
  }, [emissions, validatorMap])

  const rows = useMemo(() => {
    const byHotkey = new Map<
      string,
      Omit<
        LabMinerRow,
        'emission' | 'activeSubnetPct' | 'labEmissionPct' | 'computeSpendUsd' | 'scheduledReimbursementUsd' | 'activeAwardCount' | 'reimbursementEpochs'
      >
    >()
    for (const loop of loops) {
      if (!loop.minerHotkey) continue
      const current = byHotkey.get(loop.minerHotkey) ?? {
        hotkey: loop.minerHotkey,
        count: 0,
        active: 0,
        scored: 0,
        promising: 0,
        lastActivityAt: loop.lastActivityAt,
      }
      current.count += 1
      const statusKey = loopStatusKey(loop)
      if (isActiveResearchLabLoopStatus(statusKey)) current.active += 1
      if (isScoredResearchLabLoopStatus(statusKey)) current.scored += 1
      if (isPromisingResearchLabLoopStatus(statusKey, loop.outcomeBand)) current.promising += 1
      if (new Date(loop.lastActivityAt).getTime() > new Date(current.lastActivityAt).getTime()) {
        current.lastActivityAt = loop.lastActivityAt
      }
      byHotkey.set(loop.minerHotkey, current)
    }
    const rowsWithEmission = Array.from(byHotkey.values()).map((row) => {
      const emission = Math.max(0, emissions[row.hotkey] ?? 0)
      const spendEntry = spend?.byHotkey?.[row.hotkey]
      return {
        ...row,
        emission,
        activeSubnetPct: activeSubnetEmission > 0 ? (emission / activeSubnetEmission) * 100 : 0,
        labEmissionPct: 0,
        computeSpendUsd: Math.max(0, spendEntry?.computeSpendUsd ?? 0),
        scheduledReimbursementUsd: Math.max(0, spendEntry?.scheduledReimbursementUsd ?? 0),
        activeAwardCount: Math.max(0, spendEntry?.activeAwardCount ?? 0),
        reimbursementEpochs: spendEntry?.reimbursementEpochs ?? null,
      }
    })
    const activeLabEmission = rowsWithEmission.reduce((sum, row) => sum + row.emission, 0)
    return rowsWithEmission
      .map((row) => ({
        ...row,
        labEmissionPct: activeLabEmission > 0 ? (row.emission / activeLabEmission) * 100 : 0,
      }))
      .sort(
        (a, b) =>
          b.emission - a.emission ||
          b.count - a.count ||
          b.scored - a.scored ||
          a.hotkey.localeCompare(b.hotkey)
      )
  }, [activeSubnetEmission, emissions, loops, spend?.byHotkey])

  const totalLoops = rows.reduce((sum, row) => sum + row.count, 0)
  const activeLabEmission = rows.reduce((sum, row) => sum + row.emission, 0)
  const activeLabEmissionPct = activeSubnetEmission > 0 ? (activeLabEmission / activeSubnetEmission) * 100 : 0
  const totalComputeSpendUsd = rows.reduce((sum, row) => sum + row.computeSpendUsd, 0)
  const barRows = rows.filter((row) => row.emission > 0)
  const selected = rows.find((row) => row.hotkey === selectedHotkey) ?? rows[0] ?? null
  const hasEmissionData = Object.keys(emissions).length > 0 && !metagraph?.error
  const spendWindowLabel = labSpendWindowLabel(spend?.window ?? null)

  useEffect(() => {
    if (rows.length === 0) {
      if (selectedHotkey) onSelectHotkey(null)
      return
    }
    if (selectedHotkey && rows.some((row) => row.hotkey === selectedHotkey)) return
    onSelectHotkey(rows[0].hotkey)
  }, [onSelectHotkey, rows, selectedHotkey])

  if (rows.length === 0) {
    return (
      <section className="border-b border-[var(--line)] py-8">
        <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[var(--muted-2)]">
          Active emission share by lab miner
        </div>
        <p className="mt-3 text-[13px] text-[var(--muted-2)]">No Research Lab miner activity yet.</p>
      </section>
    )
  }

  return (
    <section className="border-b border-[var(--line)] py-8 md:py-10">
      <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[var(--muted-2)]">
            Active emission share by lab miner
          </div>
          <div className="mt-2 font-display text-[22px] font-medium tracking-[-0.025em] text-[var(--platinum)]">
            {rows.length} hotkeys · {formatPercent(activeLabEmissionPct)} active subnet emission
          </div>
          <div className="mt-1 font-mono text-[10px] text-[var(--muted-2)]">
            {totalLoops} lab loops · {hasEmissionData ? 'live metagraph emission' : 'waiting for metagraph emission'}
            {spendWindowLabel ? ` · ${formatUsd(totalComputeSpendUsd)} compute in ${spendWindowLabel}` : ''}
          </div>
        </div>
        {selected ? (
          <div className="rounded-md border border-[var(--line)] bg-[rgba(236,234,230,0.018)] px-3 py-2 md:min-w-[300px]">
            <div className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-[var(--muted-2)]">
              Selected hotkey
            </div>
            <div className="mt-1 flex items-start justify-between gap-3">
              <HotkeyCopyButton hotkey={selected.hotkey} />
              <span className="text-right">
                <span className="block font-display text-[18px] font-medium text-[var(--white)]">
                  {formatPercent(selected.activeSubnetPct)}
                </span>
                <span className="block font-mono text-[9.5px] uppercase tracking-[0.08em] text-[var(--muted-2)]">
                  active subnet emission
                </span>
                <span className="mt-1 block font-mono text-[9.5px] uppercase tracking-[0.08em] text-[var(--muted-2)]">
                  {formatUsd(selected.computeSpendUsd)} compute
                </span>
              </span>
            </div>
          </div>
        ) : null}
      </div>

      <div className="h-9 w-full overflow-hidden rounded-[5px] border border-[var(--line-2)] bg-[rgba(236,234,230,0.025)] p-[3px]">
        <div className="flex h-full w-full gap-[2px]">
          {barRows.length > 0 ? (
            barRows.map((row, index) => {
              const isSelected = selected?.hotkey === row.hotkey
              const labelFits = row.labEmissionPct >= 7
              return (
                <button
                  key={row.hotkey}
                  type="button"
                  onClick={() => onSelectHotkey(row.hotkey)}
                  className={cn(
                    'group relative flex h-full min-w-[2px] items-center justify-center overflow-hidden rounded-[3px] transition-[filter,opacity,box-shadow]',
                    isSelected
                      ? 'shadow-[inset_0_0_0_1px_rgba(255,255,255,0.48)]'
                      : 'opacity-80 hover:opacity-100 hover:brightness-125'
                  )}
                  style={{
                    width: `${row.labEmissionPct}%`,
                    background: labEmissionTone(index),
                  }}
                  title={`${row.hotkey} · ${formatPercent(row.activeSubnetPct)} of active subnet emission · ${formatUsd(row.computeSpendUsd)} compute`}
                  aria-label={`${formatPercent(row.activeSubnetPct)} of active subnet emission for hotkey ${row.hotkey}`}
                >
                  {labelFits ? (
                    <span
                      className={cn(
                        'truncate px-1 font-mono text-[10px] font-semibold tabular-nums',
                        index < 3 ? 'text-slate-950' : 'text-[var(--platinum)]'
                      )}
                    >
                      {formatPercent(row.activeSubnetPct)}
                    </span>
                  ) : null}
                </button>
              )
            })
          ) : (
            <div className="flex h-full w-full items-center justify-center rounded-[3px] font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--muted-2)]">
              No active emission for these lab hotkeys in the current metagraph
            </div>
          )}
        </div>
      </div>

      <div className="mt-5 overflow-hidden rounded-md border border-[var(--line)]">
        <div className="hidden grid-cols-[minmax(0,1fr)_124px_116px_72px_72px_86px_92px] gap-3 border-b border-[var(--line)] bg-[rgba(236,234,230,0.018)] px-3 py-2 font-mono text-[9.5px] uppercase tracking-[0.1em] text-[var(--muted-2)] md:grid">
          <span>Hotkey</span>
          <span className="text-right">Emission share</span>
          <span className="text-right">Compute spent</span>
          <span className="text-right">Loops</span>
          <span className="text-right">Active</span>
          <span className="text-right">Scored</span>
          <span className="text-right">Latest</span>
        </div>
        {rows.map((row, index) => {
          const isSelected = selected?.hotkey === row.hotkey
          return (
            <div
              key={row.hotkey}
              role="button"
              tabIndex={0}
              onClick={() => onSelectHotkey(row.hotkey)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                onSelectHotkey(row.hotkey)
              }}
              className={cn(
                'grid w-full grid-cols-[minmax(0,1fr)_104px] gap-3 border-b border-[var(--line)] px-3 py-3 text-left transition-colors last:border-b-0 md:grid-cols-[minmax(0,1fr)_124px_116px_72px_72px_86px_92px] md:items-center',
                isSelected ? 'bg-[rgba(232,240,255,0.055)]' : 'hover-bg-warm'
              )}
            >
              <span className="flex min-w-0 items-center gap-2">
                <span
                  className="h-4 w-1.5 shrink-0 rounded-full"
                  style={{ background: labEmissionTone(index) }}
                />
                <span className="min-w-0">
                  <HotkeyCopyButton hotkey={row.hotkey} />
                  <span className="mt-1 block font-mono text-[10px] text-[var(--muted-2)] md:hidden">
                    {row.count} loops · {row.scored} scored · {formatUsd(row.computeSpendUsd)} compute
                  </span>
                </span>
              </span>
              <span className="text-right tabular-nums">
                <span className="block font-display text-[16px] font-medium text-[var(--platinum)]">
                  {formatPercent(row.activeSubnetPct)}
                </span>
                <span className="block font-mono text-[9.5px] uppercase tracking-[0.08em] text-[var(--muted-2)]">
                  active subnet
                </span>
              </span>
              <span className="hidden text-right tabular-nums md:block">
                <span className="block font-display text-[15px] font-medium text-[var(--platinum)]">
                  {formatUsd(row.computeSpendUsd)}
                </span>
                <span className="block font-mono text-[9.5px] uppercase tracking-[0.08em] text-[var(--muted-2)]">
                  {row.activeAwardCount > 0 ? `${row.activeAwardCount} active ${row.activeAwardCount === 1 ? 'run' : 'runs'}` : 'no active runs'}
                </span>
              </span>
              <span className="hidden text-right font-mono text-[11px] tabular-nums text-[var(--muted)] md:block">
                {row.count}
              </span>
              <span className="hidden text-right font-mono text-[11px] tabular-nums text-[var(--muted)] md:block">
                {row.active}
              </span>
              <span className="hidden text-right font-mono text-[11px] tabular-nums text-[var(--muted)] md:block">
                {row.scored}
                {row.promising > 0 ? <span className="ml-1.5 text-[var(--white)]">+{row.promising}</span> : null}
              </span>
              <span className="hidden text-right font-mono text-[10.5px] tabular-nums text-[var(--muted-2)] md:block">
                {formatRelative(row.lastActivityAt)}
              </span>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0%'
  if (value >= 10) return `${value.toFixed(1)}%`
  if (value >= 1) return `${value.toFixed(2)}%`
  if (value >= 0.01) return `${value.toFixed(3)}%`
  return '<0.01%'
}

function formatUsd(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '$0.00'
  if (value >= 1000) {
    return `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
  }
  if (value >= 1) return `$${value.toFixed(2)}`
  if (value >= 0.01) return `$${value.toFixed(2)}`
  return '<$0.01'
}

function labSpendWindowLabel(window: LabMinerSpendWindow | null): string {
  if (!window?.latestEpoch || !window.epochCount) return ''
  return `${window.epochCount}-epoch window at ${window.latestEpoch}`
}

function labEmissionTone(index: number): string {
  const alpha = Math.max(0.2, 0.9 - index * 0.055)
  if (index === 0) return 'linear-gradient(90deg, #ffffff, var(--white))'
  if (index === 1) return 'linear-gradient(90deg, var(--platinum), #d6d4cd)'
  return `linear-gradient(90deg, rgba(236,234,230,${alpha}), rgba(236,234,230,${Math.max(0.16, alpha - 0.18)}))`
}

/* ============================================================
 * Benchmark detail — distribution + ICP leaderboard.
 * ============================================================ */
function BenchmarkSection({ benchmark }: { benchmark: BenchmarkReport | null }) {
  const publicIcps = benchmark?.publicIcps ?? []
  const detailSub = benchmark
    ? `${formatDate(benchmark.benchmarkDate)} · ${benchmark.itemCount} ICPs`
    : 'no report'
  return (
    <section className="pt-16">
      <SecLabel
        index="01"
        title="Benchmark detail"
        sub={detailSub}
      />
      {!benchmark ? (
        <p className="text-[14px] text-[var(--muted)]">
          The first Research Lab benchmark has not been published yet.
        </p>
      ) : (
        <>
          <div className="mb-6 flex flex-wrap gap-x-6 gap-y-2 border-l-2 border-l-[var(--line-2)] pl-4 font-mono text-[10.5px] uppercase tracking-[0.12em] text-[var(--muted-2)]">
            <span>
              <span className="text-[var(--platinum)]">{benchmark.itemCount}</span> total
            </span>
            <span>
              <span className="text-[var(--platinum)]">{benchmark.publicIcpCount}</span> shown
            </span>
            <span>
              <span className="text-[var(--platinum)]">{benchmark.privateHoldoutIcpCount}</span> withheld
            </span>
          </div>
          {benchmark.scoreBandCounts && <DistributionStrip counts={benchmark.scoreBandCounts} />}
          <div className="hidden sm:grid sm:grid-cols-[28px_minmax(0,1fr)_132px_64px] gap-4 border-b border-[var(--line)] pb-3 pl-3 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--muted-2)]">
            <span>#</span>
            <span>Ideal customer profile</span>
            <span>Score</span>
            <span className="text-right">Leads</span>
          </div>
          {publicIcps.length === 0 ? (
            <p className="py-6 text-[13px] text-[var(--muted-2)]">No public ICPs in this report.</p>
          ) : (
            publicIcps.map((icp, i) => (
              <LeaderboardRow key={icp.icp_ref || icp.icp_hash || i} icp={icp} rank={i + 1} />
            ))
          )}
          {(benchmark.aggregateFunnel || (benchmark.intentTypes && benchmark.intentTypes.length > 0)) && (
            <div className="mt-12 border-t border-[var(--line)] pt-10">
              <div className="mb-7 font-mono text-[10.5px] uppercase tracking-[0.16em] text-[var(--muted-2)]">
                Where leads drop off
              </div>
              {benchmark.discovery && <DiscoveryHealth discovery={benchmark.discovery} />}
              {benchmark.aggregateFunnel && (
                <AggregateFunnel funnel={benchmark.aggregateFunnel} sourcingFailedCount={benchmark.sourcingFailedCount} />
              )}
              {benchmark.intentTypes && benchmark.intentTypes.length > 0 && (
                <IntentTypeChart rows={benchmark.intentTypes} />
              )}
            </div>
          )}
        </>
      )}
    </section>
  )
}

/* ============================================================
 * Lead funnel — stage-by-stage drop-off of the model's leads.
 * Helps miners see WHERE leads fall out, not just the final score.
 * ============================================================ */
const FUNNEL_STAGES: { key: keyof LeadFunnel; label: string }[] = [
  { key: 'sourced', label: 'Discovered' },
  { key: 'fit_pass', label: 'Passed fit' },
  { key: 'verified', label: 'Verified' },
  { key: 'intent_valid', label: 'Valid intent' },
  { key: 'scored', label: 'Scored' },
]

/* ============================================================
 * Discovery health — per-ICP, how often the model could find
 * companies at all. Surfaces where DISCOVERY (not scoring) is weak.
 * ============================================================ */
function DiscoveryHealth({ discovery }: { discovery: DiscoverySummary }) {
  const { totalIcps, noCompanies, weak, healthy, totalDiscovered, totalScored, floor } = discovery
  if (totalIcps <= 0) return null
  const segments = [
    { key: 'healthy', label: `Healthy (${floor}+)`, value: healthy, color: 'var(--platinum)' },
    { key: 'weak', label: `Weak (1–${floor - 1})`, value: weak, color: 'var(--muted)' },
    { key: 'none', label: 'No companies', value: noCompanies, color: 'rgba(236,234,230,0.16)' },
  ]
  return (
    <div className="mb-10">
      <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--muted-2)]">
        Discovery health · companies found per ICP
      </div>
      <p className="mb-4 text-[11.5px] leading-relaxed text-[var(--muted-2)]">
        How many of the {totalIcps} benchmark ICPs the model could source companies for.
        &ldquo;No companies&rdquo; is an infrastructure/sourcing failure, not model skill.
      </p>
      <div className="flex h-2 w-full gap-[2px] overflow-hidden rounded-[3px]">
        {segments.map((s) =>
          s.value > 0 ? (
            <span
              key={s.key}
              className="rounded-[2px]"
              style={{ width: `${(s.value / totalIcps) * 100}%`, background: s.color }}
            />
          ) : null
        )}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 font-mono text-[10.5px] text-[var(--muted-2)]">
        {segments.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-[2px]" style={{ background: s.color }} />
            <span className="text-[var(--platinum)]">{s.value}</span> {s.label}
          </span>
        ))}
      </div>
      <div className="mt-3 font-mono text-[10.5px] text-[var(--muted-2)]">
        <span className="text-[var(--platinum)]">{totalDiscovered}</span> companies discovered ·{' '}
        <span className="text-[var(--platinum)]">{totalScored}</span> scored across all ICPs
      </div>
    </div>
  )
}

function AggregateFunnel({ funnel, sourcingFailedCount }: { funnel: LeadFunnel; sourcingFailedCount: number }) {
  const top = Math.max(1, funnel.sourced)
  const conversion = funnel.sourced > 0 ? Math.round((funnel.scored / funnel.sourced) * 100) : 0
  // All-zero funnel (every ICP failed sourcing) — show a note, not empty bars.
  if (funnel.sourced === 0) {
    return (
      <div className="mb-10">
        <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--muted-2)]">
          Lead funnel · across scored ICPs
        </div>
        <p className="font-mono text-[11px] text-[var(--muted-2)]">
          No companies were sourced in this run
          {sourcingFailedCount > 0
            ? ` — ${sourcingFailedCount} ICP${sourcingFailedCount === 1 ? '' : 's'} failed sourcing (infra, not model skill).`
            : '.'}
        </p>
      </div>
    )
  }
  return (
    <div className="mb-10">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--muted-2)]">
          Lead funnel · across scored ICPs
        </span>
        <span className="font-mono text-[10.5px] text-[var(--muted-2)]">
          <span className="text-[var(--platinum)]">{funnel.scored}</span> of {funnel.sourced} discovered scored
          <span className="ml-1.5 text-[var(--faint)]">({conversion}%)</span>
        </span>
      </div>
      <div className="space-y-2">
        {FUNNEL_STAGES.map((stage, i) => {
          const value = funnel[stage.key]
          const prev = i === 0 ? value : funnel[FUNNEL_STAGES[i - 1].key]
          const dropped = Math.max(0, prev - value)
          return (
            <div key={stage.key} className="grid grid-cols-[88px_minmax(0,1fr)_88px] items-center gap-3">
              <span className="font-mono text-[10.5px] text-[var(--muted)]">{stage.label}</span>
              <span className="h-[6px] overflow-hidden rounded-full bg-[rgba(236,234,230,0.06)]">
                <span
                  className="block h-full rounded-full bg-[var(--muted)]"
                  style={{ width: `${(value / top) * 100}%` }}
                />
              </span>
              <span className="text-right font-mono text-[11px] tabular-nums text-[var(--platinum)]">
                {value}
                {i > 0 && dropped > 0 ? (
                  <span className="ml-1.5 text-[var(--faint)]">−{dropped}</span>
                ) : null}
              </span>
            </div>
          )
        })}
      </div>
      {sourcingFailedCount > 0 ? (
        <div className="mt-3 font-mono text-[10px] text-[var(--muted-2)]">
          {sourcingFailedCount} ICP{sourcingFailedCount === 1 ? '' : 's'} excluded — sourcing failed (infra, not model skill)
        </div>
      ) : null}
    </div>
  )
}

/* ============================================================
 * Intent type performance — run-wide companies passed per intent
 * type, so miners see which intent categories the model is strong
 * or weak at. Anonymized: intent-type level, no ICP identity.
 * ============================================================ */
function IntentTypeChart({ rows }: { rows: IntentTypeRollup[] }) {
  const floor = rows.find((r) => r.icp_count > 0 && r.expected > 0)
    ? Math.round((rows[0]?.expected ?? 0) / Math.max(1, rows[0]?.icp_count ?? 1))
    : 5
  return (
    <div className="mb-2">
      <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--muted-2)]">
        Intent pass rate by type
      </div>
      <p className="mb-4 text-[11.5px] leading-relaxed text-[var(--muted-2)]">
        Percentage of companies that passed each required intent type, measured against an
        expectation of {floor} per ICP (fulfilled ÷ {floor} × ICPs requiring that intent).
      </p>
      <div className="space-y-3">
        {rows.map((row) => {
          const pct = Math.max(0, Math.min(100, row.pass_pct))
          const tone = pct >= 80 ? 'var(--platinum)' : pct >= 40 ? 'var(--muted)' : 'var(--muted-2)'
          return (
            <div
              key={row.evidence_type}
              className="grid grid-cols-[150px_minmax(0,1fr)_172px] items-center gap-3"
            >
              <span
                className="truncate font-mono text-[10.5px] uppercase tracking-[0.06em] text-[var(--muted)]"
                title={readableTag(row.evidence_type)}
              >
                {readableTag(row.evidence_type)}
              </span>
              <span className="h-[7px] w-full overflow-hidden rounded-full bg-[rgba(236,234,230,0.06)]">
                <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: tone }} />
              </span>
              <span className="text-right font-mono text-[10.5px] tabular-nums text-[var(--muted-2)]">
                <span style={{ color: tone }}>{row.pass_pct}%</span>
                <span className="ml-1.5 text-[var(--faint)]">{row.fulfilled}/{row.expected}</span>
                <span className="ml-1.5 text-[var(--faint)]">· {row.icp_count} ICP{row.icp_count === 1 ? '' : 's'}</span>
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function IcpFunnelStrip({
  funnel,
  perSignal,
  rejectionReasons,
  sourcingFailed,
}: {
  funnel?: LeadFunnel
  perSignal?: Record<string, PerSignalStat>
  rejectionReasons?: Record<string, number>
  sourcingFailed?: boolean
}) {
  if (sourcingFailed) {
    return (
      <div className="mt-3 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--muted-2)]">
        Sourcing failed — infra, not model skill
      </div>
    )
  }
  if (!funnel) return null
  const top = Math.max(1, funnel.sourced)
  const reasons = Object.entries(rejectionReasons ?? {}).filter(([, n]) => n > 0)
  const signals = Object.values(perSignal ?? {}).sort((a, b) => a.signal_index - b.signal_index)
  return (
    <div className="mt-3 border-l border-[var(--line)] pl-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] text-[var(--muted-2)]">
        {FUNNEL_STAGES.map((stage, i) => (
          <span key={stage.key} className="inline-flex items-center gap-1">
            {i > 0 ? <span className="text-[var(--faint)]">→</span> : null}
            <span className="text-[var(--muted)]">{stage.label.toLowerCase()}</span>
            <span className="tabular-nums text-[var(--platinum)]">{funnel[stage.key]}</span>
          </span>
        ))}
      </div>
      <div className="mt-2 h-[4px] w-full max-w-[260px] overflow-hidden rounded-full bg-[rgba(236,234,230,0.06)]">
        <span
          className="block h-full rounded-full bg-[var(--muted)]"
          style={{ width: `${(funnel.scored / top) * 100}%` }}
        />
      </div>
      {reasons.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px] text-[var(--muted-2)]">
          {reasons.map(([key, n]) => (
            <span key={key}>
              {humanizeRejectionReason(key)} <span className="text-[var(--muted)]">{n}</span>
            </span>
          ))}
        </div>
      ) : null}
      {signals.length > 0 ? (
        <div className="mt-2 space-y-1">
          {signals.map((s) => {
            const failed = s.companies_passed === 0 && s.companies_submitted > 0
            return (
              <div
                key={s.signal_index}
                className="flex flex-wrap items-center gap-x-2 font-mono text-[10px]"
                style={{ color: failed ? 'var(--muted-2)' : 'var(--muted)' }}
              >
                <span className="uppercase tracking-[0.08em] text-[var(--muted-2)]">
                  {readableTag(s.evidence_type || 'unspecified')}
                </span>
                <span className="tabular-nums text-[var(--platinum)]">
                  {s.companies_passed}/{s.companies_submitted}
                </span>
                <span>companies</span>
                {s.companies_passed > 0 ? (
                  <span className="text-[var(--faint)]">avg {s.avg_score}</span>
                ) : (
                  <span className="text-[var(--faint)]">no evidence passed</span>
                )}
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

function humanizeRejectionReason(key: string): string {
  const map: Record<string, string> = {
    employee_count_mismatch: 'Wrong employee size',
    employee_count_missing: 'Missing employee size',
    company_stage_mismatch: 'Wrong company stage',
    company_stage_missing: 'Missing company stage',
    company_unverifiable: 'Company unverifiable',
    intent_fabricated: 'Fabricated intent',
    scoring_error: 'Scoring error',
    failed_prechecks: 'Failed pre-checks',
    duplicate_company: 'Duplicate company',
    other: 'Other',
  }
  return map[key] ?? readableTag(key)
}

function DistributionStrip({ counts }: { counts: Record<string, number> }) {
  const order = ['80_plus', '60_79', '40_59', '1_39', 'zero']
  const labelMap: Record<string, string> = {
    '80_plus': '80+',
    '60_79': '60–79',
    '40_59': '40–59',
    '1_39': '1–39',
    zero: '0',
  }
  const toneMap: Record<string, string> = {
    '80_plus': 'var(--white)',
    '60_79': 'var(--platinum)',
    '40_59': 'var(--muted)',
    '1_39': 'var(--muted-2)',
    zero: 'var(--faint)',
  }
  const total = order.reduce((sum, k) => sum + (counts[k] ?? 0), 0)
  if (total === 0) return null
  return (
    <div className="mb-10">
      <div className="flex h-2 w-full gap-[2px] overflow-hidden rounded-[3px]">
        {order.map((k) => {
          const c = counts[k] ?? 0
          if (!c) return null
          return (
            <span
              key={k}
              className="rounded-[2px]"
              style={{ width: `${(c / total) * 100}%`, background: toneMap[k] }}
            />
          )
        })}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 font-mono text-[10.5px] text-[var(--muted-2)]">
        {order.map((k) =>
          (counts[k] ?? 0) > 0 ? (
            <span key={k} className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-[2px]" style={{ background: toneMap[k] }} />
              <span className="text-[var(--muted)]">{counts[k]}</span> {labelMap[k]}
            </span>
          ) : null
        )}
      </div>
    </div>
  )
}

function LeaderboardRow({ icp, rank }: { icp: PublicIcp; rank: number }) {
  const doc = icp.icp ?? {}
  const signals = intentSignals(doc.intent_signals)
  const title =
    compactParts([
      textValue(doc.industry),
      textValue(doc.sub_industry),
      textValue(doc.product_service),
    ]) || 'Benchmark ICP'
  const geography = compactParts([
    textValue(doc.company_region),
    textValue(doc.company_country ?? doc.country ?? doc.target_geography),
  ])
  const companySize = textValue(doc.employee_count ?? doc.company_size)
  const roles = arrayText(doc.target_roles ?? doc.target_role_types)
  const score = numberOr(icp.score, 0)
  const top = rank === 1

  return (
    <div
      className={cn(
        'grid grid-cols-[24px_minmax(0,1fr)] items-start gap-x-3 gap-y-3 border-b border-l-2 py-5 pl-3 transition-colors last:border-b-0 sm:grid-cols-[28px_minmax(0,1fr)_132px_64px] sm:gap-4',
        top
          ? 'border-l-[var(--white)] border-b-[var(--line)] bg-[rgba(232,240,255,0.025)]'
          : 'border-l-transparent border-[var(--line)] hover-bg-warm'
      )}
    >
      <span
        className="mt-0.5 font-mono text-[12px]"
        style={{ color: top ? 'var(--white)' : 'var(--muted-2)' }}
      >
        {String(rank).padStart(2, '0')}
      </span>
      <div className="min-w-0">
        <div className="break-words text-[13.5px] font-medium leading-snug text-[var(--platinum)]">{title}</div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {geography && <Tag>{geography}</Tag>}
          {companySize && <Tag>{companySize}</Tag>}
          {roles && <Tag>{roles}</Tag>}
        </div>
        {signals.length > 0 && (
          <div className="mt-2.5 space-y-1">
            {signals.slice(0, 2).map((signal, index) => (
              <div key={index} className="text-[11.5px] leading-relaxed text-[var(--muted-2)]">
                <span className="mr-1.5 font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--muted)]">
                  signal
                </span>
                {signal}
              </div>
            ))}
          </div>
        )}
        <IcpFunnelStrip
          funnel={icp.diagnostics?.funnel}
          perSignal={icp.diagnostics?.per_signal}
          rejectionReasons={icp.diagnostics?.rejection_reasons}
          sourcingFailed={icp.diagnostics?.sourcing_failed}
        />
      </div>
      <div className="col-start-2 flex items-center justify-between gap-4 sm:contents">
        <div className="flex w-full min-w-[88px] max-w-[160px] flex-col gap-1.5 pt-0.5 sm:max-w-none">
          <span
            className="font-display text-[15px] font-medium tabular-nums"
            style={{ color: top ? 'var(--white)' : 'var(--platinum)' }}
          >
            {formatScore(score)}
          </span>
          <span className="h-[3px] overflow-hidden rounded-full bg-[rgba(236,234,230,0.06)]">
            <span
              className="block h-full rounded-full"
              style={{
                width: `${Math.max(0, Math.min(100, score))}%`,
                background: top ? 'var(--white)' : 'var(--muted)',
              }}
            />
          </span>
        </div>
        <div className="shrink-0 text-right">
          <div className="font-display text-[15px] font-medium tabular-nums text-[var(--platinum)]">
            {numberOr(icp.company_count, 0)}
          </div>
          <div className="mt-1 font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--muted-2)]">
            companies
          </div>
        </div>
      </div>
    </div>
  )
}

/* ============================================================
 * Model issues
 * ============================================================ */
function ModelIssuesSection({ issues }: { issues: BenchmarkIssue[] }) {
  return (
    <section className="pt-16">
      <SecLabel index="02" title="Model issues" sub={`${issues.length} categories`} />
      {issues.length === 0 ? (
        <p className="text-[13px] text-[var(--muted-2)]">No repeated benchmark issues recorded yet.</p>
      ) : (
        <div>
          {issues.slice(0, 8).map((issue) => (
            <IssueRow key={issue.key} issue={issue} />
          ))}
        </div>
      )}
    </section>
  )
}

function IssueRow({ issue }: { issue: BenchmarkIssue }) {
  const tone = severityTone(issue.severity)
  const icpRefs = formatIssueIcpRefs(issue.icps ?? [])
  return (
    <div className="flex items-start justify-between gap-5 border-b border-[var(--line)] py-4 last:border-b-0">
      <div className="min-w-0">
        <div className="text-[13.5px] font-medium text-[var(--platinum)]">{issue.label}</div>
        <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--muted-2)]">{issue.description}</p>
        {icpRefs ? (
          <div className="mt-2 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--muted)]">
            {icpRefs}
          </div>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <span className="font-display text-[15px] font-medium tabular-nums text-[var(--platinum)]">
          {issue.count}
        </span>
        <span
          className="rounded-[3px] border px-2 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.1em]"
          style={{ color: tone.color, borderColor: tone.border }}
        >
          {issue.severity}
        </span>
      </div>
    </div>
  )
}

/* ============================================================
 * Live research activity panel
 * ============================================================ */
function ResearchActivityDialog({
  open,
  loops,
  onOpenChange,
}: {
  open: boolean
  loops: ResearchLoop[]
  onOpenChange: (open: boolean) => void
}) {
  const [minerQuery, setMinerQuery] = useState('')
  const [direction, setDirection] = useState('all')
  const [status, setStatus] = useState('all')
  const [currentPage, setCurrentPage] = useState(1)

  useEffect(() => {
    if (!open) {
      setMinerQuery('')
      setDirection('all')
      setStatus('all')
      setCurrentPage(1)
    }
  }, [open])

  useEffect(() => {
    if (open) setCurrentPage(1)
  }, [open, minerQuery, direction, status])

  const directionOptions = useMemo(
    () => buildDirectionOptions(loops),
    [loops]
  )

  const minerCount = useMemo(() => {
    const miners = new Set<string>()
    for (const loop of loops) {
      if (loop.minerHotkey) miners.add(loop.minerHotkey)
    }
    return miners.size
  }, [loops])

  const filteredLoops = useMemo(() => {
    return filterResearchLabActivityLoops(loops, { minerQuery, direction, status })
  }, [loops, minerQuery, direction, status])

  const statusOptions = useMemo(() => {
    return researchLabStatusFilterOptionsWithCounts(loops, { minerQuery, direction })
  }, [loops, minerQuery, direction])

  useEffect(() => {
    if (status === 'all') return
    if (statusOptions.some((option) => option.value === status)) return
    setStatus('all')
  }, [status, statusOptions])

  const totalPages = Math.max(1, Math.ceil(filteredLoops.length / ACTIVITY_PAGE_SIZE))
  const safePage = Math.min(currentPage, totalPages)
  const pageStart = (safePage - 1) * ACTIVITY_PAGE_SIZE
  const pageEnd = Math.min(filteredLoops.length, pageStart + ACTIVITY_PAGE_SIZE)
  const paginatedLoops = filteredLoops.slice(pageStart, pageEnd)

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages)
  }, [currentPage, totalPages])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        showCloseButton={false}
        className="h-[82vh] max-h-[82vh] supports-[height:100svh]:h-[calc(100svh-0.75rem)] supports-[height:100svh]:max-h-[calc(100svh-0.75rem)] sm:h-auto sm:w-[calc(100vw-3rem)] sm:max-w-[1180px] sm:max-h-[90vh] overflow-hidden flex flex-col gap-0 bg-[var(--canvas)] border-[var(--line-2)] p-0 sm:p-0 text-[var(--platinum)]"
      >
        <DialogHeader className="shrink-0 border-b border-[var(--line)] px-4 py-3 text-left sm:px-5 sm:py-4">
          <div className="mb-3 flex items-center justify-end">
            <DialogTitle className="sr-only">Live research activity</DialogTitle>
            <DialogClose asChild>
              <button
                type="button"
                className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-[var(--line-2)] bg-[rgba(236,234,230,0.055)] text-[var(--platinum)] transition-colors hover:border-[var(--line-3)] hover:bg-[rgba(236,234,230,0.08)] premium-focus"
                aria-label="Close activity panel"
                title="Close activity panel"
              >
                <X className="h-4 w-4" />
              </button>
            </DialogClose>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <ActivityPanelStat label="Visible" value={filteredLoops.length} />
            <ActivityPanelStat label="Runs" value={loops.length} />
            <ActivityPanelStat label="Miners" value={minerCount} />
            <ActivityPanelStat label="Directions" value={directionOptions.length} />
          </div>

          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative sm:max-w-sm sm:flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--muted-2)]" />
              <input
                type="text"
                value={minerQuery}
                onChange={(e) => setMinerQuery(e.target.value)}
                placeholder="Filter miner hotkey"
                className="h-8 w-full rounded-md border border-[var(--line-2)] bg-[rgba(236,234,230,0.025)] pl-8 pr-12 font-mono text-[11px] text-[var(--platinum)] outline-none transition-colors placeholder:text-[var(--faint)] premium-focus"
              />
              <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1.5">
                {minerQuery.trim() ? (
                  <button
                    type="button"
                    onClick={() => setMinerQuery('')}
                    className="text-[var(--muted-2)] transition-colors hover:text-[var(--platinum)]"
                    aria-label="Clear miner filter"
                    title="Clear miner filter"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                ) : (
                  <span className="font-mono text-[10px] text-[var(--muted-2)]">
                    {filteredLoops.length}
                  </span>
                )}
              </div>
            </div>

            <Select value={direction} onValueChange={setDirection}>
              <SelectTrigger
                size="sm"
                className="h-8 w-full border-[var(--line-2)] bg-[rgba(236,234,230,0.025)] font-mono text-[11px] text-[var(--muted)] shadow-none hover:border-[var(--line-3)] hover:text-[var(--platinum)] sm:w-[280px]"
                aria-label="Filter by research direction"
              >
                <SelectValue placeholder="All directions" />
              </SelectTrigger>
              <SelectContent className="z-[70] border-[var(--line-2)] bg-[var(--canvas-2)] text-[var(--platinum)]">
                <SelectItem
                  value="all"
                  className="font-mono text-[11px] text-[var(--muted)] focus:bg-[rgba(236,234,230,0.06)] focus:text-[var(--platinum)]"
                >
                  All directions
                </SelectItem>
                {directionOptions.map((option) => (
                  <SelectItem
                    key={option.value}
                    value={option.value}
                    className="font-mono text-[11px] text-[var(--muted)] focus:bg-[rgba(236,234,230,0.06)] focus:text-[var(--platinum)]"
                  >
                    {option.label} ({option.count})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger
                size="sm"
                className="h-8 w-full border-[var(--line-2)] bg-[rgba(236,234,230,0.025)] font-mono text-[11px] text-[var(--muted)] shadow-none hover:border-[var(--line-3)] hover:text-[var(--platinum)] sm:w-[210px]"
                aria-label="Filter by status"
              >
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent className="z-[70] border-[var(--line-2)] bg-[var(--canvas-2)] text-[var(--platinum)]">
                {statusOptions.map((option) => (
                  <SelectItem
                    key={option.value}
                    value={option.value}
                    className="font-mono text-[11px] text-[var(--muted)] focus:bg-[rgba(236,234,230,0.06)] focus:text-[var(--platinum)]"
                  >
                    {option.label} ({option.count ?? 0})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
          {filteredLoops.length === 0 ? (
            <div className="px-5 py-16 text-center text-[13px] text-[var(--muted-2)]">
              No research loop activity matches the current filters.
            </div>
          ) : (
            <div>
              <div className="sticky top-0 z-10 hidden grid-cols-[minmax(170px,1.05fr)_minmax(0,1.65fr)_86px_122px_86px] gap-4 border-b border-[var(--line)] bg-[var(--canvas)] px-5 py-2 font-mono text-[9.5px] uppercase tracking-[0.12em] text-[var(--muted-2)] backdrop-blur md:grid">
                <span>Miner / direction</span>
                <span>Focus</span>
                <span className="text-right">Candidates</span>
                <span className="text-center">Outcome</span>
                <span>Activity</span>
              </div>
              {paginatedLoops.map((loop) => (
                <ActivityPanelRow key={loop.cardId} loop={loop} />
              ))}
            </div>
          )}
        </div>
        {filteredLoops.length > 0 ? (
          <ActivityPagination
            page={safePage}
            totalPages={totalPages}
            start={pageStart + 1}
            end={pageEnd}
            total={filteredLoops.length}
            onPageChange={setCurrentPage}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function ActivityPanelStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-[var(--line)] bg-[rgba(236,234,230,0.018)] px-3 py-2">
      <div className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-[var(--muted-2)]">
        {label}
      </div>
      <div className="mt-1 font-display text-[20px] font-medium leading-none tabular-nums text-[var(--platinum)]">
        {value.toLocaleString()}
      </div>
    </div>
  )
}

function ActivityPagination({
  page,
  totalPages,
  start,
  end,
  total,
  onPageChange,
}: {
  page: number
  totalPages: number
  start: number
  end: number
  total: number
  onPageChange: (page: number) => void
}) {
  const canPrev = page > 1
  const canNext = page < totalPages
  return (
    <div className="flex flex-col gap-3 border-t border-[var(--line)] px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="font-mono text-[10.5px] text-[var(--muted-2)]">
        Showing <span className="text-[var(--platinum)]">{start}</span>–<span className="text-[var(--platinum)]">{end}</span> of{' '}
        <span className="text-[var(--platinum)]">{total}</span>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => canPrev && onPageChange(page - 1)}
          disabled={!canPrev}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--line-2)] bg-[rgba(236,234,230,0.02)] text-[var(--muted)] transition-colors hover:border-[var(--line-3)] hover:bg-[rgba(236,234,230,0.045)] hover:text-[var(--platinum)] disabled:cursor-not-allowed disabled:opacity-35"
          aria-label="Previous activity page"
          title="Previous page"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        <div className="min-w-20 text-center font-mono text-[10.5px] text-[var(--muted-2)]">
          <span className="text-[var(--platinum)]">{page}</span> / {totalPages}
        </div>
        <button
          type="button"
          onClick={() => canNext && onPageChange(page + 1)}
          disabled={!canNext}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--line-2)] bg-[rgba(236,234,230,0.02)] text-[var(--muted)] transition-colors hover:border-[var(--line-3)] hover:bg-[rgba(236,234,230,0.045)] hover:text-[var(--platinum)] disabled:cursor-not-allowed disabled:opacity-35"
          aria-label="Next activity page"
          title="Next page"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}

function ActivityPanelRow({ loop }: { loop: ResearchLoop }) {
  const statusTone = loop.statusNote ? statusNoteTone(loop.statusNote.tone) : null
  return (
    <div className="grid gap-3 border-b border-[var(--line)] px-5 py-4 transition-colors last:border-b-0 hover-bg-warm md:grid-cols-[minmax(170px,1.05fr)_minmax(0,1.65fr)_86px_122px_86px] md:items-start md:gap-4">
      <div className="min-w-0">
        <HotkeyCopyButton hotkey={loop.minerHotkey} />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {loop.topicTags.length > 0 ? (
            loop.topicTags.slice(0, 3).map((tag) => (
              <Tag key={tag}>{readableTag(tag)}</Tag>
            ))
          ) : (
            <Tag>{readableTag(loop.researchArea || 'generalist')}</Tag>
          )}
        </div>
      </div>

      <div className="min-w-0">
        {loop.researchFocusSummary ? (
          <p className="line-clamp-2 text-[13px] leading-relaxed text-[var(--muted)]">
            {loop.researchFocusSummary}
          </p>
        ) : (
          <p className="text-[13px] text-[var(--muted-2)]">No focus summary published.</p>
        )}
        {loop.bestCandidatePublicSummary ? (
          <p className="mt-1.5 line-clamp-2 text-[12px] leading-relaxed text-[var(--muted-2)]">
            {loop.bestCandidatePublicSummary}
          </p>
        ) : null}
        {loop.statusNote && statusTone ? (
          <div
            className="mt-3 border-l-2 py-2 pl-3"
            style={{ borderColor: statusTone.border, background: statusTone.bg }}
          >
            <div className="font-mono text-[10px] uppercase tracking-[0.12em]" style={{ color: statusTone.color }}>
              {loop.statusNote.label}
            </div>
            <p className="mt-1 text-[11.5px] leading-relaxed text-[var(--muted-2)]">
              <span className="font-mono text-[var(--muted)]">Ticket {shortId(loop.ticketId)}</span>
              <span className="text-[var(--faint)]"> · </span>
              {loop.statusNote.detail}
            </p>
          </div>
        ) : null}
      </div>

      <div className="flex gap-4 font-mono text-[10.5px] text-[var(--muted-2)] md:block md:text-right">
        <span>
          <span className="text-[var(--muted)]">{loop.candidateCount}</span> candidates
        </span>
        <span className="md:mt-1 md:block">
          <span className="text-[var(--muted)]">{loop.scoredCandidateCount}</span> scored
        </span>
      </div>

      <div className="flex min-w-0 md:justify-center">
        <OutcomeBadge label={loop.statusLabel || readableTag(loop.outcomeLabel)} band={loop.outcomeBand} />
      </div>

      <div className="font-mono text-[10.5px] text-[var(--muted-2)]">
        <span>{formatRelative(loop.lastActivityAt)}</span>
      </div>
    </div>
  )
}

function HotkeyCopyButton({ hotkey }: { hotkey: string }) {
  const [copied, setCopied] = useState(false)
  const timeoutRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current)
    }
  }, [])

  const handleCopy = useCallback(async () => {
    try {
      await copyToClipboard(hotkey)
      setCopied(true)
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current)
      timeoutRef.current = window.setTimeout(() => setCopied(false), 1400)
    } catch {
      setCopied(false)
    }
  }, [hotkey])

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="group inline-flex max-w-full items-center gap-1.5 rounded-[4px] border border-transparent py-0.5 pr-1.5 font-mono text-[11px] text-[var(--platinum)] transition-colors hover:border-[var(--line-2)] hover:bg-[rgba(236,234,230,0.035)]"
      title={copied ? 'Copied full hotkey' : hotkey}
      aria-label={`Copy miner hotkey ${hotkey}`}
    >
      <code className="truncate">{shortHotkey(hotkey)}</code>
      {copied ? (
        <Check className="h-3 w-3 shrink-0 text-[var(--white)]" />
      ) : (
        <Copy className="h-3 w-3 shrink-0 text-[var(--muted-2)] transition-colors group-hover:text-[var(--muted)]" />
      )}
      {copied ? (
        <span className="shrink-0 text-[9.5px] uppercase tracking-[0.1em] text-[var(--muted-2)]">
          Copied
        </span>
      ) : null}
    </button>
  )
}

type DirectionOption = {
  value: string
  label: string
  count: number
}

function buildDirectionOptions(loops: ResearchLoop[]): DirectionOption[] {
  const options = new Map<string, DirectionOption>()

  for (const loop of loops) {
    for (const value of loopDirectionKeys(loop)) {
      const current = options.get(value)
      options.set(value, {
        value,
        label: readableTag(value),
        count: (current?.count ?? 0) + 1,
      })
    }
  }

  return Array.from(options.values()).sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count
    return a.label.localeCompare(b.label)
  })
}

function loopStatusKey(loop: ResearchLoop): string {
  return loop.statusKey || loop.outcomeLabel
}

function loopDirectionKeys(loop: ResearchLoop): string[] {
  return getResearchLabLoopDirectionKeys(loop)
}

function OutcomeBadge({ label, band }: { label: string; band: string }) {
  const tone = outcomeTone(band)
  return (
    <span
      className="max-w-full whitespace-normal break-words text-center leading-[1.3] rounded-[3px] border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.06em]"
      style={{ color: tone.color, borderColor: tone.border, background: tone.bg }}
    >
      {label}
    </span>
  )
}

/* ============================================================
 * Research directions
 * ============================================================ */
function DirectionsSection({ groups }: { groups: TopicGroup[] }) {
  return (
    <section className="pt-16">
      <SecLabel index="03" title="Research directions" sub="grouped by topic" />
      {groups.length === 0 ? (
        <p className="text-[13px] text-[var(--muted-2)]">No grouped research directions yet.</p>
      ) : (
        <div>
          {groups.slice(0, 8).map((group) => (
            <DirectionRow key={group.topicSignatureHash} group={group} />
          ))}
        </div>
      )}
    </section>
  )
}

function DirectionRow({ group }: { group: TopicGroup }) {
  const progress = group.total > 0 ? (group.promisingOrPromoted / group.total) * 100 : 0
  return (
    <div className="border-b border-[var(--line)] py-4 last:border-b-0">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {group.topicTags.slice(0, 3).map((tag) => (
            <Tag key={tag}>{readableTag(tag)}</Tag>
          ))}
        </div>
        <span className="font-display text-[15px] font-medium tabular-nums text-[var(--platinum)]">
          {group.total}
        </span>
      </div>
      <div className="mt-2.5 h-[3px] overflow-hidden rounded-full bg-[rgba(236,234,230,0.06)]">
        <span
          className="block h-full rounded-full bg-[var(--muted)]"
          style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
        />
      </div>
      <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] text-[var(--muted-2)]">
        <span>{group.running} running</span>
        <span>{group.scored} scored</span>
        <span className="text-[var(--platinum)]">{group.promisingOrPromoted} promising</span>
        <span>{group.noGainOrFailed} no gain / failed</span>
      </div>
    </div>
  )
}

/* ============================================================
 * Methodology footer — truthful, sourced from the README.
 * ============================================================ */
function MethodologyFooter() {
  const points = [
    {
      n: 'I',
      title: 'Loops',
      body: 'Miners direct and fund auto-research loops that try to improve Leadpoet’s sales agent.',
    },
    {
      n: 'II',
      title: 'Benchmark',
      body: 'Each candidate improvement is scored against the current model benchmark.',
    },
    {
      n: 'III',
      title: 'Rewards',
      body: 'Verified compute is partially reimbursed; candidates that beat the benchmark earn improvement rewards.',
    },
  ]
  return (
    <section className="mt-20 border-t border-[var(--line)] pt-10">
      <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[var(--muted-2)]">
        How the Research Lab works
      </div>
      <div className="mt-7 grid gap-8 md:grid-cols-3">
        {points.map((p) => (
          <div key={p.n}>
            <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--muted-2)]">
              {p.n}
            </div>
            <div className="mt-2 text-[13px] font-medium text-[var(--platinum)]">{p.title}</div>
            <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--muted-2)]">{p.body}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

/* ============================================================
 * Shared bits
 * ============================================================ */
function SecLabel({ index, title, sub }: { index: string; title: string; sub?: string }) {
  return (
    <div className="seclabel mb-8">
      <span className="ix">{index}</span>
      <span className="stitle">{title}</span>
      <span className="sline" />
      {sub ? <span className="ssub">{sub}</span> : null}
    </div>
  )
}

function Tag({ children }: { children: string }) {
  return (
    <span className="inline-flex max-w-full rounded-[5px] border border-[var(--line-2)] bg-[rgba(236,234,230,0.02)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--muted)]">
      <span className="truncate">{children}</span>
    </span>
  )
}

function CountUp({
  value,
  decimals = 0,
  className,
}: {
  value: number
  decimals?: number
  className?: string
}) {
  const [display, setDisplay] = useState(0)
  const fromRef = useRef(0)
  useEffect(() => {
    const from = fromRef.current
    const to = Number.isFinite(value) ? value : 0
    if (from === to) {
      setDisplay(to)
      return
    }
    let raf = 0
    const start = performance.now()
    const dur = 900
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / dur)
      const eased = 1 - Math.pow(1 - t, 3)
      const next = from + (to - from) * eased
      setDisplay(next)
      if (t < 1) raf = requestAnimationFrame(tick)
      else fromRef.current = to
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value])
  const text = decimals > 0 ? display.toFixed(decimals) : Math.round(display).toLocaleString()
  return <span className={cn('tabular-nums', className)}>{text}</span>
}

/* ============================================================
 * Tone helpers — brightness, never hue.
 * ============================================================ */
function scoreTone(score: number): string {
  if (score >= 80) return 'var(--white)'
  if (score >= 60) return 'var(--platinum)'
  if (score >= 40) return 'var(--muted)'
  if (score > 0) return 'var(--muted-2)'
  return 'var(--faint)'
}

function outcomeTone(band: string): { color: string; border: string; bg: string } {
  if (band === 'promoted' || band === 'passed_threshold') {
    return { color: 'var(--white)', border: 'rgba(232,240,255,0.30)', bg: 'rgba(232,240,255,0.07)' }
  }
  if (band === 'high_gain') {
    return { color: 'var(--white)', border: 'rgba(232,240,255,0.30)', bg: 'rgba(232,240,255,0.07)' }
  }
  if (band === 'small_gain') {
    return { color: 'var(--platinum)', border: 'var(--line-2)', bg: 'transparent' }
  }
  if (band === 'stale' || band === 'warning') {
    return { color: 'var(--muted)', border: 'var(--line-2)', bg: 'rgba(236,234,230,0.025)' }
  }
  if (band === 'pending' || band === 'completed') {
    return { color: 'var(--muted)', border: 'var(--line)', bg: 'transparent' }
  }
  if (band === 'no_gain' || band === 'failed') {
    return { color: 'var(--muted-2)', border: 'var(--line)', bg: 'transparent' }
  }
  return { color: 'var(--muted)', border: 'var(--line)', bg: 'transparent' }
}

function severityTone(severity: BenchmarkIssue['severity']): { color: string; border: string } {
  if (severity === 'high') return { color: 'var(--platinum)', border: 'var(--line-3)' }
  if (severity === 'medium') return { color: 'var(--muted)', border: 'var(--line-2)' }
  return { color: 'var(--muted-2)', border: 'var(--line)' }
}

function statusNoteTone(tone: LoopStatusNote['tone']): { color: string; border: string; bg: string } {
  if (tone === 'error') {
    return { color: 'var(--platinum)', border: 'var(--line-3)', bg: 'rgba(236,234,230,0.035)' }
  }
  if (tone === 'warning') {
    return { color: 'var(--muted)', border: 'var(--line-2)', bg: 'rgba(236,234,230,0.025)' }
  }
  return { color: 'var(--muted-2)', border: 'var(--line)', bg: 'transparent' }
}

/* ============================================================
 * Formatters (unchanged from prior implementation)
 * ============================================================ */
function formatScore(value: number): string {
  if (!Number.isFinite(value)) return '0.0'
  return value.toFixed(1)
}

function numberOr(value: unknown, fallback: number): number {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

function formatRelative(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const diff = Math.max(0, (Date.now() - date.getTime()) / 1000)
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`
  return formatDate(value)
}

function readableTag(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function formatIssueIcpRefs(icps: ModelIssueIcpEntry[]): string {
  const labels = icps
    .map((icp) => numberOr(icp.item_rank, 0))
    .filter((rank) => rank > 0)
    .sort((a, b) => a - b)
    .map((rank) => `ICP ${String(rank).padStart(2, '0')}`)
  if (labels.length === 0) return ''
  const visible = labels.slice(0, 8)
  const suffix = labels.length > visible.length ? ` +${labels.length - visible.length}` : ''
  return `${visible.join(', ')}${suffix}`
}

function textValue(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (Array.isArray(value)) return value.map(textValue).filter(Boolean).join(', ')
  if (value == null) return ''
  return String(value).trim()
}

function arrayText(value: unknown): string {
  if (!Array.isArray(value)) return textValue(value)
  return value.map(textValue).filter(Boolean).join(', ')
}

function compactParts(parts: string[]): string {
  return parts.filter(Boolean).join(' · ')
}

function shortId(value: string): string {
  return value ? value.slice(0, 8) : 'unknown'
}

function shortHotkey(value: string): string {
  if (value.length <= 16) return value
  return `${value.slice(0, 6)}...${value.slice(-6)}`
}

async function copyToClipboard(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value)
    return
  }

  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  document.body.appendChild(textarea)
  textarea.select()
  try {
    document.execCommand('copy')
  } finally {
    document.body.removeChild(textarea)
  }
}

function intentSignals(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      if (typeof item === 'string') return item
      if (item && typeof item === 'object') {
        const record = item as Record<string, unknown>
        const text = textValue(record.text ?? record.signal ?? record.description)
        const evidence = textValue(record.evidence_type)
        return evidence ? `${text} (${readableTag(evidence)})` : text
      }
      return ''
    })
    .filter(Boolean)
}
