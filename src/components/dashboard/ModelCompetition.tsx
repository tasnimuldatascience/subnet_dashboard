'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Loader2,
  Code,
  Eye,
  Lock,
  Copy,
  Check,
  ChevronRight,
  AlertTriangle,
  Crown,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// =================================================================
//  Model Competition. Premium editorial redesign.
//
//  Visual language matches Fulfillment: warm off-black canvas, single
//  gold accent (#c9a96e), cream for completed, amber-warm for in-flight,
//  burgundy for negative. No vivid Tailwind hues.
// =================================================================

/**
 * The score margin a new model must exceed to dethrone the current champion.
 * Sourced from env so it can be tuned without a code change. Defaults to 5%
 * which matches the subnet's published qualification spec.
 */
const CHALLENGE_THRESHOLD_PCT = Number(
  process.env.NEXT_PUBLIC_CHALLENGE_THRESHOLD_PCT ?? '5'
)

/** Lifetime of code-visibility lock after submission/champion event. */
const CODE_UNLOCK_HOURS = 24

// Types for champion history data
interface ChampionHistoryEntry {
  modelId: string
  minerHotkey: string
  modelName: string
  score: number
  createdAt?: string
  championAt: string
  dethronedAt: string | null
  reignDuration: string | null
  codeContent: unknown | null
  hasCode: boolean
  canShowCode: boolean
  scoreBreakdown: ScoreBreakdown | null
}

// Score breakdown types
interface ScoreComponents {
  icp_fit: number
  decision_maker: number
  intent_signal_raw: number
  intent_signal_final: number
  cost_penalty: number
  time_penalty: number
  time_decay_multiplier?: number
}

interface LeadResult {
  rank: number
  final_score: number
  icp_prompt: string
  lead: {
    city?: string
    role?: string
    state?: string
    country?: string
    business?: string
    industry?: string
    sub_industry?: string
    employee_count?: string
    company_website?: string
    company_linkedin?: string
  } | null
  score_components: ScoreComponents
  failure_reason: string | null
  run_cost_usd: number
  run_time_seconds: number
  icp_industry?: string
  icp_geography?: string
  intent_signals?: Array<{
    url: string
    date: string
    source: string
    snippet: string
    description: string
  }>
}

interface EvaluationSummary {
  raw_avg_score?: number
  final_score?: number
  total_icps: number
  icps_failed?: number
  icps_no_lead?: number
  icps_scored: number
  icps_with_lead?: number
  total_cost_usd: number
  total_time_seconds: number
  stopped_early?: boolean
  stopped_reason?: string | null
  fabrication_rate?: number
  fabrication_count?: number
  integrity_multiplier?: number
}

interface ScoreBreakdown {
  status: string
  version?: number
  evaluation_summary: EvaluationSummary
  top_5_leads: LeadResult[]
  bottom_5_leads: LeadResult[]
  rejection?: string | null
  zero_score_count?: number
}

// Types for today's submissions
interface Submission {
  id: string
  minerHotkey: string
  modelName: string
  status: string
  score: number | null
  scoreBreakdown: ScoreBreakdown | null
  codeContent: unknown | null
  createdAt: string
  evaluatedAt: string | null
  isChampion: boolean | null
  canShowCode: boolean
}

interface Stats {
  totalSubmissions: number
  uniqueMiners: number
  statusCounts: {
    submitted: number
    evaluating: number
    evaluated: number
    failed: number
  }
  totalChampions: number
  uniqueChampionMiners: number
  currentChampionScore: number
  baselineScore: number
  baselineSetId: number | null
}

interface BaselineModel {
  id: string
  modelName: string
  score: number
  setId: number | null
  scoredAt: string | null
  codeContent: Record<string, string> | null
  canShowCode: boolean
  sourceUrl?: string
}

interface ModelCompetitionData {
  championHistory: ChampionHistoryEntry[]
  recentSubmissions: Submission[]
  pastSubmissions?: Submission[]
  baselineModel?: BaselineModel | null
  stats: Stats
  fetchedAt: string
}

// Helper to format relative time
function getRelativeTime(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diff = Math.floor((now.getTime() - date.getTime()) / 1000)

  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

// Helper to format date as readable string
function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// Shorter date format used in the ChampionHero "Champion since" line.
// Drops the time component; the live "Reigning for X" counter on the right
// already communicates duration, so the time-of-day is redundant clutter,
// especially on narrow viewports.
function formatChampionSinceDate(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

// Helper to format PostgreSQL interval to readable string
function formatDuration(interval: string | null): string {
  if (!interval) return 'Current'

  // Parse PostgreSQL interval format like "2 days 03:45:12" or "03:45:12"
  const parts = interval.match(/(?:(\d+)\s*days?)?\s*(\d{2}):(\d{2}):(\d{2})/)
  if (!parts) return interval

  const days = parseInt(parts[1] || '0')
  const hours = parseInt(parts[2] || '0')
  const minutes = parseInt(parts[3] || '0')

  if (days > 0) {
    return `${days}d ${hours}h`
  } else if (hours > 0) {
    return `${hours}h ${minutes}m`
  } else {
    return `${minutes}m`
  }
}

// Helper to truncate hotkey. Matches the Fulfillment convention
// (6 chars · ellipsis · 4 chars) so the same identity reads identically
// on both tabs.
function truncateHotkey(hotkey: string): string {
  if (!hotkey || hotkey.length <= 12) return hotkey
  return `${hotkey.slice(0, 6)}...${hotkey.slice(-4)}`
}

/**
 * Format a duration in seconds as a live reign counter.
 * - <60s   → "47s"
 * - <1h    → "12m 47s"
 * - <1d    → "4h 12m"
 * - >=1d   → "9d 14h"
 *
 * Designed to read naturally next to a champion title; updates every second.
 */
function formatLiveDuration(seconds: number): string {
  if (seconds < 0) seconds = 0
  if (seconds < 60) return `${Math.floor(seconds)}s`
  const m = Math.floor(seconds / 60)
  if (m < 60) return `${m}m ${Math.floor(seconds % 60)}s`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ${m % 60}m`
  const d = Math.floor(h / 24)
  return `${d}d ${h % 24}h`
}

/**
 * Format a positive seconds value as a countdown (e.g. "23h 14m" or "4m 12s").
 * Returns null if the deadline has passed.
 */
function formatCountdown(secondsRemaining: number): string | null {
  if (secondsRemaining <= 0) return null
  if (secondsRemaining < 60) return `${Math.floor(secondsRemaining)}s`
  const m = Math.floor(secondsRemaining / 60)
  if (m < 60) return `${m}m ${Math.floor(secondsRemaining % 60)}s`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ${m % 60}m`
  const d = Math.floor(h / 24)
  return `${d}d ${h % 24}h`
}


/**
 * Smooth count-up animation for premium stat displays. Lifted from Fulfillment
 * so both tabs share the same easing curve and tabular-num behavior.
 */
function CountUp({
  value,
  duration = 600,
  decimals = 0,
  className,
}: {
  value: number
  duration?: number
  decimals?: number
  className?: string
}) {
  const [display, setDisplay] = useState(value)
  const fromRef = useRef(value)
  useEffect(() => {
    const from = fromRef.current
    const to = value
    if (from === to) return
    let raf = 0
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - t, 3)
      const next = from + (to - from) * eased
      setDisplay(next)
      if (t < 1) raf = requestAnimationFrame(tick)
      else fromRef.current = to
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value, duration])
  const shown = decimals > 0
    ? display.toFixed(decimals)
    : Math.round(display).toLocaleString()
  return <span className={cn('tabular-nums', className)}>{shown}</span>
}

/**
 * Live ticker. Re-renders once per second. Used for reign counter and
 * code-unlock countdown so they stay accurate without a parent poll.
 */
function useTick(intervalMs = 1000): number {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])
  return tick
}

// Status pill. Editorial palette, no Tailwind defaults.
function StatusBadge({ status }: { status: string }) {
  const statusLower = status.toLowerCase()

  switch (statusLower) {
    case 'submitted':
      return (
        <span className="inline-flex items-center gap-1 text-[10px] rounded px-1.5 py-0.5 border font-medium bg-slate-700/40 text-slate-300 border-slate-600/40">
          <span className="inline-block w-1 h-1 rounded-full dot-amber pending-breath" aria-hidden />
          Submitted
        </span>
      )
    case 'evaluating':
      return (
        <span className="inline-flex items-center gap-1 text-[10px] rounded px-1.5 py-0.5 border font-medium bg-cream-soft text-cream border-cream-soft">
          <Loader2 className="h-2.5 w-2.5 animate-spin" aria-hidden />
          Evaluating
        </span>
      )
    case 'evaluated':
      return (
        <span className="inline-flex items-center gap-1 text-[10px] rounded px-1.5 py-0.5 border font-medium bg-cream-soft text-cream border-cream-soft">
          Evaluated
        </span>
      )
    case 'failed':
      return (
        <span className="inline-flex items-center gap-1 text-[10px] rounded px-1.5 py-0.5 border font-medium bg-burgundy-soft text-burgundy border-burgundy-soft">
          Failed
        </span>
      )
    default:
      return (
        <span className="inline-flex items-center gap-1 text-[10px] rounded px-1.5 py-0.5 border font-medium bg-slate-700/40 text-slate-300 border-slate-600/40">
          {status}
        </span>
      )
  }
}

// Compact, editorial copy button. Matches Fulfillment's inline CopyButton.
function CopyButton({ text, label, ariaLabel }: { text: string; label?: string; ariaLabel?: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation()
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={ariaLabel || `Copy ${label || 'value'}`}
      className="inline-flex items-center gap-1 text-[10px] text-slate-500 hover:text-slate-100 transition-colors"
    >
      {copied ? (
        <>
          <Check className="h-3 w-3" aria-hidden />
          <span className="text-gold">Copied</span>
        </>
      ) : (
        <>
          <Copy className="h-3 w-3" aria-hidden />
          {label && <span>{label}</span>}
        </>
      )}
    </button>
  )
}

