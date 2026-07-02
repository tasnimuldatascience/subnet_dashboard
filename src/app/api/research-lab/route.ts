import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import {
  deriveResearchLabLoopStatus,
  isActiveResearchLabLoopStatus,
  isCompletedResearchLabLoopStatus,
  isNoGainOrFailedResearchLabLoopStatus,
  isPendingOrBlockingResearchLabLoopStatus,
  isPromisingResearchLabLoopStatus,
  isScoredResearchLabLoopStatus,
  type ResearchLabLoopStatusNote,
} from '@/lib/research-lab-status'
import {
  buildResearchLabLoopTimeline,
  type ResearchLabLoopTimeline,
  type ResearchLabTimelineEvent,
  type ResearchLabTimelinePhase,
  type ResearchLabTimelineRawRow,
  type ResearchLabTimelineSourceInput,
} from '@/lib/research-lab-timeline'
import {
  buildResearchLabAllocationRollup,
  researchLabAllocationEntries,
  type ResearchLabEmissionAllocationDoc,
  type ResearchLabEmissionAllocationRollup,
  type ResearchLabEmissionAllocationSnapshot,
} from '@/lib/research-lab-emissions'
import { researchLabTemporaryImprovementOverride } from '@/lib/research-lab-temporary-overrides'

export const dynamic = 'force-dynamic'

const CACHE_TTL = 60_000
const LOOP_LIMIT = 50
const LOOP_FETCH_LIMIT = LOOP_LIMIT + 100
const HIDDEN_LOOP_MINER_PREFIXES = [
  '5FEtvB',
  '5FBhsXVWpezSHcpogXo4CjMcgTBctLcZ7VnNoKzn3oEGST44',
]

type CachedResponse = {
  data: ResearchLabPayload
  ts: number
}

type PublicBenchmarkReportRow = {
  report_id: string
  benchmark_date: string
  rolling_window_hash: string
  aggregate_score: number
  report_doc: PublicBenchmarkReportDoc | null
  current_report_status: string | null
  current_status_at: string | null
  created_at: string
}

type PublicBenchmarkReportDoc = {
  schema_version?: string
  benchmark_date?: string
  rolling_window_hash?: string
  aggregate_score?: number
  aggregate_score_band?: string
  item_count?: number
  public_icp_count?: number
  private_holdout_icp_count?: number
  zero_lead_icp_count?: number
  low_intent_fit_icp_count?: number
  low_icp_fit_count?: number
  score_band_counts?: Record<string, number>
  failure_category_counts?: Record<string, number>
  model_issue_counts?: Record<string, number>
  model_issue_public_icps?: Record<string, ModelIssueIcpEntry[]>
  visibility_split?: {
    public_count?: number
    private_count?: number
  }
  public_icps?: PublicIcpEntry[]
  icp_buckets?: unknown[]
}

type BenchmarkDisplayScore = {
  source: 'daily_rebenchmark' | 'latest_promoted_model'
  score: number
  scoreBand: string
  statusAt: string | null
  label: string
  deltaVsDailyBaseline: number | null
  baselineAggregateScore: number | null
  scoreBundleId: string | null
  modelArtifactHash: string | null
  privateModelVersionId: string | null
}

type ActivePromotedModelScore = {
  privateModelVersionId: string
  modelArtifactHash: string
  scoreBundleId: string
  score: number
  scoreBand: string
  promotedAt: string | null
  deltaVsDailyBaseline: number | null
  baselineAggregateScore: number | null
  gitCommitSha: string | null
}

type PrivateModelVersionCurrentRow = {
  private_model_version_id: string | null
  model_artifact_hash: string | null
  source_score_bundle_id: string | null
  current_version_status: string | null
  current_status_at: string | null
  git_commit_sha: string | null
}

type ScoreBundleCurrentRow = {
  score_bundle_id: string | null
  bundle_status: string | null
  candidate_artifact_hash: string | null
  score_bundle_doc: ScoreBundleDoc | null
  created_at: string | null
}

type ScoreBundleDoc = {
  private_holdout_gate?: {
    candidate_total_score?: number | string | null
    candidate_delta_vs_daily_baseline?: number | string | null
    baseline_aggregate_score?: number | string | null
  }
  aggregates?: {
    candidate_score?: number | string | null
  }
}

type PublicIcpEntry = {
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
    // Per-stage funnel + per-signal coverage, sourced from the private
    // benchmark bundle and attached only for already-revealed public ICPs.
    sourcing_failed?: boolean
    funnel?: LeadFunnel
    per_signal?: Record<string, PerSignalStat>
    rejection_reasons?: Record<string, number>
  }
}

// Lead funnel: how many of the model's discovered companies survive each
// scoring stage. Stored per ICP in the private benchmark bundle's
// score_summary_doc.per_icp_summaries[].diagnostics.
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

type EvidenceTypeStat = {
  signals?: number
  companies_passed?: number
  avg_after_decay?: number
  fresh_rate?: number
}

// Run-wide rollup of one required intent/evidence type.
// icp_count = number of benchmark ICPs (across ALL 20, incl. sourcing failures)
// that required this intent type, taken from the ICP definitions.
// expected = HEALTHY_DISCOVERY_FLOOR x icp_count; fulfilled = companies whose
// evidence of this type passed; pass_pct = fulfilled / expected.
type IntentTypeRollup = {
  evidence_type: string
  fulfilled: number
  icp_count: number
  expected: number
  pass_pct: number
  avg_score: number
}

type PrivateIcpDiagnostics = {
  sourcing_failed?: boolean
  funnel?: Partial<LeadFunnel>
  per_signal?: Record<string, PerSignalStat>
  rejection_reasons?: Record<string, number>
  evidence_types?: Record<string, EvidenceTypeStat>
}

type PrivateIcpSummary = {
  icp_ref?: string
  icp_hash?: string
  diagnostics?: PrivateIcpDiagnostics
}

type PrivateBundleRow = {
  benchmark_date: string
  created_at: string
  benchmark_quality: string | null
  score_summary_doc: { per_icp_summaries?: PrivateIcpSummary[] } | null
}

// Per-ICP discovery health: how many ICPs the model could find companies for.
// The benchmark sets no hard per-ICP quota, so HEALTHY_DISCOVERY_FLOOR is a
// labeled reporting threshold, not a contract.
const HEALTHY_DISCOVERY_FLOOR = 5

type DiscoverySummary = {
  totalIcps: number
  noCompanies: number // 0 sourced (sourcing failed / infra)
  weak: number // 1..floor-1 discovered
  healthy: number // >= floor discovered
  totalDiscovered: number // sum sourced across all ICPs
  totalScored: number // sum scored across all ICPs
  floor: number
}

