'use client'

import {
  AlertTriangle,
  Building2,
  ChevronDown,
  CircleDollarSign,
  Gauge,
  Target,
  Trophy,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatDateTime, formatRelative, shortHotkey } from '@/lib/admin-format'
import type {
  AdminLabChampionSummary,
  AdminLabDailyBenchmark,
  AdminLabErrorDetail,
  AdminLabIcpDetail,
  AdminLabRunDetail,
  AdminLabTelemetryState,
} from '@/lib/admin-research-lab-telemetry'

export function DailyBenchmarkTelemetry({ benchmark }: { benchmark: AdminLabDailyBenchmark }) {
  return (
    <section className="overflow-hidden rounded-xl border" style={panelStyle}>
      <TelemetryHeader
        icon={<Gauge className="h-4 w-4 text-gold" />}
        title="Daily benchmark · live execution"
        state={benchmark.state}
        stateLabel={benchmark.stateLabel}
        aside={benchmark.benchmarkDate ? `UTC ${benchmark.benchmarkDate} · attempt ${benchmark.attempt ?? 0}` : undefined}
      />
      <div className="p-4">
        <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          {benchmark.detail}
        </p>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
          <TelemetryMetric label="ICPs left" value={benchmark.icpsRemaining} />
          <TelemetryMetric label="Processed" value={`${benchmark.icpsProcessed}/${benchmark.icpsTotal || '—'}`} />
          <TelemetryMetric label="Score so far" value={formatScore(benchmark.provisionalScore)} />
          <TelemetryMetric label="Avg processed" value={formatScore(benchmark.completedAverageScore)} />
          <TelemetryMetric label="Spend" value={formatUsd(benchmark.spendUsd)} />
          <TelemetryMetric label="Budget" value={benchmark.budgetUsd === null ? '—' : formatUsd(benchmark.budgetUsd)} />
          <TelemetryMetric label="Companies" value={benchmark.companyCount} />
          <TelemetryMetric label="Errors" value={benchmark.errorCount} critical={benchmark.errorCount > 0} />
        </div>

        <div className="mt-4">
          <div className="flex items-center justify-between gap-3 text-[10px] uppercase tracking-[0.12em]" style={{ color: 'var(--text-tertiary)' }}>
            <span>ICP progress</span>
            <span className="tabular-nums">{benchmark.progressPercent}%</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,0.07)' }}>
            <div
              className="h-full rounded-full transition-[width] duration-500"
              style={{ width: `${benchmark.progressPercent}%`, background: 'var(--accent-positive)' }}
            />
          </div>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 font-mono text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
            <span>Started {formatDateTime(benchmark.startedAt)}</span>
            <span suppressHydrationWarning>Updated {benchmark.lastActivityAt ? formatRelative(benchmark.lastActivityAt) : '—'}</span>
            {benchmark.workerRef ? <span>Worker {benchmark.workerRef}</span> : null}
          </div>
        </div>

        {benchmark.icps.length > 0 || benchmark.errors.length > 0 ? (
          <details
            className="group mt-4 overflow-hidden rounded-lg border"
            style={{ borderColor: 'var(--surface-border)', background: 'var(--surface-base)' }}
          >
            <summary className="cursor-pointer list-none px-4 py-3 marker:hidden hover-bg-warm">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                    ICP details and live errors
                  </div>
                  <div className="mt-1 text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                    {benchmark.icps.length} ICPs · {benchmark.errorCount.toLocaleString()} error events · collapsed by default
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2 text-[10px] font-medium uppercase tracking-[0.1em]" style={{ color: 'var(--text-secondary)' }}>
                  <span className="group-open:hidden">Show details</span>
                  <span className="hidden group-open:inline">Hide details</span>
                  <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
                </div>
              </div>
            </summary>
            <div className="grid gap-4 border-t p-3 xl:grid-cols-[minmax(0,1fr)_340px]" style={{ borderColor: 'var(--surface-border)' }}>
              <IcpTelemetryList icps={benchmark.icps} scoreLabel="Current score" />
              <ErrorStream errors={benchmark.errors} title="Live errors" />
            </div>
          </details>
        ) : (
          <EmptyTelemetry message="Waiting for the first per-ICP provider event." />
        )}
      </div>
    </section>
  )
}

