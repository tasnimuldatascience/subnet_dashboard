'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  Download,
  Copy,
  Check,
  Globe,
  Building2,
  ChevronRight,
  Tag,
  Clock,
  RotateCw,
  Target,
  Sparkles,
  AlertTriangle,
  ShieldCheck,
  Loader2,
  RefreshCw,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  formatDateTime,
  formatRelative,
  statusLabel,
  statusTone,
  asList,
  icpSignals,
  shortHotkey,
  creditedSignals,
} from '@/lib/admin-format'
import type {
  AdminFulfillmentRequest,
  AdminConsensusRow,
  AdminWinningLead,
  LeadDataInner,
  IcpDetails,
  IntentSignalMappingEntry,
  IntentBreakdown,
  DeepResearchState,
  DeepResearchLead,
  DeepResearchSummary,
  DeepResearchFinalStatus,
} from '@/lib/admin-supabase'

export interface RequestDetailPayload {
  chain: {
    root: AdminFulfillmentRequest
    leaf: AdminFulfillmentRequest
    cycles: AdminFulfillmentRequest[]
  }
  icp: IcpDetails | null
  approved_leads?: AdminWinningLead[]
  fulfilled_leads?: AdminWinningLead[]
  submitted_leads?: RequestSubmittedLead[]
  winners: AdminWinningLead[]
  target_num_leads: number
  delivered_count: number
  all_submissions_count: number
  deep_research?: DeepResearchState
}

type RequestSubmittedLeadStatus = 'all' | 'approved' | 'fulfilled' | 'pending' | 'denied'

interface RequestSubmittedLead {
  lead_id: string
  submission_id: string
  request_id: string
  miner_hotkey: string
  revealed: boolean
  submitted_at: string | null
  status: Exclude<RequestSubmittedLeadStatus, 'all'>
  fulfilled: boolean
  consensus: AdminConsensusRow | null
  lead: (LeadDataInner & Record<string, unknown>) | null
  score: number | null
  rejection_reason: string | null
  rejection_detail: string | null
}

interface RequestLeadsResponse {
  leads: RequestSubmittedLead[]
  counts: Record<RequestSubmittedLeadStatus, number>
  page: number
  pageSize: number
  total: number
  totalPages: number
  status: RequestSubmittedLeadStatus
}

type TabKey = 'deep_research' | 'leads' | 'icp' | 'chain'

// Order matters — left-to-right tab order is the public contract.
// Deep Research sits FIRST because the whole point is to QA before
// delivery: an operator should see the verdict before scrolling
// through the raw leads.
const TABS: { key: TabKey; label: string }[] = [
  { key: 'deep_research', label: 'Deep Research' },
  { key: 'leads', label: 'Leads' },
  { key: 'icp', label: 'Client ICP' },
  { key: 'chain', label: 'Chain History' },
]

export function AdminRequestDetail({
  requestId,
  payload,
}: {
  requestId: string
  payload: RequestDetailPayload
}) {
  // Default landing tab: Deep Research IF the chain has reached the QA
  // pass (any non-null deep_research_status), otherwise Winning leads.
  // This keeps the new tab in operators' face once a chain is
  // fulfilled, without disrupting the existing flow for in-flight
  // chains where the analysis isn't yet meaningful.
  const initialTab: TabKey =
    payload.deep_research?.status != null ? 'deep_research' : 'leads'
  const [tab, setTab] = useState<TabKey>(initialTab)

  const { chain, icp, winners, target_num_leads, delivered_count } = payload
  const approvedLeads = payload.approved_leads ?? winners
  const fulfilledLeads = payload.fulfilled_leads ?? winners
  const [submittedLeadTotal, setSubmittedLeadTotal] = useState<number | null>(
    payload.submitted_leads?.length ?? null,
  )
  const root = chain.root
  const leaf = chain.leaf
  const deepResearch: DeepResearchState =
    payload.deep_research ?? {
      status: null,
      attempts: 0,
      error: null,
      started_at: null,
      generated_at: null,
      analysis: null,
    }

  const tone = statusTone(leaf.status)
  const isFulfilled = tone === 'fulfilled'
  const isPartial = tone === 'partial'

  useEffect(() => {
    const controller = new AbortController()
    async function loadSubmittedLeadTotal() {
      try {
        const params = new URLSearchParams({
          status: 'all',
          page: '1',
          pageSize: '10',
        })
        const res = await fetch(`/api/admin/requests/${requestId}/leads?${params}`, {
          cache: 'no-store',
          signal: controller.signal,
        })
        if (!res.ok) return
        const next = (await res.json()) as RequestLeadsResponse
        setSubmittedLeadTotal(next.counts.all)
      } catch (e) {
        if ((e as Error).name !== 'AbortError') {
          console.warn('[admin] request lead total failed', e)
        }
      }
    }
    loadSubmittedLeadTotal()
    return () => controller.abort()
  }, [requestId])

  return (
    <div className="space-y-6">
      {/* Hero card */}
      <section
        className="rounded-2xl border p-6 sm:p-7"
        style={{
          borderColor: 'var(--surface-border)',
          background: 'var(--surface)',
        }}
      >
        <div className="flex flex-col gap-5">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <StatusPill status={leaf.status} />
                {chain.cycles.length > 1 && (
                  <span
                    className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.14em] rounded-full px-2.5 py-1 border"
                    style={{
                      borderColor: 'var(--surface-border-strong)',
                      color: 'var(--text-secondary)',
                      background: 'var(--surface-elevated)',
                    }}
                  >
                    <RotateCw className="h-2.5 w-2.5" />
                    {chain.cycles.length} cycles
                  </span>
                )}
              </div>
              <h1
                className="text-2xl font-medium tracking-tight"
                style={{ color: 'var(--text-primary)' }}
              >
                {leaf.internal_label || (
                  <span style={{ color: 'var(--text-tertiary)' }}>
                    (no label)
                  </span>
                )}
              </h1>
              <div
                className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs"
                style={{ color: 'var(--text-secondary)' }}
              >
                {leaf.company && (
                  <span className="inline-flex items-center gap-1.5">
                    <Building2
                      className="h-3 w-3"
                      style={{ color: 'var(--text-tertiary)' }}
                    />
                    {leaf.company}
                  </span>
                )}
                <span className="inline-flex items-center gap-1.5">
                  <Clock
                    className="h-3 w-3"
                    style={{ color: 'var(--text-tertiary)' }}
                  />
                  Created {formatRelative(root.created_at)}
                </span>
                <span className="inline-flex items-center gap-1.5 font-mono">
                  <Tag
                    className="h-3 w-3"
                    style={{ color: 'var(--text-tertiary)' }}
                  />
                  <RequestIdChip id={requestId} />
                </span>
              </div>
            </div>

            <div className="flex gap-2 items-center">
              <Link
                href={`/admin/requests/new?reuse=${requestId}`}
                className="inline-flex items-center gap-2 rounded-md px-3.5 py-2 text-xs font-medium transition-colors border"
                style={{
                  borderColor: 'rgba(201, 169, 110, 0.35)',
                  background: 'var(--brand-soft)',
                  color: 'var(--brand)',
                }}
              >
                <RotateCw className="h-3.5 w-3.5" />
                Reuse request
              </Link>
              <CopyButton text={requestId} label="Copy request ID" />
              <a
                href={`/api/admin/requests/${requestId}/csv`}
                className="inline-flex items-center gap-2 rounded-md px-3.5 py-2 text-xs font-medium transition-colors border"
                style={{
                  borderColor: 'rgba(201, 169, 110, 0.35)',
                  background: 'var(--brand-soft)',
                  color: 'var(--brand)',
                }}
              >
                <Download className="h-3.5 w-3.5" />
                Export CSV
              </a>
            </div>
          </div>

          {/* Big progress strip */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <Stat
              label="Approved leads"
              value={`${approvedLeads.length}`}
              secondary="held/winner/positive-score candidates"
              accent="gold"
              icon={
                <ShieldCheck className="h-3.5 w-3.5 text-gold" />
              }
            />
            <Stat
              label="Fulfilled leads"
              value={`${fulfilledLeads.length}`}
              secondary={`of ${target_num_leads} requested`}
              accent={isFulfilled ? 'gold' : 'default'}
              icon={
                <Target
                  className={cn('h-3.5 w-3.5', isFulfilled ? 'text-gold' : 'text-cream')}
                />
              }
            />
            <Stat
              label="Submitted leads"
              value={submittedLeadTotal == null ? 'Loading' : `${submittedLeadTotal}`}
              secondary="individual leads across the chain"
            />
            <Stat
              label="Chain cycles"
              value={`${chain.cycles.length}`}
              secondary={
                chain.cycles.length === 1
                  ? 'single cycle'
                  : `${chain.cycles.length - 1} recycle${chain.cycles.length - 1 === 1 ? '' : 's'}`
              }
            />
            <Stat
              label="Status"
              value={statusLabel(leaf.status)}
              secondary={
                isPartial
                  ? `${target_num_leads - delivered_count} leads still needed`
                  : isFulfilled
                  ? 'Chain complete'
                  : 'In flight'
              }
            />
          </div>
        </div>
      </section>

      {/* Tabs */}
      <div className="flex items-center gap-1 flex-wrap">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              'inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-medium transition-all border',
              tab === t.key
                ? 'bg-gold-tint border-gold-strong text-gold'
                : 'border-white/[0.06] hover-bg-warm text-white/55',
            )}
          >
            {t.key === 'deep_research' && (
              <Sparkles className="h-3 w-3 flex-shrink-0" />
            )}
            {t.label}
            {t.key === 'deep_research' && (
              <DeepResearchTabBadge state={deepResearch} />
            )}
            {t.key === 'leads' && (
              <span className="tabular-nums text-[10px] opacity-70">
                {submittedLeadTotal ?? '...'}
              </span>
            )}
            {t.key === 'chain' && (
              <span className="tabular-nums text-[10px] opacity-70">
                {chain.cycles.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab body */}
      {tab === 'deep_research' && (
        <DeepResearchPanel
          state={deepResearch}
          requestId={requestId}
          chainStatus={leaf.status}
        />
      )}
      {tab === 'leads' && (
        <SubmittedLeadsPanel
          requestId={requestId}
          initialTotal={submittedLeadTotal ?? 0}
          icp={icp}
          onTotalLoaded={setSubmittedLeadTotal}
        />
      )}
      {tab === 'icp' && <IcpPanel icp={icp} />}
      {tab === 'chain' && <ChainPanel cycles={chain.cycles} />}
    </div>
  )
}