type PrivateDiagnosticsBundle = {
  aggregateFunnel: LeadFunnel
  sourcingFailedCount: number
  scoredIcpCount: number
  intentTypes: IntentTypeRollup[]
  discovery: DiscoverySummary
  byRef: Map<string, PrivateIcpDiagnostics>
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

type PublicLoopRow = {
  card_id: string
  ticket_id: string
  miner_hotkey: string
  research_area: string
  research_focus_summary: string
  topic_tags: string[] | null
  topic_signature_hash: string
  current_topic_tags: string[] | null
  current_topic_signature_hash: string | null
  current_outcome_label: string | null
  current_outcome_band: string | null
  current_candidate_count: number | null
  current_scored_candidate_count: number | null
  current_best_candidate_public_summary: string | null
  current_last_activity_at: string | null
  current_run_id: string | null
  current_receipt_id: string | null
  current_event_doc: PublicLoopEventDoc | null
  current_candidate_status?: string | null
  current_reason?: string | null
  current_queue_status?: string | null
  current_receipt_status?: string | null
  current_status?: string | null
  public_status?: string | null
  payment_state?: string | null
  execution_state?: string | null
  candidate_state?: string | null
  result_state?: string | null
  ops_reason?: string | null
  status_detail?: string | null
  ops_warnings?: unknown
  current_public_status?: string | null
  current_payment_state?: string | null
  current_execution_state?: string | null
  current_candidate_state?: string | null
  current_result_state?: string | null
  current_ops_reason?: string | null
  current_status_detail?: string | null
  current_ops_warnings?: unknown
  improvement_gate_decision?: string | null
  current_improvement_gate_decision?: string | null
  promotion_status?: string | null
  current_promotion_status?: string | null
  promotion_event_type?: string | null
  current_promotion_event_type?: string | null
  promotion_event?: string | null
  current_promotion_event?: string | null
  event_type?: string | null
  current_event_type?: string | null
  created_at: string
}

// Subset of the public activity event payload we rely on to derive an
// honest outcome label. `projection_reason` explains WHY a card sits at its
// current label — e.g. a "candidate_generation_complete" card whose reason is
// `stale_parent_needs_rescore` is really a rejected/stale candidate, and a
// "submitted" card whose reason is `ticket_created` with an empty queue_status
// never entered the autoresearch queue at all.
type PublicLoopEventDoc = {
  projection_reason?: string
  current_candidate_status?: string
  candidate_status?: string
  current_reason?: string
  candidate_reason?: string
  queue_status?: string
  receipt_status?: string
  public_status?: string
  payment_state?: string
  execution_state?: string
  candidate_state?: string
  result_state?: string
  ops_reason?: string
  status_detail?: string
  ops_warnings?: unknown
  current_public_status?: string
  current_payment_state?: string
  current_execution_state?: string
  current_candidate_state?: string
  current_result_state?: string
  current_ops_reason?: string
  current_status_detail?: string
  current_ops_warnings?: unknown
  improvement_gate_decision?: string
  current_improvement_gate_decision?: string
  improvement_gate?: Record<string, unknown> | null
  improvementGate?: Record<string, unknown> | null
  promotion_status?: string
  current_promotion_status?: string
  promotion_event_type?: string
  current_promotion_event_type?: string
  promotion_event?: string
  current_promotion_event?: string
  promotion?: Record<string, unknown> | null
  event_type?: string
  current_event_type?: string
  score_bundle_count?: number
  candidate_status_counts?: Record<string, number>
  candidate_reason_counts?: Record<string, number>
}

type ResearchLabPayload = {
  benchmark: NormalizedBenchmark | null
  loops: NormalizedLoop[]
  topicGroups: TopicGroup[]
  labMinerSpend: LabMinerSpendRollup
  labMinerActivity: LabMinerActivityRollup
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
  allTime: LabMinerAllTimeRollup
  currentAllocation: ResearchLabEmissionAllocationRollup
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

type LabMinerAllTimeRollup = {
  firstEpoch: number | null
  latestEpoch: number | null
  allocationSnapshotCount: number
  byHotkey: Record<string, LabMinerAllTimeEntry>
}

type LabMinerAllTimeEntry = {
  alphaEarned: number
  computeSpendUsd: number
  scheduledReimbursementUsd: number
  awardCount: number
  reimbursementEpochs: number | null
  alphaAllocationCount: number
}

type LabMinerActivityRollup = {
  windowStartedAt: string
  allTime: Record<string, LabMinerActivityEntry>
  last24h: Record<string, LabMinerActivityEntry>
}

type LabMinerActivityEntry = {
  count: number
  active: number
  scored: number
  promising: number
  lastActivityAt: string
}

type NormalizedBenchmark = {
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
  publicIcps: PublicIcpEntry[]
  aggregateFunnel: LeadFunnel | null
  sourcingFailedCount: number
  intentTypes: IntentTypeRollup[]
  discovery: DiscoverySummary | null
  currentStatusAt: string | null
  displayScore: BenchmarkDisplayScore
  activePromotedModel: ActivePromotedModelScore | null
}

type BenchmarkIssue = {
  key: string
  label: string
  count: number
  severity: 'high' | 'medium' | 'low'
  description: string
  icps: ModelIssueIcpEntry[]
}

type NormalizedLoop = {
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
  statusKey: string
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
  tone: ResearchLabLoopStatusNote['tone']
  label: ResearchLabLoopStatusNote['label']
  detail: ResearchLabLoopStatusNote['detail']
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

type ReimbursementScheduleRow = {
  award_id: string | null
  schedule_status: string | null
  start_epoch: number | null
  epoch_count: number | null
  total_microusd: number | string | null
}

type ReimbursementAwardRow = {
  award_id: string
  miner_hotkey: string | null
  eligible_cost_microusd: number | string | null
  target_reimbursement_microusd: number | string | null
  reimbursement_epochs: number | null
}

type EmissionAllocationSnapshotRow = {
  epoch: number | null
  allocation_doc: ResearchLabEmissionAllocationDoc | null
  created_at: string | null
  lab_cap_alpha_percent?: number | string | null
}

let cache: CachedResponse | null = null

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SECRET_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) {
    throw new Error('Supabase environment variables are not configured')
  }
  return createClient(url, key, { auth: { persistSession: false } })
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const ticketId = url.searchParams.get('ticketId')?.trim()
    if (ticketId) {
      const supabase = getSupabase()
      const timeline = await fetchLoopTimeline(supabase, ticketId)
      if (!timeline) {
        return NextResponse.json(
          { success: false, error: 'Research Lab loop not found' },
          { status: 404 },
        )
      }
      return NextResponse.json({ success: true, data: timeline })
    }

    if (cache && Date.now() - cache.ts < CACHE_TTL) {
      return NextResponse.json({ success: true, data: cache.data })
    }

    const supabase = getSupabase()
    const [benchmark, activePromotedModel, loops, allLoops, labMinerSpend] = await Promise.all([
      fetchLatestBenchmark(supabase),
      fetchActivePromotedModelScore(supabase),
      fetchPublicLoops(supabase),
      fetchPublicLoops(supabase, 5_000, 5_000),
      fetchLabMinerSpend(supabase),
    ])
    const displayBenchmark = benchmark
      ? withBenchmarkDisplayScore(benchmark, activePromotedModel)
      : null
    const topicGroups = groupLoopsByTopic(loops)
    const labMinerActivity = buildLabMinerActivityRollup(allLoops)
    const promisingLoopCount = countPromisingLoopsWithTemporaryOverrides(loops)
    const data: ResearchLabPayload = {
      benchmark: displayBenchmark,
      loops,
      topicGroups,
      labMinerSpend,
      labMinerActivity,
      stats: {
        activeLoopCount: loops.filter((loop) => isActiveResearchLabLoopStatus(loop.statusKey)).length,
        opsPendingLoopCount: loops.filter((loop) =>
          isPendingOrBlockingResearchLabLoopStatus(loop.statusKey)
        ).length,
        scoredLoopCount: loops.filter((loop) =>
          isScoredResearchLabLoopStatus(loop.statusKey)
        ).length,
        promisingLoopCount,
        totalBenchmarkIcpCount: displayBenchmark?.itemCount ?? 0,
      },
      fetchedAt: new Date().toISOString(),
    }
    cache = { data, ts: Date.now() }
    return NextResponse.json({ success: true, data })
  } catch (error) {
    console.error('[Research Lab API] failed:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to fetch Research Lab data' },
      { status: 500 }
    )
  }
}

async function fetchLoopTimeline(
  supabase: ReturnType<typeof getSupabase>,
  ticketId: string,
): Promise<ResearchLabLoopTimeline | null> {
  const { data: currentRows, error: currentError } = await supabase
    .from('research_lab_public_loop_card_current')
    .select('*')
    .eq('ticket_id', ticketId)
    .limit(5)

  if (currentError) {
    console.error('[Research Lab API] loop timeline current query failed:', currentError)
    return null
  }

  const currentRow = ((currentRows ?? []) as PublicLoopRow[]).find(isVisiblePublicLoop) ?? null
  if (!currentRow) return null

  const currentRunId = currentRow.current_run_id
  const currentReceiptId = currentRow.current_receipt_id
  const fetches: Array<Promise<TimelineSourceResult>> = [
    fetchTimelineSourceByTicket(supabase, 'research_loop_ticket_events', 'ticket', ticketId),
    fetchTimelineSourceByTicket(supabase, 'research_loop_run_queue_events', 'queue', ticketId),
    fetchTimelineSourceByTicket(supabase, 'research_lab_auto_research_loop_events', 'auto_research', ticketId),
    fetchTimelineSourceByTicket(supabase, 'research_lab_candidate_evaluation_events', 'candidate', ticketId),
    fetchTimelineSourceByTicket(supabase, 'research_evaluation_score_bundle_events', 'scoring', ticketId),
    fetchTimelineSourceByTicket(supabase, 'research_lab_candidate_promotion_events', 'promotion', ticketId),
    fetchTimelineSourceByTicket(supabase, 'research_lab_public_loop_card_events', 'public_projection', ticketId),
  ]

  if (currentRunId) {
    fetches.push(
      fetchTimelineSourceByRun(supabase, 'research_loop_run_queue_events', 'queue', currentRunId),
      fetchTimelineSourceByRun(supabase, 'research_lab_auto_research_loop_events', 'auto_research', currentRunId),
      fetchTimelineSourceByRun(supabase, 'research_lab_candidate_evaluation_events', 'candidate', currentRunId),
      fetchTimelineSourceByRun(supabase, 'research_evaluation_score_bundle_events', 'scoring', currentRunId),
      fetchTimelineSourceByRun(supabase, 'research_lab_candidate_promotion_events', 'promotion', currentRunId),
    )
  }

  const results = await Promise.all(fetches)
  const sources = mergeTimelineSources(results)
  const sourceNotes = Array.from(new Set(results.map((result) => result.note).filter(Boolean))) as string[]
  const rawEventCount = sources
    .filter((source) => source.source !== 'research_lab_public_loop_card_events')
    .reduce((sum, source) => sum + source.rows.length, 0)
  const publicProjectionCount = sources
    .filter((source) => source.source === 'research_lab_public_loop_card_events')
    .reduce((sum, source) => sum + source.rows.length, 0)

  if (rawEventCount === 0 && publicProjectionCount > 0) {
    sourceNotes.push('This timeline is built from public projection events; raw execution events were not returned by the current backend.')
  } else if (rawEventCount === 0 && publicProjectionCount === 0) {
    sourceNotes.push('Only the current public loop projection is available for this ticket.')
  }

  const detailedTimeline = buildResearchLabLoopTimeline({
    ticketId,
    currentRunId,
    currentReceiptId,
    currentLoop: {
      cardId: currentRow.card_id,
      ticketId: currentRow.ticket_id,
      runId: currentRunId,
      receiptId: currentReceiptId,
      minerHotkey: currentRow.miner_hotkey,
      outcomeLabel: currentRow.current_outcome_label,
      outcomeBand: currentRow.current_outcome_band,
      statusLabel: currentRow.current_status,
      submittedAt: currentRow.created_at,
      lastActivityAt: currentRow.current_last_activity_at,
      eventDoc: currentRow.current_event_doc,
    },
    sources,
    sourceNotes,
  })

  return summarizePublicLoopTimeline(detailedTimeline, currentRow)
}