export function ChampionTelemetry({ champions }: { champions: AdminLabChampionSummary[] }) {
  return (
    <section className="overflow-hidden rounded-xl border" style={panelStyle}>
      <TelemetryHeader
        icon={<Trophy className="h-4 w-4 text-gold" />}
        title="Champion runs · score, budget, ICPs, and companies"
        aside={`${champions.length} reward${champions.length === 1 ? '' : 's'}`}
      />
      {champions.length === 0 ? (
        <EmptyTelemetry message="No champion reward records are available." />
      ) : (
        <div className="space-y-2 p-3">
          {champions.map((champion) => (
            <details
              key={champion.championRewardId}
              className="group overflow-hidden rounded-lg border"
              style={{ borderColor: 'var(--surface-border)', background: 'var(--surface-base)' }}
            >
              <summary className="cursor-pointer list-none px-4 py-3 marker:hidden">
                <div className="grid items-center gap-3 lg:grid-cols-[minmax(220px,1.5fr)_repeat(5,minmax(88px,0.55fr))_24px]">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-gold" title={champion.minerHotkey}>{shortHotkey(champion.minerHotkey)}</span>
                      <TelemetryState state="completed" label={champion.status} />
                    </div>
                    <div suppressHydrationWarning className="mt-1 truncate text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                      Promoted {formatDateTime(champion.promotedAt)} · {compactId(champion.candidateId)}
                    </div>
                  </div>
                  <SummaryDatum label="Score" value={formatScore(champion.candidateScore)} />
                  <SummaryDatum label="Base" value={formatScore(champion.baseScore)} />
                  <SummaryDatum label="Gain" value={formatSigned(champion.meanDelta ?? champion.improvementPoints)} positive />
                  <SummaryDatum label="Spend" value={formatUsd(champion.spendUsd)} />
                  <SummaryDatum label="Companies" value={String(champion.companyCount)} />
                  <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" style={{ color: 'var(--text-tertiary)' }} />
                </div>
              </summary>
              <div className="border-t p-4" style={{ borderColor: 'var(--surface-border)' }}>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
                  <TelemetryMetric label="Candidate" value={formatScore(champion.candidateScore)} />
                  <TelemetryMetric label="Base" value={formatScore(champion.baseScore)} />
                  <TelemetryMetric label="Mean delta" value={formatSigned(champion.meanDelta)} />
                  <TelemetryMetric label="Delta LCB" value={formatSigned(champion.deltaLcb)} />
                  <TelemetryMetric label="Spend" value={formatUsd(champion.spendUsd)} />
                  <TelemetryMetric label="Budget seen" value={champion.budgetUsd === null ? '—' : formatUsd(champion.budgetUsd)} />
                  <TelemetryMetric label="ICPs" value={`${champion.successfulIcpCount}/${champion.icpCount}`} />
                  <TelemetryMetric label="Errors" value={champion.errorCount} critical={champion.errorCount > 0} />
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  <IdDatum label="Reward" value={champion.championRewardId} />
                  <IdDatum label="Score bundle" value={champion.scoreBundleId} />
                  <IdDatum label="Ticket / run" value={[champion.ticketId, champion.runId].filter(Boolean).join(' · ') || '—'} />
                </div>
                <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
                  <IcpTelemetryList icps={champion.icps} scoreLabel="Candidate score" />
                  <ErrorStream errors={champion.errors} title="Champion errors" />
                </div>
              </div>
            </details>
          ))}
        </div>
      )}
    </section>
  )
}