// Score Breakdown. Refined to the editorial palette and now surfaces
// integrity signals (fabrication rate, integrity multiplier, early stop) that
// were previously hidden in the API but never rendered.
function ScoreBreakdownTab({ breakdown, score }: { breakdown: ScoreBreakdown | null | undefined; score: number | null }) {
  const [copied, setCopied] = useState(false)

  const handleCopyBreakdown = async () => {
    if (!breakdown) return
    await navigator.clipboard.writeText(JSON.stringify(breakdown, null, 2))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (!breakdown || !breakdown.evaluation_summary) {
    return (
      <div className="p-8 text-center">
        <p className="text-sm text-slate-500">Score breakdown not available</p>
      </div>
    )
  }

  const summary = breakdown.evaluation_summary
  const successRate = summary.total_icps > 0
    ? ((summary.icps_scored ?? 0) / summary.total_icps) * 100
    : 0

  return (
    <div className="space-y-5">
      {/* Top row: copy action */}
      <div className="flex justify-end">
        <Button
          variant="outline"
          size="sm"
          className="gap-2 h-7 text-[11px] border-slate-700/50 bg-slate-900/40 hover:bg-slate-800/60 text-slate-300 hover:text-slate-100"
          onClick={handleCopyBreakdown}
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5" aria-hidden />
              Copied
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" aria-hidden />
              Copy full breakdown
            </>
          )}
        </Button>
      </div>

      {/* Evaluation summary: six tiles in the StatBlock pattern */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
        <StatTile label="Final score" value={`${(score ?? 0).toFixed(2)}`} tone="gold" />
        <StatTile label="ICPs tested" value={`${summary.total_icps ?? 0}`} tone="slate" />
        <StatTile
          label="Success rate"
          value={`${successRate.toFixed(1)}%`}
          tone="gold"
          muted
        />
        <StatTile label="Total cost" value={`$${(summary.total_cost_usd ?? 0).toFixed(4)}`} tone="slate" mono />
        <StatTile label="Total time" value={`${Math.round(summary.total_time_seconds ?? 0)}s`} tone="slate" mono />
        <StatTile
          label="Scored 0"
          value={`${breakdown.zero_score_count ?? 0}`}
          tone={(breakdown.zero_score_count ?? 0) > 0 ? 'burgundy' : 'slate'}
        />
      </div>

      {/* Integrity signals: the trust block. Hidden if no integrity data. */}
      {(summary.fabrication_rate !== undefined ||
        summary.integrity_multiplier !== undefined ||
        summary.stopped_early !== undefined) && (
        <section>
          <h4 className="font-medium text-[11px] mb-2 text-slate-300 uppercase tracking-[0.1em]">
            Integrity
          </h4>
          <div className="rounded-lg border border-slate-800/70 overflow-hidden divide-y divide-slate-800/60">
            {summary.fabrication_rate !== undefined && (
              <IntegrityRow
                label="Fabrication rate"
                hint={summary.fabrication_count !== undefined ? `${summary.fabrication_count} fabricated` : null}
                pct={(summary.fabrication_rate ?? 0) * 100}
                negative
              />
            )}
            {summary.integrity_multiplier !== undefined && (
              <IntegrityRow
                label="Integrity multiplier"
                hint={null}
                pct={(summary.integrity_multiplier ?? 1) * 100}
              />
            )}
            {summary.stopped_early !== undefined && (
              <div className="px-3 py-2.5 flex items-center gap-3 text-[11px]">
                <span className="text-slate-300">Evaluation</span>
                <span className="ml-auto font-mono text-slate-400">
                  {summary.stopped_early
                    ? <>Stopped early <span className="text-burgundy ml-1">{summary.stopped_reason ?? 'unknown reason'}</span></>
                    : <span className="text-gold">Completed in full</span>
                  }
                </span>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Top 5 Leads */}
      {breakdown.top_5_leads && breakdown.top_5_leads.length > 0 && (
        <section>
          <h4 className="font-medium text-[11px] mb-2 flex items-center gap-2 text-gold uppercase tracking-[0.1em]">
            Top leads
          </h4>
          <div className="space-y-2">
            {breakdown.top_5_leads.map((lead) => (
              <LeadResultCard key={`top-${lead.rank}`} lead={lead} tone="positive" />
            ))}
          </div>
        </section>
      )}

      {/* Bottom 5 Leads */}
      {breakdown.bottom_5_leads && breakdown.bottom_5_leads.length > 0 && (
        <section>
          <h4 className="font-medium text-[11px] mb-2 flex items-center gap-2 text-burgundy uppercase tracking-[0.1em]">
            Bottom leads
          </h4>
          <div className="space-y-2">
            {breakdown.bottom_5_leads.map((lead) => (
              <LeadResultCard key={`bot-${lead.rank}`} lead={lead} tone="negative" />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

/* ============================================================
 * StatTile. Small KPI cell whose palette mirrors Fulfillment's StatBlock.
 * ============================================================ */
function StatTile({
  label,
  value,
  tone,
  muted,
  mono,
}: {
  label: string
  value: string
  tone: 'slate' | 'gold' | 'amber' | 'burgundy'
  muted?: boolean
  mono?: boolean
}) {
  const valueColor =
    tone === 'gold'
      ? muted ? 'text-gold opacity-80' : 'text-gold'
      : tone === 'amber'
        ? 'text-amber-warm'
        : tone === 'burgundy'
          ? 'text-burgundy'
          : 'text-slate-100'
  return (
    <div className="rounded-lg border border-slate-800/70 bg-slate-900/30 px-3 py-2">
      <div className="text-[9px] text-slate-500 uppercase tracking-[0.1em] font-medium">{label}</div>
      <div className={cn(
        'text-lg font-semibold tabular-nums leading-tight mt-0.5',
        mono && 'font-mono',
        valueColor
      )}>
        {value}
      </div>
    </div>
  )
}

/* ============================================================
 * IntegrityRow. Percentage bar showing a trust-signal value.
 * - negative=true: dusty burgundy (worse = more)
 * - negative=false: warm gold (more = better)
 * ============================================================ */
function IntegrityRow({
  label,
  hint,
  pct,
  negative,
}: {
  label: string
  hint: string | null
  pct: number
  negative?: boolean
}) {
  const clamped = Math.min(100, Math.max(0, pct))
  return (
    <div className="px-3 py-2.5 text-[11px]">
      <div className="flex items-center justify-between mb-1">
        <span className="text-slate-300">{label}</span>
        <span className="font-mono text-slate-400 tabular-nums">
          {hint && <span className="text-slate-500 mr-2">{hint}</span>}
          {pct.toFixed(1)}%
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-slate-800/60 overflow-hidden">
        <div
          className="h-full rounded-full"
          style={{
            width: `${clamped}%`,
            background: negative
              ? 'linear-gradient(90deg, rgba(168, 116, 111, 0.85) 0%, rgba(196, 142, 137, 0.85) 100%)'
              : 'linear-gradient(90deg, #b89456 0%, #c9a96e 100%)',
            transition: 'width 320ms cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        />
      </div>
    </div>
  )
}

/* ============================================================
 * LeadResultCard. Single lead row in top/bottom breakdown lists.
 * Editorial palette, restrained component-score chips.
 * ============================================================ */
function LeadResultCard({ lead, tone }: { lead: LeadResult; tone: 'positive' | 'negative' }) {
  const scoreColor = tone === 'positive' ? 'text-gold' : 'text-burgundy'
  return (
    <div className={cn(
      'rounded-lg p-3 text-sm border bg-slate-900/30',
      tone === 'positive' ? 'border-gold-soft' : 'border-burgundy-soft'
    )}>
      <div className="flex justify-between items-start mb-2 gap-3">
        <div className="flex-1 min-w-0">
          <span className="text-[10px] text-slate-500 font-mono">#{lead.rank}</span>
          {lead.lead ? (
            <p className="font-medium text-slate-100 text-[13px] truncate">
              {lead.lead.role} at {lead.lead.business}
            </p>
          ) : (
            <p className="font-medium text-burgundy text-[13px]">No lead returned</p>
          )}
        </div>
        <span className={cn('text-lg font-bold tabular-nums shrink-0', scoreColor)}>
          {(lead.final_score ?? 0).toFixed(1)}
        </span>
      </div>
      <p className="text-[11px] text-slate-400 mb-2">
        <span className="text-slate-500">ICP · </span>{lead.icp_prompt}
      </p>
      {lead.lead && (
        <div className="text-[11px] text-slate-500 mb-2 font-mono">
          {[lead.lead.city, lead.lead.state, lead.lead.country].filter(Boolean).join(', ')}
          {lead.lead.industry && (
            <>
              {' · '}
              <span className="text-slate-400">{lead.lead.industry}</span>
              {lead.lead.sub_industry && <span className="text-slate-600"> ({lead.lead.sub_industry})</span>}
            </>
          )}
        </div>
      )}
      {lead.failure_reason && (
        <p className="text-[11px] text-burgundy mb-2">
          <span className="text-slate-500">Failure · </span>{lead.failure_reason}
        </p>
      )}
      {lead.score_components && (
        <div className="flex flex-wrap gap-1.5 text-[10px]">
          <ScoreChip label="ICP fit" value={lead.score_components.icp_fit} />
          <ScoreChip label="Decision maker" value={lead.score_components.decision_maker} />
          <ScoreChip label="Intent" value={lead.score_components.intent_signal_final} />
          <ScoreChip
            label="Time penalty"
            value={lead.score_components.time_penalty}
            negative
          />
        </div>
      )}
    </div>
  )
}

function ScoreChip({ label, value, negative }: { label: string; value: number; negative?: boolean }) {
  const cls = negative
    ? 'bg-burgundy-soft text-burgundy border-burgundy-soft'
    : 'bg-slate-800/50 text-slate-300 border-slate-700/50'
  return (
    <span className={cn(
      'px-1.5 py-0.5 rounded border font-mono tabular-nums',
      cls
    )}>
      <span className="text-slate-500 mr-1">{label}</span>
      {(value ?? 0).toFixed(1)}
    </span>
  )
}

// Code viewer. Warm off-black surface (matches canvas), gold accent on
// active file pill. No GitHub colors. Shared by both ChampionDetailDialog
// and SubmissionDetailDialog so we don't have to fake a champion object
// to render submission code.
function CodeViewer({
  codeContent,
  loadingCode,
  codeError,
  onRetry,
  activeFile,
  setActiveFile,
}: {
  codeContent: Record<string, string> | null
  loadingCode: boolean
  codeError: string | null
  onRetry?: () => void
  activeFile: string | null
  setActiveFile: (file: string) => void
}) {
  if (loadingCode) {
    return (
      <div className="p-8 text-center">
        <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2 text-gold" aria-hidden />
        <p className="text-sm text-slate-500">Loading code...</p>
      </div>
    )
  }

  if (codeError) {
    return (
      <div className="p-8 text-center">
        <AlertTriangle className="h-6 w-6 text-amber-warm mx-auto mb-2" aria-hidden />
        <p className="text-sm text-slate-400">{codeError}</p>
        {onRetry && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onRetry}
            className="mt-4 border-slate-700 bg-transparent text-slate-200 hover:bg-slate-900 hover:text-slate-100"
          >
            Try again
          </Button>
        )}
      </div>
    )
  }

  if (!codeContent || !activeFile) {
    return (
      <div className="p-8 text-center">
        <p className="text-sm text-slate-500">No code files found</p>
      </div>
    )
  }

  return (
    <div className="rounded-md overflow-hidden border border-slate-800/70">
      {/* File tabs row */}
      <div className="flex flex-wrap gap-1 p-1.5 bg-slate-900/60 border-b border-slate-800/70 overflow-x-auto">
        {Object.keys(codeContent).map(filename => (
          <button
            key={filename}
            type="button"
            onClick={() => setActiveFile(filename)}
            title={filename}
            className={cn(
              'h-7 text-[11px] font-mono px-2.5 rounded transition-colors',
              activeFile === filename
                ? 'bg-gold-soft text-gold border border-gold-soft'
                : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/40'
            )}
          >
            {getCodeFileLabel(filename)}
          </button>
        ))}
      </div>
      {/* Code body */}
      <div>
        <div className="flex justify-end px-2 py-1.5 bg-[#0a0a0c] border-b border-slate-800/70">
          <button
            type="button"
            onClick={() => navigator.clipboard.writeText(codeContent[activeFile])}
            aria-label="Copy code"
            className="h-6 text-[10px] text-slate-400 hover:text-slate-100 transition-colors inline-flex items-center gap-1 px-2"
          >
            <Copy className="h-3 w-3" aria-hidden />
            Copy
          </button>
        </div>
        <pre className="p-4 text-[11px] font-mono overflow-x-auto max-h-[320px] overflow-y-auto bg-[#0a0a0c] text-[color:var(--text-primary)] leading-relaxed">
          <code>{codeContent[activeFile]}</code>
        </pre>
      </div>
    </div>
  )
}

// Champion Detail Dialog
function ChampionDetailDialog({
  champion,
  isOpen,
  onClose
}: {
  champion: ChampionHistoryEntry | null
  isOpen: boolean
  onClose: () => void
}) {
  const [codeContent, setCodeContent] = useState<Record<string, string> | null>(null)
  const [loadingCode, setLoadingCode] = useState(false)
  const [codeError, setCodeError] = useState<string | null>(null)
  const [activeFile, setActiveFile] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'score' | 'code'>('score')
  const [codeRetryNonce, setCodeRetryNonce] = useState(0)

  useEffect(() => {
    if (isOpen) setActiveTab('score')
  }, [champion?.modelId, isOpen])

  // Resolve champion code when the dialog opens: inline codeContent when the
  // payload carries it, otherwise LAZY-LOAD via /api/model-code (the minute
  // refresh no longer ships champion/history code; the endpoint enforces the
  // same evaluated-status + 24h lock).
  useEffect(() => {
    if (!champion || !isOpen) return

    // Reset state
    setCodeError(null)
    setLoadingCode(false)
    setCodeContent(null)
    setActiveFile(null)

    const applyCode = (code: Record<string, string>) => {
      setCodeContent(code)
      const files = Object.keys(code)
      if (files.length > 0) setActiveFile(files[0])
    }

    if (champion.canShowCode && champion.codeContent) {
      applyCode(champion.codeContent as Record<string, string>)
      return
    }
    if (!champion.canShowCode) return

    let cancelled = false
    setLoadingCode(true)
    fetch(`/api/model-code?modelId=${encodeURIComponent(champion.modelId)}`)
      .then(async (res) => {
        const payload = await res.json().catch(() => null)
        if (!res.ok || !payload?.success) {
          throw new Error(payload?.error || 'Could not load code')
        }
        return payload
      })
      .then((payload) => {
        if (cancelled) return
        if (payload.code) applyCode(payload.code)
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setCodeError(error instanceof Error ? error.message : 'Could not load code')
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingCode(false)
      })
    return () => {
      cancelled = true
    }
  }, [champion, isOpen, codeRetryNonce])

  if (!champion) return null

  const isCurrentChampion = !champion.dethronedAt

  // Parse score breakdown
  let scoreBreakdown: ScoreBreakdown | null = null
  if (champion.scoreBreakdown) {
    if (typeof champion.scoreBreakdown === 'string') {
      try {
        scoreBreakdown = JSON.parse(champion.scoreBreakdown)
      } catch {
        scoreBreakdown = null
      }
    } else {
      scoreBreakdown = champion.scoreBreakdown
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent
        aria-describedby={undefined}
        className={cn(
          'bg-slate-950 border-slate-800 text-slate-100 shadow-2xl shadow-black/60',
          'overflow-hidden flex flex-col p-0 outline-none gap-0',
          // Mobile bottom-sheet, desktop centered modal. Matches Fulfillment.
          'inset-x-0 bottom-0 w-full max-w-full max-h-[92vh] rounded-t-2xl border-t border-x',
          'data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom',
          'sm:inset-x-auto sm:bottom-auto sm:top-[50%] sm:left-[50%]',
          'sm:translate-x-[-50%] sm:translate-y-[-50%]',
          'sm:max-w-4xl sm:w-[calc(100%-2rem)] sm:max-h-[88vh] sm:rounded-xl sm:border'
        )}
      >
        <DialogHeader className="px-5 py-4 border-b border-slate-800/80 space-y-2 text-left">
          <DialogTitle className="flex items-center gap-2 pr-8">
            <span className="text-sm font-mono text-slate-100">{truncateHotkey(champion.minerHotkey)}</span>
            <CopyButton text={champion.minerHotkey} ariaLabel="Copy hotkey" />
            {isCurrentChampion && (
              <span className="ml-auto inline-flex items-center gap-1.5 text-[10px] rounded px-1.5 py-0.5 border bg-gold-soft text-gold border-gold-strong">
                Current champion
              </span>
            )}
            {!isCurrentChampion && (
              <span className="ml-auto inline-flex items-center text-[10px] rounded px-1.5 py-0.5 border bg-slate-900/60 text-slate-400 border-slate-700/50">
                Former champion
              </span>
            )}
          </DialogTitle>

          {/* Stat row */}
          <div className="flex items-baseline justify-between gap-4 flex-wrap pt-1">
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-400 font-mono">
              <span>
                <span className="text-slate-500">Champion since</span>{' '}
                <span className="text-slate-200">{formatDate(champion.championAt)}</span>
              </span>
              {champion.dethronedAt && champion.dethronedAt !== 'stale' && (
                <span>
                  <span className="text-slate-500">Dethroned</span>{' '}
                  <span className="text-slate-200">{formatDate(champion.dethronedAt)}</span>
                </span>
              )}
              {champion.reignDuration && (
                <span>
                  <span className="text-slate-500">Reign</span>{' '}
                  <span className="text-gold tabular-nums">{formatDuration(champion.reignDuration)}</span>
                </span>
              )}
            </div>
            <div className="text-right">
              <span className="text-3xl font-bold text-gold tabular-nums">{champion.score.toFixed(2)}</span>
              <span className="text-slate-500 ml-1 text-sm">/ 100</span>
            </div>
          </div>
        </DialogHeader>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-slate-800/70 px-3" role="tablist">
          <DialogTab
            active={activeTab === 'score'}
            onClick={() => setActiveTab('score')}
            label="Score breakdown"
          />
          <DialogTab
            active={activeTab === 'code'}
            onClick={() => setActiveTab('code')}
            label="Model code"
            locked={!champion.canShowCode}
          />
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {activeTab === 'score' ? (
            <ScoreBreakdownTab breakdown={scoreBreakdown} score={champion.score} />
          ) : !champion.canShowCode ? (
            <CodeLockedState
              unlockAt={new Date(new Date(champion.createdAt ?? champion.championAt).getTime() + CODE_UNLOCK_HOURS * 60 * 60 * 1000).toISOString()}
              context="champion"
            />
          ) : (
            <CodeViewer
              codeContent={codeContent}
              loadingCode={loadingCode}
              codeError={codeError}
              onRetry={() => setCodeRetryNonce((nonce) => nonce + 1)}
              activeFile={activeFile}
              setActiveFile={setActiveFile}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

/* ============================================================
 * DialogTab. Accessible tab pill used in both detail dialogs.
 * Uses role=tab + aria-selected for screen-reader correctness.
 * ============================================================ */
function DialogTab({
  active,
  onClick,
  label,
  locked,
}: {
  active: boolean
  onClick: () => void
  label: string
  locked?: boolean
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'relative inline-flex items-center gap-1.5 px-3 py-2 text-[12px] font-medium transition-colors',
        active
          ? 'text-gold'
          : 'text-slate-400 hover:text-slate-100'
      )}
    >
      {label}
      {locked && <Lock className="h-3 w-3 opacity-70" aria-label="Locked" />}
      {active && (
        <span
          className="absolute left-2 right-2 -bottom-px h-px rounded-full"
          style={{ background: '#c9a96e' }}
          aria-hidden
        />
      )}
    </button>
  )
}

/* ============================================================
 * CodeLockedState. Premium "Code unlocks in …" panel.
 * Replaces the generic lucide-Lock illustration with a circular
 * countdown progress + human countdown.
 * ============================================================ */
function CodeLockedState({
  unlockAt,
  context,
}: {
  unlockAt: string
  context: 'champion' | 'submission'
}) {
  // Tick once per second for a live countdown
  useTick(1000)
  const now = Date.now()
  const target = new Date(unlockAt).getTime()
  const remaining = Math.max(0, Math.floor((target - now) / 1000))
  const totalWindow = CODE_UNLOCK_HOURS * 3600
  const elapsed = totalWindow - remaining
  const pct = Math.min(100, Math.max(0, (elapsed / totalWindow) * 100))
  const countdown = formatCountdown(remaining)

  // Circular progress geometry
  const R = 28
  const C = 2 * Math.PI * R
  const dash = (C * pct) / 100

  return (
    <div className="flex flex-col items-center justify-center py-10 text-center">
      <div className="relative w-20 h-20 mb-4">
        <svg width="80" height="80" viewBox="0 0 80 80" aria-hidden>
          <circle cx="40" cy="40" r={R} fill="none" stroke="rgba(245,240,232,0.12)" strokeWidth="3" />
          <circle
            cx="40"
            cy="40"
            r={R}
            fill="none"
            stroke="#c9a96e"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={`${dash} ${C - dash}`}
            transform="rotate(-90 40 40)"
            style={{ transition: 'stroke-dasharray 320ms cubic-bezier(0.16, 1, 0.3, 1)' }}
          />
        </svg>
        <Lock className="absolute inset-0 m-auto h-6 w-6 text-gold" aria-hidden />
      </div>
      <p className="text-sm font-medium text-slate-100">Code unlocks in {countdown ?? 'moments'}</p>
      <p className="text-[11px] text-slate-500 mt-1">
        {context === 'champion'
          ? 'Champion code is released 24 hours after taking the crown.'
          : 'Submission code is released 24 hours after submission.'}
      </p>
      <p className="text-[10px] text-slate-600 mt-2 font-mono">
        Available {formatDate(unlockAt)}
      </p>
    </div>
  )
}

// Submission Detail Dialog
function SubmissionDetailDialog({
  submission,
  isOpen,
  onClose
}: {
  submission: Submission | null
  isOpen: boolean
  onClose: () => void
}) {
  const [activeTab, setActiveTab] = useState<'score' | 'code'>('score')
  const [codeContent, setCodeContent] = useState<Record<string, string> | null>(null)
  const [loadingCode, setLoadingCode] = useState(false)
  const [codeError, setCodeError] = useState<string | null>(null)
  const [activeFile, setActiveFile] = useState<string | null>(null)
  const [codeRetryNonce, setCodeRetryNonce] = useState(0)

  useEffect(() => {
    if (isOpen) setActiveTab('score')
  }, [submission?.id, isOpen])

  // Resolve code when the dialog opens: use inline codeContent if the payload
  // carries it, otherwise LAZY-LOAD from /api/model-code (the minute cache no
  // longer ships every model's code — ~6.7 MB/refresh saved; the endpoint
  // enforces the same evaluated-status + 24h lock).
  useEffect(() => {
    if (!submission || !isOpen) return

    // Reset state
    setCodeContent(null)
    setCodeError(null)
    setLoadingCode(false)
    setActiveFile(null)

    const applyCode = (raw: unknown) => {
      let parsedCode: Record<string, string> | null = null
      try {
        parsedCode = typeof raw === 'string' ? JSON.parse(raw) : (raw as Record<string, string>)
      } catch {
        console.error('Failed to parse code content')
      }
      if (parsedCode && Object.keys(parsedCode).length > 0) {
        setCodeContent(parsedCode)
        setActiveFile(Object.keys(parsedCode)[0])
      }
    }

    if (submission.codeContent) {
      applyCode(submission.codeContent)
      return
    }
    if (!submission.canShowCode) return

    let cancelled = false
    setLoadingCode(true)
    fetch(`/api/model-code?modelId=${encodeURIComponent(submission.id)}`)
      .then(async (res) => {
        const payload = await res.json().catch(() => null)
        if (!res.ok || !payload?.success) {
          throw new Error(payload?.error || 'Could not load code')
        }
        return payload
      })
      .then((payload) => {
        if (cancelled) return
        if (payload.code) applyCode(payload.code)
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setCodeError(error instanceof Error ? error.message : 'Could not load code')
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingCode(false)
      })
    return () => {
      cancelled = true
    }
  }, [submission, isOpen, codeRetryNonce])

  if (!submission) return null

  // Use canShowCode from backend (24-hour protection)
  const canShowCode = submission.canShowCode

  // Parse score breakdown if available
  let scoreBreakdown: ScoreBreakdown | null = null
  if (submission.scoreBreakdown) {
    if (typeof submission.scoreBreakdown === 'string') {
      try {
        scoreBreakdown = JSON.parse(submission.scoreBreakdown)
      } catch {
        scoreBreakdown = null
      }
    } else {
      scoreBreakdown = submission.scoreBreakdown
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent
        aria-describedby={undefined}
        className={cn(
          'bg-slate-950 border-slate-800 text-slate-100 shadow-2xl shadow-black/60',
          'overflow-hidden flex flex-col p-0 outline-none gap-0',
          // Mobile bottom-sheet, desktop centered modal. Matches Fulfillment.
          'inset-x-0 bottom-0 w-full max-w-full max-h-[92vh] rounded-t-2xl border-t border-x',
          'data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom',
          'sm:inset-x-auto sm:bottom-auto sm:top-[50%] sm:left-[50%]',
          'sm:translate-x-[-50%] sm:translate-y-[-50%]',
          'sm:max-w-4xl sm:w-[calc(100%-2rem)] sm:max-h-[88vh] sm:rounded-xl sm:border'
        )}
      >
        <DialogHeader className="px-5 py-4 border-b border-slate-800/80 space-y-2 text-left">
          <DialogTitle className="flex items-center gap-2 pr-8">
            <span className="text-sm font-mono text-slate-100">{truncateHotkey(submission.minerHotkey)}</span>
            <CopyButton text={submission.minerHotkey} ariaLabel="Copy hotkey" />
            {submission.isChampion && (
              <span className="ml-auto inline-flex items-center gap-1.5 text-[10px] rounded px-1.5 py-0.5 border bg-gold-soft text-gold border-gold-strong">
                Champion
              </span>
            )}
            {!submission.isChampion && (
              <span className="ml-auto">
                <StatusBadge status={submission.status} />
              </span>
            )}
          </DialogTitle>

          {/* Stat row */}
          <div className="flex items-baseline justify-between gap-4 flex-wrap pt-1">
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-400 font-mono">
              <span>
                <span className="text-slate-500">Submitted</span>{' '}
                <span className="text-slate-200">{formatDate(submission.createdAt)}</span>
              </span>
              {submission.evaluatedAt && (
                <span>
                  <span className="text-slate-500">Evaluated</span>{' '}
                  <span className="text-slate-200">{formatDate(submission.evaluatedAt)}</span>
                </span>
              )}
            </div>
            {submission.score !== null && (
              <div className="text-right">
                <span className="text-3xl font-bold text-gold tabular-nums">{submission.score.toFixed(2)}</span>
                <span className="text-slate-500 ml-1 text-sm">/ 100</span>
              </div>
            )}
          </div>
        </DialogHeader>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-slate-800/70 px-3" role="tablist">
          <DialogTab
            active={activeTab === 'score'}
            onClick={() => setActiveTab('score')}
            label="Score breakdown"
          />
          <DialogTab
            active={activeTab === 'code'}
            onClick={() => setActiveTab('code')}
            label="Model code"
            locked={!canShowCode}
          />
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {activeTab === 'score' ? (
            <ScoreBreakdownTab breakdown={scoreBreakdown} score={submission.score} />
          ) : !canShowCode ? (
            <CodeLockedState
              unlockAt={new Date(new Date(submission.createdAt).getTime() + CODE_UNLOCK_HOURS * 60 * 60 * 1000).toISOString()}
              context="submission"
            />
          ) : (
            <CodeViewer
              codeContent={codeContent}
              loadingCode={loadingCode}
              codeError={codeError}
              onRetry={() => setCodeRetryNonce((nonce) => nonce + 1)}
              activeFile={activeFile}
              setActiveFile={setActiveFile}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function BaselineModelDialog({
  baseline,
  isOpen,
  onClose,
}: {
  baseline: BaselineModel | null
  isOpen: boolean
  onClose: () => void
}) {
  const [activeFile, setActiveFile] = useState<string | null>(null)

  useEffect(() => {
    if (!baseline?.codeContent || !isOpen) {
      setActiveFile(null)
      return
    }
    setActiveFile(getDefaultCodeFile(baseline.codeContent))
  }, [baseline, isOpen])

  if (!baseline) return null

  const hasCode = Boolean(baseline.codeContent && Object.keys(baseline.codeContent).length > 0)
  const displayName = getBaselineModelDisplayName(baseline.modelName)

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent
        aria-describedby={undefined}
        className={cn(
          'bg-slate-950 border-slate-800 text-slate-100 shadow-2xl shadow-black/60',
          'overflow-hidden flex flex-col p-0 outline-none gap-0',
          'inset-x-0 bottom-0 w-full max-w-full max-h-[92vh] rounded-t-2xl border-t border-x',
          'data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom',
          'sm:inset-x-auto sm:bottom-auto sm:top-[50%] sm:left-[50%]',
          'sm:translate-x-[-50%] sm:translate-y-[-50%]',
          'sm:max-w-4xl sm:w-[calc(100%-2rem)] sm:max-h-[88vh] sm:rounded-xl sm:border'
        )}
      >
        <DialogHeader className="px-5 py-4 border-b border-slate-800/80 space-y-2 text-left">
          <DialogTitle className="flex items-center gap-2 pr-8">
            <span className="text-sm font-semibold text-slate-100">{displayName}</span>
            <span className="ml-auto inline-flex items-center gap-1.5 text-[10px] rounded px-1.5 py-0.5 border bg-slate-800/50 text-slate-300 border-slate-700/60">
              Baseline
            </span>
          </DialogTitle>
          <div className="flex items-baseline justify-between gap-4 flex-wrap pt-1">
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-400 font-mono">
              {baseline.scoredAt && (
                <span>
                  <span className="text-slate-500">Scored</span>{' '}
                  <span className="text-slate-200">{formatDate(baseline.scoredAt)}</span>
                </span>
              )}
            </div>
            <div className="text-right">
              <span className="text-3xl font-bold text-slate-100 tabular-nums">
                {baseline.score.toFixed(2)}
              </span>
              <span className="text-slate-500 ml-1 text-sm">/ 100</span>
            </div>
          </div>
        </DialogHeader>

        <div className="border-b border-slate-800/70 px-5 py-3">
          <p className="text-xs text-slate-400">
            Runs against each day&apos;s benchmark to establish the baseline score miners need to beat.
          </p>
          {baseline.sourceUrl && (
            <a
              href={baseline.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-gold hover:text-gold-bright transition-colors"
            >
              Open on GitHub
              <ChevronRight className="h-3 w-3" aria-hidden />
            </a>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {hasCode && baseline.codeContent && activeFile ? (
            <CodeViewer
              codeContent={baseline.codeContent}
              loadingCode={false}
              codeError={null}
              activeFile={activeFile}
              setActiveFile={setActiveFile}
            />
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Code className="h-10 w-10 text-slate-600 mb-3" aria-hidden />
              <p className="text-sm font-medium text-slate-100">Baseline code not available</p>
              <p className="text-xs text-slate-500 mt-1">
                The baseline score is loaded, but the open-source model could not be fetched.
              </p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function ModelCompetition({ onSync }: { onSync?: () => void } = {}) {
  const [data, setData] = useState<ModelCompetitionData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedChampion, setSelectedChampion] = useState<ChampionHistoryEntry | null>(null)
  const [isDetailOpen, setIsDetailOpen] = useState(false)
  const [selectedSubmission, setSelectedSubmission] = useState<Submission | null>(null)
  const [isSubmissionDetailOpen, setIsSubmissionDetailOpen] = useState(false)
  const [isBaselineOpen, setIsBaselineOpen] = useState(false)

  // Fetch data + bubble sync events to the page-level indicator.
  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/model-competition?t=${Date.now()}`)
      if (!res.ok) throw new Error('Failed to fetch')
      const json = await res.json()
      if (json.success) {
        setData(json.data)
        setError(null)
        onSync?.()
      } else {
        setError(json.error || 'Unknown error')
      }
    } catch (err) {
      console.error('Error fetching model competition data:', err)
      setError('Failed to fetch data')
    } finally {
      setLoading(false)
    }
  }, [onSync])

  // Initial fetch + polling every 60 seconds. Server also refreshes the
  // upstream cache on the same cadence, so 60s here keeps the two in sync.
  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 60000)
    return () => clearInterval(interval)
  }, [fetchData])

  // ---------- Derived data ----------
  // A history row is the *real* current champion only when its
  // dethroned_at is genuinely null. The cache layer marks any
  // history row that is undethroned BUT does not match
  // qualification_models.is_champion=true as 'stale' — that's a
  // stranded-row signal, not a "still reigning" signal. We must NOT
  // surface stale rows in the Current Champion slot, otherwise an
  // orphaned history entry from a long-since-superseded model can
  // masquerade as the reigning champion (real bug we hit: a Mar 26
  // 23.84 row showed as "current" months after higher-scoring
  // champions had come and gone, because its dethroned_at was never
  // written). When there is no genuine reigning champion the UI
  // falls through to its "throne empty" state, which is correct.
  const currentChampion = useMemo(
    () =>
      data?.championHistory.find(
        (c) => !c.dethronedAt && c.dethronedAt !== 'stale',
      ) ?? null,
    [data]
  )
  const pastChampions = useMemo(
    () =>
      data?.championHistory.filter((c) => c.dethronedAt && c.dethronedAt !== 'stale') ?? [],
    [data]
  )

  const previousChampionScore = pastChampions[0]?.score ?? null
  const championDelta =
    currentChampion && previousChampionScore !== null
      ? currentChampion.score - previousChampionScore
      : null

  // Threshold: a new model must score 10+ absolute points above the champion
  // to dethrone (CHAMPION_DETHRONING_THRESHOLD_POINTS in gateway config).
  const DETHRONE_THRESHOLD = 10
  const baselineScore = data?.stats.baselineScore || 0
  const baselineModel = data?.baselineModel ?? (
    baselineScore > 0
      ? {
          id: 'baseline',
          modelName: 'Reference implementation',
          score: baselineScore,
          setId: data?.stats.baselineSetId ?? null,
          scoredAt: null,
          codeContent: null,
          canShowCode: false,
          sourceUrl: 'https://github.com/leadpoet/leadpoet/tree/main/miner_models/qualification_model',
        }
      : null
  )
  const beatToWin = currentChampion
    ? currentChampion.score + DETHRONE_THRESHOLD
    : Math.max(20, baselineScore + DETHRONE_THRESHOLD) // No champion → baseline + 10 or minimum 20

  // Today's challengers, excluding the current champion row.
  const challengers = useMemo(
    () => data?.recentSubmissions.filter((s) => !s.isChampion) ?? [],
    [data]
  )
  const pastSubmissions = useMemo(
    () => data?.pastSubmissions?.filter((s) => !s.isChampion) ?? [],
    [data]
  )
  const handleChampionOpen = useCallback(() => {
    if (!currentChampion) return
    const championSubmission = data?.recentSubmissions.find((s) => s.isChampion)
    if (championSubmission) {
      setSelectedSubmission(championSubmission)
      setIsSubmissionDetailOpen(true)
    } else {
      setSelectedChampion(currentChampion)
      setIsDetailOpen(true)
    }
  }, [currentChampion, data])

  // ---------- Loading / error ----------
  if (loading) {
    return <ModelCompetitionSkeleton />
  }

  // Only replace the whole tab when we have no usable data at all.
  // A transient poll failure should not blank a previously loaded page.
  if (!data) {
    return (
      <div
        role="alert"
        className="rounded-xl border border-burgundy-soft bg-slate-900/40 p-6 text-center"
      >
        <AlertTriangle className="h-6 w-6 text-burgundy mx-auto mb-2" aria-hidden />
        <p className="text-sm text-slate-300">{error || 'No data available'}</p>
        <button
          type="button"
          onClick={fetchData}
          className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-slate-200 bg-slate-800/60 border border-slate-700/50 hover:bg-slate-700/60 hover:border-slate-600 transition-colors"
        >
          Try again
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {error && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={fetchData}
            className="text-[10px] font-mono text-burgundy hover:text-slate-200 transition-colors"
            title={error}
          >
            Refresh failed. Retry
          </button>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════
          HERO: dominant champion block (or vacant throne).
          The whole page is framed around who's winning.
          ════════════════════════════════════════════════════════════ */}
      {currentChampion ? (
        <ChampionHero
          champion={currentChampion}
          championDelta={championDelta}
          beatToWin={beatToWin}
          baselineScore={baselineScore}
          onOpen={handleChampionOpen}
        />
      ) : (
        <VacantThrone beatToWin={beatToWin} baselineScore={baselineScore} />
      )}

      {/* ════════════════════════════════════════════════════════════
          LINEAGE: sparkline of past champions (if any).
          ════════════════════════════════════════════════════════════ */}
      {pastChampions.length > 0 && (
        <ChampionLineageStrip
          history={data.championHistory.filter((c) => c.dethronedAt !== 'stale')}
          currentChampion={currentChampion}
          onSelect={(champ) => {
            setSelectedChampion(champ)
            setIsDetailOpen(true)
          }}
        />
      )}

      {baselineModel && (
        <BaselineModelCard
          baseline={baselineModel}
          onOpen={() => setIsBaselineOpen(true)}
        />
      )}

      {/* ════════════════════════════════════════════════════════════
          Challengers. The board's own header shows miner count and the
          per-row "Evaluating" badge communicates live activity, so the
          previous KPI strip was redundant and has been removed.
          ════════════════════════════════════════════════════════════ */}
      <ChallengersBoard
        challengers={challengers}
        onSelect={(s) => {
          setSelectedSubmission(s)
          setIsSubmissionDetailOpen(true)
        }}
      />

      <PastSubmissionsBoard
        submissions={pastSubmissions}
        onSelect={(s) => {
          setSelectedSubmission(s)
          setIsSubmissionDetailOpen(true)
        }}
      />

      {/* ════════════════════════════════════════════════════════════
          Past champions: compact table-style list below the fold.
          Hero already tells the "current" story; this is for archive.
          ════════════════════════════════════════════════════════════ */}
      {pastChampions.length > 0 && (
        <section className="rounded-xl border border-slate-800/70 bg-slate-950/50 overflow-hidden">
          <header className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-800/70 bg-gradient-to-b from-slate-900/80 to-slate-900/40">
            <span className="text-[11px] font-semibold text-slate-100 uppercase tracking-[0.1em]">
              Past champions
            </span>
            <span className="ml-auto text-[10px] text-slate-500 font-mono tabular-nums">
              {pastChampions.length} {pastChampions.length === 1 ? 'reign' : 'reigns'}
            </span>
          </header>
          <div className="max-h-[420px] overflow-y-auto divide-y divide-slate-800/60">
            {pastChampions.map((champion, idx) => (
              <PastChampionRow
                key={champion.modelId}
                rank={idx + 1}
                champion={champion}
                onSelect={() => {
                  setSelectedChampion(champion)
                  setIsDetailOpen(true)
                }}
              />
            ))}
          </div>
        </section>
      )}

      {/* ════════════════════════════════════════════════════════════
          How to challenge: actionable checklist with real values.
          ════════════════════════════════════════════════════════════ */}
      <HowToChallenge currentChampionScore={currentChampion?.score ?? null} />

      {/* Dialogs */}
      <ChampionDetailDialog
        champion={selectedChampion}
        isOpen={isDetailOpen}
        onClose={() => {
          setIsDetailOpen(false)
          setSelectedChampion(null)
        }}
      />
      <SubmissionDetailDialog
        submission={selectedSubmission}
        isOpen={isSubmissionDetailOpen}
        onClose={() => {
          setIsSubmissionDetailOpen(false)
          setSelectedSubmission(null)
        }}
      />
      <BaselineModelDialog
        baseline={baselineModel}
        isOpen={isBaselineOpen}
        onClose={() => setIsBaselineOpen(false)}
      />
    </div>
  )
}

/* ============================================================
 * Skeleton. Matches Fulfillment shimmer aesthetic.
 * ============================================================ */
function ModelCompetitionSkeleton() {
  // Mirror the real layout's section count + heights so content doesn't pop
  // when it fills in: Champion hero, Champion lineage strip, Today's
  // challengers list, Past champions list.
  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-slate-800/70 bg-slate-900/30 h-[180px] shimmer" />
      <div className="rounded-xl border border-slate-800/70 bg-slate-900/30 h-[140px] shimmer" />
      <div className="rounded-xl border border-slate-800/70 bg-slate-900/30 h-[280px] shimmer" />
      <div className="rounded-xl border border-slate-800/70 bg-slate-900/30 h-[420px] shimmer" />
    </div>
  )
}

/* ============================================================
 * ChampionHero. Dominant block that frames the entire page.
 *
 * Layout (desktop):
 *  ┌──────────────────────────────────────────────────────────┐
 *  │  CURRENT CHAMPION                          [Reign live]  │
 *  │  ●avatar  hotkey · model           SCORE       34.14     │
 *  │                                    /100      ↑ +2.86     │
 *  │  Code unlocks in 14h 22m                                 │
 *  │                              BEAT TO WIN     35.85       │
 *  │  [ View score breakdown → ]                              │
 *  └──────────────────────────────────────────────────────────┘
 * ============================================================ */
function ChampionHero({
  champion,
  championDelta,
  beatToWin,
  baselineScore,
  onOpen,
}: {
  champion: ChampionHistoryEntry
  championDelta: number | null
  beatToWin: number
  baselineScore: number
  onOpen: () => void
}) {
  useTick(1000) // re-render for live reign counter
  const reignSeconds = Math.max(
    0,
    Math.floor((Date.now() - new Date(champion.championAt).getTime()) / 1000)
  )
  const unlockTarget = new Date(champion.championAt).getTime() + CODE_UNLOCK_HOURS * 60 * 60 * 1000
  const unlockRemaining = Math.max(0, Math.floor((unlockTarget - Date.now()) / 1000))
  const codeUnlocked = unlockRemaining === 0

  return (
    <section
      role="button"
      tabIndex={0}
      aria-label="Current champion. Press Enter to view score breakdown."
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen()
        }
      }}
      className={cn(
        'group relative rounded-2xl border border-gold-soft bg-gradient-to-b from-[rgba(201,169,110,0.05)] to-transparent overflow-hidden cursor-pointer transition-all',
        'hover:border-[rgba(201,169,110,0.45)] hover:from-[rgba(201,169,110,0.09)]',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-soft focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950'
      )}
    >
      {/* Subtle gold accent line at top */}
      <span
        className="absolute top-0 left-0 right-0 h-px"
        style={{ background: 'linear-gradient(90deg, transparent, #c9a96e 50%, transparent)' }}
        aria-hidden
      />

      <div className="px-5 sm:px-7 py-5 sm:py-6">
        {/* Header: small label + live reign on the right */}
        <div className="flex items-center justify-between mb-4 gap-3">
          <div className="text-[10px] uppercase tracking-[0.18em] text-gold font-semibold">
            Current champion
          </div>
          <div className="text-[10px] font-mono text-slate-400 tabular-nums shrink-0">
            <span className="text-slate-500 hidden sm:inline">Reigning for </span>
            <span className="text-gold">{formatLiveDuration(reignSeconds)}</span>
          </div>
        </div>

        {/* Body: stacks vertically on mobile, horizontal on desktop. */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6">
          {/* Avatar + identity. Champion gets a gold crown avatar — the
              one place gold is reserved for the active champion identity,
              not derived from the hotkey hash. */}
          <div className="flex items-center gap-4 min-w-0">
            <div
              className="w-14 h-14 sm:w-16 sm:h-16 rounded-full flex items-center justify-center shadow-lg shrink-0"
              style={{
                background:
                  'linear-gradient(135deg, rgba(232, 201, 135, 0.18), rgba(201, 169, 110, 0.08))',
                boxShadow:
                  '0 0 0 1px rgba(201, 169, 110, 0.45), 0 12px 32px -10px rgba(201, 169, 110, 0.35)',
              }}
              aria-label="Current champion"
            >
              <Crown
                className="h-6 w-6 sm:h-7 sm:w-7 text-gold"
                strokeWidth={1.75}
                aria-hidden
              />
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <code className="text-sm sm:text-base font-mono text-slate-100 truncate" title={champion.minerHotkey}>
                  {truncateHotkey(champion.minerHotkey)}
                </code>
                <CopyButton text={champion.minerHotkey} ariaLabel="Copy champion hotkey" />
              </div>
              <div className="text-[11px] text-slate-500 mt-1.5">
                Champion since{' '}
                <span className="text-slate-300">{formatChampionSinceDate(champion.championAt)}</span>
              </div>
            </div>
          </div>

          {/* Score block. Full width on mobile (own row), right-aligned on desktop. */}
          <div className="text-left sm:text-right sm:ml-auto sm:shrink-0">
            <div className="text-[10px] text-slate-500 uppercase tracking-[0.12em] font-medium">
              Score
            </div>
            <div className="flex items-baseline gap-1 justify-start sm:justify-end mt-0.5">
              <CountUp
                value={champion.score}
                decimals={2}
                className="text-4xl sm:text-5xl font-semibold text-gold leading-none"
              />
              <span className="text-slate-500 text-sm">/ 100</span>
            </div>
            {championDelta !== null && (
              <div
                className={cn(
                  'text-[10px] font-mono tabular-nums mt-1',
                  championDelta >= 0 ? 'text-gold' : 'text-burgundy'
                )}
              >
                {championDelta >= 0 ? '↑' : '↓'} {Math.abs(championDelta).toFixed(2)} vs previous champ
              </div>
            )}
          </div>
        </div>

        {/* Bottom strip: code unlock + beat-to-win + CTA */}
        <div className="mt-5 pt-4 border-t border-slate-800/60 flex items-center gap-4 sm:gap-6 flex-wrap">
          {/* Code unlock countdown */}
          <div className="flex items-center gap-2 text-[11px] text-slate-400">
            {codeUnlocked ? (
              <>
                <Eye className="h-3.5 w-3.5 text-slate-500" aria-hidden />
                <span>Code available</span>
              </>
            ) : (
              <>
                <Lock className="h-3.5 w-3.5 text-slate-500" aria-hidden />
                <span>
                  Code unlocks in{' '}
                  <span className="text-gold tabular-nums font-mono">
                    {formatCountdown(unlockRemaining) ?? 'moments'}
                  </span>
                </span>
              </>
            )}
          </div>

          {/* Baseline + Beat to win */}
          <div className="ml-auto flex items-center gap-3 sm:gap-4 text-[11px]">
            {baselineScore > 0 && (
              <>
                <div className="flex flex-col items-end">
                  <span className="text-[10px] text-slate-500 uppercase tracking-[0.1em] font-medium">
                    Baseline
                  </span>
                  <span className="text-sm font-mono font-semibold text-slate-300 tabular-nums">
                    {baselineScore.toFixed(2)}
                  </span>
                </div>
                <div className="w-px h-8 bg-slate-700" />
              </>
            )}
            <div className="flex flex-col items-end">
              <span className="text-[10px] text-slate-500 uppercase tracking-[0.1em] font-medium">
                Beat to win
              </span>
              <span className="text-base font-mono font-semibold text-gold-bright tabular-nums">
                {beatToWin.toFixed(2)}
              </span>
            </div>
          </div>

          {/* Click-to-open affordance. The whole hero is the trigger; this
              is a subtle visual cue. Hidden on mobile to keep the bottom
              strip uncluttered (whole card is already a tap target). */}
          <span className="hidden sm:inline-flex items-center gap-1 text-[11px] font-medium text-slate-400 group-hover:text-gold transition-colors">
            View score breakdown
            <ChevronRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
          </span>
        </div>
      </div>
    </section>
  )
}

/* ============================================================
 * VacantThrone. Shown when championHistory has no active champion.
 * ============================================================ */
function VacantThrone({ beatToWin, baselineScore }: { beatToWin: number; baselineScore: number }) {
  return (
    <section
      aria-label="No current champion"
      className="rounded-2xl border border-slate-800/70 bg-slate-900/30 p-7 text-center"
    >
      <h3 className="text-sm font-semibold text-slate-100">The throne is empty</h3>
      <p className="text-[12px] text-slate-400 mt-1.5 max-w-md mx-auto">
        No active champion right now.
        {baselineScore > 0 && (
          <>
            {' '}The current baseline score is{' '}
            <span className="text-slate-300 tabular-nums font-mono">{baselineScore.toFixed(2)}</span>.
          </>
        )}
        {' '}Score{' '}
        <span className="text-gold tabular-nums font-mono">{beatToWin.toFixed(2)}</span>{' '}
        or higher to claim the crown.
      </p>
    </section>
  )
}

function BaselineModelCard({
  baseline,
  onOpen,
}: {
  baseline: BaselineModel
  onOpen: () => void
}) {
  const hasCode = Boolean(
    baseline.canShowCode &&
    baseline.codeContent &&
    Object.keys(baseline.codeContent).length > 0
  )
  const displayName = getBaselineModelDisplayName(baseline.modelName)

  return (
    <section
      role="button"
      tabIndex={0}
      aria-label="Baseline model. Press Enter to view code."
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen()
        }
      }}
      className={cn(
        'group rounded-xl border border-slate-800/70 bg-slate-950/50 overflow-hidden cursor-pointer transition-all',
        'hover:border-[rgba(201,169,110,0.35)] hover:bg-slate-900/40',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-soft focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950'
      )}
    >
      <div className="px-5 py-4 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex items-start gap-3 min-w-0">
          <div
            className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-700/70 bg-slate-900/70 transition-colors group-hover:border-gold/35"
            aria-hidden
          >
            <Code className="h-4 w-4 text-slate-300" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                Baseline model
              </span>
            </div>
            <h3 className="mt-1 text-sm font-medium text-slate-100 truncate">
              {displayName}
            </h3>
            <p className="mt-1 max-w-2xl text-[12px] leading-relaxed text-slate-400">
              Runs against each day&apos;s benchmark to establish the baseline score miners need to beat.
            </p>
          </div>
        </div>

        <div className="md:ml-auto md:shrink-0">
          <span className="inline-flex items-center gap-1.5 rounded-md border border-slate-700/70 bg-slate-900/70 px-3 py-2 text-[11px] font-medium text-slate-200 transition-colors group-hover:border-gold/40 group-hover:bg-slate-800/70 group-hover:text-gold">
            {hasCode ? (
              <>
                <Eye className="h-3.5 w-3.5" aria-hidden />
                View code
              </>
            ) : (
              <>
                <Code className="h-3.5 w-3.5" aria-hidden />
                View baseline
              </>
            )}
            <ChevronRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
          </span>
        </div>
      </div>
    </section>
  )
}

function getBaselineModelDisplayName(modelName: string): string {
  return modelName.trim().toLowerCase() === 'reference baseline model'
    ? 'Reference implementation'
    : modelName.trim().toLowerCase() === 'baseline model'
      ? 'Reference implementation'
    : modelName
}

function getDefaultCodeFile(codeContent: Record<string, string>): string | null {
  const files = Object.keys(codeContent)
  return files.find((file) => file.split('/').pop()?.toLowerCase() === 'readme.md')
    ?? files[0]
    ?? null
}

function getCodeFileLabel(filename: string): string {
  return filename.split('/').pop() || filename
}

/* ============================================================
 * ChampionLineageStrip. Horizontal sparkline of champion scores
 * over time. Each champion is a dot at (championAt, score), linked
 * by a thin warm-gold line. Current champion gets a pulsing dot.
 *
 * IMPORTANT: we draw at 1:1 pixel scale (no preserveAspectRatio="none")
 * so circles stay round. A previous version stretched the viewBox to
 * the container width, which turned the pulsing ring around the current
 * champion into a wide ellipse on big screens.
 * ============================================================ */
function ChampionLineageStrip({
  history,
  currentChampion,
  onSelect,
}: {
  history: ChampionHistoryEntry[]
  currentChampion: ChampionHistoryEntry | null
  onSelect: (champion: ChampionHistoryEntry) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(800)
  const H = 90
  const PADDING_X = 24
  const PADDING_Y = 16

  // Track the real rendered width so the SVG can draw 1px-to-1px (no scale).
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const update = () => {
      if (el) setWidth(el.clientWidth)
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Sort ascending by championAt so the line reads left-to-right (oldest → newest)
  const points = useMemo(() => {
    const sorted = [...history].sort(
      (a, b) => new Date(a.championAt).getTime() - new Date(b.championAt).getTime()
    )
    if (sorted.length === 0) return [] as Array<{ x: number; y: number; champ: ChampionHistoryEntry }>
    const minT = new Date(sorted[0].championAt).getTime()
    const maxT = currentChampion
      ? Date.now()
      : new Date(sorted[sorted.length - 1].championAt).getTime()
    const tSpan = Math.max(1, maxT - minT)
    const scores = sorted.map((s) => s.score)
    const minS = Math.min(...scores)
    const maxS = Math.max(...scores)
    const sSpan = Math.max(1, maxS - minS)
    return sorted.map((c) => {
      const t = new Date(c.championAt).getTime()
      const x = PADDING_X + ((t - minT) / tSpan) * (width - 2 * PADDING_X)
      const y = H - PADDING_Y - ((c.score - minS) / sSpan) * (H - 2 * PADDING_Y)
      return { x, y, champ: c }
    })
  }, [history, currentChampion, width])

  if (points.length < 2) return null

  const pathD = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(' ')

  const minScore = Math.min(...points.map((p) => p.champ.score))
  const maxScore = Math.max(...points.map((p) => p.champ.score))

  return (
    <section className="rounded-xl border border-slate-800/70 bg-slate-950/40 overflow-hidden">
      <header className="flex items-center gap-2 px-4 py-2 border-b border-slate-800/70 bg-gradient-to-b from-slate-900/80 to-slate-900/40">
        <span className="text-[10px] font-semibold text-slate-300 uppercase tracking-[0.12em]">
          Champion lineage
        </span>
        <span className="ml-auto text-[10px] text-slate-500 font-mono tabular-nums">
          {history.length} {history.length === 1 ? 'reign' : 'reigns'}
        </span>
      </header>
      <div ref={containerRef} className="relative px-2 py-3">
        <svg
          width={width}
          height={H}
          className="block"
          role="img"
          aria-label="Champion score trajectory over time"
        >
          {/* Subtle axis baseline */}
          <line
            x1={PADDING_X}
            y1={H - PADDING_Y}
            x2={width - PADDING_X}
            y2={H - PADDING_Y}
            stroke="rgba(245,240,232,0.06)"
            strokeWidth="1"
          />
          {/* Trajectory line */}
          <path
            d={pathD}
            fill="none"
            stroke="#c9a96e"
            strokeOpacity="0.55"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {/* Dots: each champion is keyboard-focusable with an expanded
              hit target (14×14 transparent circle) so taps and screen
              reader gestures land reliably. */}
          {points.map((p, i) => {
            const isCurrent =
              currentChampion && p.champ.modelId === currentChampion.modelId
            const label = `${truncateHotkey(p.champ.minerHotkey)} · ${p.champ.score.toFixed(2)} · ${formatDate(p.champ.championAt)}${
              i === points.length - 1 && isCurrent ? ' (current)' : ''
            }`
            return (
              <g
                key={p.champ.modelId}
                style={{ cursor: 'pointer' }}
                role="button"
                tabIndex={0}
                aria-label={label}
                onClick={() => onSelect(p.champ)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onSelect(p.champ)
                  }
                }}
              >
                {/* Expanded transparent hit target (touch / focus ring) */}
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={12}
                  fill="transparent"
                  className="outline-none focus-visible:[stroke:#c9a96e]"
                  style={{ pointerEvents: 'all' }}
                />
                {isCurrent && (
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={6}
                    fill="none"
                    stroke="#e8c987"
                    strokeOpacity="0.5"
                    strokeWidth="1.4"
                    className="live-pulse"
                    // SVG quirk: CSS `transform: scale()` from `.live-pulse`
                    // defaults to the SVG root as origin, which slides the
                    // ring across the chart at every animation step. These
                    // two properties make the transform respect the circle's
                    // own bounding box, so the ring pulses in place.
                    style={{
                      transformBox: 'fill-box',
                      transformOrigin: 'center',
                    }}
                  />
                )}
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={isCurrent ? 3.5 : 2.5}
                  fill={isCurrent ? '#e8c987' : '#c9a96e'}
                  stroke="rgba(8,8,10,0.9)"
                  strokeWidth="0.8"
                >
                  <title>{label}</title>
                </circle>
              </g>
            )
          })}
        </svg>
        {/* Range hints */}
        <div className="absolute left-3 top-2 text-[9px] font-mono text-slate-600 tabular-nums">
          {maxScore.toFixed(1)}
        </div>
        <div className="absolute left-3 bottom-1 text-[9px] font-mono text-slate-600 tabular-nums">
          {minScore.toFixed(1)}
        </div>
      </div>
    </section>
  )
}

/* ============================================================
 * ChallengersBoard. Leaderboard-style list of today's submissions.
 * ============================================================ */
function ChallengersBoard({
  challengers,
  onSelect,
}: {
  challengers: Submission[]
  onSelect: (s: Submission) => void
}) {
  if (challengers.length === 0) {
    return (
      <section className="rounded-xl border border-slate-800/70 bg-slate-950/50 px-5 py-8 text-center">
        <p className="text-sm text-slate-400">No submissions today.</p>
        <p className="text-[11px] text-slate-500 mt-1">
          The first model to submit gets ranked here.
        </p>
      </section>
    )
  }

  return (
    <section className="rounded-xl border border-slate-800/70 bg-slate-950/50 overflow-hidden">
      <header className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-800/70 bg-gradient-to-b from-slate-900/80 to-slate-900/40">
        <span className="text-[11px] font-semibold text-slate-100 uppercase tracking-[0.1em]">
          Today&apos;s challengers
        </span>
        <span className="ml-auto text-[10px] text-slate-500 font-mono tabular-nums">
          {challengers.length}
        </span>
      </header>
      {/* Column header */}
      <div className="hidden md:grid grid-cols-[2rem_1fr_6rem_5rem] gap-3 px-4 py-1.5 text-[9px] text-slate-500 font-mono uppercase tracking-[0.06em] bg-slate-900/40 border-b border-slate-800/60">
        <span className="text-right">#</span>
        <span>Hotkey</span>
        <span className="text-right">Score</span>
        <span className="text-right">Time</span>
      </div>
      <div className="max-h-[420px] overflow-y-auto divide-y divide-slate-800/60">
        {challengers.map((s, idx) => (
          <ChallengerRow key={s.id} rank={idx + 1} submission={s} onSelect={() => onSelect(s)} />
        ))}
      </div>
    </section>
  )
}

/* ============================================================
 * ChallengerRow. Single row in the leaderboard.
 * Buttons (not divs) for keyboard/SR correctness; subtle hover.
 * ============================================================ */
function ChallengerRow({
  rank,
  submission,
  onSelect,
}: {
  rank: number
  submission: Submission
  onSelect: () => void
}) {
  const isEvaluating = submission.status === 'evaluating'
  const isSubmitted = submission.status === 'submitted'
  const isEvaluated = submission.status === 'evaluated'
  const hasScore = isEvaluated && submission.score !== null

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'w-full grid grid-cols-[2rem_minmax(0,1fr)_auto] md:grid-cols-[2rem_1fr_6rem_5rem] gap-2 md:gap-3 items-center px-4 py-2.5 text-[11px] text-left transition-colors',
        'hover-bg-warm focus:outline-none focus:bg-slate-800/40',
        (isEvaluating || isSubmitted) && 'pending-breath'
      )}
      title={`View submission ${submission.minerHotkey}`}
    >
      <span className="text-[10px] font-mono text-slate-500 text-right tabular-nums">
        {String(rank).padStart(2, '0')}
      </span>
      <div className="flex flex-col min-w-0 gap-0.5 md:flex-row md:items-center md:gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <code className="font-mono text-slate-200 truncate" title={submission.minerHotkey}>
            {truncateHotkey(submission.minerHotkey)}
          </code>
          {isEvaluated && (
            submission.canShowCode ? (
              <Eye className="h-3 w-3 text-slate-500 shrink-0" aria-label="Code available" />
            ) : (
              <Lock className="h-3 w-3 text-slate-500 shrink-0" aria-label="Code locked" />
            )
          )}
        </div>
        <span className="md:hidden font-mono text-slate-500 tabular-nums text-[10px]">
          {getRelativeTime(submission.createdAt)}
        </span>
      </div>
      {/* Score-or-status column. When the submission is evaluated, we show
          the score in gold; otherwise we show "Evaluating" inline so the
          column always reads as a status of progress. */}
      {hasScore ? (
        <span className="font-mono font-semibold text-right tabular-nums tracking-tight text-gold">
          {submission.score!.toFixed(2)}
        </span>
      ) : (
        <span className="flex items-center justify-end gap-1.5 text-[10px] font-mono text-slate-400">
          <Loader2 className="h-3 w-3 animate-spin text-slate-500" aria-hidden />
          <span>Evaluating</span>
        </span>
      )}
      <span className="hidden md:inline-block font-mono text-slate-500 tabular-nums text-[10px] text-right">
        {getRelativeTime(submission.createdAt)}
      </span>
    </button>
  )
}

/* ============================================================
 * PastSubmissionsBoard. Recent historical model submissions so
 * activity is visible even when the today-only challenger board is empty.
 * ============================================================ */
function PastSubmissionsBoard({
  submissions,
  onSelect,
}: {
  submissions: Submission[]
  onSelect: (s: Submission) => void
}) {
  if (submissions.length === 0) {
    return (
      <section className="rounded-xl border border-slate-800/70 bg-slate-950/50 px-5 py-8 text-center">
        <p className="text-sm text-slate-400">No past submissions in the current competition era.</p>
        <p className="text-[11px] text-slate-500 mt-1">
          Historical model submissions will appear here once available.
        </p>
      </section>
    )
  }

  return (
    <section className="rounded-xl border border-slate-800/70 bg-slate-950/50 overflow-hidden">
      <header className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-800/70 bg-gradient-to-b from-slate-900/80 to-slate-900/40">
        <span className="text-[11px] font-semibold text-slate-100 uppercase tracking-[0.1em]">
          Past submissions
        </span>
        <span className="ml-auto text-[10px] text-slate-500 font-mono tabular-nums">
          {submissions.length}
        </span>
      </header>
      <div className="hidden md:grid grid-cols-[2rem_1fr_7rem_6rem_8rem] gap-3 px-4 py-1.5 text-[9px] text-slate-500 font-mono uppercase tracking-[0.06em] bg-slate-900/40 border-b border-slate-800/60">
        <span className="text-right">#</span>
        <span>Hotkey</span>
        <span className="text-right">Score</span>
        <span className="text-right">Status</span>
        <span className="text-right">Submitted</span>
      </div>
      <div className="max-h-[420px] overflow-y-auto divide-y divide-slate-800/60">
        {submissions.map((s, idx) => (
          <PastSubmissionRow
            key={s.id}
            rank={idx + 1}
            submission={s}
            onSelect={() => onSelect(s)}
          />
        ))}
      </div>
    </section>
  )
}

function PastSubmissionRow({
  rank,
  submission,
  onSelect,
}: {
  rank: number
  submission: Submission
  onSelect: () => void
}) {
  const hasScore = submission.score !== null
  return (
    <button
      type="button"
      onClick={onSelect}
      className="w-full grid grid-cols-[2rem_minmax(0,1fr)_auto] md:grid-cols-[2rem_1fr_7rem_6rem_8rem] gap-2 md:gap-3 items-center px-4 py-2.5 text-[11px] text-left transition-colors hover-bg-warm focus:outline-none focus:bg-slate-800/40"
      title={`View submission ${submission.minerHotkey}`}
    >
      <span className="text-[10px] font-mono text-slate-500 text-right tabular-nums">
        {String(rank).padStart(2, '0')}
      </span>
      <div className="flex items-center gap-2 min-w-0">
        <code className="font-mono text-slate-200 truncate" title={submission.minerHotkey}>
          {truncateHotkey(submission.minerHotkey)}
        </code>
        {submission.canShowCode ? (
          <Eye className="h-3 w-3 text-slate-500 shrink-0" aria-label="Code available" />
        ) : (
          <Lock className="h-3 w-3 text-slate-500 shrink-0" aria-label="Code locked" />
        )}
      </div>
      <span className="font-mono font-semibold text-right tabular-nums tracking-tight text-gold">
        {hasScore ? submission.score!.toFixed(2) : '—'}
      </span>
      <span className="hidden md:inline-flex justify-end">
        <StatusBadge status={submission.status} />
      </span>
      <span className="hidden md:inline-block font-mono text-slate-500 tabular-nums text-[10px] text-right">
        {formatDate(submission.createdAt)}
      </span>
    </button>
  )
}

/* ============================================================
 * PastChampionRow. Compact, table-style row for past champions.
 * ============================================================ */
function PastChampionRow({
  rank,
  champion,
  onSelect,
}: {
  rank: number
  champion: ChampionHistoryEntry
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="w-full grid grid-cols-[2rem_minmax(0,1fr)_4.5rem] md:grid-cols-[2rem_1fr_5rem_minmax(0,1fr)_6rem] gap-2 md:gap-3 items-center px-4 py-3 md:py-2.5 text-[11px] text-left hover-bg-warm focus:outline-none focus:bg-slate-800/40 transition-colors"
      title={`View ${champion.minerHotkey}`}
    >
      <span className="text-[10px] font-mono text-slate-500 text-right tabular-nums">
        {String(rank).padStart(2, '0')}
      </span>
      <div className="flex items-center gap-2 min-w-0">
        <code className="font-mono text-slate-200 truncate" title={champion.minerHotkey}>
          {truncateHotkey(champion.minerHotkey)}
        </code>
        {champion.canShowCode ? (
          <Eye className="h-3 w-3 text-slate-500 shrink-0" aria-label="Code available" />
        ) : (
          <Lock className="h-3 w-3 text-slate-500 shrink-0" aria-label="Code locked" />
        )}
      </div>
      <span className="font-mono font-semibold text-right tabular-nums text-gold">
        {champion.score.toFixed(2)}
      </span>
      <span className="font-mono text-slate-500 text-[10px] tabular-nums truncate col-start-2 col-span-2 md:col-start-auto md:col-span-1">
        {formatDate(champion.championAt)}
      </span>
      <span className="font-mono text-slate-400 text-[10px] tabular-nums col-start-2 col-span-2 md:col-start-auto md:col-span-1 md:text-right">
        Reign · <span className="text-slate-200">{formatDuration(champion.reignDuration)}</span>
      </span>
    </button>
  )
}

/* ============================================================
 * HowToChallenge. Three numbered steps explaining how to enter
 * the model competition. No right-side values or copy buttons.
 * The steps stand on their own.
 * ============================================================ */
function HowToChallenge({
  currentChampionScore,
}: {
  currentChampionScore: number | null
}) {
  return (
    <section className="rounded-xl border border-slate-800/70 bg-slate-950/40 overflow-hidden">
      <header className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-800/70 bg-gradient-to-b from-slate-900/80 to-slate-900/40">
        <span className="text-[11px] font-semibold text-slate-100 uppercase tracking-[0.1em]">
          How to challenge
        </span>
        <a
          href="https://github.com/leadpoet/leadpoet"
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto text-[10px] text-slate-400 hover:text-gold inline-flex items-center gap-1 transition-colors"
        >
          Full docs
          <ChevronRight className="h-3 w-3" aria-hidden />
        </a>
      </header>

      <div className="divide-y divide-slate-800/60">
        <ChallengeStep
          num={1}
          title="Pay submission fee"
          description="Send $5 worth of TAO to enter the competition."
        />
        <ChallengeStep
          num={2}
          title="Submit your model"
          description="Validators benchmark it against the current champion on the same benchmark set."
        />
        <ChallengeStep
          num={3}
          title="Beat the threshold"
          description={
            currentChampionScore !== null
              ? `Current champion scores ${currentChampionScore.toFixed(2)} / 100. Score ${(currentChampionScore + 10).toFixed(2)}+ to take the crown (10 points above).`
              : 'The throne is empty. Score 20.00+ to claim the crown.'
          }
        />
      </div>
    </section>
  )
}

function ChallengeStep({
  num,
  title,
  description,
}: {
  num: number
  title: string
  description: string
}) {
  return (
    <div className="px-4 py-3 grid gap-3 grid-cols-[2rem_minmax(0,1fr)] items-center">
      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-900/80 text-slate-300 text-[11px] font-mono border border-slate-700/50">
        {num}
      </div>
      <div className="min-w-0">
        <div className="text-[12px] font-medium text-slate-100">{title}</div>
        <p className="text-[11px] text-slate-500 mt-0.5">{description}</p>
      </div>
    </div>
  )
}