type PublicTimelineStageId =
  | 'submitted'
  | 'paid_queued'
  | 'run_started'
  | 'research_patch'
  | 'candidate_generated'
  | 'scoring'
  | 'final_result'

type PublicTimelineStageDefinition = {
  id: PublicTimelineStageId
  label: string
  phase: ResearchLabTimelinePhase
  pick?: 'first' | 'last'
  match: (event: ResearchLabTimelineEvent, text: string) => boolean
  fallback?: (event: ResearchLabTimelineEvent, text: string) => boolean
}

const PUBLIC_TIMELINE_STAGES: PublicTimelineStageDefinition[] = [
  {
    id: 'submitted',
    label: 'Submitted',
    phase: 'ticket',
    match: (event, text) =>
      event.phase === 'ticket' && hasAny(text, ['submitted', 'opened', 'created', 'ticket created']),
    fallback: (event) => event.phase === 'ticket',
  },
  {
    id: 'paid_queued',
    label: 'Paid / queued',
    phase: 'queue',
    match: (event, text) =>
      event.phase === 'queue' ||
      (event.phase === 'ticket' && hasAny(text, ['paid', 'payment', 'funded', 'queued', 'queue'])),
  },
  {
    id: 'run_started',
    label: 'Run started',
    phase: 'queue',
    match: (event, text) =>
      Boolean(event.runId) &&
      (event.phase === 'queue' || hasAny(text, ['run started', 'started run', 'claimed', 'dispatched'])),
    fallback: (event) => Boolean(event.runId) && event.phase !== 'ticket',
  },
  {
    id: 'research_patch',
    label: 'Research / patch attempt',
    phase: 'auto_research',
    match: (event) => event.phase === 'auto_research',
  },
  {
    id: 'candidate_generated',
    label: 'Candidate generated',
    phase: 'candidate',
    match: (event) => event.phase === 'candidate',
  },
  {
    id: 'scoring',
    label: 'Scoring',
    phase: 'scoring',
    match: (event, text) =>
      event.phase === 'scoring' ||
      (event.phase === 'public_projection' && hasAny(text, ['scoring'])),
  },
  {
    id: 'final_result',
    label: 'Final result / promotion',
    phase: 'promotion',
    pick: 'last',
    match: (event, text) => event.phase === 'public_projection' && isFinalPublicTimelineText(text),
  },
]

function summarizePublicLoopTimeline(
  timeline: ResearchLabLoopTimeline,
  currentLoop: PublicLoopRow | null,
): ResearchLabLoopTimeline {
  const events = timeline.runs
    .flatMap((run) => run.events)
    .filter((event) => Number.isFinite(new Date(event.enteredAt).getTime()))
    .sort((a, b) => new Date(a.enteredAt).getTime() - new Date(b.enteredAt).getTime())

  const stageEvents = PUBLIC_TIMELINE_STAGES
    .reduce<ResearchLabTimelineEvent[]>((acc, stage) => {
      if (stage.id === 'final_result' && !isCurrentPublicLoopFinal(currentLoop)) return acc
      const sourceEvent = selectPublicStageEvent(stage, events)
      if (!sourceEvent) return acc
      acc.push({
        id: `public-stage:${stage.id}`,
        phase: stage.phase,
        stage: stage.label,
        enteredAt: sourceEvent.enteredAt,
        timestampKind: 'entered_stage' as const,
        lastActivityAt: sourceEvent.lastActivityAt,
        runId: sourceEvent.runId,
        receiptId: sourceEvent.receiptId,
      })
      return acc
    }, [])

  const receiptId = stageEvents.find((event) => event.receiptId)?.receiptId

  return {
    ticketId: timeline.ticketId,
    currentRunId: timeline.currentRunId,
    runs: stageEvents.length
      ? [
          {
            runId: timeline.currentRunId,
            receiptId,
            isCurrent: Boolean(timeline.currentRunId),
            events: stageEvents,
          },
        ]
      : [],
  }
}