export function RunTelemetry({ detail }: { detail: AdminLabRunDetail }) {
  return (
    <div className="mb-5 space-y-4">
      <section className="overflow-hidden rounded-lg border" style={{ borderColor: 'var(--surface-border)', background: 'var(--surface-base)' }}>
        <TelemetryHeader
          icon={<CircleDollarSign className="h-4 w-4 text-gold" />}
          title="Run telemetry"
          state={detail.state}
          stateLabel={detail.phase}
          aside={`Refreshed ${formatDateTime(detail.fetchedAt)}`}
        />
        <div className="p-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <TelemetryMetric label="Candidates" value={detail.candidates.length} />
            <TelemetryMetric label="Spend" value={formatUsd(detail.totalSpendUsd)} />
            <TelemetryMetric label="Budget seen" value={detail.totalBudgetUsd === null ? '—' : formatUsd(detail.totalBudgetUsd)} />
            <TelemetryMetric label="Companies" value={detail.companyCount} />
            <TelemetryMetric label="Errors" value={detail.errorCount} critical={detail.errorCount > 0} />
          </div>
          {detail.candidates.length === 0 ? (
            <EmptyTelemetry message="No candidate has been emitted for this loop yet. Ticket and queue events remain visible in the timeline below." />
          ) : (
            <div className="mt-4 space-y-2">
              {detail.candidates.map((candidate) => (
                <details
                  key={candidate.candidateId}
                  className="group rounded-lg border"
                  style={{ borderColor: 'var(--surface-border)', background: 'var(--surface)' }}
                >
                  <summary className="cursor-pointer list-none p-3 marker:hidden">
                    <div className="grid items-center gap-3 md:grid-cols-[minmax(200px,1.4fr)_repeat(4,minmax(78px,0.5fr))_20px]">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-mono text-xs" style={{ color: 'var(--text-primary)' }}>{compactId(candidate.candidateId)}</span>
                          <TelemetryState state={stateForCandidate(candidate.status)} label={candidate.status} />
                        </div>
                        <div className="mt-1 truncate text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                          {candidate.summary || candidate.reason || 'No public candidate summary'}
                        </div>
                      </div>
                      <SummaryDatum label="Score" value={formatScore(candidate.candidateScore)} />
                      <SummaryDatum label="Delta" value={formatSigned(candidate.meanDelta)} positive />
                      <SummaryDatum label="Spend" value={formatUsd(candidate.spendUsd)} />
                      <SummaryDatum label="Errors" value={String(candidate.errorCount)} />
                      <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" style={{ color: 'var(--text-tertiary)' }} />
                    </div>
                  </summary>
                  <div className="border-t p-3" style={{ borderColor: 'var(--surface-border)' }}>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
                      <TelemetryMetric label="Candidate" value={formatScore(candidate.candidateScore)} />
                      <TelemetryMetric label="Base" value={formatScore(candidate.baseScore)} />
                      <TelemetryMetric label="Delta LCB" value={formatSigned(candidate.deltaLcb)} />
                      <TelemetryMetric label="Provider calls" value={candidate.providerEventCount} />
                      <TelemetryMetric label="Companies" value={candidate.companyCount} />
                      <TelemetryMetric label="Updated" value={candidate.statusAt ? formatRelative(candidate.statusAt) : '—'} />
                    </div>
                    {candidate.scoreBundleId ? <div className="mt-2"><IdDatum label="Score bundle" value={candidate.scoreBundleId} /></div> : null}
                    <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
                      <IcpTelemetryList icps={candidate.icps} scoreLabel="Candidate score" />
                      <ErrorStream errors={candidate.errors} title="Candidate errors" />
                    </div>
                  </div>
                </details>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

function IcpTelemetryList({ icps, scoreLabel }: { icps: AdminLabIcpDetail[]; scoreLabel: string }) {
  if (icps.length === 0) return <EmptyTelemetry message="No per-ICP scoring rows are available yet." />
  return (
    <div className="min-w-0 overflow-hidden rounded-lg border" style={{ borderColor: 'var(--surface-border)' }}>
      <div className="grid grid-cols-[minmax(170px,1.5fr)_72px_88px_74px_64px_24px] gap-2 border-b px-3 py-2 text-[9px] uppercase tracking-[0.12em]" style={{ borderColor: 'var(--surface-border)', color: 'var(--text-tertiary)' }}>
        <span>ICP</span><span>{scoreLabel}</span><span>Spend / cap</span><span>Companies</span><span>Errors</span><span />
      </div>
      <div className="max-h-[620px] overflow-auto">
        {icps.map((icp) => (
          <details key={icp.icpRef} className="group border-b last:border-b-0" style={{ borderColor: 'var(--surface-border)' }}>
            <summary className="cursor-pointer list-none px-3 py-2.5 marker:hidden hover-bg-warm">
              <div className="grid grid-cols-[minmax(170px,1.5fr)_72px_88px_74px_64px_24px] items-center gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', icpStatusDot(icp))} />
                    <span className="truncate text-xs" title={icp.label} style={{ color: 'var(--text-primary)' }}>{icp.label}</span>
                  </div>
                  <div className="mt-1 truncate font-mono text-[9px]" title={icp.icpRef} style={{ color: 'var(--text-tertiary)' }}>{compactId(icp.icpRef)}</div>
                </div>
                <div className="tabular-nums text-xs" style={{ color: 'var(--text-primary)' }}>{formatScore(icp.score)}</div>
                <div className="text-[11px] tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                  {formatUsd(icp.spendUsd)}
                  <div className="text-[9px]" style={{ color: 'var(--text-tertiary)' }}>of {icp.budgetUsd === null ? '—' : formatUsd(icp.budgetUsd)}</div>
                </div>
                <div className="text-xs tabular-nums" style={{ color: 'var(--text-secondary)' }}>{Math.max(icp.companies.length, icp.companyScoreCount)}</div>
                <div className={cn('text-xs tabular-nums', icp.errorCount > 0 ? 'text-burgundy' : '')} style={icp.errorCount > 0 ? undefined : { color: 'var(--text-secondary)' }}>{icp.errorCount}</div>
                <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" style={{ color: 'var(--text-tertiary)' }} />
              </div>
            </summary>
            <div className="border-t px-3 py-3" style={{ borderColor: 'var(--surface-border)', background: 'rgba(255,255,255,0.018)' }}>
              <div className="grid gap-2 sm:grid-cols-5">
                <TelemetryMetric label="Status" value={readable(icp.status)} />
                <TelemetryMetric label="Base" value={formatScore(icp.baseScore)} />
                <TelemetryMetric label="Delta" value={formatSigned(icp.delta)} />
                <TelemetryMetric label="Provider calls" value={icp.providerEventCount} />
                <TelemetryMetric label="Company score rows" value={icp.companyScoreCount} />
              </div>
              <IntentSignalList icp={icp} />
              {icp.funnel ? (
                <div className="mt-2 grid grid-cols-5 gap-1 rounded-lg border p-2 text-center" style={{ borderColor: 'var(--surface-border)' }}>
                  {[
                    ['Sourced', icp.funnel.sourced],
                    ['Fit', icp.funnel.fitPass],
                    ['Verified', icp.funnel.verified],
                    ['Intent', icp.funnel.intentValid],
                    ['Scored', icp.funnel.scored],
                  ].map(([label, value]) => (
                    <div key={String(label)}>
                      <div className="text-sm tabular-nums" style={{ color: 'var(--text-primary)' }}>{value}</div>
                      <div className="text-[9px] uppercase tracking-[0.1em]" style={{ color: 'var(--text-tertiary)' }}>{label}</div>
                    </div>
                  ))}
                </div>
              ) : null}
              {icp.failureReason ? (
                <div className="mt-2 rounded-md border border-burgundy-soft bg-burgundy-soft px-3 py-2 text-[11px] leading-relaxed text-burgundy">
                  {icp.failureReason}
                </div>
              ) : null}
              <CompanyList icp={icp} />
            </div>
          </details>
        ))}
      </div>
    </div>
  )
}

function IntentSignalList({ icp }: { icp: AdminLabIcpDetail }) {
  if (icp.intentSignals.length === 0) return null
  return (
    <div className="mt-3">
      <div className="mb-2 flex items-center gap-2 text-[10px] uppercase tracking-[0.12em]" style={{ color: 'var(--text-tertiary)' }}>
        <Target className="h-3.5 w-3.5" /> Intent signals
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        {icp.intentSignals.map((signal) => (
          <div
            key={`${signal.primary ? 'primary' : 'bonus'}:${signal.text}`}
            className="rounded-md border px-3 py-2.5"
            style={{ borderColor: 'var(--surface-border)', background: 'var(--surface-base)' }}
          >
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={cn(
                'rounded border px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.09em]',
                signal.primary
                  ? 'border-gold-soft bg-gold-soft text-gold'
                  : 'border-white/10 text-white/50',
              )}>
                {signal.primary ? 'Primary' : 'Bonus'}
              </span>
              {signal.category ? (
                <span className="rounded border px-1.5 py-0.5 text-[9px]" style={{ borderColor: 'var(--surface-border)', color: 'var(--text-tertiary)' }}>
                  {readable(signal.category)}
                </span>
              ) : null}
              {signal.maxAgeDays !== null ? (
                <span className="rounded border px-1.5 py-0.5 text-[9px] tabular-nums" style={{ borderColor: 'var(--surface-border)', color: 'var(--text-tertiary)' }}>
                  ≤ {signal.maxAgeDays.toLocaleString()}d old
                </span>
              ) : null}
            </div>
            <div className="mt-2 text-xs leading-relaxed" style={{ color: 'var(--text-primary)' }}>
              {signal.text}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function CompanyList({ icp }: { icp: AdminLabIcpDetail }) {
  if (icp.companies.length === 0) {
    return (
      <div className="mt-3 rounded-md border px-3 py-2 text-[11px]" style={{ borderColor: 'var(--surface-border)', color: 'var(--text-tertiary)' }}>
        {icp.companyScoreCount > 0
          ? `${icp.companyScoreCount} scored company slot${icp.companyScoreCount === 1 ? '' : 's'} are present, but company identity telemetry was not retained for this run.`
          : 'No companies were surfaced for this ICP.'}
      </div>
    )
  }
  return (
    <div className="mt-3">
      <div className="mb-2 flex items-center gap-2 text-[10px] uppercase tracking-[0.12em]" style={{ color: 'var(--text-tertiary)' }}>
        <Building2 className="h-3.5 w-3.5" /> Surfaced companies
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        {icp.companies.map((company) => (
          <div key={company.id} className="rounded-md border px-3 py-2" style={{ borderColor: 'var(--surface-border)', background: 'var(--surface-base)' }}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                {company.website ? (
                  <a href={normalizeUrl(company.website)} target="_blank" rel="noreferrer" className="block truncate text-xs underline-offset-2 hover:underline" style={{ color: 'var(--text-primary)' }}>
                    {company.name}
                  </a>
                ) : (
                  <div className="truncate text-xs" style={{ color: 'var(--text-primary)' }}>{company.name}</div>
                )}
                <div className="mt-1 truncate text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                  {[company.industry, company.country, company.modelSide].filter(Boolean).join(' · ') || 'No additional metadata'}
                </div>
              </div>
              <span className="shrink-0 font-mono text-xs text-gold">{formatScore(company.finalScore, 0)}</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <MiniPill label="Fit" pass={company.fitPassed} />
              <MiniPill label="Intent" pass={company.intentPassed} />
              {company.linkedin ? <a href={normalizeUrl(company.linkedin)} target="_blank" rel="noreferrer" className="rounded border px-1.5 py-0.5 text-[9px]" style={{ borderColor: 'var(--surface-border)', color: 'var(--text-secondary)' }}>LinkedIn ↗</a> : null}
            </div>
            {company.failureReason ? <div className="mt-2 text-[10px] text-burgundy">{company.failureReason}</div> : null}
          </div>
        ))}
      </div>
    </div>
  )
}

function ErrorStream({ errors, title }: { errors: AdminLabErrorDetail[]; title: string }) {
  const groups = groupErrorsByType(errors)
  const eventCount = errors.reduce((sum, item) => sum + item.count, 0)
  return (
    <div className="overflow-hidden rounded-lg border" style={{ borderColor: 'var(--surface-border)' }}>
      <div className="flex items-center justify-between gap-3 border-b px-3 py-2" style={{ borderColor: 'var(--surface-border)' }}>
        <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-primary)' }}>
          <AlertTriangle className={cn('h-3.5 w-3.5', errors.length > 0 ? 'text-burgundy' : 'text-gold')} />
          {title}
        </div>
        <span className="font-mono text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
          {groups.length} type{groups.length === 1 ? '' : 's'} · {eventCount.toLocaleString()} events
        </span>
      </div>
      {errors.length === 0 ? (
        <div className="p-4 text-xs" style={{ color: 'var(--text-secondary)' }}>No errors recorded for this scope.</div>
      ) : (
        <div className="max-h-[620px] divide-y overflow-auto" style={{ borderColor: 'var(--surface-border)' }}>
          {groups.map((group) => (
            <details key={group.key} className="group/error">
              <summary className="cursor-pointer list-none px-3 py-3 marker:hidden hover-bg-warm">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-xs font-medium text-burgundy">{group.label}</span>
                      <span className="truncate font-mono text-[10px]" title={group.endpoint} style={{ color: 'var(--text-primary)' }}>
                        {group.endpoint}
                      </span>
                    </div>
                    <div className="mt-1 text-[9px]" style={{ color: 'var(--text-tertiary)' }}>
                      {group.icpCount} affected ICP{group.icpCount === 1 ? '' : 's'} · latest {group.latestAt ? formatRelative(group.latestAt) : 'unknown'}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="rounded-full border border-burgundy-soft bg-burgundy-soft px-2 py-0.5 font-mono text-[9px] text-burgundy">
                      ×{group.eventCount.toLocaleString()}
                    </span>
                    <ChevronDown className="h-3.5 w-3.5 transition-transform group-open/error:rotate-180" style={{ color: 'var(--text-tertiary)' }} />
                  </div>
                </div>
              </summary>
              <div className="border-t" style={{ borderColor: 'var(--surface-border)', background: 'rgba(255,255,255,0.015)' }}>
                <div className="grid grid-cols-[minmax(110px,1.4fr)_80px_minmax(118px,1fr)_44px] gap-2 border-b px-3 py-1.5 text-[8px] uppercase tracking-[0.1em]" style={{ borderColor: 'var(--surface-border)', color: 'var(--text-tertiary)' }}>
                  <span>ICP / scope</span>
                  <span>Provider</span>
                  <span>Latest event</span>
                  <span className="text-right">Hits</span>
                </div>
                <div className="max-h-[300px] overflow-auto">
                  {group.occurrences.map((error) => (
                    <div
                      key={error.id}
                      className="grid grid-cols-[minmax(110px,1.4fr)_80px_minmax(118px,1fr)_44px] items-center gap-2 border-b px-3 py-2 last:border-b-0"
                      style={{ borderColor: 'var(--surface-border)' }}
                    >
                      <div className="min-w-0">
                        <div className="truncate font-mono text-[9px]" title={error.icpRef ?? error.candidateId ?? error.runId ?? error.title} style={{ color: 'var(--text-secondary)' }}>
                          {error.icpRef
                            ? compactId(error.icpRef)
                            : error.candidateId
                              ? `Candidate ${compactId(error.candidateId)}`
                              : error.runId
                                ? `Run ${compactId(error.runId)}`
                                : 'Global'}
                        </div>
                      </div>
                      <div className="truncate text-[9px]" title={error.provider ?? error.source} style={{ color: 'var(--text-tertiary)' }}>
                        {error.provider ?? readable(error.source)}
                      </div>
                      <time suppressHydrationWarning className="font-mono text-[9px]" dateTime={error.occurredAt ?? undefined} style={{ color: 'var(--text-tertiary)' }}>
                        {formatDateTime(error.occurredAt)}
                      </time>
                      <div className="text-right font-mono text-[9px] text-burgundy">×{error.count}</div>
                    </div>
                  ))}
                </div>
              </div>
            </details>
          ))}
        </div>
      )}
    </div>
  )
}

type ErrorTypeGroup = {
  key: string
  label: string
  endpoint: string
  eventCount: number
  icpCount: number
  latestAt: string | null
  occurrences: AdminLabErrorDetail[]
}

function groupErrorsByType(errors: AdminLabErrorDetail[]): ErrorTypeGroup[] {
  const grouped = new Map<string, AdminLabErrorDetail[]>()
  for (const error of errors) {
    const endpoint = error.endpoint ?? error.detail ?? 'No endpoint'
    const key = error.statusCode !== null
      ? `${error.statusCode}\u0000${endpoint}`
      : `${error.source}\u0000${error.title}\u0000${endpoint}`
    const current = grouped.get(key) ?? []
    current.push(error)
    grouped.set(key, current)
  }

  return Array.from(grouped.entries())
    .map(([key, occurrences]) => {
      const first = occurrences[0]
      const latestAt = occurrences.reduce<string | null>((latest, error) => {
        if (!error.occurredAt) return latest
        if (!latest || new Date(error.occurredAt).getTime() > new Date(latest).getTime()) return error.occurredAt
        return latest
      }, null)
      return {
        key,
        label: first.statusCode !== null ? `HTTP ${first.statusCode}` : first.title,
        endpoint: first.endpoint ?? first.detail ?? 'No endpoint',
        eventCount: occurrences.reduce((sum, error) => sum + error.count, 0),
        icpCount: new Set(occurrences.map((error) => error.icpRef).filter(Boolean)).size,
        latestAt,
        occurrences: [...occurrences].sort(
          (a, b) => new Date(b.occurredAt ?? 0).getTime() - new Date(a.occurredAt ?? 0).getTime(),
        ),
      }
    })
    .sort((a, b) => b.eventCount - a.eventCount || new Date(b.latestAt ?? 0).getTime() - new Date(a.latestAt ?? 0).getTime())
}

function TelemetryHeader({
  icon,
  title,
  state,
  stateLabel,
  aside,
}: {
  icon: React.ReactNode
  title: string
  state?: AdminLabTelemetryState
  stateLabel?: string
  aside?: string
}) {
  return (
    <div className="flex flex-col gap-2 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between" style={{ borderColor: 'var(--surface-border)' }}>
      <div className="flex min-w-0 items-center gap-2">
        {icon}
        <h2 className="truncate text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{title}</h2>
        {state && stateLabel ? <TelemetryState state={state} label={stateLabel} /> : null}
      </div>
      {aside ? <div className="font-mono text-[10px]" style={{ color: 'var(--text-tertiary)' }}>{aside}</div> : null}
    </div>
  )
}

function TelemetryState({ state, label }: { state: AdminLabTelemetryState; label: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[9px] font-medium uppercase tracking-[0.1em]', statePillClass(state))}>
      <span className={cn('h-1.5 w-1.5 rounded-full', stateDot(state))} />
      {readable(label)}
    </span>
  )
}

function TelemetryMetric({ label, value, critical = false }: { label: string; value: string | number; critical?: boolean }) {
  return (
    <div className="min-w-0 rounded-lg border px-3 py-2" style={{ borderColor: 'var(--surface-border)', background: 'var(--surface-base)' }}>
      <div className="truncate text-[9px] uppercase tracking-[0.11em]" style={{ color: 'var(--text-tertiary)' }}>{label}</div>
      <div className={cn('mt-1 truncate text-sm font-medium tabular-nums', critical ? 'text-burgundy' : '')} style={critical ? undefined : { color: 'var(--text-primary)' }} title={String(value)}>{typeof value === 'number' ? value.toLocaleString() : value}</div>
    </div>
  )
}

function SummaryDatum({ label, value, positive = false }: { label: string; value: string; positive?: boolean }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-[0.1em]" style={{ color: 'var(--text-tertiary)' }}>{label}</div>
      <div className={cn('mt-1 truncate text-xs font-medium tabular-nums', positive && value.startsWith('+') ? 'text-gold' : '')} style={positive && value.startsWith('+') ? undefined : { color: 'var(--text-primary)' }}>{value}</div>
    </div>
  )
}

function IdDatum({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md border px-3 py-2" style={{ borderColor: 'var(--surface-border)' }}>
      <div className="text-[9px] uppercase tracking-[0.1em]" style={{ color: 'var(--text-tertiary)' }}>{label}</div>
      <div className="mt-1 truncate font-mono text-[10px]" title={value} style={{ color: 'var(--text-secondary)' }}>{value}</div>
    </div>
  )
}

function MiniPill({ label, pass }: { label: string; pass: boolean | null }) {
  return (
    <span className={cn('rounded border px-1.5 py-0.5 text-[9px]', pass === true ? 'border-gold-soft bg-gold-soft text-gold' : pass === false ? 'border-burgundy-soft bg-burgundy-soft text-burgundy' : 'border-white/10 text-white/45')}>
      {label} {pass === true ? 'pass' : pass === false ? 'fail' : '—'}
    </span>
  )
}

function EmptyTelemetry({ message }: { message: string }) {
  return <div className="m-4 rounded-lg border p-5 text-center text-xs" style={{ borderColor: 'var(--surface-border)', color: 'var(--text-secondary)' }}>{message}</div>
}

const panelStyle = { borderColor: 'var(--surface-border)', background: 'var(--surface)' }

function statePillClass(state: AdminLabTelemetryState): string {
  if (state === 'active') return 'border-amber-warm-soft bg-amber-warm-soft text-amber-warm'
  if (state === 'completed') return 'border-gold-soft bg-gold-soft text-gold'
  if (state === 'failed' || state === 'stalled') return 'border-burgundy-soft bg-burgundy-soft text-burgundy'
  return 'border-white/10 text-white/50'
}

function stateDot(state: AdminLabTelemetryState): string {
  if (state === 'active') return 'bg-[var(--accent-pending)] live-pulse'
  if (state === 'completed') return 'bg-[var(--accent-positive)]'
  if (state === 'failed' || state === 'stalled') return 'bg-[var(--accent-negative)]'
  return 'bg-white/30'
}

function stateForCandidate(status: string): AdminLabTelemetryState {
  const value = status.toLowerCase()
  if (value.includes('fail') || value.includes('reject') || value.includes('cancel')) return 'failed'
  if (value.includes('score') || value.includes('complete') || value.includes('promot')) return 'completed'
  if (value.includes('run') || value.includes('queue') || value.includes('evaluat')) return 'active'
  return 'unknown'
}

function icpStatusDot(icp: AdminLabIcpDetail): string {
  if (icp.hardFailure || icp.errorCount > 0) return 'bg-[var(--accent-negative)]'
  if (icp.status === 'pending') return 'bg-white/25'
  return 'bg-[var(--accent-positive)]'
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: value < 1 ? 3 : 2, maximumFractionDigits: value < 1 ? 3 : 2 }).format(Number.isFinite(value) ? value : 0)
}

function formatScore(value: number | null | undefined, digits = 2): string {
  return value === null || value === undefined || !Number.isFinite(value) ? '—' : value.toFixed(digits)
}

function formatSigned(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return `${value > 0 ? '+' : ''}${value.toFixed(digits)}`
}

function compactId(value: string): string {
  const tail = value.split(':').at(-1) ?? value
  return tail.length > 22 ? `${tail.slice(0, 12)}…${tail.slice(-6)}` : tail
}

function readable(value: string): string {
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())
}

function normalizeUrl(value: string): string {
  return /^https?:\/\//i.test(value) ? value : `https://${value}`
}