// =================================================================
// Deep Research Analysis tab
// =================================================================
//
// Renders the gateway's Sonar Deep Research QA pass for the chain.
// Four possible states (driven by ``state.status``):
//
//   null              -> chain not yet fulfilled; show coachmark
//   pending / in_progress -> show spinner + status text
//   completed         -> show summary card + per-lead table
//   failed            -> show error + retry button
//
// The "Re-run analysis" button POSTs to
// /api/admin/requests/[id]/deep-research/rerun which resets the row
// to 'pending'. The gateway sweep picks it up on its next tick
// (~30s). We auto-refresh the page after a short delay so the
// operator sees the new state without manual reload.

function DeepResearchTabBadge({ state }: { state: DeepResearchState }) {
  if (state.status === 'completed' && state.analysis) {
    const ready = state.analysis.summary?.client_ready ?? 0
    const total = state.analysis.summary?.total_reviewed ?? 0
    return (
      <span className="tabular-nums text-[10px] opacity-70">
        {ready}/{total}
      </span>
    )
  }
  if (state.status === 'pending' || state.status === 'in_progress') {
    return <Loader2 className="h-3 w-3 animate-spin opacity-70" />
  }
  if (state.status === 'failed') {
    return (
      <AlertTriangle
        className="h-3 w-3"
        style={{ color: 'var(--burgundy)' }}
      />
    )
  }
  return null
}

