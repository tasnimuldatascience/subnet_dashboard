'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

type ResearchLabData = {
  benchmark: BenchmarkReport | null
  loops: ResearchLoop[]
  topicGroups: TopicGroup[]
  stats: {
    activeLoopCount: number
    scoredLoopCount: number
    promisingLoopCount: number
    totalBenchmarkIcpCount: number
  }
  fetchedAt: string
}

type BenchmarkReport = {
  reportId: string
  benchmarkDate: string
  rollingWindowHash: string
  aggregateScore: number
  aggregateScoreBand: string
  itemCount: number
  scoreBandCounts: Record<string, number>
  failureCategoryCounts: Record<string, number>
  issues: BenchmarkIssue[]
  publicIcps: PublicIcp[]
  currentStatusAt: string | null
}

type BenchmarkIssue = {
  key: string
  label: string
  count: number
  severity: 'high' | 'medium' | 'low'
  description: string
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
  outcomeBand: string
  candidateCount: number
  scoredCandidateCount: number
  bestCandidatePublicSummary: string
  lastActivityAt: string
  submittedAt: string
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

export function ResearchLab({ onSync }: { onSync?: () => void } = {}) {
  const [data, setData] = useState<ResearchLabData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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

  if (loading && !data) return <ResearchLabLoading />

  if (error && !data) {
    return (
      <div className="mx-auto max-w-[1080px]">
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
    <div className="mx-auto max-w-[1080px]">
      <header className="flex items-end justify-between gap-4">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--muted-2)]">
            Research Lab
          </div>
          <h2 className="mt-3 font-display text-[26px] md:text-[30px] font-medium leading-[1.12] tracking-[-0.025em] text-[var(--platinum)] max-w-[600px]">
            Current model benchmark and live research activity
          </h2>
        </div>
        {data?.fetchedAt ? (
          <div className="font-mono text-[11px] text-[var(--muted-2)] shrink-0">
            Updated {formatRelative(data.fetchedAt)}
          </div>
        ) : null}
      </header>

      <Hero benchmark={benchmark} />

      <KpiRail stats={data?.stats ?? { activeLoopCount: 0, scoredLoopCount: 0, promisingLoopCount: 0, totalBenchmarkIcpCount: 0 }} />

      <BenchmarkSection benchmark={benchmark} />

      <ModelIssuesSection issues={benchmark?.issues ?? []} />

      <ActivitySection loops={data?.loops ?? []} activeCount={data?.stats.activeLoopCount ?? 0} />

      <DirectionsSection groups={data?.topicGroups ?? []} />

      <MethodologyFooter />
    </div>
  )
}

/* ============================================================
 * Loading
 * ============================================================ */