function isCurrentPublicLoopFinal(row: PublicLoopRow | null): boolean {
  if (!row) return false
  return isFinalPublicTimelineText(
    [
      row.current_status,
      row.current_outcome_label,
      row.current_outcome_band,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase(),
  )
}

function selectPublicStageEvent(
  stage: PublicTimelineStageDefinition,
  events: ResearchLabTimelineEvent[],
): ResearchLabTimelineEvent | undefined {
  const matches = events.filter((event) => stage.match(event, publicTimelineText(event)))
  const candidates =
    matches.length > 0 || !stage.fallback
      ? matches
      : events.filter((event) => stage.fallback?.(event, publicTimelineText(event)))
  if (candidates.length === 0) return undefined
  return stage.pick === 'last' ? candidates[candidates.length - 1] : candidates[0]
}

function publicTimelineText(event: ResearchLabTimelineEvent): string {
  return [
    event.phase,
    event.stage,
    event.status,
    event.summary,
    event.source,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

function hasAny(value: string, needles: string[]): boolean {
  return needles.some((needle) => value.includes(needle))
}

function isFinalPublicTimelineText(value: string): boolean {
  return hasAny(value, [
    'promoted',
    'final',
    'result',
    'scored',
    'completed',
    'no gain',
    'no_gain',
    'failed',
    'cancelled',
    'rejected',
  ])
}

type TimelineSourceResult = ResearchLabTimelineSourceInput & {
  note?: string
}

async function fetchTimelineSourceByTicket(
  supabase: ReturnType<typeof getSupabase>,
  table: string,
  phase: ResearchLabTimelinePhase,
  ticketId: string,
): Promise<TimelineSourceResult> {
  return fetchTimelineSource(supabase, table, phase, 'ticket_id', ticketId)
}

async function fetchTimelineSourceByRun(
  supabase: ReturnType<typeof getSupabase>,
  table: string,
  phase: ResearchLabTimelinePhase,
  runId: string,
): Promise<TimelineSourceResult> {
  return fetchTimelineSource(supabase, table, phase, 'run_id', runId)
}

async function fetchTimelineSource(
  supabase: ReturnType<typeof getSupabase>,
  table: string,
  phase: ResearchLabTimelinePhase,
  column: 'ticket_id' | 'run_id',
  value: string,
): Promise<TimelineSourceResult> {
  const { data, error } = await supabase
    .from(table)
    .select('*')
    .eq(column, value)
    .limit(500)

  if (error) {
    if (!isExpectedOptionalTimelineSourceMiss(error.message)) {
      console.warn(`[Research Lab API] timeline source unavailable: ${table}.${column}`, error.message)
    }
    return {
      source: table,
      phase,
      rows: [],
    }
  }

  return {
    source: table,
    phase,
    rows: (data ?? []) as ResearchLabTimelineRawRow[],
  }
}

function mergeTimelineSources(results: TimelineSourceResult[]): ResearchLabTimelineSourceInput[] {
  const bySource = new Map<string, ResearchLabTimelineSourceInput>()
  for (const result of results) {
    const key = `${result.phase}:${result.source}`
    const current = bySource.get(key) ?? {
      source: result.source,
      phase: result.phase,
      rows: [],
    }
    current.rows.push(...result.rows)
    bySource.set(key, current)
  }
  return Array.from(bySource.values())
}

function isExpectedOptionalTimelineSourceMiss(message: string | undefined): boolean {
  const normalized = (message ?? '').toLowerCase()
  return normalized.includes('does not exist') || normalized.includes('could not find')
}

async function fetchLatestBenchmark(supabase: ReturnType<typeof getSupabase>): Promise<NormalizedBenchmark | null> {
  const { data, error } = await supabase
    .from('research_lab_public_benchmark_report_current')
    .select('report_id, benchmark_date, rolling_window_hash, aggregate_score, report_doc, current_report_status, current_status_at, created_at')
    .eq('current_report_status', 'published')
    .order('benchmark_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)

  if (error) {
    console.error('[Research Lab API] benchmark query failed:', error)
    return null
  }

  const row = (data?.[0] ?? null) as PublicBenchmarkReportRow | null
  if (!row) return null
  const doc = row.report_doc ?? {}
  const benchmarkDate = String(doc.benchmark_date || row.benchmark_date)
  // Pull per-stage funnel + per-signal coverage from the private bundle and
  // attach it ONLY to the already-revealed public ICPs (no holdout leak).
  const privateDiag = await fetchPrivateDiagnostics(supabase, benchmarkDate)
  const publicIcps = attachPrivateDiagnostics(
    stripInternalIcpFields(Array.isArray(doc.public_icps) ? doc.public_icps : []),
    privateDiag,
  )
  const publicIcpCount = numberOr(
    doc.public_icp_count,
    numberOr(doc.visibility_split?.public_count, publicIcps.length)
  )
  const privateHoldoutIcpCount = numberOr(
    doc.private_holdout_icp_count,
    numberOr(doc.visibility_split?.private_count, 0)
  )
  const itemCount = numberOr(doc.item_count, publicIcpCount + privateHoldoutIcpCount)
  const aggregateScore = numberOr(doc.aggregate_score, row.aggregate_score)
  const aggregateScoreBand = String(doc.aggregate_score_band || scoreBand(aggregateScore))

  return {
    reportId: row.report_id,
    benchmarkDate: String(doc.benchmark_date || row.benchmark_date),
    rollingWindowHash: String(doc.rolling_window_hash || row.rolling_window_hash),
    aggregateScore,
    aggregateScoreBand,
    itemCount,
    publicIcpCount,
    privateHoldoutIcpCount,
    scoreBandCounts: doc.score_band_counts ?? {},
    failureCategoryCounts: doc.failure_category_counts ?? {},
    issues: buildBenchmarkIssues(doc),
    publicIcps,
    aggregateFunnel: privateDiag?.aggregateFunnel ?? null,
    sourcingFailedCount: privateDiag?.sourcingFailedCount ?? 0,
    intentTypes: privateDiag?.intentTypes ?? [],
    discovery: privateDiag?.discovery ?? null,
    currentStatusAt: row.current_status_at || row.created_at,
    displayScore: {
      source: 'daily_rebenchmark',
      score: aggregateScore,
      scoreBand: aggregateScoreBand,
      statusAt: row.current_status_at || row.created_at,
      label: 'Daily rebenchmark',
      deltaVsDailyBaseline: null,
      baselineAggregateScore: aggregateScore,
      scoreBundleId: null,
      modelArtifactHash: null,
      privateModelVersionId: null,
    },
    activePromotedModel: null,
  }
}

async function fetchActivePromotedModelScore(
  supabase: ReturnType<typeof getSupabase>,
): Promise<ActivePromotedModelScore | null> {
  const { data: versionData, error: versionError } = await supabase
    .from('research_lab_private_model_version_current')
    .select('private_model_version_id, model_artifact_hash, source_score_bundle_id, current_version_status, current_status_at, git_commit_sha')
    .eq('current_version_status', 'active')
    .order('current_status_at', { ascending: false })
    .limit(1)

  if (versionError) {
    console.error('[Research Lab API] active model version query failed:', versionError)
    return null
  }

  const version = (versionData?.[0] ?? null) as PrivateModelVersionCurrentRow | null
  const scoreBundleId = version?.source_score_bundle_id ? String(version.source_score_bundle_id) : ''
  if (!version || !scoreBundleId) return null

  const { data: scoreData, error: scoreError } = await supabase
    .from('research_evaluation_score_bundle_current')
    .select('score_bundle_id, bundle_status, candidate_artifact_hash, score_bundle_doc, created_at')
    .eq('score_bundle_id', scoreBundleId)
    .limit(1)

  if (scoreError) {
    console.error('[Research Lab API] active model score bundle query failed:', scoreError)
    return null
  }

  const scoreRow = (scoreData?.[0] ?? null) as ScoreBundleCurrentRow | null
  const doc = scoreRow?.score_bundle_doc ?? {}
  const gate = doc.private_holdout_gate ?? {}
  const candidateTotal = numberOr(
    gate.candidate_total_score,
    numberOr(doc.aggregates?.candidate_score, NaN),
  )
  if (!Number.isFinite(candidateTotal) || candidateTotal <= 0) return null

  return {
    privateModelVersionId: String(version.private_model_version_id || ''),
    modelArtifactHash: String(version.model_artifact_hash || scoreRow?.candidate_artifact_hash || ''),
    scoreBundleId,
    score: candidateTotal,
    scoreBand: scoreBand(candidateTotal),
    promotedAt: version.current_status_at || scoreRow?.created_at || null,
    deltaVsDailyBaseline: nullableNumber(gate.candidate_delta_vs_daily_baseline),
    baselineAggregateScore: nullableNumber(gate.baseline_aggregate_score),
    gitCommitSha: version.git_commit_sha ? String(version.git_commit_sha) : null,
  }
}

function withBenchmarkDisplayScore(
  benchmark: NormalizedBenchmark,
  activePromotedModel: ActivePromotedModelScore | null,
): NormalizedBenchmark {
  const benchmarkTime = timestampOrZero(benchmark.currentStatusAt || benchmark.benchmarkDate)
  const promotedTime = timestampOrZero(activePromotedModel?.promotedAt)
  if (!activePromotedModel || promotedTime <= benchmarkTime) {
    return { ...benchmark, activePromotedModel }
  }

  return {
    ...benchmark,
    activePromotedModel,
    displayScore: {
      source: 'latest_promoted_model',
      score: activePromotedModel.score,
      scoreBand: activePromotedModel.scoreBand,
      statusAt: activePromotedModel.promotedAt,
      label: 'Latest promoted model',
      deltaVsDailyBaseline: activePromotedModel.deltaVsDailyBaseline,
      baselineAggregateScore: activePromotedModel.baselineAggregateScore,
      scoreBundleId: activePromotedModel.scoreBundleId,
      modelArtifactHash: activePromotedModel.modelArtifactHash,
      privateModelVersionId: activePromotedModel.privateModelVersionId,
    },
  }
}

// Read the matching private benchmark bundle (service-role only) and reduce it
// to: an anonymized aggregate funnel across ALL ICPs, a sourcing-failure count,
// and a per-ICP diagnostics map keyed by icp_ref (consumed only for revealed
// public ICPs). Returns null if unavailable — the rest of the report still works.
async function fetchPrivateDiagnostics(
  supabase: ReturnType<typeof getSupabase>,
  benchmarkDate: string,
): Promise<PrivateDiagnosticsBundle | null> {
  let query = supabase
    .from('research_lab_private_model_benchmark_current')
    .select('benchmark_date, created_at, benchmark_quality, score_summary_doc')
    .eq('benchmark_quality', 'passed')
    .order('created_at', { ascending: false })
    .limit(1)
  if (benchmarkDate) query = query.eq('benchmark_date', benchmarkDate)

  const { data, error } = await query
  if (error) {
    console.error('[Research Lab API] private bundle query failed:', error)
    return null
  }
  const row = (data?.[0] ?? null) as PrivateBundleRow | null
  if (!row?.score_summary_doc) return null

  const summaries = Array.isArray(row.score_summary_doc.per_icp_summaries)
    ? row.score_summary_doc.per_icp_summaries
    : []

  const aggregateFunnel: LeadFunnel = { sourced: 0, fit_pass: 0, verified: 0, intent_valid: 0, scored: 0 }
  let sourcingFailedCount = 0
  let scoredIcpCount = 0
  const byRef = new Map<string, PrivateIcpDiagnostics>()
  // Companies that PASSED each intent type (numerator), from per_signal.
  const fulfilledAcc = new Map<string, { fulfilled: number; signalsPassed: number; scoreSum: number }>()

  const discovery: DiscoverySummary = {
    totalIcps: 0, noCompanies: 0, weak: 0, healthy: 0,
    totalDiscovered: 0, totalScored: 0, floor: HEALTHY_DISCOVERY_FLOOR,
  }

  for (const summary of summaries) {
    const diag = summary?.diagnostics
    if (!diag) continue
    const ref = summary.icp_ref ? String(summary.icp_ref) : ''
    if (ref) byRef.set(ref, diag)

    // Discovery health counts every ICP, including sourcing failures.
    discovery.totalIcps += 1
    const srcCount = diag.sourcing_failed ? 0 : numberOr(diag.funnel?.sourced, 0)
    discovery.totalDiscovered += srcCount
    discovery.totalScored += diag.sourcing_failed ? 0 : numberOr(diag.funnel?.scored, 0)
    if (srcCount <= 0) discovery.noCompanies += 1
    else if (srcCount < HEALTHY_DISCOVERY_FLOOR) discovery.weak += 1
    else discovery.healthy += 1

    if (diag.sourcing_failed) {
      sourcingFailedCount += 1
      continue
    }
    scoredIcpCount += 1
    const f = diag.funnel ?? {}
    aggregateFunnel.sourced += numberOr(f.sourced, 0)
    aggregateFunnel.fit_pass += numberOr(f.fit_pass, 0)
    aggregateFunnel.verified += numberOr(f.verified, 0)
    aggregateFunnel.intent_valid += numberOr(f.intent_valid, 0)
    aggregateFunnel.scored += numberOr(f.scored, 0)

    for (const stat of Object.values(diag.per_signal ?? {})) {
      const type = (stat.evidence_type || 'UNSPECIFIED').toUpperCase()
      const entry = fulfilledAcc.get(type) ?? { fulfilled: 0, signalsPassed: 0, scoreSum: 0 }
      entry.fulfilled += numberOr(stat.companies_passed, 0)
      entry.signalsPassed += numberOr(stat.signals_passed, 0)
      entry.scoreSum += numberOr(stat.sum_score, 0)
      fulfilledAcc.set(type, entry)
    }
  }

  // Denominator: how many of ALL benchmark ICPs (incl. sourcing failures)
  // required each intent type — taken from the ICP definitions, so types the
  // model never passed (or only had in failed ICPs) still appear at their true %.
  const requiredByType = await fetchRequiredIntentCounts(
    supabase,
    summaries.map((s) => (s?.icp_ref ? String(s.icp_ref) : '')).filter(Boolean),
  )

  const allTypes = new Set<string>([...requiredByType.keys(), ...fulfilledAcc.keys()])
  const intentTypes: IntentTypeRollup[] = Array.from(allTypes)
    .map((evidence_type) => {
      const icpCount = requiredByType.get(evidence_type) ?? 0
      const f = fulfilledAcc.get(evidence_type) ?? { fulfilled: 0, signalsPassed: 0, scoreSum: 0 }
      const expected = HEALTHY_DISCOVERY_FLOOR * icpCount
      return {
        evidence_type,
        fulfilled: f.fulfilled,
        icp_count: icpCount,
        expected,
        pass_pct: expected > 0 ? Math.round((f.fulfilled / expected) * 100) : 0,
        avg_score: f.signalsPassed > 0 ? Math.round((f.scoreSum / f.signalsPassed) * 10) / 10 : 0,
      }
    })
    .sort((a, b) => b.pass_pct - a.pass_pct || b.icp_count - a.icp_count)

  return { aggregateFunnel, sourcingFailedCount, scoredIcpCount, intentTypes, discovery, byRef }
}

// Count, per intent/evidence type, how many benchmark ICPs required it — read
// from the ICP definitions (intent_category + bonus_intents) for ALL ICPs in
// the run, so the pass-rate denominator reflects every ICP, not just scored ones.
async function fetchRequiredIntentCounts(
  supabase: ReturnType<typeof getSupabase>,
  icpRefs: string[],
): Promise<Map<string, number>> {
  const setIds = new Set<string>()
  const refToIcpId = new Map<string, string>()
  for (const ref of icpRefs) {
    const parts = ref.split(':') // qualification_private_icp_sets:<set_id>:<icp_id>
    if (parts.length >= 3) {
      setIds.add(parts[1])
      refToIcpId.set(ref, parts[2])
    }
  }
  const counts = new Map<string, number>()
  if (setIds.size === 0) return counts

  const { data, error } = await supabase
    .from('qualification_private_icp_sets')
    .select('set_id, icps')
    .in('set_id', Array.from(setIds))
  if (error) {
    console.error('[Research Lab API] icp set query failed:', error)
    return counts
  }

  type RawIcp = { icp_id?: string; intent_category?: string; bonus_intents?: { intent_category?: string }[] }
  const icpIdToTypes = new Map<string, Set<string>>()
  for (const row of (data ?? []) as { icps?: RawIcp[] }[]) {
    for (const icp of row.icps ?? []) {
      const id = String(icp.icp_id || '')
      if (!id) continue
      const types = new Set<string>()
      const primary = String(icp.intent_category || '').toUpperCase().trim()
      if (primary) types.add(primary)
      for (const bonus of icp.bonus_intents ?? []) {
        const bc = String(bonus?.intent_category || '').toUpperCase().trim()
        if (bc) types.add(bc)
      }
      icpIdToTypes.set(id, types)
    }
  }

  // Each ICP contributes +1 to every distinct intent type it requires.
  for (const icpId of refToIcpId.values()) {
    for (const type of icpIdToTypes.get(icpId) ?? []) {
      counts.set(type, (counts.get(type) ?? 0) + 1)
    }
  }
  return counts
}

function attachPrivateDiagnostics(
  icps: PublicIcpEntry[],
  privateDiag: PrivateDiagnosticsBundle | null,
): PublicIcpEntry[] {
  if (!privateDiag) return icps
  return icps.map((icp) => {
    const ref = icp.icp_ref ? String(icp.icp_ref) : ''
    const diag = ref ? privateDiag.byRef.get(ref) : undefined
    if (!diag) return icp
    return {
      ...icp,
      diagnostics: {
        ...icp.diagnostics,
        sourcing_failed: diag.sourcing_failed,
        funnel: normalizeFunnel(diag.funnel),
        per_signal: normalizePerSignal(diag.per_signal),
        rejection_reasons: normalizeReasons(diag.rejection_reasons),
      },
    }
  })
}

// Apply numeric defaults so the UI never renders "undefined" if the stored
// per-signal blob is missing fields (mirrors normalizeFunnel for funnel).
function normalizePerSignal(
  per: Record<string, PerSignalStat> | undefined,
): Record<string, PerSignalStat> | undefined {
  if (!per) return undefined
  const out: Record<string, PerSignalStat> = {}
  for (const [key, stat] of Object.entries(per)) {
    out[key] = {
      signal_index: numberOr(stat?.signal_index, Number(key) || 0),
      evidence_type: String(stat?.evidence_type || 'UNSPECIFIED'),
      companies_submitted: numberOr(stat?.companies_submitted, 0),
      companies_passed: numberOr(stat?.companies_passed, 0),
      signals_submitted: numberOr(stat?.signals_submitted, 0),
      signals_passed: numberOr(stat?.signals_passed, 0),
      avg_score: numberOr(stat?.avg_score, 0),
      sum_score: numberOr(stat?.sum_score, 0),
      max_score: numberOr(stat?.max_score, 0),
    }
  }
  return out
}

function normalizeReasons(
  reasons: Record<string, number> | undefined,
): Record<string, number> | undefined {
  if (!reasons) return undefined
  const out: Record<string, number> = {}
  for (const [key, value] of Object.entries(reasons)) out[key] = numberOr(value, 0)
  return out
}

function normalizeFunnel(funnel: Partial<LeadFunnel> | undefined): LeadFunnel | undefined {
  if (!funnel) return undefined
  return {
    sourced: numberOr(funnel.sourced, 0),
    fit_pass: numberOr(funnel.fit_pass, 0),
    verified: numberOr(funnel.verified, 0),
    intent_valid: numberOr(funnel.intent_valid, 0),
    scored: numberOr(funnel.scored, 0),
  }
}

function buildBenchmarkIssues(doc: PublicBenchmarkReportDoc): BenchmarkIssue[] {
  const counts = new Map<string, number>()
  const icpsByIssue = new Map<string, ModelIssueIcpEntry[]>()

  const explicitIssueCounts = doc.model_issue_counts
  if (!explicitIssueCounts || Object.keys(explicitIssueCounts).length === 0) {
    return []
  }
  for (const [key, count] of Object.entries(explicitIssueCounts)) {
    addIssueCount(counts, key, count)
    const rows = Array.isArray(doc.model_issue_public_icps?.[key])
      ? doc.model_issue_public_icps[key]
      : []
    for (const row of rows) {
      appendIssueIcp(icpsByIssue, key, issueIcpEntry(row))
    }
  }

  return Array.from(counts.entries())
    .map(([key, count]) => issueForKey(key, count, icpsByIssue.get(key) ?? []))
    .filter((issue) => issue.count > 0)
    .sort((a, b) => b.count - a.count || severityRank(a.severity) - severityRank(b.severity) || a.label.localeCompare(b.label))
    .slice(0, 8)
}

function addIssueCount(counts: Map<string, number>, key: string, value: unknown) {
  const count = Math.max(0, Math.round(numberOr(value, 0)))
  if (!key || count <= 0) return
  counts.set(key, (counts.get(key) ?? 0) + count)
}

function appendIssueIcp(
  icpsByIssue: Map<string, ModelIssueIcpEntry[]>,
  key: string,
  row: ModelIssueIcpEntry
) {
  const rows = icpsByIssue.get(key) ?? []
  const rowKey = row.icp_ref || row.icp_hash || String(row.item_rank ?? '')
  if (
    !rowKey ||
    rows.some((existing) => (existing.icp_ref || existing.icp_hash || String(existing.item_rank ?? '')) === rowKey)
  ) {
    icpsByIssue.set(key, rows)
    return
  }
  rows.push(row)
  rows.sort((a, b) => numberOr(a.item_rank, 0) - numberOr(b.item_rank, 0))
  icpsByIssue.set(key, rows)
}

function issueIcpEntry(value: ModelIssueIcpEntry): ModelIssueIcpEntry {
  return {
    item_rank: numberOr(value.item_rank, 0),
    icp_ref: value.icp_ref ? String(value.icp_ref) : '',
    icp_hash: value.icp_hash ? String(value.icp_hash) : '',
    set_id: value.set_id === undefined ? undefined : numberOr(value.set_id, 0),
    day_index: value.day_index === undefined ? undefined : numberOr(value.day_index, 0),
    day_rank: value.day_rank === undefined ? undefined : numberOr(value.day_rank, 0),
    industry_bucket: value.industry_bucket ? String(value.industry_bucket) : undefined,
    score: value.score === undefined ? undefined : numberOr(value.score, 0),
    company_count: value.company_count === undefined ? undefined : numberOr(value.company_count, 0),
  }
}

function issueForKey(key: string, count: number, icps: ModelIssueIcpEntry[]): BenchmarkIssue {
  const normalized = key.toLowerCase()
  if (normalized.includes('hallucinated') || normalized.includes('generic_intent')) {
    return {
      key,
      count,
      label: 'Generic or hallucinated intent',
      severity: 'high',
      description: 'Intent evidence looked fabricated, generic, hardcoded, or not tied closely enough to the ICP.',
      icps,
    }
  }
  if (normalized.includes('stale') || normalized.includes('date') || normalized.includes('freshness')) {
    return {
      key,
      count,
      label: 'Stale or invalid timing',
      severity: 'high',
      description: 'Intent evidence did not appear recent enough or had invalid/future-dated timing.',
      icps,
    }
  }
  if (normalized.includes('low_intent')) {
    return {
      key,
      count,
      label: 'Weak intent match',
      severity: 'medium',
      description: 'The model found companies, but the buying-intent signal was too weak or indirect.',
      icps,
    }
  }
  if (normalized.includes('low_icp') || normalized.includes('icp_or_geo')) {
    return {
      key,
      count,
      label: 'ICP mismatch',
      severity: 'medium',
      description: 'The returned company did not match the target industry, geography, company size, or role profile closely enough.',
      icps,
    }
  }
  if (normalized.includes('zero')) {
    return {
      key,
      count,
      label: 'No companies returned',
      severity: 'medium',
      description: 'The model returned no usable companies for that ICP.',
      icps,
    }
  }
  if (normalized.includes('company_verification')) {
    return {
      key,
      count,
      label: 'Company verification failed',
      severity: 'medium',
      description: 'The company identity or website could not be verified reliably.',
      icps,
    }
  }
  if (normalized.includes('source') || normalized.includes('url') || normalized.includes('fetch')) {
    return {
      key,
      count,
      label: 'Source fetch failed',
      severity: 'low',
      description: 'The model relied on a source that could not be fetched or verified cleanly.',
      icps,
    }
  }
  if (normalized.includes('parser') || normalized.includes('json') || normalized.includes('llm')) {
    return {
      key,
      count,
      label: 'Scoring format issue',
      severity: 'low',
      description: 'The response could not be parsed or scored cleanly.',
      icps,
    }
  }
  return {
    key,
    count,
    label: readableIssueLabel(key),
    severity: 'low',
    description: 'A sanitized benchmark issue was recorded for this model run.',
    icps,
  }
}

function severityRank(severity: BenchmarkIssue['severity']): number {
  if (severity === 'high') return 0
  if (severity === 'medium') return 1
  return 2
}

function readableIssueLabel(value: string): string {
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function stripInternalIcpFields(icps: PublicIcpEntry[]): PublicIcpEntry[] {
  return icps.map((icp) => {
    const publicIcp = { ...icp }
    delete publicIcp.strength_label
    return publicIcp
  })
}

async function fetchLabMinerSpend(supabase: ReturnType<typeof getSupabase>): Promise<LabMinerSpendRollup> {
  const empty = emptyLabMinerSpend()
  const [scheduleResult, allAwardsResult, allocationResult] = await Promise.all([
    supabase
      .from('research_reimbursement_schedules')
      .select('award_id, schedule_status, start_epoch, epoch_count, total_microusd')
      .eq('schedule_status', 'scheduled')
      .order('start_epoch', { ascending: false, nullsFirst: false })
      .limit(5_000),
    supabase
      .from('research_reimbursement_awards')
      .select('award_id, miner_hotkey, eligible_cost_microusd, target_reimbursement_microusd, reimbursement_epochs')
      .limit(5_000),
    supabase
      .from('research_lab_emission_allocation_snapshots')
      .select('epoch, allocation_doc, created_at')
      .order('epoch', { ascending: true, nullsFirst: false })
      .limit(5_000),
  ])

  if (scheduleResult.error) {
    console.error('[Research Lab API] reimbursement schedule query failed:', scheduleResult.error)
  }
  if (allAwardsResult.error) {
    console.error('[Research Lab API] all-time reimbursement award query failed:', allAwardsResult.error)
  }
  if (allocationResult.error) {
    console.error('[Research Lab API] emission allocation snapshot query failed:', allocationResult.error)
  }

  const allTime = buildLabMinerAllTimeRollup(
    (allAwardsResult.data ?? []) as ReimbursementAwardRow[],
    (allocationResult.data ?? []) as EmissionAllocationSnapshotRow[]
  )
  const allocationSnapshots = (allocationResult.data ?? []) as EmissionAllocationSnapshotRow[]
  const latestPublishedWeightEpoch = await fetchLatestPublishedWeightEpoch(supabase)
  const currentAllocation = await fetchCurrentLabAllocation(
    supabase,
    latestPublishedWeightEpoch,
    allocationSnapshots,
  )

  if (scheduleResult.error) return { ...empty, allTime, currentAllocation }

  const schedules = ((scheduleResult.data ?? []) as ReimbursementScheduleRow[])
    .filter((row) => row.award_id && Number.isFinite(Number(row.start_epoch)))
  if (schedules.length === 0) return { ...empty, allTime, currentAllocation }

  const latestEpoch = Math.max(...schedules.map((row) => numberOr(row.start_epoch, 0)))
  const activeSchedules = schedules.filter((row) => {
    const startEpoch = numberOr(row.start_epoch, 0)
    const epochCount = Math.max(1, Math.round(numberOr(row.epoch_count, 1)))
    return startEpoch <= latestEpoch && latestEpoch <= startEpoch + epochCount - 1
  })
  if (activeSchedules.length === 0) {
    return {
      window: { latestEpoch, epochCount: null, activeScheduleCount: 0 },
      byHotkey: {},
      allTime,
      currentAllocation,
    }
  }

  const awardIds = Array.from(new Set(activeSchedules.map((row) => row.award_id).filter(Boolean))) as string[]
  const awardRows: ReimbursementAwardRow[] = []
  for (let i = 0; i < awardIds.length; i += 100) {
    const batch = awardIds.slice(i, i + 100)
    const { data: awardData, error: awardError } = await supabase
      .from('research_reimbursement_award_current')
      .select('award_id, miner_hotkey, eligible_cost_microusd, target_reimbursement_microusd, reimbursement_epochs')
      .in('award_id', batch)

    if (awardError) {
      console.error('[Research Lab API] reimbursement award query failed:', awardError)
      return {
        window: spendWindowForSchedules(latestEpoch, activeSchedules),
        byHotkey: {},
        allTime,
        currentAllocation,
      }
    }
    awardRows.push(...((awardData ?? []) as ReimbursementAwardRow[]))
  }

  const awardsById = new Map(awardRows.map((award) => [award.award_id, award]))
  const byHotkey: Record<string, LabMinerSpendEntry> = {}
  for (const schedule of activeSchedules) {
    if (!schedule.award_id) continue
    const award = awardsById.get(schedule.award_id)
    if (!award) continue
    const hotkey = award.miner_hotkey ? String(award.miner_hotkey) : ''
    if (!hotkey) continue

    const current = byHotkey[hotkey] ?? {
      computeSpendUsd: 0,
      scheduledReimbursementUsd: 0,
      activeAwardCount: 0,
      reimbursementEpochs: null,
    }
    current.computeSpendUsd += microusdToUsd(award.eligible_cost_microusd)
    current.scheduledReimbursementUsd += microusdToUsd(
      award.target_reimbursement_microusd ?? schedule.total_microusd
    )
    current.activeAwardCount += 1
    current.reimbursementEpochs = Math.max(
      current.reimbursementEpochs ?? 0,
      Math.round(numberOr(award.reimbursement_epochs ?? schedule.epoch_count, 0))
    ) || current.reimbursementEpochs
    byHotkey[hotkey] = current
  }

  return {
    window: spendWindowForSchedules(latestEpoch, activeSchedules),
    byHotkey: Object.fromEntries(
      Object.entries(byHotkey).map(([hotkey, entry]) => [
        hotkey,
        {
          ...entry,
          computeSpendUsd: roundUsd(entry.computeSpendUsd),
          scheduledReimbursementUsd: roundUsd(entry.scheduledReimbursementUsd),
        },
      ])
    ),
    allTime,
    currentAllocation,
  }
}

async function fetchLatestPublishedWeightEpoch(
  supabase: ReturnType<typeof getSupabase>,
): Promise<number | null> {
  const { data, error } = await supabase
    .from('published_weight_bundles')
    .select('epoch_id')
    .eq('netuid', 71)
    .order('epoch_id', { ascending: false, nullsFirst: false })
    .limit(1)

  if (error) {
    console.error('[Research Lab API] published weight epoch query failed:', error)
    return null
  }
  const epoch = numberOr((data?.[0] as { epoch_id?: unknown } | undefined)?.epoch_id, NaN)
  return Number.isFinite(epoch) ? epoch : null
}

async function fetchCurrentLabAllocation(
  supabase: ReturnType<typeof getSupabase>,
  latestPublishedWeightEpoch: number | null,
  snapshots: EmissionAllocationSnapshotRow[],
): Promise<ResearchLabEmissionAllocationRollup> {
  if (latestPublishedWeightEpoch !== null) {
    const row = await fetchCurrentLabAllocationRow(supabase, latestPublishedWeightEpoch)
    if (row) return buildResearchLabAllocationRollup(row, 'latest_weight_epoch')
  }

  const latestCurrentRow = await fetchCurrentLabAllocationRow(supabase, null)
  if (latestCurrentRow) return buildResearchLabAllocationRollup(latestCurrentRow, 'latest_allocation_current')

  const latestSnapshot = snapshots
    .slice()
    .sort((a, b) => numberOr(b.epoch, -Infinity) - numberOr(a.epoch, -Infinity))[0]
  if (latestSnapshot) {
    return buildResearchLabAllocationRollup(latestSnapshot, 'latest_allocation_snapshot')
  }

  return buildResearchLabAllocationRollup(null, 'none')
}

async function fetchCurrentLabAllocationRow(
  supabase: ReturnType<typeof getSupabase>,
  epoch: number | null,
): Promise<ResearchLabEmissionAllocationSnapshot | null> {
  let query = supabase
    .from('research_lab_emission_allocation_current')
    .select('*')
    .order('epoch', { ascending: false, nullsFirst: false })
    .limit(1)

  if (epoch !== null) query = query.eq('epoch', epoch)

  const { data, error } = await query
  if (error) {
    console.error('[Research Lab API] current emission allocation query failed:', error)
    return null
  }

  const row = data?.[0] as ResearchLabEmissionAllocationSnapshot | undefined
  return row ?? null
}

function buildLabMinerAllTimeRollup(
  awards: ReimbursementAwardRow[],
  snapshots: EmissionAllocationSnapshotRow[],
): LabMinerAllTimeRollup {
  const byHotkey: Record<string, LabMinerAllTimeEntry> = {}
  for (const award of awards) {
    const hotkey = award.miner_hotkey ? String(award.miner_hotkey) : ''
    if (!hotkey) continue
    const current = byHotkey[hotkey] ?? emptyLabMinerAllTimeEntry()
    current.computeSpendUsd += microusdToUsd(award.eligible_cost_microusd)
    current.scheduledReimbursementUsd += microusdToUsd(award.target_reimbursement_microusd)
    current.awardCount += 1
    current.reimbursementEpochs = Math.max(
      current.reimbursementEpochs ?? 0,
      Math.round(numberOr(award.reimbursement_epochs, 0))
    ) || current.reimbursementEpochs
    byHotkey[hotkey] = current
  }

  const epochs = snapshots
    .map((snapshot) => numberOr(snapshot.epoch, NaN))
    .filter((epoch) => Number.isFinite(epoch))
  for (const snapshot of snapshots) {
    const doc = snapshot.allocation_doc ?? {}
    for (const allocation of researchLabAllocationEntries(doc)) {
      const hotkey = allocation.miner_hotkey ? String(allocation.miner_hotkey) : ''
      if (!hotkey) continue
      const current = byHotkey[hotkey] ?? emptyLabMinerAllTimeEntry()
      current.alphaEarned += numberOr(allocation.paid_alpha_percent ?? allocation.alpha_percent, 0)
      current.alphaAllocationCount += 1
      byHotkey[hotkey] = current
    }
  }

  return {
    firstEpoch: epochs.length ? Math.min(...epochs) : null,
    latestEpoch: epochs.length ? Math.max(...epochs) : null,
    allocationSnapshotCount: snapshots.length,
    byHotkey: Object.fromEntries(
      Object.entries(byHotkey).map(([hotkey, entry]) => [
        hotkey,
        {
          ...entry,
          alphaEarned: roundAlpha(entry.alphaEarned),
          computeSpendUsd: roundUsd(entry.computeSpendUsd),
          scheduledReimbursementUsd: roundUsd(entry.scheduledReimbursementUsd),
        },
      ])
    ),
  }
}

function emptyLabMinerAllTimeEntry(): LabMinerAllTimeEntry {
  return {
    alphaEarned: 0,
    computeSpendUsd: 0,
    scheduledReimbursementUsd: 0,
    awardCount: 0,
    reimbursementEpochs: null,
    alphaAllocationCount: 0,
  }
}

async function fetchPublicLoops(
  supabase: ReturnType<typeof getSupabase>,
  limit = LOOP_LIMIT,
  fetchLimit = LOOP_FETCH_LIMIT,
): Promise<NormalizedLoop[]> {
  const { data, error } = await supabase
    .from('research_lab_public_loop_card_current')
    .select('*')
    .order('current_last_activity_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(fetchLimit)

  if (error) {
    console.error('[Research Lab API] public loop query failed:', error)
    return []
  }

  return ((data ?? []) as PublicLoopRow[])
    .filter(isVisiblePublicLoop)
    .slice(0, limit)
    .map((row) => {
      const projectedOutcomeLabel = row.current_outcome_label || 'submitted'
      const projectedOutcomeBand = row.current_outcome_band || 'pending'
      const doc = row.current_event_doc ?? {}
      const improvementGate = objectRecord(doc.improvement_gate) ?? objectRecord(doc.improvementGate)
      const promotionDoc = objectRecord(doc.promotion)
      const lastActivityAt = row.current_last_activity_at || row.created_at
      const candidateCount = numberOr(row.current_candidate_count, 0)
      const scoredCandidateCount = numberOr(row.current_scored_candidate_count, 0)
      const publicStatus =
        stringOr(row.public_status) ??
        stringOr(row.current_public_status) ??
        stringOr(doc.public_status) ??
        stringOr(doc.current_public_status)
      const paymentState =
        stringOr(row.payment_state) ??
        stringOr(row.current_payment_state) ??
        stringOr(doc.payment_state) ??
        stringOr(doc.current_payment_state)
      const executionState =
        stringOr(row.execution_state) ??
        stringOr(row.current_execution_state) ??
        stringOr(doc.execution_state) ??
        stringOr(doc.current_execution_state)
      const candidateState =
        stringOr(row.candidate_state) ??
        stringOr(row.current_candidate_state) ??
        stringOr(doc.candidate_state) ??
        stringOr(doc.current_candidate_state)
      const resultState =
        stringOr(row.result_state) ??
        stringOr(row.current_result_state) ??
        stringOr(doc.result_state) ??
        stringOr(doc.current_result_state)
      const opsReason =
        stringOr(row.ops_reason) ??
        stringOr(row.current_ops_reason) ??
        stringOr(doc.ops_reason) ??
        stringOr(doc.current_ops_reason)
      const statusDetail =
        stringOr(row.status_detail) ??
        stringOr(row.current_status_detail) ??
        stringOr(doc.status_detail) ??
        stringOr(doc.current_status_detail)
      const opsWarningsSource =
        row.ops_warnings ??
        row.current_ops_warnings ??
        doc.ops_warnings ??
        doc.current_ops_warnings
      const opsWarnings = warningStrings(opsWarningsSource)
      const improvementGateDecision =
        stringOr(row.improvement_gate_decision) ??
        stringOr(row.current_improvement_gate_decision) ??
        stringOr(doc.improvement_gate_decision) ??
        stringOr(doc.current_improvement_gate_decision) ??
        stringOr(improvementGate?.decision)
      const promotionStatus =
        stringOr(row.promotion_status) ??
        stringOr(row.current_promotion_status) ??
        stringOr(doc.promotion_status) ??
        stringOr(doc.current_promotion_status) ??
        stringOr(promotionDoc?.status)
      const promotionEventType =
        stringOr(row.promotion_event_type) ??
        stringOr(row.current_promotion_event_type) ??
        stringOr(doc.promotion_event_type) ??
        stringOr(doc.current_promotion_event_type) ??
        stringOr(promotionDoc?.event_type)
      const promotionEvent =
        stringOr(row.promotion_event) ??
        stringOr(row.current_promotion_event) ??
        stringOr(doc.promotion_event) ??
        stringOr(doc.current_promotion_event) ??
        stringOr(promotionDoc?.event)
      const eventType =
        stringOr(row.event_type) ??
        stringOr(row.current_event_type) ??
        stringOr(doc.event_type) ??
        stringOr(doc.current_event_type)
      const displayStatus = deriveResearchLabLoopStatus({
        publicStatus,
        paymentState,
        executionState,
        candidateState,
        resultState,
        opsReason,
        statusDetail,
        opsWarnings,
        outcomeLabel: projectedOutcomeLabel,
        outcomeBand: projectedOutcomeBand,
        runId: row.current_run_id,
        receiptId: row.current_receipt_id,
        candidateCount,
        scoredCandidateCount,
        currentCandidateStatus:
          row.current_candidate_status ??
          stringOr(doc.current_candidate_status) ??
          stringOr(doc.candidate_status) ??
          dominantCountKey(doc.candidate_status_counts),
        currentReason:
          row.current_reason ??
          stringOr(doc.current_reason) ??
          stringOr(doc.candidate_reason) ??
          dominantCountKey(doc.candidate_reason_counts) ??
          doc.projection_reason,
        currentQueueStatus: row.current_queue_status ?? doc.queue_status,
        currentReceiptStatus: row.current_receipt_status ?? doc.receipt_status,
        currentStatus: row.current_status,
        improvementGateDecision,
        promotionStatus,
        promotionEventType,
        promotionEvent,
        eventType,
      })
      return {
        cardId: row.card_id,
        ticketId: row.ticket_id,
        runId: row.current_run_id,
        receiptId: row.current_receipt_id,
        minerHotkey: row.miner_hotkey,
        researchArea: row.research_area || 'generalist',
        researchFocusSummary: row.research_focus_summary || '',
        topicTags: arrayOfStrings(row.current_topic_tags ?? row.topic_tags),
        topicSignatureHash: row.current_topic_signature_hash || row.topic_signature_hash,
        outcomeLabel: projectedOutcomeLabel,
        publicStatus,
        paymentState,
        executionState,
        candidateState,
        resultState,
        opsReason,
        statusDetail,
        opsWarnings,
        statusKey: displayStatus.key,
        statusLabel: displayStatus.label,
        outcomeBand: displayStatus.band,
        candidateCount,
        scoredCandidateCount,
        bestCandidatePublicSummary: row.current_best_candidate_public_summary || '',
        lastActivityAt,
        submittedAt: row.created_at,
        statusNote: displayStatus.note,
      }
    })
}

function isVisiblePublicLoop(row: PublicLoopRow): boolean {
  return !HIDDEN_LOOP_MINER_PREFIXES.some((prefix) => row.miner_hotkey.startsWith(prefix))
}

function groupLoopsByTopic(loops: NormalizedLoop[]): TopicGroup[] {
  const groups = new Map<string, TopicGroup>()
  for (const loop of loops) {
    const key = loop.topicSignatureHash || loop.topicTags.join('|') || 'unknown'
    const group = groups.get(key) ?? {
      topicSignatureHash: key,
      topicTags: loop.topicTags.length ? loop.topicTags : ['unknown'],
      total: 0,
      running: 0,
      completed: 0,
      scored: 0,
      promisingOrPromoted: 0,
      noGainOrFailed: 0,
      latestActivityAt: loop.lastActivityAt,
    }
    group.total += 1
    if (isActiveResearchLabLoopStatus(loop.statusKey)) group.running += 1
    if (isCompletedResearchLabLoopStatus(loop.statusKey)) {
      group.completed += 1
    }
    if (isScoredResearchLabLoopStatus(loop.statusKey)) group.scored += 1
    if (isPromisingResearchLabLoopStatus(loop.statusKey, loop.outcomeBand)) group.promisingOrPromoted += 1
    if (isNoGainOrFailedResearchLabLoopStatus(loop.statusKey)) group.noGainOrFailed += 1
    if (new Date(loop.lastActivityAt).getTime() > new Date(group.latestActivityAt).getTime()) {
      group.latestActivityAt = loop.lastActivityAt
    }
    groups.set(key, group)
  }
  return Array.from(groups.values()).sort(
    (a, b) => new Date(b.latestActivityAt).getTime() - new Date(a.latestActivityAt).getTime()
  )
}

function buildLabMinerActivityRollup(loops: NormalizedLoop[]): LabMinerActivityRollup {
  const windowStartedAt = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const allTime: Record<string, LabMinerActivityEntry> = {}
  const last24h: Record<string, LabMinerActivityEntry> = {}
  for (const loop of loops) {
    addLabMinerActivityEntry(allTime, loop)
    if (new Date(loop.lastActivityAt).getTime() >= new Date(windowStartedAt).getTime()) {
      addLabMinerActivityEntry(last24h, loop)
    }
  }
  return { windowStartedAt, allTime, last24h }
}

function countPromisingLoopsWithTemporaryOverrides(loops: NormalizedLoop[]): number {
  const actualByHotkey = new Map<string, number>()
  const hotkeys = new Set<string>()
  let total = 0
  for (const loop of loops) {
    const hotkey = loop.minerHotkey
    if (hotkey) hotkeys.add(hotkey)
    if (!isPromisingResearchLabLoopStatus(loop.statusKey, loop.outcomeBand)) continue
    total += 1
    if (hotkey) actualByHotkey.set(hotkey, (actualByHotkey.get(hotkey) ?? 0) + 1)
  }
  for (const hotkey of hotkeys) {
    const override = researchLabTemporaryImprovementOverride(hotkey)
    if (override <= 0) continue
    total += Math.max(0, override - (actualByHotkey.get(hotkey) ?? 0))
  }
  return total
}

function addLabMinerActivityEntry(
  rollup: Record<string, LabMinerActivityEntry>,
  loop: NormalizedLoop,
) {
  const hotkey = loop.minerHotkey
  if (!hotkey) return
  const current = rollup[hotkey] ?? {
    count: 0,
    active: 0,
    scored: 0,
    promising: 0,
    lastActivityAt: loop.lastActivityAt,
  }
  current.count += 1
  if (isActiveResearchLabLoopStatus(loop.statusKey)) current.active += 1
  if (isScoredResearchLabLoopStatus(loop.statusKey)) current.scored += 1
  if (isPromisingResearchLabLoopStatus(loop.statusKey, loop.outcomeBand)) current.promising += 1
  current.promising = Math.max(current.promising, researchLabTemporaryImprovementOverride(hotkey))
  if (new Date(loop.lastActivityAt).getTime() > new Date(current.lastActivityAt).getTime()) {
    current.lastActivityAt = loop.lastActivityAt
  }
  rollup[hotkey] = current
}

function emptyLabMinerSpend(): LabMinerSpendRollup {
  return {
    window: {
      latestEpoch: null,
      epochCount: null,
      activeScheduleCount: 0,
    },
    byHotkey: {},
    allTime: {
      firstEpoch: null,
      latestEpoch: null,
      allocationSnapshotCount: 0,
      byHotkey: {},
    },
    currentAllocation: buildResearchLabAllocationRollup(null, 'none'),
  }
}

function spendWindowForSchedules(
  latestEpoch: number,
  schedules: ReimbursementScheduleRow[],
): LabMinerSpendWindow {
  const epochCounts = schedules
    .map((row) => Math.max(1, Math.round(numberOr(row.epoch_count, 0))))
    .filter((value) => value > 0)
  return {
    latestEpoch,
    epochCount: epochCounts.length > 0 ? Math.max(...epochCounts) : null,
    activeScheduleCount: schedules.length,
  }
}

function microusdToUsd(value: unknown): number {
  return Math.max(0, numberOr(value, 0) / 1_000_000)
}

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}

function roundAlpha(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}

function numberOr(value: unknown, fallback: number): number {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

function nullableNumber(value: unknown): number | null {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function timestampOrZero(value: unknown): number {
  if (typeof value !== 'string' || !value.trim()) return 0
  const time = new Date(value).getTime()
  return Number.isFinite(time) ? time : 0
}

function arrayOfStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0)
}

function warningStrings(value: unknown): string[] {
  if (!value) return []
  const values = Array.isArray(value) ? value : [value]
  return values
    .map((item) => {
      if (typeof item === 'string') return item.trim()
      if (typeof item === 'number' || typeof item === 'boolean') return String(item)
      if (!item || typeof item !== 'object') return ''
      const record = item as Record<string, unknown>
      return stringOr(record.detail) ??
        stringOr(record.message) ??
        stringOr(record.reason) ??
        stringOr(record.code) ??
        stringOr(record.label) ??
        JSON.stringify(record)
    })
    .map((item) => item.trim())
    .filter(Boolean)
}

function stringOr(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function dominantCountKey(counts: Record<string, number> | undefined): string | undefined {
  if (!counts) return undefined
  let bestKey = ''
  let bestCount = 0
  for (const [key, value] of Object.entries(counts)) {
    const count = numberOr(value, 0)
    if (key && count > bestCount) {
      bestKey = key
      bestCount = count
    }
  }
  return bestKey || undefined
}

function scoreBand(score: number): string {
  if (score >= 80) return '80_plus'
  if (score >= 60) return '60_79'
  if (score >= 40) return '40_59'
  if (score > 0) return '1_39'
  return 'zero'
}
