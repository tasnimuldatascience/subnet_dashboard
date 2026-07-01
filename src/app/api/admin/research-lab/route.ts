import { NextRequest, NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/admin-supabase'
import {
  buildResearchLabLoopTimeline,
  type ResearchLabLoopTimeline,
  type ResearchLabTimelinePhase,
  type ResearchLabTimelineRawRow,
  type ResearchLabTimelineSourceInput,
} from '@/lib/research-lab-timeline'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const LOOP_LIMIT = 250

type AdminLabLoopRow = {
  card_id: string
  ticket_id: string
  miner_hotkey: string | null
  research_area: string | null
  research_focus_summary: string | null
  topic_tags: string[] | null
  topic_signature_hash: string | null
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
  current_event_doc: Record<string, unknown> | null
  current_status?: string | null
  created_at: string
}

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

export type AdminResearchLabTimelinePayload = {
  loop: AdminLabLoopSummary
  timeline: ResearchLabLoopTimeline
  fetchedAt: string
}

export async function GET(request: NextRequest) {
  let supabase
  try {
    supabase = getAdminSupabase()
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'admin supabase not configured'
    return NextResponse.json({ error: msg }, { status: 503 })
  }

  const ticketId = request.nextUrl.searchParams.get('ticketId')?.trim()
  if (ticketId) {
    let detail: AdminResearchLabTimelinePayload | null = null
    try {
      detail = await fetchAdminLabTimeline(supabase, ticketId)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown Supabase error'
      return NextResponse.json({ error: msg }, { status: 502 })
    }
    if (!detail) {
      return NextResponse.json({ error: 'Research Lab loop not found' }, { status: 404 })
    }
    return NextResponse.json(detail, { headers: { 'Cache-Control': 'no-store' } })
  }

  let loops: AdminLabLoopSummary[] = []
  try {
    loops = await fetchAdminLabLoops(supabase)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown Supabase error'
    return NextResponse.json({ error: msg }, { status: 502 })
  }
  const miners = new Set(loops.map((loop) => loop.minerHotkey).filter(Boolean))
  return NextResponse.json(
    {
      loops,
      stats: {
        totalLoops: loops.length,
        runningLoops: loops.filter((loop) => isRunningOutcome(loop.outcomeLabel, loop.outcomeBand)).length,
        scoredLoops: loops.filter((loop) => isScoredOutcome(loop.outcomeLabel, loop.outcomeBand)).length,
        failedLoops: loops.filter((loop) => isFailedOutcome(loop.outcomeLabel, loop.outcomeBand)).length,
        uniqueMiners: miners.size,
      },
      fetchedAt: new Date().toISOString(),
    } satisfies AdminResearchLabPayload,
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

async function fetchAdminLabLoops(
  supabase: ReturnType<typeof getAdminSupabase>,
): Promise<AdminLabLoopSummary[]> {
  const { data, error } = await supabase
    .from('research_lab_public_loop_card_current')
    .select('*')
    .order('current_last_activity_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(LOOP_LIMIT)

  if (error) {
    throw new Error(`Supabase error: ${error.message}`)
  }

  return ((data ?? []) as AdminLabLoopRow[]).map(normalizeLoopRow)
}

async function fetchAdminLabTimeline(
  supabase: ReturnType<typeof getAdminSupabase>,
  ticketId: string,
): Promise<AdminResearchLabTimelinePayload | null> {
  const { data, error } = await supabase
    .from('research_lab_public_loop_card_current')
    .select('*')
    .eq('ticket_id', ticketId)
    .limit(1)

  if (error) {
    throw new Error(`Supabase error: ${error.message}`)
  }

  const row = ((data ?? []) as AdminLabLoopRow[])[0] ?? null
  if (!row) return null

  const loop = normalizeLoopRow(row)
  const currentRunId = row.current_run_id
  const currentReceiptId = row.current_receipt_id
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
  const timeline = buildResearchLabLoopTimeline({
    ticketId,
    currentRunId,
    currentReceiptId,
    currentLoop: {
      cardId: row.card_id,
      ticketId: row.ticket_id,
      runId: currentRunId,
      receiptId: currentReceiptId,
      minerHotkey: row.miner_hotkey,
      outcomeLabel: row.current_outcome_label,
      outcomeBand: row.current_outcome_band,
      statusLabel: row.current_status,
      submittedAt: row.created_at,
      lastActivityAt: row.current_last_activity_at,
      eventDoc: row.current_event_doc,
    },
    sources,
  })

  return { loop, timeline, fetchedAt: new Date().toISOString() }
}

type TimelineSourceResult = ResearchLabTimelineSourceInput

async function fetchTimelineSourceByTicket(
  supabase: ReturnType<typeof getAdminSupabase>,
  table: string,
  phase: ResearchLabTimelinePhase,
  ticketId: string,
): Promise<TimelineSourceResult> {
  return fetchTimelineSource(supabase, table, phase, 'ticket_id', ticketId)
}

async function fetchTimelineSourceByRun(
  supabase: ReturnType<typeof getAdminSupabase>,
  table: string,
  phase: ResearchLabTimelinePhase,
  runId: string,
): Promise<TimelineSourceResult> {
  return fetchTimelineSource(supabase, table, phase, 'run_id', runId)
}

async function fetchTimelineSource(
  supabase: ReturnType<typeof getAdminSupabase>,
  table: string,
  phase: ResearchLabTimelinePhase,
  column: 'ticket_id' | 'run_id',
  value: string,
): Promise<TimelineSourceResult> {
  const { data, error } = await supabase
    .from(table)
    .select('*')
    .eq(column, value)
    .limit(1000)

  if (error) {
    if (!isExpectedOptionalTimelineSourceMiss(error.message)) {
      console.warn(`[admin:research-lab] timeline source unavailable: ${table}.${column}`, error.message)
    }
    return { source: table, phase, rows: [] }
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

function normalizeLoopRow(row: AdminLabLoopRow): AdminLabLoopSummary {
  return {
    cardId: row.card_id,
    ticketId: row.ticket_id,
    runId: row.current_run_id,
    receiptId: row.current_receipt_id,
    minerHotkey: row.miner_hotkey ?? '',
    researchArea: row.research_area || 'generalist',
    researchFocusSummary: row.research_focus_summary || '',
    topicTags: arrayOfStrings(row.current_topic_tags ?? row.topic_tags),
    topicSignatureHash: row.current_topic_signature_hash || row.topic_signature_hash || '',
    outcomeLabel: row.current_status || row.current_outcome_label || 'submitted',
    outcomeBand: row.current_outcome_band || 'pending',
    candidateCount: numberOr(row.current_candidate_count, 0),
    scoredCandidateCount: numberOr(row.current_scored_candidate_count, 0),
    bestCandidatePublicSummary: row.current_best_candidate_public_summary || '',
    lastActivityAt: row.current_last_activity_at || row.created_at,
    submittedAt: row.created_at,
  }
}

function arrayOfStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0)
}

function numberOr(value: unknown, fallback: number): number {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

function isRunningOutcome(label: string, band: string): boolean {
  const value = `${label} ${band}`.toLowerCase()
  return value.includes('running') || value.includes('queued') || value.includes('scoring')
}

function isScoredOutcome(label: string, band: string): boolean {
  const value = `${label} ${band}`.toLowerCase()
  return value.includes('scored') || value.includes('promoted') || value.includes('gain')
}

function isFailedOutcome(label: string, band: string): boolean {
  const value = `${label} ${band}`.toLowerCase()
  return value.includes('failed') || value.includes('cancelled')
}

function isExpectedOptionalTimelineSourceMiss(message: string | undefined): boolean {
  const normalized = (message ?? '').toLowerCase()
  return normalized.includes('does not exist') || normalized.includes('could not find')
}