function ResearchLabLoading() {
  return (
    <div className="mx-auto max-w-[1080px]">
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
        <div className="pb-3">
          <span
            className="inline-block rounded-[3px] border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.16em]"
            style={{ color: tone, borderColor: 'var(--line-2)' }}
          >
            {readableTag(benchmark.aggregateScoreBand)}
          </span>
        </div>
      </div>

      <p className="mt-7 max-w-[560px] text-[14px] leading-[1.7] text-[var(--muted)]">
        The current benchmark score for Leadpoet&apos;s sales agent
        {benchmark.itemCount > 0 ? (
          <>
            , measured across{' '}
            <b className="font-medium text-[var(--platinum)]">{benchmark.itemCount}</b> ideal
            customer profiles
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

/* ============================================================
 * Benchmark detail — distribution + ICP leaderboard.
 * ============================================================ */
function BenchmarkSection({ benchmark }: { benchmark: BenchmarkReport | null }) {
  const publicIcps = benchmark?.publicIcps ?? []
  return (
    <section className="pt-16">
      <SecLabel
        index="01"
        title="Benchmark detail"
        sub={benchmark ? formatDate(benchmark.benchmarkDate) : 'no report'}
      />
      {!benchmark ? (
        <p className="text-[14px] text-[var(--muted)]">
          The first Research Lab benchmark has not been published yet.
        </p>
      ) : (
        <>
          {benchmark.scoreBandCounts && <DistributionStrip counts={benchmark.scoreBandCounts} />}
          <div className="grid grid-cols-[28px_minmax(0,1fr)_132px_64px] gap-4 border-b border-[var(--line)] pb-3 pl-3 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--muted-2)]">
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
        </>
      )}
    </section>
  )
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
        'grid grid-cols-[28px_minmax(0,1fr)_132px_64px] items-start gap-4 border-b border-l-2 py-5 pl-3 transition-colors last:border-b-0',
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
        <div className="text-[13.5px] font-medium leading-snug text-[var(--platinum)]">{title}</div>
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
      </div>
      <div className="flex flex-col gap-1.5 pt-0.5">
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
      <div className="text-right">
        <div className="font-display text-[15px] font-medium tabular-nums text-[var(--platinum)]">
          {numberOr(icp.company_count, 0)}
        </div>
        <div className="mt-1 font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--muted-2)]">
          companies
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
  return (
    <div className="flex items-start justify-between gap-5 border-b border-[var(--line)] py-4 last:border-b-0">
      <div className="min-w-0">
        <div className="text-[13.5px] font-medium text-[var(--platinum)]">{issue.label}</div>
        <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--muted-2)]">{issue.description}</p>
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
 * Live research activity
 * ============================================================ */
function ActivitySection({ loops, activeCount }: { loops: ResearchLoop[]; activeCount: number }) {
  return (
    <section className="pt-16">
      <SecLabel index="03" title="Live research activity" />
      {activeCount > 0 ? (
        <div className="-mt-3 mb-6 inline-flex items-center gap-2 font-mono text-[11px] text-[var(--muted)]">
          <span className="live-ring inline-block h-1.5 w-1.5 rounded-full bg-[var(--white)]" />
          {activeCount} running
        </div>
      ) : null}
      {loops.length === 0 ? (
        <p className="text-[13px] text-[var(--muted-2)]">No research loop activity yet.</p>
      ) : (
        <div>
          {loops.map((loop) => (
            <LoopRow key={loop.cardId} loop={loop} />
          ))}
        </div>
      )}
    </section>
  )
}

function LoopRow({ loop }: { loop: ResearchLoop }) {
  return (
    <div className="border-b border-[var(--line)] py-4 transition-colors last:border-b-0 hover-bg-warm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <span className="break-all font-mono text-[11px] text-[var(--muted)]">{loop.minerHotkey}</span>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {loop.topicTags.slice(0, 3).map((tag) => (
              <Tag key={tag}>{readableTag(tag)}</Tag>
            ))}
          </div>
        </div>
        <OutcomeBadge label={loop.outcomeLabel} band={loop.outcomeBand} />
      </div>
      {loop.researchFocusSummary && (
        <p className="mt-2.5 line-clamp-2 text-[13px] leading-relaxed text-[var(--muted)]">
          {loop.researchFocusSummary}
        </p>
      )}
      {loop.bestCandidatePublicSummary && (
        <p className="mt-2 line-clamp-2 text-[12px] leading-relaxed text-[var(--muted-2)]">
          {loop.bestCandidatePublicSummary}
        </p>
      )}
      <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[10.5px] text-[var(--muted-2)]">
        <span>
          <span className="text-[var(--muted)]">{loop.candidateCount}</span> candidates
        </span>
        <span>
          <span className="text-[var(--muted)]">{loop.scoredCandidateCount}</span> scored
        </span>
        <span>{formatRelative(loop.lastActivityAt)}</span>
      </div>
    </div>
  )
}

function OutcomeBadge({ label, band }: { label: string; band: string }) {
  const tone = outcomeTone(band)
  return (
    <span
      className="shrink-0 rounded-[3px] border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.06em]"
      style={{ color: tone.color, borderColor: tone.border, background: tone.bg }}
    >
      {readableTag(label)}
    </span>
  )
}

/* ============================================================
 * Research directions
 * ============================================================ */
function DirectionsSection({ groups }: { groups: TopicGroup[] }) {
  return (
    <section className="pt-16">
      <SecLabel index="04" title="Research directions" sub="grouped by topic" />
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
        <span>{group.noGainOrFailed} no gain</span>
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
  if (band === 'small_gain') {
    return { color: 'var(--platinum)', border: 'var(--line-2)', bg: 'transparent' }
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
