import { NextRequest, NextResponse } from 'next/server'
import {
  getAdminSupabase,
  AdminConsensusRow,
  AdminFulfillmentRequest,
  LeadDataEntry,
} from '@/lib/admin-supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type SubmittedLeadStatus = 'approved' | 'fulfilled' | 'pending' | 'denied'
type SubmittedLeadFilter = SubmittedLeadStatus | 'all'

type SubmissionRow = {
  submission_id: string
  request_id: string
  miner_hotkey: string | null
  revealed: boolean | null
  revealed_at: string | null
  lead_hashes: Array<{ lead_id?: string }> | null
}

type ScoreRow = {
  request_id: string
  lead_id: string
  failure_reason: string | null
  failure_detail: string | null
  final_score: number | null
}

type SubmittedLeadIndexRow = {
  lead_id: string
  submission_id: string
  request_id: string
  miner_hotkey: string
  revealed: boolean
  submitted_at: string | null
  activity_at: string | null
  status: SubmittedLeadStatus
  fulfilled: boolean
  consensus: AdminConsensusRow | undefined
}

async function walkChain(
  supabase: ReturnType<typeof getAdminSupabase>,
  startId: string,
): Promise<AdminFulfillmentRequest[]> {
  const collected = new Map<string, AdminFulfillmentRequest>()

  async function fetchOne(id: string): Promise<AdminFulfillmentRequest | null> {
    const { data, error } = await supabase
      .from('fulfillment_requests')
      .select(
        'request_id, internal_label, company, status, num_leads, icp_details, required_attributes, created_at, window_start, window_end, successor_request_id',
      )
      .eq('request_id', id)
      .limit(1)
      .maybeSingle()
    if (error) {
      console.error('[admin] request leads fetchOne failed', id, error)
      return null
    }
    return data as AdminFulfillmentRequest | null
  }

  const startRow = await fetchOne(startId)
  if (!startRow) return []
  collected.set(startRow.request_id, startRow)

  let cur: AdminFulfillmentRequest | null = startRow
  for (let i = 0; cur && i < 50; i++) {
    const { data: predData } = await supabase
      .from('fulfillment_requests')
      .select(
        'request_id, internal_label, company, status, num_leads, icp_details, required_attributes, created_at, window_start, window_end, successor_request_id',
      )
      .eq('successor_request_id', cur.request_id)
      .limit(1)
      .maybeSingle()
    const pred = predData as AdminFulfillmentRequest | null
    if (!pred || collected.has(pred.request_id)) break
    collected.set(pred.request_id, pred)
    cur = pred
  }

  cur = startRow
  for (let i = 0; cur && i < 50; i++) {
    if (!cur.successor_request_id) break
    if (collected.has(cur.successor_request_id)) break
    const next = await fetchOne(cur.successor_request_id)
    if (!next) break
    collected.set(next.request_id, next)
    cur = next
  }

  return Array.from(collected.values()).sort((a, b) =>
    a.created_at < b.created_at ? -1 : 1,
  )
}

function classifyLead(
  submission: Pick<SubmissionRow, 'revealed'>,
  consensus: AdminConsensusRow | undefined,
): SubmittedLeadStatus {
  if (consensus?.is_winner) return 'fulfilled'
  if (
    consensus?.is_chain_held ||
    ((consensus?.consensus_final_score ?? 0) > 0)
  ) {
    return 'approved'
  }
  if (!submission.revealed || !consensus) return 'pending'
  return 'denied'
}

function rejectionReason(score: ScoreRow | undefined): string | null {
  const reason = score?.failure_reason?.trim()
  if (reason) return reason

  const detail = score?.failure_detail?.toLowerCase() ?? ''
  if (detail.includes('email verification failed')) {
    const match = detail.match(/\(([^)]+)\)/)
    return match?.[1] ? `email_${match[1]}` : 'email_verification_failed'
  }
  return null
}

