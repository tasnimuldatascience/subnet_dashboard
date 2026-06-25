'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity,
  AlertCircle,
  BarChart3,
  Clock3,
  FlaskConical,
  Loader2,
  Target,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

type ResearchLabData = {
  benchmark: BenchmarkReport | null
  loops: ResearchLoop[]
  topicGroups: TopicGroup[]
  stats: {
    activeLoopCount: number
    scoredLoopCount: number
    promisingLoopCount: number
    publicIcpCount: number
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
  publicIcpCount: number
  privateHoldoutIcpCount: number
  scoreBandCounts: Record<string, number>
  failureCategoryCounts: Record<string, number>
  visibilitySplit: {
    splitPolicy?: string
    public_count?: number
    private_count?: number
    public_strength_counts?: Record<string, number>
    private_strength_counts?: Record<string, number>
  }
  publicIcps: PublicIcp[]
  currentStatusAt: string | null
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
  strength_label?: string
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
  const publicIcpAverage = useMemo(() => {
    const icps = benchmark?.publicIcps ?? []
    if (!icps.length) return 0
    return icps.reduce((sum, row) => sum + numberOr(row.score, 0), 0) / icps.length
  }, [benchmark])

  if (loading) return <ResearchLabLoading />

  if (error) {
    return (
      <div className="rounded-xl border border-burgundy-soft bg-burgundy-soft p-6 text-slate-200">
        <div className="flex items-center gap-2 text-sm font-semibold text-cream">
          <AlertCircle className="h-4 w-4 text-burgundy" />
          Research Lab data unavailable
        </div>
        <p className="mt-2 text-sm text-slate-400">{error}</p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-gold">
            <FlaskConical className="h-3.5 w-3.5" />
            Research Lab
          </div>
          <h2 className="mt-2 text-2xl md:text-3xl font-semibold tracking-tight text-slate-100">
            Private model benchmark and live research activity
          </h2>
        </div>
        <div className="text-xs font-mono text-slate-500">
          {data?.fetchedAt ? `Updated ${formatRelative(data.fetchedAt)}` : null}
        </div>
      </header>

      <section className="grid gap-3 md:grid-cols-4">
        <MetricPanel
          label="Current model score"
          value={benchmark ? formatScore(benchmark.aggregateScore) : 'Pending'}
          detail={benchmark ? `${benchmark.itemCount} ICP benchmark` : 'No published benchmark'}
          tone="gold"
        />
        <MetricPanel
          label="Public ICP average"
          value={benchmark ? formatScore(publicIcpAverage) : 'Pending'}
          detail={`${benchmark?.publicIcpCount ?? 0} public ICPs shown`}
        />
        <MetricPanel
          label="Private holdout"
          value={`${benchmark?.privateHoldoutIcpCount ?? 0}`}
          detail="ICPs kept hidden"
        />
        <MetricPanel
          label="Active loops"
          value={`${data?.stats.activeLoopCount ?? 0}`}
          detail={`${data?.stats.scoredLoopCount ?? 0} scored recently`}
        />
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(380px,0.9fr)]">
        <BenchmarkPanel benchmark={benchmark} />
        <ActivityPanel loops={data?.loops ?? []} topicGroups={data?.topicGroups ?? []} />
      </section>
    </div>
  )
}

function ResearchLabLoading() {
  return (
    <div className="rounded-xl border border-slate-800/70 bg-slate-950/40 p-8 text-center text-slate-400">
      <Loader2 className="mx-auto h-5 w-5 animate-spin text-gold" />
      <div className="mt-3 text-sm">Loading Research Lab data</div>
    </div>
  )
}

function MetricPanel({
  label,
  value,
  detail,
  tone = 'neutral',
}: {
  label: string
  value: string
  detail: string
  tone?: 'gold' | 'neutral'
}) {
  return (
    <div className="rounded-lg border border-slate-800/70 bg-slate-950/45 px-4 py-3">
      <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">{label}</div>
      <div className={cn('mt-2 text-2xl font-semibold tabular-nums', tone === 'gold' ? 'text-gold' : 'text-slate-100')}>
        {value}
      </div>
      <div className="mt-1 text-xs text-slate-500">{detail}</div>
    </div>
  )
}

function BenchmarkPanel({ benchmark }: { benchmark: BenchmarkReport | null }) {
  const publicIcps = benchmark?.publicIcps ?? []
  const publicStrength = benchmark?.visibilitySplit?.public_strength_counts ?? {}
  const privateStrength = benchmark?.visibilitySplit?.private_strength_counts ?? {}

  return (
    <div className="rounded-xl border border-slate-800/70 bg-slate-950/40 overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-slate-800/70 px-4 py-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
            <BarChart3 className="h-4 w-4 text-gold" />
            Current benchmark
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {benchmark ? `${formatDate(benchmark.benchmarkDate)} · ${shortHash(benchmark.rollingWindowHash)}` : 'No published report yet'}
          </div>
        </div>
        {benchmark && (
          <Badge className="border-gold-soft bg-gold-soft text-gold">
            {benchmark.aggregateScoreBand.replace(/_/g, ' ')}
          </Badge>
        )}
      </div>

      {!benchmark ? (
        <div className="p-6 text-sm text-slate-400">The first public Research Lab benchmark has not been published yet.</div>
      ) : (
        <>
          <div className="grid gap-3 border-b border-slate-800/70 p-4 md:grid-cols-3">
            <SplitBlock label="Public split" weak={numberOr(publicStrength.weak, 0)} strong={numberOr(publicStrength.strong, 0)} />
            <SplitBlock label="Private holdout" weak={numberOr(privateStrength.weak, 0)} strong={numberOr(privateStrength.strong, 0)} />
            <div className="rounded-lg border border-slate-800/60 bg-slate-900/35 p-3">
              <div className="text-[10px] uppercase tracking-[0.14em] text-slate-500">Failures</div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {Object.entries(benchmark.failureCategoryCounts).slice(0, 4).map(([key, count]) => (
                  <Badge key={key} className="border-slate-700/70 bg-slate-900/60 text-slate-300">
                    {readableTag(key)} {count}
                  </Badge>
                ))}
                {Object.keys(benchmark.failureCategoryCounts).length === 0 && (
                  <span className="text-xs text-slate-500">None recorded</span>
                )}
              </div>
            </div>
          </div>

          <div className="max-h-[720px] overflow-auto">
            <div className="grid grid-cols-[88px_minmax(0,1fr)_96px] gap-3 border-b border-slate-800/60 px-4 py-2 text-[10px] uppercase tracking-[0.14em] text-slate-500">
              <span>Score</span>
              <span>Public ICP</span>
              <span className="text-right">Leads</span>
            </div>
            {publicIcps.map((icp) => (
              <PublicIcpRow key={icp.icp_ref || icp.icp_hash || icp.item_rank} icp={icp} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function SplitBlock({ label, weak, strong }: { label: string; weak: number; strong: number }) {
  return (
    <div className="rounded-lg border border-slate-800/60 bg-slate-900/35 p-3">
      <div className="text-[10px] uppercase tracking-[0.14em] text-slate-500">{label}</div>
      <div className="mt-2 flex items-baseline gap-3">
        <span className="text-xl font-semibold text-slate-100 tabular-nums">{weak + strong}</span>
        <span className="text-xs text-slate-500">ICPs</span>
      </div>
      <div className="mt-2 flex gap-2 text-xs">
        <span className="text-amber-warm">{weak} weak</span>
        <span className="text-slate-600">/</span>
        <span className="text-gold">{strong} strong</span>
      </div>
    </div>
  )
}

function PublicIcpRow({ icp }: { icp: PublicIcp }) {
  const doc = icp.icp ?? {}
  const signals = intentSignals(doc.intent_signals)
  const title = compactParts([
    textValue(doc.industry),
    textValue(doc.sub_industry),
    textValue(doc.product_service),
  ]) || 'Public ICP'
  const geography = compactParts([
    textValue(doc.company_region),
    textValue(doc.company_country ?? doc.country ?? doc.target_geography),
  ])
  const companySize = textValue(doc.employee_count ?? doc.company_size)
  const roles = arrayText(doc.target_roles ?? doc.target_role_types)

  return (
    <div className="grid grid-cols-[88px_minmax(0,1fr)_96px] gap-3 border-b border-slate-800/45 px-4 py-3 last:border-b-0">
      <div>
        <div className={cn('text-lg font-semibold tabular-nums', icp.strength_label === 'weak' ? 'text-amber-warm' : 'text-gold')}>
          {formatScore(numberOr(icp.score, 0))}
        </div>
        <div className="mt-1 text-[10px] uppercase tracking-[0.12em] text-slate-500">
          {icp.strength_label || 'public'}
        </div>
      </div>
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-slate-100">{title}</div>
        <div className="mt-1 flex flex-wrap gap-1.5 text-xs text-slate-500">
          {geography && <Tag>{geography}</Tag>}
          {companySize && <Tag>{companySize}</Tag>}
          {roles && <Tag>{roles}</Tag>}
        </div>
        {signals.length > 0 && (
          <div className="mt-2 space-y-1">
            {signals.slice(0, 3).map((signal, index) => (
              <div key={`${icp.icp_ref}-signal-${index}`} className="text-xs leading-relaxed text-slate-400">
                <span className="text-slate-600">signal</span> {signal}
              </div>
            ))}
          </div>
        )}
        {(icp.diagnostics?.failure_categories?.length ?? 0) > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {icp.diagnostics?.failure_categories?.slice(0, 3).map((failure) => (
              <Badge key={failure} className="border-burgundy-soft bg-burgundy-soft text-slate-300">
                {readableTag(failure)}
              </Badge>
            ))}
          </div>
        )}
      </div>
      <div className="text-right">
        <div className="text-sm font-semibold text-slate-100 tabular-nums">{numberOr(icp.company_count, 0)}</div>
        <div className="mt-1 text-[10px] uppercase tracking-[0.12em] text-slate-500">companies</div>
      </div>
    </div>
  )
}

function ActivityPanel({ loops, topicGroups }: { loops: ResearchLoop[]; topicGroups: TopicGroup[] }) {
  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-slate-800/70 bg-slate-950/40 overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-slate-800/70 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
            <Activity className="h-4 w-4 text-gold" />
            Recent research activity
          </div>
          <span className="text-xs text-slate-500">{loops.length} loops</span>
        </div>
        <div className="max-h-[440px] overflow-auto">
          {loops.length === 0 ? (
            <div className="p-5 text-sm text-slate-400">No public Research Lab loop activity yet.</div>
          ) : (
            loops.map((loop) => <LoopRow key={loop.cardId} loop={loop} />)
          )}
        </div>
      </div>

      <div className="rounded-xl border border-slate-800/70 bg-slate-950/40 overflow-hidden">
        <div className="flex items-center gap-2 border-b border-slate-800/70 px-4 py-3 text-sm font-semibold text-slate-100">
          <Target className="h-4 w-4 text-gold" />
          Research directions
        </div>
        <div className="divide-y divide-slate-800/50">
          {topicGroups.length === 0 ? (
            <div className="p-5 text-sm text-slate-400">No grouped research directions yet.</div>
          ) : (
            topicGroups.slice(0, 8).map((group) => <TopicGroupRow key={group.topicSignatureHash} group={group} />)
          )}
        </div>
      </div>
    </div>
  )
}

function LoopRow({ loop }: { loop: ResearchLoop }) {
  return (
    <div className="border-b border-slate-800/45 px-4 py-3 last:border-b-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="break-all font-mono text-xs text-slate-300">{loop.minerHotkey}</div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {loop.topicTags.slice(0, 3).map((tag) => <Tag key={tag}>{readableTag(tag)}</Tag>)}
          </div>
        </div>
        <OutcomeBadge label={loop.outcomeLabel} band={loop.outcomeBand} />
      </div>
      {loop.researchFocusSummary && (
        <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-slate-400">{loop.researchFocusSummary}</p>
      )}
      {loop.bestCandidatePublicSummary && (
        <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-slate-500">{loop.bestCandidatePublicSummary}</p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-500">
        <span>{loop.candidateCount} candidates</span>
        <span>{loop.scoredCandidateCount} scored</span>
        <span className="inline-flex items-center gap-1">
          <Clock3 className="h-3 w-3" />
          {formatRelative(loop.lastActivityAt)}
        </span>
      </div>
    </div>
  )
}

function TopicGroupRow({ group }: { group: TopicGroup }) {
  return (
    <div className="px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {group.topicTags.slice(0, 3).map((tag) => <Tag key={tag}>{readableTag(tag)}</Tag>)}
        </div>
        <span className="text-sm font-semibold text-slate-100 tabular-nums">{group.total}</span>
      </div>
      <div className="mt-2 grid grid-cols-4 gap-2 text-[11px] text-slate-500">
        <span>{group.running} running</span>
        <span>{group.scored} scored</span>
        <span className="text-gold">{group.promisingOrPromoted} promising</span>
        <span className="text-burgundy">{group.noGainOrFailed} no gain</span>
      </div>
    </div>
  )
}

function OutcomeBadge({ label, band }: { label: string; band: string }) {
  const tone =
    band === 'promoted' || band === 'passed_threshold'
      ? 'gold'
      : band === 'small_gain'
        ? 'amber'
        : band === 'failed' || band === 'no_gain'
          ? 'burgundy'
          : 'neutral'
  return (
    <Badge
      className={cn(
        'capitalize',
        tone === 'gold' && 'border-gold-soft bg-gold-soft text-gold',
        tone === 'amber' && 'border-amber-warm-soft bg-amber-warm-soft text-amber-warm',
        tone === 'burgundy' && 'border-burgundy-soft bg-burgundy-soft text-slate-300',
        tone === 'neutral' && 'border-slate-700/70 bg-slate-900/70 text-slate-300'
      )}
    >
      {readableTag(label)}
    </Badge>
  )
}

function Tag({ children }: { children: string }) {
  return (
    <span className="inline-flex max-w-full rounded border border-slate-800/80 bg-slate-900/55 px-1.5 py-0.5 text-[11px] text-slate-400">
      <span className="truncate">{children}</span>
    </span>
  )
}

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

function shortHash(value: string): string {
  if (!value) return ''
  return value.length > 18 ? `${value.slice(0, 13)}...${value.slice(-4)}` : value
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