function DeepResearchPanel({
  state,
  requestId,
  chainStatus,
}: {
  state: DeepResearchState
  requestId: string
  chainStatus: string
}) {
  const [rerunInFlight, setRerunInFlight] = useState(false)
  const [rerunError, setRerunError] = useState<string | null>(null)

  async function triggerRerun() {
    setRerunInFlight(true)
    setRerunError(null)
    try {
      // The rerun route now runs the full ~90s analysis inline before
      // returning, so this fetch is held open until either the LLM
      // produces a verdict or hits the worker's internal 3-min cap.
      // When the response comes back the page reloads to render the
      // fresh state. Browser shows the button in a loading state the
      // entire time.
      const res = await fetch(
        `/api/admin/requests/${requestId}/deep-research/rerun`,
        { method: 'POST' },
      )
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setRerunError(body.error || `Server returned ${res.status}`)
        setRerunInFlight(false)
        return
      }
      // If the worker came back with a non-ok status (failed parse,
      // OpenRouter error) we surface it inline rather than reloading
      // into a "failed" card — saves the operator one round-trip.
      if (body.ok === false && body.error) {
        setRerunError(body.error)
        // Still reload after a short delay so the failure state is
        // reflected in the rest of the UI (status badge, etc).
        setTimeout(() => window.location.reload(), 2000)
        return
      }
      window.location.reload()
    } catch (e) {
      setRerunError(e instanceof Error ? e.message : 'Unknown error')
      setRerunInFlight(false)
    }
  }

  // State A: no analysis state yet. Splits into two sub-cases:
  //   A1. Chain not fulfilled         -> pure coachmark, nothing to do
  //   A2. Chain IS fulfilled but null -> migration just applied OR the
  //       chain pre-dated the auto-trigger OR the auto-trigger failed
  //       silently. Show a "Run analysis now" button so the operator
  //       can manually kick off the QA pass without needing to touch
  //       Supabase. Hits the same POST /rerun endpoint as the failed
  //       state's retry button (which requires status='fulfilled', so
  //       this is safe by construction).
  if (state.status == null) {
    const canManuallyTrigger = chainStatus === 'fulfilled'
    return (
      <div
        className="rounded-xl border p-10 text-center space-y-4"
        style={{
          borderColor: 'var(--surface-border)',
          background: 'var(--surface)',
        }}
      >
        <Sparkles
          className="h-6 w-6 mx-auto"
          style={{ color: 'var(--text-tertiary)' }}
        />
        <div className="space-y-1">
          <div
            className="text-sm font-medium"
            style={{ color: 'var(--text-primary)' }}
          >
            {canManuallyTrigger
              ? 'No deep research analysis on file yet'
              : 'Analysis runs automatically once the chain is fulfilled'}
          </div>
          <div
            className="text-xs max-w-md mx-auto"
            style={{ color: 'var(--text-tertiary)' }}
          >
            {canManuallyTrigger
              ? 'This chain finished before the auto-trigger was wired in, or the trigger has not run yet. Click below to run Perplexity Sonar Deep Research now and verify every winning lead against the live web.'
              : 'Once every winning lead is in, Perplexity Sonar Deep Research verifies each row against the live web and flags anything inaccurate, stale, off-ICP, or unsafe to deliver.'}
          </div>
          <div
            className="text-[11px] mt-2"
            style={{ color: 'var(--text-tertiary)' }}
          >
            Current chain status:{' '}
            <span style={{ color: 'var(--text-secondary)' }}>
              {chainStatus}
            </span>
          </div>
        </div>
        {canManuallyTrigger && (
          <div className="space-y-2">
            <button
              type="button"
              onClick={triggerRerun}
              disabled={rerunInFlight}
              className="inline-flex items-center gap-2 rounded-md px-4 py-2 text-xs font-medium border transition-colors disabled:opacity-50"
              style={{
                borderColor: 'rgba(201, 169, 110, 0.35)',
                background: 'var(--brand-soft)',
                color: 'var(--brand)',
              }}
            >
              {rerunInFlight ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Queuing…
                </>
              ) : (
                <>
                  <Sparkles className="h-3.5 w-3.5" />
                  Run analysis now
                </>
              )}
            </button>
            {rerunError && (
              <div
                className="text-xs"
                style={{ color: 'var(--burgundy)' }}
              >
                {rerunError}
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  // State B: in flight (pending / in_progress).
  if (state.status === 'pending' || state.status === 'in_progress') {
    const label =
      state.status === 'in_progress'
        ? 'Running deep research now…'
        : 'Queued for the next gateway tick…'
    return (
      <div
        className="rounded-xl border p-10 text-center space-y-3"
        style={{
          borderColor: 'var(--surface-border)',
          background: 'var(--surface)',
        }}
      >
        <Loader2
          className="h-6 w-6 mx-auto animate-spin"
          style={{ color: 'var(--brand)' }}
        />
        <div className="space-y-1">
          <div
            className="text-sm font-medium"
            style={{ color: 'var(--text-primary)' }}
          >
            {label}
          </div>
          <div
            className="text-xs max-w-md mx-auto"
            style={{ color: 'var(--text-tertiary)' }}
          >
            Sonar Deep Research takes 30 to 90 seconds. The page will
            update once results are in — refresh shortly.
          </div>
          {state.attempts > 1 && (
            <div
              className="text-[11px] mt-2"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Attempt {state.attempts} of 3
            </div>
          )}
        </div>
      </div>
    )
  }

  // State C: failed — retry button.
  if (state.status === 'failed') {
    return (
      <div
        className="rounded-xl border p-8 space-y-4"
        style={{
          background: 'rgba(168, 116, 111, 0.08)',
          borderColor: 'rgba(168, 116, 111, 0.30)',
        }}
      >
        <div className="flex items-start gap-3">
          <AlertTriangle
            className="h-5 w-5 flex-shrink-0 mt-0.5"
            style={{ color: 'var(--burgundy)' }}
          />
          <div className="flex-1 min-w-0">
            <div
              className="text-sm font-medium mb-1"
              style={{ color: 'var(--text-primary)' }}
            >
              Deep research analysis failed after 3 attempts
            </div>
            {state.error && (
              <div
                className="text-xs font-mono leading-relaxed"
                style={{ color: 'var(--text-secondary)' }}
              >
                {state.error}
              </div>
            )}
            {rerunError && (
              <div
                className="text-xs mt-2"
                style={{ color: 'var(--burgundy)' }}
              >
                Re-run failed: {rerunError}
              </div>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={triggerRerun}
          disabled={rerunInFlight}
          className="inline-flex items-center gap-2 rounded-md px-3.5 py-2 text-xs font-medium border transition-colors disabled:opacity-50"
          style={{
            borderColor: 'rgba(201, 169, 110, 0.35)',
            background: 'var(--brand-soft)',
            color: 'var(--brand)',
          }}
        >
          {rerunInFlight ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Queuing…
            </>
          ) : (
            <>
              <RefreshCw className="h-3.5 w-3.5" />
              Re-run analysis
            </>
          )}
        </button>
      </div>
    )
  }

  // State D: completed — render the summary + per-lead table.
  const analysis = state.analysis
  if (!analysis) {
    // Shouldn't happen — completed without analysis means a write
    // race we don't expect. Show a defensive empty state.
    return (
      <div
        className="rounded-xl border p-10 text-center"
        style={{
          borderColor: 'var(--surface-border)',
          background: 'var(--surface)',
        }}
      >
        <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          Analysis marked complete but no payload present. Try re-running.
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <DeepResearchSummaryCard
        summary={analysis.summary}
        generatedAt={state.generated_at}
        model={analysis.model}
        onRerun={triggerRerun}
        rerunInFlight={rerunInFlight}
        rerunError={rerunError}
      />
      <DeepResearchLeadsTable leads={analysis.leads} />
    </div>
  )
}

function DeepResearchSummaryCard({
  summary,
  generatedAt,
  model,
  onRerun,
  rerunInFlight,
  rerunError,
}: {
  summary: DeepResearchSummary
  generatedAt: string | null | undefined
  model?: string
  onRerun: () => void
  rerunInFlight: boolean
  rerunError: string | null
}) {
  return (
    <section
      className="rounded-xl border p-5 sm:p-6 space-y-5"
      style={{
        borderColor: 'var(--surface-border)',
        background: 'var(--surface)',
      }}
    >
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div
            className="text-[10px] uppercase tracking-[0.14em] mb-1 flex items-center gap-1.5"
            style={{ color: 'var(--text-tertiary)' }}
          >
            <Sparkles className="h-3 w-3" />
            QA Summary
          </div>
          <h2
            className="text-base font-medium"
            style={{ color: 'var(--text-primary)' }}
          >
            Recommended delivery decision
          </h2>
        </div>
        <button
          type="button"
          onClick={onRerun}
          disabled={rerunInFlight}
          className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-medium border transition-colors disabled:opacity-50"
          style={{
            borderColor: 'var(--surface-border)',
            background: 'var(--surface-elevated)',
            color: 'var(--text-secondary)',
          }}
          title="Reset and re-run the deep research analysis"
        >
          {rerunInFlight ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" />
              Queuing…
            </>
          ) : (
            <>
              <RefreshCw className="h-3 w-3" />
              Re-run
            </>
          )}
        </button>
      </header>

      {rerunError && (
        <div
          className="text-xs rounded-md border px-3 py-2"
          style={{
            background: 'rgba(168, 116, 111, 0.10)',
            borderColor: 'rgba(168, 116, 111, 0.30)',
            color: 'var(--burgundy)',
          }}
        >
          Re-run failed: {rerunError}
        </div>
      )}

      {summary.recommended_delivery_decision && (
        <p
          className="text-sm leading-relaxed"
          style={{ color: 'var(--text-primary)' }}
        >
          {summary.recommended_delivery_decision}
        </p>
      )}

      {/* Status grid */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <SummaryTile
          label="Total reviewed"
          value={summary.total_reviewed}
        />
        <SummaryTile
          label="Client ready"
          value={summary.client_ready}
          tone="ready"
        />
        <SummaryTile
          label="Needs edit"
          value={summary.needs_edit}
          tone="edit"
        />
        <SummaryTile
          label="Needs re-research"
          value={summary.needs_re_research}
          tone="reresearch"
        />
        <SummaryTile
          label="Remove"
          value={summary.remove}
          tone="remove"
        />
      </div>

      {summary.top_issues.length > 0 && (
        <div>
          <div
            className="text-[10px] uppercase tracking-[0.14em] mb-2 flex items-center gap-1.5"
            style={{ color: 'var(--text-tertiary)' }}
          >
            <AlertTriangle className="h-3 w-3" />
            Top issues across the chain
          </div>
          <ul className="space-y-1.5 text-sm">
            {summary.top_issues.map((issue, i) => (
              <li
                key={i}
                className="flex items-start gap-2"
                style={{ color: 'var(--text-primary)' }}
              >
                <span
                  className="inline-block w-1 h-1 rounded-full mt-2 flex-shrink-0"
                  style={{ background: 'var(--text-tertiary)' }}
                />
                <span>{issue}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Footer: provenance */}
      <div
        className="flex items-center gap-4 text-[11px] flex-wrap pt-1"
        style={{ color: 'var(--text-tertiary)' }}
      >
        {model && (
          <span className="inline-flex items-center gap-1 font-mono">
            {model}
          </span>
        )}
        {generatedAt && (
          <span className="inline-flex items-center gap-1">
            <Clock className="h-3 w-3" />
            Generated {formatRelative(generatedAt)}
          </span>
        )}
      </div>
    </section>
  )
}

function SummaryTile({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone?: 'ready' | 'edit' | 'reresearch' | 'remove'
}) {
  const accent =
    tone === 'ready'
      ? { color: 'var(--brand)', border: 'rgba(201, 169, 110, 0.35)' }
      : tone === 'edit'
      ? { color: 'var(--amber-warm)', border: 'rgba(200, 156, 100, 0.35)' }
      : tone === 'reresearch'
      ? { color: 'var(--amber-warm)', border: 'rgba(200, 156, 100, 0.35)' }
      : tone === 'remove'
      ? { color: 'var(--burgundy)', border: 'rgba(168, 116, 111, 0.35)' }
      : {
          color: 'var(--text-primary)',
          border: 'var(--surface-border-strong)',
        }
  return (
    <div
      className="rounded-xl border px-4 py-3"
      style={{
        borderColor: accent.border,
        background: 'var(--surface-elevated)',
      }}
    >
      <div
        className="text-[10px] uppercase tracking-[0.14em] mb-1.5"
        style={{ color: 'var(--text-tertiary)' }}
      >
        {label}
      </div>
      <div
        className="tabular-nums text-xl font-medium leading-none"
        style={{ color: accent.color }}
      >
        {value}
      </div>
    </div>
  )
}

function DeepResearchLeadsTable({ leads }: { leads: DeepResearchLead[] }) {
  if (leads.length === 0) {
    return (
      <div
        className="rounded-xl border p-10 text-center"
        style={{
          borderColor: 'var(--surface-border)',
          background: 'var(--surface)',
        }}
      >
        <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          No per-lead verdicts produced.
        </div>
      </div>
    )
  }
  return (
    <section
      className="rounded-xl border overflow-hidden"
      style={{
        borderColor: 'var(--surface-border)',
        background: 'var(--surface)',
      }}
    >
      <header
        className="flex items-center justify-between gap-4 border-b px-5 py-3.5"
        style={{ borderColor: 'var(--surface-border)' }}
      >
        <div className="flex items-baseline gap-2">
          <h2
            className="text-sm font-medium"
            style={{ color: 'var(--text-primary)' }}
          >
            Per-lead verdicts
          </h2>
          <span
            className="tabular-nums text-xs"
            style={{ color: 'var(--text-tertiary)' }}
          >
            {leads.length}
          </span>
        </div>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr style={{ background: 'var(--surface-elevated)' }}>
              <DeepResearchTH width="44px">#</DeepResearchTH>
              <DeepResearchTH minWidth="180px">Company</DeepResearchTH>
              <DeepResearchTH minWidth="160px">Contact</DeepResearchTH>
              <DeepResearchTH minWidth="110px">ICP Fit</DeepResearchTH>
              <DeepResearchTH minWidth="110px">Intent Fit</DeepResearchTH>
              <DeepResearchTH minWidth="110px">Data Confidence</DeepResearchTH>
              <DeepResearchTH minWidth="140px">Final Status</DeepResearchTH>
              <DeepResearchTH minWidth="320px">Reasoning</DeepResearchTH>
              <DeepResearchTH minWidth="280px">Data Issues</DeepResearchTH>
              <DeepResearchTH minWidth="240px">Recommended Fix</DeepResearchTH>
            </tr>
          </thead>
          <tbody>
            {leads.map((lead, idx) => (
              <tr
                key={`${lead.company}-${idx}`}
                className="hover-bg-warm transition-colors"
              >
                <td
                  className="px-3 py-3 border-b tabular-nums text-xs align-top"
                  style={{
                    borderColor: 'var(--surface-border)',
                    color: 'var(--text-tertiary)',
                  }}
                >
                  {idx + 1}
                </td>
                <td
                  className="px-3 py-3 border-b align-top text-sm"
                  style={{
                    borderColor: 'var(--surface-border)',
                    color: 'var(--text-primary)',
                  }}
                >
                  {lead.company || <Dash />}
                </td>
                <td
                  className="px-3 py-3 border-b align-top text-sm"
                  style={{
                    borderColor: 'var(--surface-border)',
                    color: 'var(--text-primary)',
                  }}
                >
                  {lead.contact || <Dash />}
                </td>
                <td
                  className="px-3 py-3 border-b align-top"
                  style={{ borderColor: 'var(--surface-border)' }}
                >
                  <FitBadge value={lead.icp_fit} />
                </td>
                <td
                  className="px-3 py-3 border-b align-top"
                  style={{ borderColor: 'var(--surface-border)' }}
                >
                  <FitBadge value={lead.intent_fit} />
                </td>
                <td
                  className="px-3 py-3 border-b align-top"
                  style={{ borderColor: 'var(--surface-border)' }}
                >
                  <ConfidenceBadge value={lead.data_confidence} />
                </td>
                <td
                  className="px-3 py-3 border-b align-top"
                  style={{ borderColor: 'var(--surface-border)' }}
                >
                  <FinalStatusBadge value={lead.final_status} />
                </td>
                <td
                  className="px-3 py-3 border-b align-top text-[12px] leading-relaxed"
                  style={{
                    borderColor: 'var(--surface-border)',
                    color: 'var(--text-primary)',
                    maxWidth: '420px',
                  }}
                >
                  {lead.reasoning || <Dash />}
                </td>
                <td
                  className="px-3 py-3 border-b align-top text-[12px] leading-relaxed"
                  style={{
                    borderColor: 'var(--surface-border)',
                    color: 'var(--text-primary)',
                    maxWidth: '360px',
                  }}
                >
                  {lead.data_issues_found || <Dash />}
                </td>
                <td
                  className="px-3 py-3 border-b align-top text-[12px] leading-relaxed"
                  style={{
                    borderColor: 'var(--surface-border)',
                    color: 'var(--text-primary)',
                    maxWidth: '320px',
                  }}
                >
                  {lead.recommended_fix || <Dash />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function DeepResearchTH({
  children,
  minWidth,
  width,
}: {
  children: React.ReactNode
  minWidth?: string
  width?: string
}) {
  return (
    <th
      scope="col"
      className="px-3 py-2.5 text-left text-[10px] uppercase tracking-[0.14em] font-medium border-b whitespace-nowrap"
      style={{
        background: 'var(--surface-elevated)',
        borderColor: 'var(--surface-border)',
        color: 'var(--text-tertiary)',
        minWidth,
        width,
      }}
    >
      {children}
    </th>
  )
}

function Dash() {
  return <span style={{ color: 'var(--text-tertiary)' }}>—</span>
}

function FitBadge({
  value,
}: {
  value: 'Strong' | 'Borderline' | 'Poor' | null
}) {
  if (!value) return <Dash />
  const cls =
    value === 'Strong'
      ? 'bg-gold-soft border-gold-soft text-gold'
      : value === 'Borderline'
      ? 'bg-amber-warm-soft border-amber-warm-soft text-amber-warm'
      : 'bg-burgundy-soft border-burgundy-soft text-burgundy'
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.10em] font-medium',
        cls,
      )}
    >
      {value}
    </span>
  )
}

function ConfidenceBadge({
  value,
}: {
  value: 'High' | 'Medium' | 'Low' | null
}) {
  if (!value) return <Dash />
  const cls =
    value === 'High'
      ? 'bg-gold-soft border-gold-soft text-gold'
      : value === 'Medium'
      ? 'bg-amber-warm-soft border-amber-warm-soft text-amber-warm'
      : 'bg-burgundy-soft border-burgundy-soft text-burgundy'
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.10em] font-medium',
        cls,
      )}
    >
      {value}
    </span>
  )
}

function FinalStatusBadge({
  value,
}: {
  value: DeepResearchFinalStatus | null
}) {
  if (!value) return <Dash />
  const cls =
    value === 'Client Ready'
      ? 'bg-gold-soft border-gold-soft text-gold'
      : value === 'Needs Edit'
      ? 'bg-amber-warm-soft border-amber-warm-soft text-amber-warm'
      : value === 'Needs Re-Research'
      ? 'bg-amber-warm-soft border-amber-warm-soft text-amber-warm'
      : 'bg-burgundy-soft border-burgundy-soft text-burgundy'
  const icon =
    value === 'Client Ready' ? (
      <ShieldCheck className="h-3 w-3" />
    ) : value === 'Remove' ? (
      <AlertTriangle className="h-3 w-3" />
    ) : null
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.10em] font-medium whitespace-nowrap',
        cls,
      )}
    >
      {icon}
      {value}
    </span>
  )
}

// =================================================================
// Hero stat tile
// =================================================================

function Stat({
  label,
  value,
  secondary,
  accent,
  icon,
}: {
  label: string
  value: string
  secondary?: string
  accent?: 'gold' | 'default'
  icon?: React.ReactNode
}) {
  return (
    <div
      className="rounded-xl border px-4 py-3.5"
      style={{
        borderColor: 'var(--surface-border)',
        background: 'var(--surface-elevated)',
      }}
    >
      <div
        className="text-[10px] uppercase tracking-[0.14em] mb-1.5 flex items-center gap-1.5"
        style={{ color: 'var(--text-tertiary)' }}
      >
        {icon}
        {label}
      </div>
      <div
        className={cn(
          'tabular-nums text-xl font-medium leading-none',
          accent === 'gold' ? 'text-gold' : '',
        )}
        style={accent === 'gold' ? undefined : { color: 'var(--text-primary)' }}
      >
        {value}
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

// =================================================================
// Leads tab
// =================================================================

const LEAD_FILTERS: Array<{ key: RequestSubmittedLeadStatus; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'approved', label: 'Approved' },
  { key: 'fulfilled', label: 'Fulfilled' },
  { key: 'pending', label: 'Pending' },
  { key: 'denied', label: 'Denied' },
]

function submittedLeadStatusLabel(status: RequestSubmittedLeadStatus): string {
  return status === 'all' ? 'All' : status.charAt(0).toUpperCase() + status.slice(1)
}

const REQUEST_LEADS_PAGE_SIZE = 50

function SubmittedLeadsPanel({
  requestId,
  initialTotal,
  icp,
  onTotalLoaded,
}: {
  requestId: string
  initialTotal: number
  icp: IcpDetails | null
  onTotalLoaded: (total: number) => void
}) {
  const [filter, setFilter] = useState<RequestSubmittedLeadStatus>('all')
  const [page, setPage] = useState(1)
  const [selectedLead, setSelectedLead] = useState<RequestSubmittedLead | null>(null)
  const [data, setData] = useState<RequestLeadsResponse>({
    leads: [],
    counts: {
      all: initialTotal,
      approved: 0,
      fulfilled: 0,
      pending: 0,
      denied: 0,
    },
    page: 1,
    pageSize: REQUEST_LEADS_PAGE_SIZE,
    total: initialTotal,
    totalPages: Math.max(1, Math.ceil(initialTotal / REQUEST_LEADS_PAGE_SIZE)),
    status: 'all',
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()

    async function loadPage() {
      setLoading(true)
      setError(null)
      try {
        const params = new URLSearchParams({
          status: filter,
          page: String(page),
          pageSize: String(REQUEST_LEADS_PAGE_SIZE),
        })
        const res = await fetch(`/api/admin/requests/${requestId}/leads?${params}`, {
          cache: 'no-store',
          signal: controller.signal,
        })
        if (!res.ok) {
          throw new Error(`Lead page returned ${res.status}`)
        }
        const next = (await res.json()) as RequestLeadsResponse
        setData(next)
        onTotalLoaded(next.counts.all)
      } catch (e) {
        if ((e as Error).name !== 'AbortError') {
          setError(e instanceof Error ? e.message : 'Could not load leads')
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }

    loadPage()
    return () => controller.abort()
  }, [filter, onTotalLoaded, page, requestId])

  const visible = data.leads
  const counts = data.counts
  const start = data.total === 0 ? 0 : (data.page - 1) * data.pageSize + 1
  const end = Math.min(data.page * data.pageSize, data.total)

  function setFilterAndReset(nextFilter: RequestSubmittedLeadStatus) {
    setFilter(nextFilter)
    setPage(1)
  }

  return (
    <section
      className="rounded-xl border overflow-hidden"
      style={{ borderColor: 'var(--surface-border)', background: 'var(--surface)' }}
    >
      <header
        className="flex flex-col gap-3 border-b px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between"
        style={{ borderColor: 'var(--surface-border)' }}
      >
        <div className="flex items-baseline gap-2">
          <h2 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            Leads
          </h2>
          <span className="tabular-nums text-xs" style={{ color: 'var(--text-tertiary)' }}>
            {visible.length}
          </span>
        </div>
        <div className="flex flex-wrap gap-1">
          {LEAD_FILTERS.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setFilterAndReset(item.key)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-all whitespace-nowrap',
                filter === item.key
                  ? 'bg-gold-tint border-gold-strong text-gold'
                  : 'border-white/[0.06] hover-bg-warm text-white/55',
              )}
            >
              {item.label}
              <span className="tabular-nums text-[10px] opacity-70">{counts[item.key]}</span>
            </button>
          ))}
        </div>
      </header>

      {error ? (
        <div
          className="m-5 rounded-lg border p-4 text-sm"
          style={{
            borderColor: 'rgba(168, 116, 111, 0.30)',
            background: 'rgba(168, 116, 111, 0.10)',
            color: 'var(--burgundy)',
          }}
        >
          {error}
        </div>
      ) : loading && visible.length === 0 ? (
        <div className="p-12 text-center text-sm" style={{ color: 'var(--text-secondary)' }}>
          Loading leads...
        </div>
      ) : visible.length === 0 ? (
        <div className="p-12 text-center text-sm" style={{ color: 'var(--text-secondary)' }}>
          No {submittedLeadStatusLabel(filter).toLowerCase()} leads for this request.
        </div>
      ) : (
        <SubmittedLeadsTable
          leads={visible}
          pageStart={start}
          onSelectLead={setSelectedLead}
          icp={icp}
        />
      )}
      <footer
        className="flex flex-col gap-3 border-t px-5 py-3 sm:flex-row sm:items-center sm:justify-between"
        style={{ borderColor: 'var(--surface-border)' }}
      >
        <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
          {loading ? 'Updating...' : `Showing ${start}-${end} of ${data.total}`}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPage((value) => Math.max(1, value - 1))}
            disabled={loading || data.page <= 1}
            className="rounded-md border px-3 py-1.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40"
            style={{
              borderColor: 'var(--surface-border)',
              color: 'var(--text-secondary)',
            }}
          >
            Previous
          </button>
          <span className="text-xs tabular-nums" style={{ color: 'var(--text-tertiary)' }}>
            Page {data.page} of {data.totalPages}
          </span>
          <button
            type="button"
            onClick={() => setPage((value) => Math.min(data.totalPages, value + 1))}
            disabled={loading || data.page >= data.totalPages}
            className="rounded-md border px-3 py-1.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40"
            style={{
              borderColor: 'var(--surface-border)',
              color: 'var(--text-secondary)',
            }}
          >
            Next
          </button>
        </div>
      </footer>
      {selectedLead && (
        <RequestLeadDetailModal
          lead={selectedLead}
          icp={icp}
          onClose={() => setSelectedLead(null)}
        />
      )}
    </section>
  )
}
//
// Single component now — the Excel-style table contains both the
// scannable lead columns AND the per-signal Intent Signals column
// (last in the row, wide cell with stacked signal cards). Previously
// the per-signal evidence rendered as a separate "Verified intent
// signals · per lead" section beneath the table; operator feedback
// was that having the evidence inside the row makes it easier to
// audit a lead without scrolling back and forth.

export function LeadsList({
  leads,
  title,
  emptyText,
}: {
  leads: AdminWinningLead[]
  title: string
  emptyText: string
}) {
  if (leads.length === 0) {
    return (
      <div
        className="rounded-xl border p-12 text-center"
        style={{
          borderColor: 'var(--surface-border)',
          background: 'var(--surface)',
        }}
      >
        <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          {emptyText}
        </div>
      </div>
    )
  }
  return <WinnersTable winners={leads} title={title} />
}

// -----------------------------------------------------------------
// WinnersTable
// -----------------------------------------------------------------
// Column set is fixed by the operator. Total table width sits
// around 3000px, so the wrapper enables horizontal scroll and the
// row-index column is sticky-left so the eye doesn't lose its
// place when scanning right.

interface TableCol {
  key: string
  label: string
  // Tailwind min-width class. Cells wrap when content exceeds it.
  minW: string
  // True for long-form cells where we want soft-wrap with tighter
  // line height (Description, Intent Details).
  longForm?: boolean
  // Render function. Returns a React node, never raw HTML strings.
  cell: (w: AdminWinningLead) => React.ReactNode
}

function dashIfEmpty(v: string | null | undefined): React.ReactNode {
  if (!v) return <span style={{ color: 'var(--text-tertiary)' }}>—</span>
  return v
}

function ExtLink({
  href,
  children,
}: {
  href: string
  children: React.ReactNode
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="transition-colors hover:text-gold break-all"
      style={{ color: 'var(--text-primary)' }}
    >
      {children}
    </a>
  )
}

const TABLE_COLUMNS: TableCol[] = [
  {
    key: 'name',
    label: 'Name',
    minW: 'min-w-[180px]',
    cell: (w) => dashIfEmpty(w.lead?.full_name),
  },
  {
    key: 'email',
    label: 'Email',
    minW: 'min-w-[220px]',
    cell: (w) =>
      w.lead?.email ? (
        <ExtLink href={`mailto:${w.lead.email}`}>{w.lead.email}</ExtLink>
      ) : (
        dashIfEmpty(null)
      ),
  },
  {
    key: 'role',
    label: 'Role',
    minW: 'min-w-[170px]',
    cell: (w) => dashIfEmpty(w.lead?.role),
  },
  {
    key: 'company',
    label: 'Company',
    minW: 'min-w-[180px]',
    cell: (w) => dashIfEmpty(w.lead?.business),
  },
  {
    key: 'linkedin',
    label: 'LinkedIn',
    minW: 'min-w-[220px]',
    cell: (w) =>
      w.lead?.linkedin_url ? (
        <ExtLink href={w.lead.linkedin_url}>{w.lead.linkedin_url}</ExtLink>
      ) : (
        dashIfEmpty(null)
      ),
  },
  {
    key: 'website',
    label: 'Website',
    minW: 'min-w-[220px]',
    cell: (w) =>
      w.lead?.company_website ? (
        <ExtLink href={w.lead.company_website}>{w.lead.company_website}</ExtLink>
      ) : (
        dashIfEmpty(null)
      ),
  },
  {
    key: 'company_linkedin',
    label: 'Company LinkedIn',
    minW: 'min-w-[220px]',
    cell: (w) =>
      w.lead?.company_linkedin ? (
        <ExtLink href={w.lead.company_linkedin}>{w.lead.company_linkedin}</ExtLink>
      ) : (
        dashIfEmpty(null)
      ),
  },
  {
    key: 'industry',
    label: 'Industry',
    minW: 'min-w-[140px]',
    cell: (w) => dashIfEmpty(w.lead?.industry),
  },
  {
    key: 'sub_industry',
    label: 'Sub Industry',
    minW: 'min-w-[140px]',
    cell: (w) => dashIfEmpty(w.lead?.sub_industry),
  },
  {
    key: 'city',
    label: 'City',
    minW: 'min-w-[120px]',
    cell: (w) => dashIfEmpty(w.lead?.city),
  },
  {
    key: 'state',
    label: 'State',
    minW: 'min-w-[120px]',
    cell: (w) => dashIfEmpty(w.lead?.state),
  },
  {
    key: 'country',
    label: 'Country',
    minW: 'min-w-[120px]',
    cell: (w) => dashIfEmpty(w.lead?.country),
  },
  {
    key: 'hq_state',
    label: 'HQ State',
    minW: 'min-w-[120px]',
    cell: (w) => dashIfEmpty(w.lead?.company_hq_state),
  },
  {
    key: 'hq_country',
    label: 'HQ Country',
    minW: 'min-w-[120px]',
    cell: (w) => dashIfEmpty(w.lead?.company_hq_country),
  },
  {
    key: 'employee_count',
    label: 'Employee Count',
    minW: 'min-w-[110px]',
    cell: (w) => dashIfEmpty(w.lead?.employee_count),
  },
  {
    key: 'description',
    label: 'Description',
    minW: 'min-w-[320px]',
    longForm: true,
    cell: (w) => dashIfEmpty(w.lead?.description),
  },
  {
    key: 'intent_details',
    label: 'Intent Details',
    minW: 'min-w-[340px]',
    longForm: true,
    cell: (w) => dashIfEmpty(w.consensus.intent_details),
  },
  {
    key: 'phone',
    label: 'Phone',
    minW: 'min-w-[140px]',
    cell: (w) => dashIfEmpty(w.lead?.phone ?? null),
  },
  {
    // Per-signal evidence used to render in a separate card section
    // below the table. Operator wanted it inline with the row so each
    // winning lead is fully auditable on a single horizontal scroll.
    // The cell stacks one signal block per credited signal, each with:
    //   - source pill + date + score
    //   - matched ICP signal label
    //   - LLM-written per-signal description (or raw description as
    //     fallback before migration 16 / before backfill runs)
    //   - expandable raw evidence snippet
    //   - clickable source URL
    key: 'intent_signals',
    label: 'Intent Signals',
    minW: 'min-w-[440px]',
    longForm: true,
    cell: (w) => {
      const credited = creditedSignals(w.consensus.intent_signal_mapping)
      if (credited.length === 0) return dashIfEmpty(null)
      return (
        <IntentSignalsList
          mapping={w.consensus.intent_signal_mapping}
          breakdown={w.consensus.intent_breakdown}
        />
      )
    },
  },
]

interface SubmittedLeadTableCol {
  key: string
  label: string
  minW: string
  longForm?: boolean
  cell: (lead: RequestSubmittedLead, icp: IcpDetails | null) => React.ReactNode
}

function submittedStatusPill(status: RequestSubmittedLead['status']) {
  return (
    <span
      className={cn(
        'inline-flex rounded-full px-2.5 py-1 text-[10px] font-medium capitalize',
        status === 'denied'
          ? 'bg-red-500/10 text-red-300'
          : status === 'pending'
          ? 'bg-white/5 text-white/60'
          : 'bg-gold-tint text-gold',
      )}
    >
      {status}
    </span>
  )
}

function RawLeadAttributes({ lead }: { lead: RequestSubmittedLead['lead'] }) {
  if (!lead) return dashIfEmpty(null)
  return (
    <pre
      className="whitespace-pre-wrap break-words text-[11px] leading-relaxed"
      style={{ color: 'var(--text-secondary)' }}
    >
      {JSON.stringify(lead, null, 2)}
    </pre>
  )
}

function requiredIntentSignals(icp: IcpDetails | null): string[] {
  return (icp?.intent_signals ?? []).flatMap((signal) => {
    if (typeof signal === 'string') return []
    return signal.required && signal.text ? [signal.text] : []
  })
}

function matchedRequiredSignals(lead: RequestSubmittedLead): string[] {
  const matches = new Set<string>()
  for (const signal of creditedSignals(lead.consensus?.intent_signal_mapping ?? null)) {
    if (signal.matched_icp_signal_required && signal.matched_icp_signal) {
      matches.add(signal.matched_icp_signal)
    }
  }
  return Array.from(matches)
}

function RequiredDetailsSummary({
  lead,
  icp,
  compact = false,
}: {
  lead: RequestSubmittedLead
  icp: IcpDetails | null
  compact?: boolean
}) {
  const companyRequired = asList(icp?.required_attributes?.company)
  const contactRequired = asList(icp?.required_attributes?.contact)
  const intentRequired = requiredIntentSignals(icp)
  const matchedSignals = matchedRequiredSignals(lead)
  const hasRequired =
    companyRequired.length > 0 || contactRequired.length > 0 || intentRequired.length > 0

  if (!hasRequired) return dashIfEmpty(null)

  const evidence = {
    company: lead.lead?.business,
    role: lead.lead?.role,
    role_type: lead.lead?.role_type,
    seniority: lead.lead?.seniority,
    industry: lead.lead?.industry,
    sub_industry: lead.lead?.sub_industry,
    description: lead.lead?.description,
  }

  if (compact) {
    return (
      <div className="space-y-2">
        {companyRequired.length > 0 && (
          <RequirementLine label="Company required" values={companyRequired} />
        )}
        {contactRequired.length > 0 && (
          <RequirementLine label="Contact required" values={contactRequired} />
        )}
        {intentRequired.length > 0 && (
          <RequirementLine
            label="Required signals matched"
            values={matchedSignals.length > 0 ? matchedSignals : intentRequired}
          />
        )}
      </div>
    )
  }

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <div className="rounded-lg border p-3" style={{ borderColor: 'var(--surface-border)' }}>
        <div className="mb-2 text-[10px] uppercase tracking-[0.12em]" style={{ color: 'var(--text-tertiary)' }}>
          Required by request
        </div>
        <div className="space-y-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
          <RequirementLine label="Company" values={companyRequired} />
          <RequirementLine label="Contact" values={contactRequired} />
          <RequirementLine label="Intent signals" values={intentRequired} />
        </div>
      </div>
      <div className="rounded-lg border p-3" style={{ borderColor: 'var(--surface-border)' }}>
        <div className="mb-2 text-[10px] uppercase tracking-[0.12em]" style={{ color: 'var(--text-tertiary)' }}>
          Submitted evidence
        </div>
        <RawLeadAttributes lead={evidence} />
        {matchedSignals.length > 0 && (
          <div className="mt-3">
            <RequirementLine label="Matched required signals" values={matchedSignals} />
          </div>
        )}
      </div>
    </div>
  )
}

function RequirementLine({ label, values }: { label: string; values: string[] }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.12em]" style={{ color: 'var(--text-tertiary)' }}>
        {label}
      </div>
      {values.length > 0 ? (
        <ul className="mt-1 space-y-1">
          {values.map((value) => (
            <li key={value} className="text-xs leading-relaxed" style={{ color: 'var(--text-primary)' }}>
              {value}
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-1 text-xs" style={{ color: 'var(--text-tertiary)' }}>
          —
        </div>
      )}
    </div>
  )
}

const SUBMITTED_LEAD_COLUMNS: SubmittedLeadTableCol[] = [
  {
    key: 'status',
    label: 'Status',
    minW: 'min-w-[110px]',
    cell: (lead) => submittedStatusPill(lead.status),
  },
  {
    key: 'name',
    label: 'Name',
    minW: 'min-w-[180px]',
    cell: (lead) => (
      <div>
        <div>{dashIfEmpty(lead.lead?.full_name)}</div>
        <div className="mt-1 font-mono text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
          {shortHotkey(lead.lead_id)}
        </div>
      </div>
    ),
  },
  {
    key: 'email',
    label: 'Email',
    minW: 'min-w-[220px]',
    cell: (lead) =>
      lead.lead?.email ? (
        <ExtLink href={`mailto:${lead.lead.email}`}>{lead.lead.email}</ExtLink>
      ) : (
        dashIfEmpty(null)
      ),
  },
  {
    key: 'phone',
    label: 'Phone',
    minW: 'min-w-[140px]',
    cell: (lead) => dashIfEmpty(lead.lead?.phone ?? null),
  },
  {
    key: 'role',
    label: 'Role',
    minW: 'min-w-[180px]',
    cell: (lead) => dashIfEmpty(lead.lead?.role),
  },
  {
    key: 'role_type',
    label: 'Role Type',
    minW: 'min-w-[140px]',
    cell: (lead) => dashIfEmpty(lead.lead?.role_type),
  },
  {
    key: 'seniority',
    label: 'Seniority',
    minW: 'min-w-[140px]',
    cell: (lead) => dashIfEmpty(lead.lead?.seniority),
  },
  {
    key: 'company',
    label: 'Company',
    minW: 'min-w-[180px]',
    cell: (lead) => dashIfEmpty(lead.lead?.business),
  },
  {
    key: 'linkedin',
    label: 'LinkedIn',
    minW: 'min-w-[220px]',
    cell: (lead) =>
      lead.lead?.linkedin_url ? (
        <ExtLink href={lead.lead.linkedin_url}>{lead.lead.linkedin_url}</ExtLink>
      ) : (
        dashIfEmpty(null)
      ),
  },
  {
    key: 'website',
    label: 'Website',
    minW: 'min-w-[220px]',
    cell: (lead) =>
      lead.lead?.company_website ? (
        <ExtLink href={lead.lead.company_website}>{lead.lead.company_website}</ExtLink>
      ) : (
        dashIfEmpty(null)
      ),
  },
  {
    key: 'company_linkedin',
    label: 'Company LinkedIn',
    minW: 'min-w-[220px]',
    cell: (lead) =>
      lead.lead?.company_linkedin ? (
        <ExtLink href={lead.lead.company_linkedin}>{lead.lead.company_linkedin}</ExtLink>
      ) : (
        dashIfEmpty(null)
      ),
  },
  {
    key: 'industry',
    label: 'Industry',
    minW: 'min-w-[140px]',
    cell: (lead) => dashIfEmpty(lead.lead?.industry),
  },
  {
    key: 'sub_industry',
    label: 'Sub Industry',
    minW: 'min-w-[140px]',
    cell: (lead) => dashIfEmpty(lead.lead?.sub_industry),
  },
  {
    key: 'employee_count',
    label: 'Employee Count',
    minW: 'min-w-[120px]',
    cell: (lead) => dashIfEmpty(lead.lead?.employee_count),
  },
  {
    key: 'city',
    label: 'City',
    minW: 'min-w-[120px]',
    cell: (lead) => dashIfEmpty(lead.lead?.city),
  },
  {
    key: 'state',
    label: 'State',
    minW: 'min-w-[120px]',
    cell: (lead) => dashIfEmpty(lead.lead?.state),
  },
  {
    key: 'country',
    label: 'Country',
    minW: 'min-w-[120px]',
    cell: (lead) => dashIfEmpty(lead.lead?.country),
  },
  {
    key: 'hq_city',
    label: 'HQ City',
    minW: 'min-w-[120px]',
    cell: (lead) => dashIfEmpty(lead.lead?.company_hq_city),
  },
  {
    key: 'hq_state',
    label: 'HQ State',
    minW: 'min-w-[120px]',
    cell: (lead) => dashIfEmpty(lead.lead?.company_hq_state),
  },
  {
    key: 'hq_country',
    label: 'HQ Country',
    minW: 'min-w-[120px]',
    cell: (lead) => dashIfEmpty(lead.lead?.company_hq_country),
  },
  {
    key: 'score',
    label: 'Score',
    minW: 'min-w-[100px]',
    cell: (lead) => (lead.score == null ? dashIfEmpty(null) : lead.score.toFixed(2)),
  },
  {
    key: 'intent_details',
    label: 'Intent Details',
    minW: 'min-w-[340px]',
    longForm: true,
    cell: (lead) => dashIfEmpty(lead.consensus?.intent_details),
  },
  {
    key: 'intent_signals',
    label: 'Intent Signals',
    minW: 'min-w-[440px]',
    longForm: true,
    cell: (lead) => {
      if (!lead.consensus) return dashIfEmpty(null)
      const credited = creditedSignals(lead.consensus.intent_signal_mapping)
      if (credited.length === 0) return dashIfEmpty(null)
      return (
        <IntentSignalsList
          mapping={lead.consensus.intent_signal_mapping}
          breakdown={lead.consensus.intent_breakdown}
        />
      )
    },
  },
  {
    key: 'required_details',
    label: 'Required Details',
    minW: 'min-w-[360px]',
    longForm: true,
    cell: (lead, icp) => (
      <RequiredDetailsSummary
        lead={lead}
        icp={icp}
        compact
      />
    ),
  },
  {
    key: 'description',
    label: 'Description',
    minW: 'min-w-[320px]',
    longForm: true,
    cell: (lead) => dashIfEmpty(lead.lead?.description),
  },
  {
    key: 'miner',
    label: 'Miner',
    minW: 'min-w-[130px]',
    cell: (lead) => (lead.miner_hotkey ? shortHotkey(lead.miner_hotkey) : dashIfEmpty(null)),
  },
  {
    key: 'reject_reason',
    label: 'Reject Reason',
    minW: 'min-w-[180px]',
    cell: (lead) => dashIfEmpty(lead.rejection_reason),
  },
  {
    key: 'reject_detail',
    label: 'Reject Detail',
    minW: 'min-w-[320px]',
    longForm: true,
    cell: (lead) => dashIfEmpty(lead.rejection_detail),
  },
  {
    key: 'submitted',
    label: 'Submitted',
    minW: 'min-w-[180px]',
    cell: (lead) =>
      lead.submitted_at
        ? formatDateTime(lead.submitted_at)
        : lead.revealed
        ? dashIfEmpty(null)
        : 'Committed only',
  },
]

function SubmittedLeadsTable({
  leads,
  pageStart,
  onSelectLead,
  icp,
}: {
  leads: RequestSubmittedLead[]
  pageStart: number
  onSelectLead: (lead: RequestSubmittedLead) => void
  icp: IcpDetails | null
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr style={{ background: 'var(--surface-elevated)' }}>
            <th
              scope="col"
              className="sticky left-0 z-10 px-3 py-2.5 text-left text-[10px] uppercase tracking-[0.14em] font-medium border-b border-r whitespace-nowrap"
              style={{
                background: 'var(--surface-elevated)',
                borderColor: 'var(--surface-border)',
                color: 'var(--text-tertiary)',
                minWidth: '44px',
                width: '44px',
              }}
            >
              #
            </th>
            {SUBMITTED_LEAD_COLUMNS.map((col) => (
              <th
                key={col.key}
                scope="col"
                className={cn(
                  'px-3 py-2.5 text-left text-[10px] uppercase tracking-[0.14em] font-medium border-b whitespace-nowrap',
                  col.minW,
                )}
                style={{
                  background: 'var(--surface-elevated)',
                  borderColor: 'var(--surface-border)',
                  color: 'var(--text-tertiary)',
                }}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {leads.map((lead, idx) => (
            <tr
              key={`${lead.submission_id}:${lead.lead_id}`}
              className="hover-bg-warm transition-colors cursor-pointer"
              tabIndex={0}
              onClick={() => onSelectLead(lead)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onSelectLead(lead)
                }
              }}
            >
              <td
                className="sticky left-0 z-[5] px-3 py-3 border-b border-r tabular-nums text-xs align-top"
                style={{
                  background: 'var(--surface)',
                  borderColor: 'var(--surface-border)',
                  color: 'var(--text-tertiary)',
                }}
              >
                {pageStart + idx}
              </td>
              {SUBMITTED_LEAD_COLUMNS.map((col) => (
                <td
                  key={col.key}
                  className={cn(
                    'px-3 py-3 border-b align-top',
                    col.longForm
                      ? 'text-[12px] leading-relaxed whitespace-pre-line'
                      : 'whitespace-normal break-words',
                    col.minW,
                  )}
                  style={{
                    borderColor: 'var(--surface-border)',
                    color: 'var(--text-primary)',
                    maxWidth: col.longForm ? '440px' : '280px',
                  }}
                >
                  {col.cell(lead, icp)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function RequestLeadDetailModal({
  lead,
  icp,
  onClose,
}: {
  lead: RequestSubmittedLead
  icp: IcpDetails | null
  onClose: () => void
}) {
  const title = lead.lead?.full_name || lead.lead?.email || shortHotkey(lead.lead_id)
  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 p-4 sm:p-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="mx-auto flex h-full max-w-6xl flex-col overflow-hidden rounded-2xl border"
        style={{
          borderColor: 'var(--surface-border)',
          background: 'var(--surface)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <header
          className="flex items-start justify-between gap-4 border-b px-5 py-4"
          style={{ borderColor: 'var(--surface-border)' }}
        >
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              {submittedStatusPill(lead.status)}
              {lead.fulfilled && (
                <span className="rounded-full bg-gold-tint px-2.5 py-1 text-[10px] font-medium text-gold">
                  Fulfilled
                </span>
              )}
            </div>
            <h3 className="text-lg font-medium" style={{ color: 'var(--text-primary)' }}>
              {title}
            </h3>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs" style={{ color: 'var(--text-tertiary)' }}>
              <span className="font-mono">Lead {shortHotkey(lead.lead_id)}</span>
              <span className="font-mono">Submission {shortHotkey(lead.submission_id)}</span>
              {lead.miner_hotkey && <span className="font-mono">Miner {shortHotkey(lead.miner_hotkey)}</span>}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border px-3 py-1.5 text-xs font-medium"
            style={{
              borderColor: 'var(--surface-border)',
              color: 'var(--text-secondary)',
            }}
          >
            Close
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-5">
          <div className="grid gap-4 lg:grid-cols-2">
            <DetailCard title="Lead Summary">
              <DetailGrid
                rows={[
                  ['Name', lead.lead?.full_name],
                  ['Email', lead.lead?.email],
                  ['Phone', lead.lead?.phone],
                  ['Role', lead.lead?.role],
                  ['Role type', lead.lead?.role_type],
                  ['Seniority', lead.lead?.seniority],
                  ['Company', lead.lead?.business],
                  ['Industry', lead.lead?.industry],
                  ['Sub-industry', lead.lead?.sub_industry],
                  ['Employee count', lead.lead?.employee_count],
                  ['Location', [lead.lead?.city, lead.lead?.state, lead.lead?.country].filter(Boolean).join(', ')],
                  ['HQ location', [lead.lead?.company_hq_city, lead.lead?.company_hq_state, lead.lead?.company_hq_country].filter(Boolean).join(', ')],
                ]}
              />
            </DetailCard>

            <DetailCard title="Validation">
              <DetailGrid
                rows={[
                  ['Status', lead.status],
                  ['Score', lead.score == null ? null : lead.score.toFixed(2)],
                  ['Submitted', lead.submitted_at ? formatDateTime(lead.submitted_at) : lead.revealed ? null : 'Committed only'],
                  ['Consensus at', lead.consensus?.computed_at ? formatDateTime(lead.consensus.computed_at) : null],
                  ['Intent score', lead.consensus?.consensus_intent_signal_final?.toFixed(2)],
                  ['Rep score', lead.consensus?.consensus_rep_score?.toFixed(2)],
                  ['ICP fit', formatBoolean(lead.consensus?.consensus_icp_fit)],
                  ['Tier 2 passed', formatBoolean(lead.consensus?.consensus_tier2_passed)],
                  ['Email verified', formatBoolean(lead.consensus?.consensus_email_verified)],
                  ['Person verified', formatBoolean(lead.consensus?.consensus_person_verified)],
                  ['Company verified', formatBoolean(lead.consensus?.consensus_company_verified)],
                  ['Decision maker', formatBoolean(lead.consensus?.consensus_decision_maker)],
                  ['Fabricated', formatBoolean(lead.consensus?.any_fabricated)],
                  ['Reject reason', lead.rejection_reason],
                ]}
              />
              {lead.rejection_detail && (
                <div className="mt-3 rounded-lg border p-3 text-xs leading-relaxed" style={{ borderColor: 'var(--surface-border)', color: 'var(--text-secondary)' }}>
                  {lead.rejection_detail}
                </div>
              )}
            </DetailCard>

            <DetailCard title="Links">
              <DetailGrid
                rows={[
                  ['LinkedIn', lead.lead?.linkedin_url],
                  ['Company website', lead.lead?.company_website],
                  ['Company LinkedIn', lead.lead?.company_linkedin],
                ]}
              />
            </DetailCard>

            <DetailCard title="Intent Details">
              <div className="text-xs leading-relaxed whitespace-pre-line" style={{ color: 'var(--text-secondary)' }}>
                {lead.consensus?.intent_details || 'No intent details available.'}
              </div>
            </DetailCard>

            <DetailCard title="Required Details" className="lg:col-span-2">
              <RequiredDetailsSummary lead={lead} icp={icp} />
            </DetailCard>

            <DetailCard title="Description" className="lg:col-span-2">
              <div className="text-xs leading-relaxed whitespace-pre-line" style={{ color: 'var(--text-secondary)' }}>
                {lead.lead?.description || 'No description available.'}
              </div>
            </DetailCard>

            <DetailCard title="Intent Signals" className="lg:col-span-2">
              {lead.consensus && creditedSignals(lead.consensus.intent_signal_mapping).length > 0 ? (
                <IntentSignalsList
                  mapping={lead.consensus.intent_signal_mapping}
                  breakdown={lead.consensus.intent_breakdown}
                />
              ) : (
                <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                  No credited intent signals available.
                </div>
              )}
            </DetailCard>

            <DetailCard title="All Lead Attributes" className="lg:col-span-2">
              <RawLeadAttributes lead={lead.lead} />
            </DetailCard>
          </div>
        </div>
      </div>
    </div>
  )
}

function DetailCard({
  title,
  children,
  className,
}: {
  title: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <section
      className={cn('rounded-xl border p-4', className)}
      style={{
        borderColor: 'var(--surface-border)',
        background: 'var(--surface-elevated)',
      }}
    >
      <h4
        className="mb-3 text-[10px] font-medium uppercase tracking-[0.14em]"
        style={{ color: 'var(--text-tertiary)' }}
      >
        {title}
      </h4>
      {children}
    </section>
  )
}

function DetailGrid({ rows }: { rows: Array<[string, React.ReactNode]> }) {
  return (
    <div className="grid gap-2">
      {rows.map(([label, value]) => (
        <div key={label} className="grid gap-1 sm:grid-cols-[140px_1fr]">
          <div className="text-[10px] uppercase tracking-[0.12em]" style={{ color: 'var(--text-tertiary)' }}>
            {label}
          </div>
          <div className="text-xs break-words" style={{ color: 'var(--text-primary)' }}>
            {value || <span style={{ color: 'var(--text-tertiary)' }}>—</span>}
          </div>
        </div>
      ))}
    </div>
  )
}

function formatBoolean(value: boolean | null | undefined): string | null {
  if (value == null) return null
  return value ? 'Yes' : 'No'
}

function WinnersTable({
  winners,
  title = 'Winning leads',
}: {
  winners: AdminWinningLead[]
  title?: string
}) {
  return (
    <section
      className="rounded-xl border overflow-hidden"
      style={{
        borderColor: 'var(--surface-border)',
        background: 'var(--surface)',
      }}
    >
      <header
        className="flex items-center justify-between gap-4 border-b px-5 py-3.5"
        style={{ borderColor: 'var(--surface-border)' }}
      >
        <div className="flex items-baseline gap-2">
          <h2 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            {title}
          </h2>
          <span className="tabular-nums text-xs" style={{ color: 'var(--text-tertiary)' }}>
            {winners.length}
          </span>
        </div>
        <span
          className="hidden sm:inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em]"
          style={{ color: 'var(--text-tertiary)' }}
        >
          <ChevronRight className="h-3 w-3" /> Scroll horizontally for more
        </span>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr style={{ background: 'var(--surface-elevated)' }}>
              <th
                scope="col"
                className="sticky left-0 z-10 px-3 py-2.5 text-left text-[10px] uppercase tracking-[0.14em] font-medium border-b border-r whitespace-nowrap"
                style={{
                  background: 'var(--surface-elevated)',
                  borderColor: 'var(--surface-border)',
                  color: 'var(--text-tertiary)',
                  minWidth: '44px',
                  width: '44px',
                }}
              >
                #
              </th>
              {TABLE_COLUMNS.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  className={cn(
                    'px-3 py-2.5 text-left text-[10px] uppercase tracking-[0.14em] font-medium border-b whitespace-nowrap',
                    col.minW,
                  )}
                  style={{
                    background: 'var(--surface-elevated)',
                    borderColor: 'var(--surface-border)',
                    color: 'var(--text-tertiary)',
                  }}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {winners.map((w, idx) => (
              <tr key={w.consensus.consensus_id} className="hover-bg-warm transition-colors">
                <td
                  className="sticky left-0 z-[5] px-3 py-3 border-b border-r tabular-nums text-xs align-top"
                  style={{
                    background: 'var(--surface)',
                    borderColor: 'var(--surface-border)',
                    color: 'var(--text-tertiary)',
                  }}
                >
                  {idx + 1}
                </td>
                {TABLE_COLUMNS.map((col) => (
                  <td
                    key={col.key}
                    className={cn(
                      'px-3 py-3 border-b align-top',
                      col.longForm
                        ? 'text-[12px] leading-relaxed whitespace-pre-line'
                        : 'whitespace-normal break-words',
                      col.minW,
                    )}
                    style={{
                      borderColor: 'var(--surface-border)',
                      color: 'var(--text-primary)',
                      maxWidth: col.longForm ? '420px' : '280px',
                    }}
                  >
                    {col.cell(w)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

// -----------------------------------------------------------------
// PerLeadIntentSignals
// -----------------------------------------------------------------
// IntentSignalsList
// -----------------------------------------------------------------
// Renders the credited intent signals for a single winning lead as a
// stack of compact cards. Used inside the "Intent Signals" column of
// WinnersTable so the evidence ships next to the lead row instead of
// in a separate section below the table. Returns null when no signal
// earned credit (the calling cell substitutes a dash so the column
// still renders consistently).
function IntentSignalsList({
  mapping,
  breakdown,
}: {
  mapping: IntentSignalMappingEntry[] | null
  breakdown: IntentBreakdown | null
}) {
  const credited = creditedSignals(mapping)
  if (credited.length === 0) return null
  const breakdownByIdx = new Map<number, string>()
  for (const b of breakdown?.per_signal ?? []) {
    if (typeof b.source_index === 'number' && b.details) {
      breakdownByIdx.set(b.source_index, b.details)
    }
  }
  return (
    <div className="space-y-3">
      {credited.map((s, i) => {
        const breakdownText = breakdownByIdx.get(i)
        const sourceLabel = s.source || 'web'
        const matched = s.matched_icp_signal
        return (
          <div
            key={`${s.url}-${i}`}
            className="rounded-lg border px-4 py-3.5 space-y-2"
            style={{
              borderColor: 'var(--surface-border)',
              background: 'var(--surface-elevated)',
            }}
          >
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.14em] rounded-full px-2 py-0.5 border"
                style={{
                  borderColor: 'var(--surface-border-strong)',
                  color: 'var(--text-secondary)',
                }}
              >
                {sourceLabel}
              </span>
              {s.date && (
                <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                  {s.date}
                </span>
              )}
              {typeof s.after_decay_score === 'number' && (
                <span
                  className="text-[11px] tabular-nums ml-auto"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  <span style={{ color: 'var(--text-tertiary)' }}>score</span>{' '}
                  {s.after_decay_score.toFixed(1)}
                </span>
              )}
            </div>
            {matched && (
              <div className="text-xs italic flex items-center gap-2 flex-wrap" style={{ color: 'var(--text-secondary)' }}>
                <span>Matches ICP signal: &ldquo;{matched}&rdquo;</span>
                {/*
                  Highlight when this evidence satisfies a buyer-required
                  spec. Legacy rows with no ``matched_icp_signal_required``
                  simply omit the chip.
                */}
                {s.matched_icp_signal_required ? (
                  <span
                    className="rounded-full border px-1.5 py-0.5 text-[10px] uppercase tracking-wider not-italic"
                    style={{
                      borderColor: 'var(--surface-border-strong)',
                      color: 'var(--text-primary)',
                    }}
                    title="Buyer marked this signal as Required; the lead would have failed without it."
                  >
                    Required
                  </span>
                ) : null}
              </div>
            )}
            {(breakdownText || s.description) && (
              <div className="text-sm leading-relaxed" style={{ color: 'var(--text-primary)' }}>
                {breakdownText || s.description}
              </div>
            )}
            {s.snippet && (
              <details className="text-xs">
                <summary
                  className="cursor-pointer transition-colors hover:text-gold inline-flex items-center gap-1"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  <ChevronRight className="h-3 w-3" />
                  Raw evidence
                </summary>
                <p
                  className="mt-2 pl-4 leading-relaxed whitespace-pre-line"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  {s.snippet}
                </p>
              </details>
            )}
            {s.url && (
              <a
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] transition-colors hover:text-gold truncate max-w-full"
                style={{ color: 'var(--text-tertiary)' }}
              >
                <Globe className="h-3 w-3 flex-shrink-0" />
                <span className="truncate">{s.url}</span>
              </a>
            )}
          </div>
        )
      })}
    </div>
  )
}


// =================================================================
// ICP tab
// =================================================================

function IcpPanel({ icp }: { icp: IcpDetails | null }) {
  if (!icp) {
    return (
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
          No ICP details on file for this request.
        </div>
      </div>
    )
  }
  const requiredCompanyAttributes = asList(icp.required_attributes?.company)
  const requiredContactAttributes = asList(icp.required_attributes?.contact)

  return (
    <div className="space-y-3">
      {icp.prompt && (
        <FieldGroup title="Buyer profile">
          <p
            className="text-sm leading-relaxed whitespace-pre-line"
            style={{ color: 'var(--text-primary)' }}
          >
            {icp.prompt}
          </p>
        </FieldGroup>
      )}
      {icp.product_service && (
        <FieldGroup title="Product / service">
          <p
            className="text-sm leading-relaxed whitespace-pre-line"
            style={{ color: 'var(--text-primary)' }}
          >
            {icp.product_service}
          </p>
        </FieldGroup>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <FieldGroup title="Targeting">
          <Field label="Industries" value={asList(icp.industry).join(', ')} />
          <Field
            label="Sub-industries"
            value={asList(icp.sub_industry).join(', ')}
          />
          <Field
            label="Countries"
            value={asList(icp.country).join(', ') || 'Any'}
          />
          {icp.geography && <Field label="Geography" value={icp.geography} />}
          <Field
            label="Employee count"
            value={asList(icp.employee_count).join(', ')}
          />
        </FieldGroup>
        <FieldGroup title="Buyer roles">
          <Field
            label="Target roles"
            value={(icp.target_roles ?? []).join(', ')}
          />
          <Field
            label="Role types"
            value={(icp.target_role_types ?? []).join(', ')}
          />
          {icp.target_seniority && (
            <Field label="Seniority" value={icp.target_seniority} />
          )}
        </FieldGroup>
      </div>
      <FieldGroup title="Intent signals requested">
        <ul className="space-y-1.5 text-sm">
          {icpSignals(icp).map((s, i) => (
            <li
              key={i}
              className="flex gap-2 items-start"
              style={{ color: 'var(--text-primary)' }}
            >
              <span
                className="inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] flex-shrink-0 mt-0.5 border"
                style={{
                  borderColor: 'var(--surface-border-strong)',
                  background: 'var(--surface-elevated)',
                  color: 'var(--text-secondary)',
                }}
              >
                {i + 1}
              </span>
              <span>{s}</span>
            </li>
          ))}
        </ul>
      </FieldGroup>
      <FieldGroup title="Required attributes">
        <div className="grid gap-4 sm:grid-cols-2">
          <AttributeList
            title="Company"
            values={requiredCompanyAttributes}
          />
          <AttributeList
            title="Contact"
            values={requiredContactAttributes}
          />
        </div>
      </FieldGroup>
      {(icp.excluded_companies ?? []).length > 0 && (
        <FieldGroup title="Excluded companies">
          <div className="flex flex-wrap gap-1.5">
            {(icp.excluded_companies ?? []).map((c, i) => (
              <span
                key={i}
                className="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px]"
                style={{
                  borderColor: 'var(--surface-border-strong)',
                  background: 'var(--surface-elevated)',
                  color: 'var(--text-secondary)',
                }}
              >
                {c}
              </span>
            ))}
          </div>
        </FieldGroup>
      )}
    </div>
  )
}

function AttributeList({
  title,
  values,
}: {
  title: string
  values: string[]
}) {
  return (
    <div>
      <div
        className="mb-2 text-[11px] uppercase tracking-[0.10em]"
        style={{ color: 'var(--text-tertiary)' }}
      >
        {title}
      </div>
      {values.length === 0 ? (
        <Dash />
      ) : (
        <ul className="space-y-1.5 text-sm">
          {values.map((value, i) => (
            <li
              key={`${title}-${i}-${value}`}
              className="flex gap-2 items-start"
              style={{ color: 'var(--text-primary)' }}
            >
              <span
                className="mt-2 inline-block h-1 w-1 flex-shrink-0 rounded-full"
                style={{ background: 'var(--text-tertiary)' }}
              />
              <span>{value}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// =================================================================
// Chain history tab
// =================================================================

function ChainPanel({ cycles }: { cycles: AdminFulfillmentRequest[] }) {
  return (
    <div className="space-y-2">
      {cycles.map((c, i) => (
        <div
          key={c.request_id}
          className="rounded-xl border p-4 flex items-center gap-4"
          style={{
            borderColor: 'var(--surface-border)',
            background:
              i === cycles.length - 1
                ? 'var(--surface-elevated)'
                : 'var(--surface)',
          }}
        >
          <div
            className="flex items-center justify-center w-7 h-7 rounded-full text-xs border tabular-nums flex-shrink-0"
            style={{
              borderColor:
                i === cycles.length - 1
                  ? 'rgba(201, 169, 110, 0.45)'
                  : 'var(--surface-border-strong)',
              background:
                i === cycles.length - 1
                  ? 'rgba(201, 169, 110, 0.12)'
                  : 'transparent',
              color:
                i === cycles.length - 1
                  ? 'var(--brand)'
                  : 'var(--text-secondary)',
            }}
          >
            {i + 1}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2 flex-wrap">
              <StatusPill status={c.status} />
              <span
                className="text-xs tabular-nums"
                style={{ color: 'var(--text-secondary)' }}
              >
                {c.num_leads} leads
              </span>
              <span
                className="text-xs"
                style={{ color: 'var(--text-tertiary)' }}
              >
                {formatDateTime(c.created_at)}
              </span>
            </div>
            <div
              className="font-mono text-[11px] mt-1 truncate"
              style={{ color: 'var(--text-tertiary)' }}
            >
              {c.request_id}
            </div>
          </div>
          {i === 0 && (
            <span
              className="text-[10px] uppercase tracking-[0.14em] inline-flex items-center gap-1 rounded-full border px-2 py-1"
              style={{
                borderColor: 'var(--surface-border-strong)',
                color: 'var(--text-secondary)',
              }}
            >
              Root
            </span>
          )}
          {i === cycles.length - 1 && cycles.length > 1 && (
            <span
              className="text-[10px] uppercase tracking-[0.14em] text-gold inline-flex items-center gap-1 rounded-full border border-gold-soft bg-gold-soft px-2 py-1"
            >
              Current
            </span>
          )}
        </div>
      ))}
    </div>
  )
}

// =================================================================
// Shared field primitives
// =================================================================

function FieldGroup({
  title,
  accentIcon,
  children,
}: {
  title: string
  accentIcon?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section
      className="rounded-xl border p-4"
      style={{
        borderColor: 'var(--surface-border)',
        background: 'var(--surface-elevated)',
      }}
    >
      <div
        className="text-[10px] uppercase tracking-[0.14em] mb-3 flex items-center gap-1.5"
        style={{ color: 'var(--text-tertiary)' }}
      >
        {accentIcon}
        {title}
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  )
}

function Field({
  label,
  value,
  link,
  icon,
  mono,
  copy,
}: {
  label: string
  value?: string
  link?: string
  icon?: React.ReactNode
  mono?: boolean
  copy?: string
}) {
  const empty = !value
  return (
    <div className="flex items-start gap-3 text-sm">
      <span
        className="text-[11px] uppercase tracking-[0.10em] flex-shrink-0 w-28 pt-0.5"
        style={{ color: 'var(--text-tertiary)' }}
      >
        {label}
      </span>
      <div className="min-w-0 flex-1 flex items-start gap-1.5">
        {icon && <span style={{ color: 'var(--text-tertiary)' }}>{icon}</span>}
        {empty ? (
          <span style={{ color: 'var(--text-tertiary)' }}>—</span>
        ) : link ? (
          <a
            href={link}
            target={link.startsWith('mailto:') ? undefined : '_blank'}
            rel="noopener noreferrer"
            className={cn(
              'truncate transition-colors hover:text-gold',
              mono ? 'font-mono text-[12px]' : '',
            )}
            style={{ color: 'var(--text-primary)' }}
          >
            {value}
          </a>
        ) : (
          <span
            className={cn(
              'whitespace-normal break-words leading-relaxed',
              mono ? 'font-mono text-[12px] tabular-nums' : '',
            )}
            style={{ color: 'var(--text-primary)' }}
          >
            {value}
          </span>
        )}
        {copy && <CopyButton text={copy} compact />}
      </div>
    </div>
  )
}

function CheckRow({
  label,
  passed,
}: {
  label: string
  passed: boolean | null | undefined
}) {
  const color =
    passed === true
      ? 'text-gold'
      : passed === false
      ? 'text-burgundy'
      : 'text-white/40'
  return (
    <div className="flex items-center gap-3 text-sm">
      <span
        className="text-[11px] uppercase tracking-[0.10em] flex-shrink-0 w-28"
        style={{ color: 'var(--text-tertiary)' }}
      >
        {label}
      </span>
      <div className={cn('inline-flex items-center gap-1.5', color)}>
        {passed === true ? (
          <>
            <Check className="h-3 w-3" />
            <span className="text-xs">Pass</span>
          </>
        ) : passed === false ? (
          <>
            <span className="text-xs">Fail</span>
          </>
        ) : (
          <span className="text-xs">—</span>
        )}
      </div>
    </div>
  )
}

function CopyButton({
  text,
  label,
  compact,
}: {
  text: string
  label?: string
  compact?: boolean
}) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        })
      }}
      className={cn(
        'inline-flex items-center gap-1.5 transition-colors hover:text-gold',
        compact
          ? 'text-[10px] opacity-60 hover:opacity-100'
          : 'rounded-md border px-3 py-2 text-xs',
      )}
      style={
        compact
          ? { color: 'var(--text-tertiary)' }
          : {
              borderColor: 'var(--surface-border)',
              background: 'var(--surface-elevated)',
              color: 'var(--text-secondary)',
            }
      }
      title={label || 'Copy'}
    >
      {copied ? (
        <>
          <Check className="h-3 w-3" />
          {!compact && 'Copied'}
        </>
      ) : (
        <>
          <Copy className="h-3 w-3" />
          {!compact && label}
        </>
      )}
    </button>
  )
}

function RequestIdChip({ id }: { id: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 font-mono text-[11px]"
      style={{ color: 'var(--text-secondary)' }}
    >
      {id.slice(0, 8)}…{id.slice(-4)}
    </span>
  )
}

function StatusPill({ status }: { status: string }) {
  const tone = statusTone(status)
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
      {statusLabel(status)}
    </span>
  )
}