function parsePageParam(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value ?? '', 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

function parseFilter(value: string | null): SubmittedLeadFilter {
  return value === 'approved' ||
    value === 'fulfilled' ||
    value === 'pending' ||
    value === 'denied'
    ? value
    : 'all'
}

function countRows(rows: SubmittedLeadIndexRow[]): Record<SubmittedLeadFilter, number> {
  return {
    all: rows.length,
    approved: rows.filter((row) => row.status === 'approved').length,
    fulfilled: rows.filter((row) => row.status === 'fulfilled').length,
    pending: rows.filter((row) => row.status === 'pending').length,
    denied: rows.filter((row) => row.status === 'denied').length,
  }
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ request_id: string }> },
) {
  const { request_id } = await ctx.params
  if (!request_id || typeof request_id !== 'string') {
    return NextResponse.json({ error: 'invalid request_id' }, { status: 400 })
  }
  if (!/^[0-9a-f-]{36}$/i.test(request_id)) {
    return NextResponse.json({ error: 'invalid request_id format' }, { status: 400 })
  }

  const search = req.nextUrl.searchParams
  const statusFilter = parseFilter(search.get('status'))
  const pageSize = parsePageParam(search.get('pageSize'), 50, 10, 100)
  const page = parsePageParam(search.get('page'), 1, 1, 100000)

  let supabase
  try {
    supabase = getAdminSupabase()
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'admin supabase not configured'
    return NextResponse.json({ error: msg }, { status: 503 })
  }

  const cycles = await walkChain(supabase, request_id)
  if (cycles.length === 0) {
    return NextResponse.json({ error: 'request not found' }, { status: 404 })
  }
  const chainIds = cycles.map((cycle) => cycle.request_id)

  const { data: consensusData, error: consensusErr } = await supabase
    .from('fulfillment_score_consensus')
    .select(
      'consensus_id, request_id, submission_id, lead_id, miner_hotkey, ' +
        'consensus_final_score, consensus_intent_signal_final, consensus_rep_score, ' +
        'consensus_icp_fit, consensus_tier2_passed, consensus_email_verified, ' +
        'consensus_person_verified, consensus_company_verified, consensus_decision_maker, ' +
        'any_fabricated, is_winner, is_chain_held, reward_pct, reward_expires_epoch, ' +
        'intent_details, intent_breakdown, intent_signal_mapping, num_validators, computed_at',
    )
    .in('request_id', chainIds)
    .limit(10000)

  if (consensusErr) {
    return NextResponse.json(
      { error: `Supabase error: ${consensusErr.message}` },
      { status: 502 },
    )
  }

  const { data: submissionData, error: submissionErr } = await supabase
    .from('fulfillment_submissions')
    .select('submission_id, request_id, miner_hotkey, revealed, revealed_at, lead_hashes')
    .in('request_id', chainIds)
    .limit(10000)

  if (submissionErr) {
    return NextResponse.json(
      { error: `Supabase error: ${submissionErr.message}` },
      { status: 502 },
    )
  }

  const consensusRows = (consensusData ?? []) as unknown as AdminConsensusRow[]
  const submissions = (submissionData ?? []) as SubmissionRow[]

  const consensusByLead = new Map<string, AdminConsensusRow>()
  const consensusBySubmission = new Map<string, AdminConsensusRow[]>()
  for (const row of consensusRows) {
    consensusByLead.set(`${row.submission_id}:${row.lead_id}`, row)
    const rows = consensusBySubmission.get(row.submission_id) ?? []
    rows.push(row)
    consensusBySubmission.set(row.submission_id, rows)
  }

  const indexRows = submissions.flatMap((submission): SubmittedLeadIndexRow[] => {
    const leadIds = new Set<string>()
    for (const entry of submission.lead_hashes ?? []) {
      if (entry.lead_id) leadIds.add(entry.lead_id)
    }
    for (const consensus of consensusBySubmission.get(submission.submission_id) ?? []) {
      leadIds.add(consensus.lead_id)
    }

    return Array.from(leadIds).map((leadId) => {
      const consensus = consensusByLead.get(`${submission.submission_id}:${leadId}`)
      const status = classifyLead(submission, consensus)
      const submittedAt = submission.revealed_at
      const activityAt =
        status === 'approved' || status === 'denied' || status === 'fulfilled'
          ? consensus?.computed_at ?? submittedAt
          : submittedAt

      return {
        lead_id: leadId,
        submission_id: submission.submission_id,
        request_id: submission.request_id,
        miner_hotkey: submission.miner_hotkey ?? consensus?.miner_hotkey ?? '',
        revealed: Boolean(submission.revealed),
        submitted_at: submittedAt,
        activity_at: activityAt,
        status,
        fulfilled: Boolean(consensus?.is_winner),
        consensus,
      }
    })
  })

  indexRows.sort((a, b) => {
    const at = a.activity_at ?? ''
    const bt = b.activity_at ?? ''
    return at < bt ? 1 : -1
  })

  const counts = countRows(indexRows)
  const filteredRows =
    statusFilter === 'all'
      ? indexRows
      : indexRows.filter((row) => row.status === statusFilter)

  const total = filteredRows.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const safePage = Math.min(page, totalPages)
  const from = (safePage - 1) * pageSize
  const pageRows = filteredRows.slice(from, from + pageSize)

  const pageSubmissionIds = Array.from(new Set(pageRows.map((row) => row.submission_id)))
  const pageLeadIds = Array.from(new Set(pageRows.map((row) => row.lead_id)))

  const leadDataBySubmission = new Map<string, LeadDataEntry[]>()
  if (pageSubmissionIds.length > 0) {
    const { data: pageSubmissionData, error: pageSubmissionErr } = await supabase
      .from('fulfillment_submissions')
      .select('submission_id, lead_data')
      .in('submission_id', pageSubmissionIds)

    if (pageSubmissionErr) {
      console.warn('[admin] request leads page hydration failed', pageSubmissionErr.message)
    } else {
      for (const submission of pageSubmissionData ?? []) {
        leadDataBySubmission.set(
          submission.submission_id,
          ((submission.lead_data ?? []) as LeadDataEntry[]),
        )
      }
    }
  }

  const scoreByLead = new Map<string, ScoreRow>()
  if (pageLeadIds.length > 0) {
    const { data: scoreData, error: scoreErr } = await supabase
      .from('fulfillment_scores')
      .select('request_id, lead_id, failure_reason, failure_detail, final_score')
      .in('request_id', chainIds)
      .in('lead_id', pageLeadIds)
      .limit(10000)

    if (scoreErr) {
      console.warn('[admin] request leads scores failed', scoreErr.message)
    } else {
      for (const row of (scoreData ?? []) as ScoreRow[]) {
        const key = `${row.request_id}:${row.lead_id}`
        const prev = scoreByLead.get(key)
        const prevHasDetail = Boolean(prev?.failure_reason || prev?.failure_detail)
        const rowHasDetail = Boolean(row.failure_reason || row.failure_detail)
        if (!prev || (!prevHasDetail && rowHasDetail)) scoreByLead.set(key, row)
      }
    }
  }

  const leads = pageRows.map((row) => {
    const leadData =
      leadDataBySubmission
        .get(row.submission_id)
        ?.find((entry) => entry.lead_id === row.lead_id)?.data ?? null
    const scoreRow = scoreByLead.get(`${row.request_id}:${row.lead_id}`)

    return {
      lead_id: row.lead_id,
      submission_id: row.submission_id,
      request_id: row.request_id,
      miner_hotkey: row.miner_hotkey,
      revealed: row.revealed,
      submitted_at: row.submitted_at,
      status: row.status,
      fulfilled: row.fulfilled,
      consensus: row.consensus ?? null,
      lead: leadData,
      score: row.consensus?.consensus_final_score ?? scoreRow?.final_score ?? null,
      rejection_reason: row.status === 'denied' ? rejectionReason(scoreRow) : null,
      rejection_detail: row.status === 'denied' ? scoreRow?.failure_detail ?? null : null,
    }
  })

  return NextResponse.json(
    {
      leads,
      counts,
      page: safePage,
      pageSize,
      total,
      totalPages,
      status: statusFilter,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
