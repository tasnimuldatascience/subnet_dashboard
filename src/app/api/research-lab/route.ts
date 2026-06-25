import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const CACHE_TTL = 60_000
const LOOP_LIMIT = 50

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
  visibility_split?: {
    split_policy?: string
    public_count?: number
    private_count?: number
    public_strength_counts?: Record<string, number>
    private_strength_counts?: Record<string, number>
  }
  public_icps?: PublicIcpEntry[]
  icp_buckets?: unknown[]
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
  }
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
  created_at: string
}

type ResearchLabPayload = {
  benchmark: NormalizedBenchmark | null
  loops: NormalizedLoop[]
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
  visibilitySplit: NonNullable<PublicBenchmarkReportDoc['visibility_split']>
  publicIcps: PublicIcpEntry[]
  currentStatusAt: string | null
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

let cache: CachedResponse | null = null

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SECRET_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) {
    throw new Error('Supabase environment variables are not configured')
  }
  return createClient(url, key, { auth: { persistSession: false } })
}

export async function GET() {
  try {
    if (cache && Date.now() - cache.ts < CACHE_TTL) {
      return NextResponse.json({ success: true, data: cache.data })
    }

    const supabase = getSupabase()
    const [benchmark, loops] = await Promise.all([
      fetchLatestBenchmark(supabase),
      fetchPublicLoops(supabase),
    ])
    const topicGroups = groupLoopsByTopic(loops)
    const data: ResearchLabPayload = {
      benchmark,
      loops,
      topicGroups,
      stats: {
        activeLoopCount: loops.filter((loop) => ['queued', 'running', 'scoring'].includes(loop.outcomeLabel)).length,
        scoredLoopCount: loops.filter((loop) => loop.scoredCandidateCount > 0).length,
        promisingLoopCount: loops.filter((loop) =>
          ['small_gain', 'passed_threshold', 'promoted'].includes(loop.outcomeBand)
        ).length,
        publicIcpCount: benchmark?.publicIcpCount ?? 0,
        totalBenchmarkIcpCount: benchmark?.itemCount ?? 0,
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
  const publicIcps = Array.isArray(doc.public_icps) ? doc.public_icps : []
  const itemCount = numberOr(doc.item_count, publicIcps.length + numberOr(doc.private_holdout_icp_count, 0))

  return {
    reportId: row.report_id,
    benchmarkDate: String(doc.benchmark_date || row.benchmark_date),
    rollingWindowHash: String(doc.rolling_window_hash || row.rolling_window_hash),
    aggregateScore: numberOr(doc.aggregate_score, row.aggregate_score),
    aggregateScoreBand: String(doc.aggregate_score_band || scoreBand(numberOr(doc.aggregate_score, row.aggregate_score))),
    itemCount,
    publicIcpCount: numberOr(doc.public_icp_count, publicIcps.length),
    privateHoldoutIcpCount: numberOr(doc.private_holdout_icp_count, Math.max(0, itemCount - publicIcps.length)),
    scoreBandCounts: doc.score_band_counts ?? {},
    failureCategoryCounts: doc.failure_category_counts ?? {},
    visibilitySplit: doc.visibility_split ?? {},
    publicIcps,
    currentStatusAt: row.current_status_at || row.created_at,
  }
}

async function fetchPublicLoops(supabase: ReturnType<typeof getSupabase>): Promise<NormalizedLoop[]> {
  const { data, error } = await supabase
    .from('research_lab_public_loop_card_current')
    .select('card_id, ticket_id, miner_hotkey, research_area, research_focus_summary, topic_tags, topic_signature_hash, current_topic_tags, current_topic_signature_hash, current_outcome_label, current_outcome_band, current_candidate_count, current_scored_candidate_count, current_best_candidate_public_summary, current_last_activity_at, current_run_id, current_receipt_id, created_at')
    .order('current_last_activity_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(LOOP_LIMIT)

  if (error) {
    console.error('[Research Lab API] public loop query failed:', error)
    return []
  }

  return ((data ?? []) as PublicLoopRow[]).map((row) => ({
    cardId: row.card_id,
    ticketId: row.ticket_id,
    runId: row.current_run_id,
    receiptId: row.current_receipt_id,
    minerHotkey: row.miner_hotkey,
    researchArea: row.research_area || 'generalist',
    researchFocusSummary: row.research_focus_summary || '',
    topicTags: arrayOfStrings(row.current_topic_tags ?? row.topic_tags),
    topicSignatureHash: row.current_topic_signature_hash || row.topic_signature_hash,
    outcomeLabel: row.current_outcome_label || 'submitted',
    outcomeBand: row.current_outcome_band || 'pending',
    candidateCount: numberOr(row.current_candidate_count, 0),
    scoredCandidateCount: numberOr(row.current_scored_candidate_count, 0),
    bestCandidatePublicSummary: row.current_best_candidate_public_summary || '',
    lastActivityAt: row.current_last_activity_at || row.created_at,
    submittedAt: row.created_at,
  }))
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
    if (['queued', 'running', 'scoring'].includes(loop.outcomeLabel)) group.running += 1
    if (['candidate_generation_complete', 'scored_no_gain', 'scored_promising', 'promotion_passed', 'promoted', 'failed'].includes(loop.outcomeLabel)) {
      group.completed += 1
    }
    if (['scored_no_gain', 'scored_promising', 'promotion_passed', 'promoted'].includes(loop.outcomeLabel)) group.scored += 1
    if (['small_gain', 'passed_threshold', 'promoted'].includes(loop.outcomeBand)) group.promisingOrPromoted += 1
    if (['no_gain', 'failed'].includes(loop.outcomeBand)) group.noGainOrFailed += 1
    if (new Date(loop.lastActivityAt).getTime() > new Date(group.latestActivityAt).getTime()) {
      group.latestActivityAt = loop.lastActivityAt
    }
    groups.set(key, group)
  }
  return Array.from(groups.values()).sort(
    (a, b) => new Date(b.latestActivityAt).getTime() - new Date(a.latestActivityAt).getTime()
  )
}

function numberOr(value: unknown, fallback: number): number {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

function arrayOfStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0)
}

function scoreBand(score: number): string {
  if (score >= 80) return '80_plus'
  if (score >= 60) return '60_79'
  if (score >= 40) return '40_59'
  if (score > 0) return '1_39'
  return 'zero'
}
