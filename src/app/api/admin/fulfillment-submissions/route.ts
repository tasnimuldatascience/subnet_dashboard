import { NextRequest, NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/admin-supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SUBMISSION_BATCH_SIZE = 100
const MAX_SUBMISSIONS = 2000
const CONSENSUS_BATCH_SIZE = 1000
const SCORE_BATCH_SIZE = 1000
const MAX_SCORE_ROWS = 10000
const DEFAULT_PAGE_SIZE = 50
const MAX_PAGE_SIZE = 100
const DATASET_CACHE_TTL_MS = 60_000

type FulfillmentSubmissionRow = {
  submission_id: string
  request_id: string
  miner_hotkey: string | null
  num_leads: number | null
  revealed: boolean | null
  revealed_at: string | null
  lead_hashes: Array<{ lead_id?: string }> | null
  lead_data: Array<{ lead_id?: string; data?: Record<string, unknown> }> | null
}

type ConsensusRow = {
  request_id: string
  submission_id: string
  lead_id: string
  miner_hotkey: string | null
  consensus_final_score: number | null
  consensus_intent_signal_final: number | null
  consensus_rep_score: number | null
  consensus_icp_fit: boolean | null
  consensus_tier2_passed: boolean | null
  is_winner: boolean
  is_chain_held: boolean
  intent_details: string | null
  computed_at: string | null
}

type ScoreRow = {
  request_id: string
  lead_id: string
  miner_hotkey: string | null
  failure_reason: string | null
  failure_detail: string | null
  final_score: number | null
  scored_at: string | null
}

type RejectionDailyRow = {
  date: string
  reason: string
  count: number
}

type MinerDailyRow = {
  date: string
  minerHotkey: string
  count: number
  committed: number
  approved: number
  denied: number
  pending: number
  fulfilled: number
}

type ChartConsensusRow = {
  request_id: string
  lead_id: string
  consensus_final_score: number | null
  is_winner: boolean
  is_chain_held: boolean
  computed_at: string | null
}

type RequestRow = {
  request_id: string
  internal_label: string | null
  company: string | null
  created_at: string | null
  icp_details: Record<string, unknown> | null
  required_attributes: Record<string, unknown> | null
}

type RequestOption = {
  requestId: string
  label: string
  company: string | null
}

type TransparencyCommitRow = {
  ts: string
  payload: {
    submission_id?: string
    request_id?: string
    submission_timestamp?: string
  } | null
}

type SubmittedLeadStatus = 'committed' | 'pending' | 'approved' | 'denied'

type FulfillmentAnalyticsDataset = {
  submissions: FulfillmentSubmissionRow[]
  commitAtBySubmission: Map<string, string>
  consensusByLead: Map<string, ConsensusRow>
  requestById: Map<string, RequestRow>
  requestOptions: RequestOption[]
  chartConsensusRows: ChartConsensusRow[]
  scoreByLead: Map<string, ScoreRow>
  loadedAt: number
}

let cachedDataset: FulfillmentAnalyticsDataset | null = null
let pendingDatasetLoad: Promise<FulfillmentAnalyticsDataset> | null = null

function dateKey(value: string | null | undefined): string {
  if (!value) return 'Unknown'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return 'Unknown'
  return parsed.toISOString().slice(0, 10)
}

function shortLeadValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function numberParam(value: string | null, fallback: number, max: number): number {
  const parsed = Number.parseInt(value ?? '', 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.min(parsed, max)
}

function normalizeDateBound(value: string | null, endOfDay = false): string | null {
  if (!value) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  return endOfDay ? `${value}T23:59:59.999Z` : `${value}T00:00:00.000Z`
}

function inDateRange(value: string | null, from: string | null, to: string | null): boolean {
  if (!from && !to) return true
  if (!value) return false
  const key = dateKey(value)
  if (key === 'Unknown') return false
  const fromDay = from?.slice(0, 10) ?? null
  const toDay = to?.slice(0, 10) ?? null
  if (fromDay && key < fromDay) return false
  if (toDay && key > toDay) return false
  return true
}

function csvEscape(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value)
  return `"${text.replace(/"/g, '""')}"`
}

function rejectionReason(row: Pick<ScoreRow, 'failure_reason' | 'failure_detail'> | undefined): string {
  const reason = row?.failure_reason?.trim()
  if (reason) return reason

  const detail = row?.failure_detail?.toLowerCase() ?? ''
  if (detail.includes('email verification failed')) {
    const match = detail.match(/\(([^)]+)\)/)
    return match?.[1] ? `email_${match[1]}` : 'email_verification_failed'
  }
  if (detail.includes('intent')) return 'insufficient_intent'
  if (detail.includes('geography') || detail.includes('location')) return 'geography_mismatch'
  if (detail.includes('role type')) return 'role_type_mismatch'
  if (detail.includes('role')) return 'role_mismatch'
  if (detail.includes('industry')) return 'industry_mismatch'
  if (detail.includes('country')) return 'country_mismatch'

  return 'unknown_rejection'
}

function csvResponse(filename: string, headers: string[], rows: unknown[][]): NextResponse {
  const csv = [
    headers.map(csvEscape).join(','),
    ...rows.map((row) => row.map(csvEscape).join(',')),
  ].join('\n')
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}

function classifyLead(
  submission: FulfillmentSubmissionRow,
  consensus: ConsensusRow | undefined,
): SubmittedLeadStatus {
  if (!submission.revealed) return 'committed'
  if (!consensus) return 'pending'
  if (consensus.is_winner || consensus.is_chain_held) {
    return 'approved'
  }
  return 'denied'
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

async function fetchSubmissions(
  supabase: ReturnType<typeof getAdminSupabase>,
): Promise<{
  data: FulfillmentSubmissionRow[]
  error: ({ message: string } & Record<string, unknown>) | null
}> {
  const all: FulfillmentSubmissionRow[] = []
  for (let offset = 0; offset < MAX_SUBMISSIONS; offset += SUBMISSION_BATCH_SIZE) {
    const { data, error } = await supabase
      .from('fulfillment_submissions')
      .select(
        'submission_id, request_id, miner_hotkey, revealed, revealed_at, lead_hashes, lead_data',
      )
      .order('revealed_at', { ascending: false })
      .range(offset, offset + SUBMISSION_BATCH_SIZE - 1)

    if (error) {
      return {
        data: all,
        error: { ...error, message: error.message || `fetch failed at offset ${offset}` },
      }
    }
    const batch = (data ?? []) as FulfillmentSubmissionRow[]
    all.push(...batch)
    if (batch.length < SUBMISSION_BATCH_SIZE) break
  }

  return { data: all, error: null }
}

async function fetchConsensusRows(
  supabase: ReturnType<typeof getAdminSupabase>,
  submissionIds: string[],
): Promise<{ data: ConsensusRow[]; error: { message: string } | null }> {
  const all: ConsensusRow[] = []
  for (const group of chunks(submissionIds, 100)) {
    const { data, error } = await supabase
      .from('fulfillment_score_consensus')
      .select(
        'request_id, submission_id, lead_id, miner_hotkey, consensus_final_score, ' +
          'consensus_intent_signal_final, consensus_rep_score, consensus_icp_fit, ' +
          'consensus_tier2_passed, is_winner, is_chain_held, intent_details, computed_at',
      )
      .in('submission_id', group)

    if (error) {
      return { data: all, error: { message: error.message || 'consensus batch failed' } }
    }
    all.push(...((data ?? []) as unknown as ConsensusRow[]))
  }
  return { data: all, error: null }
}

async function fetchRequestRows(
  supabase: ReturnType<typeof getAdminSupabase>,
  requestIds: string[],
): Promise<{ data: RequestRow[]; error: { message: string } | null }> {
  const all: RequestRow[] = []
  for (const group of chunks(requestIds, 100)) {
    const { data, error } = await supabase
      .from('fulfillment_requests')
      .select('request_id, internal_label, company, created_at, icp_details, required_attributes')
      .in('request_id', group)

    if (error) {
      return { data: all, error: { message: error.message || 'request batch failed' } }
    }
    all.push(...((data ?? []) as RequestRow[]))
  }
  return { data: all, error: null }
}

async function fetchScoreRows(
  supabase: ReturnType<typeof getAdminSupabase>,
  requestIds: string[],
): Promise<{ data: ScoreRow[]; error: { message: string } | null }> {
  const all: ScoreRow[] = []
  for (const group of chunks(requestIds, 100)) {
    for (
      let offset = 0;
      offset < MAX_SCORE_ROWS && all.length < MAX_SCORE_ROWS;
      offset += SCORE_BATCH_SIZE
    ) {
      const remaining = MAX_SCORE_ROWS - all.length
      const batchSize = Math.min(SCORE_BATCH_SIZE, remaining)
      const { data, error } = await supabase
        .from('fulfillment_scores')
        .select('request_id, lead_id, miner_hotkey, failure_reason, failure_detail, final_score, scored_at')
        .in('request_id', group)
        .order('scored_at', { ascending: false })
        .range(offset, offset + batchSize - 1)

      if (error) {
        return { data: all, error: { message: error.message || 'score batch failed' } }
      }

      const batch = (data ?? []) as ScoreRow[]
      all.push(...batch)
      if (batch.length < batchSize) break
    }
    if (all.length >= MAX_SCORE_ROWS) break
  }
  return { data: all, error: null }
}

async function fetchChartConsensusRows(
  supabase: ReturnType<typeof getAdminSupabase>,
): Promise<{ data: ChartConsensusRow[]; error: { message: string } | null }> {
  const all: ChartConsensusRow[] = []
  for (let offset = 0; ; offset += CONSENSUS_BATCH_SIZE) {
    const { data, error } = await supabase
      .from('fulfillment_score_consensus')
      .select('request_id, lead_id, consensus_final_score, is_winner, is_chain_held, computed_at')
      .not('computed_at', 'is', null)
      .order('computed_at', { ascending: false })
      .range(offset, offset + CONSENSUS_BATCH_SIZE - 1)

    if (error) {
      return { data: all, error: { message: error.message || 'chart consensus query failed' } }
    }
    const batch = (data ?? []) as ChartConsensusRow[]
    all.push(...batch)
    if (batch.length < CONSENSUS_BATCH_SIZE) break
  }

  return { data: all, error: null }
}

async function loadAnalyticsDataset(
  supabase: ReturnType<typeof getAdminSupabase>,
  forceRefresh = false,
): Promise<FulfillmentAnalyticsDataset> {
  const now = Date.now()
  if (
    !forceRefresh &&
    cachedDataset &&
    now - cachedDataset.loadedAt < DATASET_CACHE_TTL_MS
  ) {
    return cachedDataset
  }
  if (!forceRefresh && pendingDatasetLoad) return pendingDatasetLoad

  pendingDatasetLoad = (async () => {
    const { data: submissionsData, error: submissionsErr } = await fetchSubmissions(supabase)
    if (submissionsErr) {
      throw new Error(`Supabase submissions error: ${submissionsErr.message}`)
    }

    const submissions = (submissionsData ?? []) as FulfillmentSubmissionRow[]
    const submissionIds = submissions.map((s) => s.submission_id)
    const requestIds = Array.from(new Set(submissions.map((s) => s.request_id)))

    const commitAtBySubmission = new Map<string, string>()
    if (submissionIds.length > 0) {
      const { data: commitData } = await supabase
        .from('transparency_log')
        .select('ts, payload')
        .eq('event_type', 'FULFILLMENT_COMMIT')
        .order('ts', { ascending: false })
        .limit(MAX_SUBMISSIONS * 2)

      for (const row of (commitData ?? []) as TransparencyCommitRow[]) {
        const submissionId = row.payload?.submission_id
        if (!submissionId || !submissionIds.includes(submissionId)) continue
        commitAtBySubmission.set(
          submissionId,
          row.payload?.submission_timestamp ?? row.ts,
        )
      }
    }

    const consensusByLead = new Map<string, ConsensusRow>()
    if (submissionIds.length > 0) {
      const { data: consensusData, error: consensusErr } =
        await fetchConsensusRows(supabase, submissionIds)
      if (consensusErr) {
        throw new Error(`Supabase consensus error: ${consensusErr.message}`)
      }
      for (const row of consensusData) {
        consensusByLead.set(`${row.submission_id}:${row.lead_id}`, row)
      }
    }

    const requestById = new Map<string, RequestRow>()
    if (requestIds.length > 0) {
      const { data: requestData, error: requestErr } =
        await fetchRequestRows(supabase, requestIds)
      if (requestErr) {
        throw new Error(`Supabase request error: ${requestErr.message}`)
      }
      for (const row of requestData) {
        requestById.set(row.request_id, row)
      }
    }
    const requestOptions: RequestOption[] = Array.from(requestById.values())
      .map((request) => ({
        requestId: request.request_id,
        label: request.internal_label || request.request_id.slice(0, 8),
        company: request.company,
      }))
      .sort((a, b) => a.label.localeCompare(b.label))

    const { data: chartConsensusRows, error: chartConsensusErr } =
      await fetchChartConsensusRows(supabase)
    if (chartConsensusErr) {
      throw new Error(`Supabase chart consensus error: ${chartConsensusErr.message}`)
    }

    const scoreByLead = new Map<string, ScoreRow>()
    const scoreRequestIds = Array.from(
      new Set([...requestIds, ...chartConsensusRows.map((row) => row.request_id)]),
    )
    if (scoreRequestIds.length > 0) {
      const { data: scoreData, error: scoreErr } = await fetchScoreRows(supabase, scoreRequestIds)
      if (scoreErr) {
        throw new Error(`Supabase score error: ${scoreErr.message}`)
      }
      for (const row of scoreData) {
        const key = `${row.request_id}:${row.lead_id}`
        const prev = scoreByLead.get(key)
        if (!prev) {
          scoreByLead.set(key, row)
          continue
        }
        const prevHasDetail = Boolean(prev.failure_detail || prev.failure_reason)
        const rowHasDetail = Boolean(row.failure_detail || row.failure_reason)
        if (!prevHasDetail && rowHasDetail) scoreByLead.set(key, row)
      }
    }

    const dataset: FulfillmentAnalyticsDataset = {
      submissions,
      commitAtBySubmission,
      consensusByLead,
      requestById,
      requestOptions,
      chartConsensusRows,
      scoreByLead,
      loadedAt: Date.now(),
    }
    cachedDataset = dataset
    return dataset
  })()

  try {
    return await pendingDatasetLoad
  } finally {
    pendingDatasetLoad = null
  }
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const page = numberParam(searchParams.get('page'), 1, 10_000)
  const pageSize = numberParam(searchParams.get('pageSize'), DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE)
  const statusFilter = searchParams.get('status') ?? 'all'
  const query = (searchParams.get('q') ?? '').trim().toLowerCase()
  const rejectReasonFilter = (searchParams.get('rejectReason') ?? '').trim().toLowerCase()
  const requestFilter = searchParams.get('requestId') ?? 'all'
  const minerFilter = searchParams.get('minerHotkey') ?? 'all'
  const dateFrom = normalizeDateBound(searchParams.get('from'))
  const dateTo = normalizeDateBound(searchParams.get('to'), true)
  const bucket = searchParams.get('bucket') === 'hour' ? 'hour' : 'day'
  const wantsCsv = searchParams.get('export') === 'csv'
  const exportKind = searchParams.get('export') ?? ''

  let supabase
  try {
    supabase = getAdminSupabase()
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'admin supabase not configured'
    return NextResponse.json({ error: msg }, { status: 503 })
  }

  let dataset: FulfillmentAnalyticsDataset
  try {
    dataset = await loadAnalyticsDataset(supabase, searchParams.get('refresh') === '1')
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to load fulfillment analytics dataset'
    return NextResponse.json(
      { error: message },
      { status: 502 },
    )
  }

  const {
    submissions,
    commitAtBySubmission,
    consensusByLead,
    requestById,
    requestOptions,
    chartConsensusRows,
    scoreByLead,
  } = dataset
  const bucketKey = (value: string | null | undefined): string => {
    const day = dateKey(value)
    if (bucket !== 'hour' || day === 'Unknown') return day
    const parsed = new Date(value ?? '')
    if (Number.isNaN(parsed.getTime())) return 'Unknown'
    return `${day} ${String(parsed.getUTCHours()).padStart(2, '0')}:00`
  }

  const leads = submissions.flatMap((submission) => {
    const leadEntries =
      submission.lead_data && submission.lead_data.length > 0
        ? submission.lead_data
        : (submission.lead_hashes ?? []).map((entry) => ({
            lead_id: entry.lead_id,
            data: {},
          }))

    return leadEntries
      .filter((entry) => entry.lead_id)
      .map((entry) => {
        const leadId = entry.lead_id as string
        const data: Record<string, unknown> = entry.data ?? {}
        const consensus = consensusByLead.get(`${submission.submission_id}:${leadId}`)
        const scoreRow = scoreByLead.get(`${submission.request_id}:${leadId}`)
        const request = requestById.get(submission.request_id)
        const requestIcp = request?.icp_details
          ? {
              ...request.icp_details,
              required_attributes:
                (request.icp_details.required_attributes as unknown) ??
                request.required_attributes ??
                null,
            }
          : null
        const submittedAt =
          submission.revealed_at ??
          commitAtBySubmission.get(submission.submission_id) ??
          request?.created_at ??
          null
        const status = classifyLead(submission, consensus)
        const activityAt =
          status === 'approved' || status === 'denied' || consensus?.is_winner
            ? consensus?.computed_at ?? submittedAt
            : submittedAt

        return {
          leadId,
          submissionId: submission.submission_id,
          requestId: submission.request_id,
          requestLabel: request?.internal_label ?? null,
          clientCompany: request?.company ?? null,
          minerHotkey: submission.miner_hotkey ?? consensus?.miner_hotkey ?? '',
          submittedAt,
          activityAt,
          revealed: Boolean(submission.revealed),
          status,
          fulfilled: Boolean(consensus?.is_winner),
          company: shortLeadValue(data.business),
          contact: shortLeadValue(data.full_name),
          email: shortLeadValue(data.email),
          role: shortLeadValue(data.role),
          country: shortLeadValue(data.country),
          score: consensus?.consensus_final_score ?? null,
          intentScore: consensus?.consensus_intent_signal_final ?? null,
          repScore: consensus?.consensus_rep_score ?? null,
          icpFit: consensus?.consensus_icp_fit ?? null,
          tier2Passed: consensus?.consensus_tier2_passed ?? null,
          intentDetails: consensus?.intent_details ?? null,
          consensusAt: consensus?.computed_at ?? null,
          rejectionReason: status === 'denied' ? rejectionReason(scoreRow) : null,
          rejectionDetail: scoreRow?.failure_detail ?? null,
          requestIcp,
          leadData: data,
        }
      })
  })

  leads.sort((a, b) => {
    const at = a.activityAt ?? ''
    const bt = b.activityAt ?? ''
    return at < bt ? 1 : -1
  })

  const dailyMap = new Map<
    string,
    {
      date: string
      submitted: number
      committed: number
      approved: number
      denied: number
      pending: number
      fulfilled: number
    }
  >()
  const baseFilteredLeads = leads.filter((lead) => {
    if (requestFilter !== 'all' && lead.requestId !== requestFilter) return false
    if (minerFilter !== 'all' && lead.minerHotkey !== minerFilter) return false
    return inDateRange(lead.activityAt, dateFrom, dateTo)
  })

  const baseFilteredConsensus = chartConsensusRows.filter((row) => {
    if (requestFilter !== 'all' && row.request_id !== requestFilter) return false
    if (minerFilter !== 'all') {
      const scoreRow = scoreByLead.get(`${row.request_id}:${row.lead_id}`)
      if (scoreRow?.miner_hotkey !== minerFilter) return false
    }
    return inDateRange(row.computed_at, dateFrom, dateTo)
  })

  for (const lead of baseFilteredLeads) {
    const key = bucketKey(lead.activityAt)
    const bucket =
      dailyMap.get(key) ??
      {
        date: key,
        submitted: 0,
        committed: 0,
        approved: 0,
        denied: 0,
        pending: 0,
        fulfilled: 0,
      }
    bucket.submitted += 1
    if (lead.status === 'committed') bucket.committed += 1
    if (lead.status === 'pending') bucket.pending += 1
    dailyMap.set(key, bucket)
  }

  for (const row of baseFilteredConsensus) {
    const key = bucketKey(row.computed_at)
    const bucket =
      dailyMap.get(key) ??
      {
        date: key,
        submitted: 0,
        committed: 0,
        approved: 0,
        denied: 0,
        pending: 0,
        fulfilled: 0,
      }
    const approved = row.is_winner || row.is_chain_held
    if (approved) bucket.approved += 1
    else bucket.denied += 1
    if (row.is_winner) bucket.fulfilled += 1
    dailyMap.set(key, bucket)
  }

  if (bucket === 'hour' && dateFrom && dateTo) {
    const start = new Date(dateFrom)
    const end = new Date(dateTo)
    start.setUTCMinutes(0, 0, 0)
    end.setUTCMinutes(0, 0, 0)
    for (let t = start.getTime(); t <= end.getTime(); t += 60 * 60 * 1000) {
      const d = new Date(t)
      const key = `${d.toISOString().slice(0, 10)} ${String(d.getUTCHours()).padStart(2, '0')}:00`
      if (!dailyMap.has(key)) {
        dailyMap.set(key, {
          date: key,
          submitted: 0,
          committed: 0,
          approved: 0,
          denied: 0,
          pending: 0,
          fulfilled: 0,
        })
      }
    }
  }

  const daily = Array.from(dailyMap.values()).sort((a, b) =>
    a.date < b.date ? -1 : 1,
  )

  const deniedConsensusRows = baseFilteredConsensus.filter(
    (row) => !(row.is_winner || row.is_chain_held || (row.consensus_final_score ?? 0) > 0),
  )

  const rejectionMap = new Map<string, RejectionDailyRow>()
  for (const row of deniedConsensusRows) {
    const date = bucketKey(row.computed_at)
    const scoreRow = scoreByLead.get(`${row.request_id}:${row.lead_id}`)
    const reason = rejectionReason(scoreRow)
    const key = `${date}|||${reason}`
    const bucket = rejectionMap.get(key) ?? { date, reason, count: 0 }
    bucket.count += 1
    rejectionMap.set(key, bucket)
  }
  const rejectionDaily = Array.from(rejectionMap.values()).sort((a, b) =>
    a.date === b.date ? a.reason.localeCompare(b.reason) : a.date < b.date ? -1 : 1,
  )
  const rejectTypes = Array.from(
    deniedConsensusRows.reduce((map, row) => {
      const scoreRow = scoreByLead.get(`${row.request_id}:${row.lead_id}`)
      const reason = rejectionReason(scoreRow)
      map.set(reason, (map.get(reason) ?? 0) + 1)
      return map
    }, new Map<string, number>()),
  )
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count)

  const minerMap = new Map<string, MinerDailyRow>()
  for (const lead of baseFilteredLeads) {
    const date = bucketKey(lead.activityAt)
    const minerHotkey = lead.minerHotkey || 'unknown_hotkey'
    const key = `${date}|||${minerHotkey}`
    const bucket =
      minerMap.get(key) ?? {
        date,
        minerHotkey,
        count: 0,
        committed: 0,
        approved: 0,
        denied: 0,
        pending: 0,
        fulfilled: 0,
      }
    bucket.count += 1
    if (lead.fulfilled) bucket.fulfilled += 1
    else bucket[lead.status] += 1
    minerMap.set(key, bucket)
  }
  const minerDaily = Array.from(minerMap.values()).sort((a, b) =>
    a.date === b.date ? a.minerHotkey.localeCompare(b.minerHotkey) : a.date < b.date ? -1 : 1,
  )
  const minerHotkeys = Array.from(
    baseFilteredLeads.reduce((map, lead) => {
      const hotkey = lead.minerHotkey || 'unknown_hotkey'
      map.set(hotkey, (map.get(hotkey) ?? 0) + 1)
      return map
    }, new Map<string, number>()),
  )
    .map(([hotkey, count]) => ({ hotkey, count }))
    .sort((a, b) => b.count - a.count)

  const filteredLeads = baseFilteredLeads.filter((lead) => {
    if (statusFilter === 'fulfilled' && !lead.fulfilled) return false
    if (
      statusFilter !== 'all' &&
      statusFilter !== 'fulfilled' &&
      lead.status !== statusFilter
    ) {
      return false
    }
    if (
      rejectReasonFilter &&
      !(lead.rejectionReason ?? '').toLowerCase().includes(rejectReasonFilter)
    ) {
      return false
    }
    if (!query) return true
    const hay = [
      lead.company,
      lead.contact,
      lead.email,
      lead.role,
      lead.requestLabel,
      lead.clientCompany,
      lead.minerHotkey,
      lead.leadId,
      lead.submissionId,
      lead.requestId,
      lead.rejectionReason,
      lead.rejectionDetail,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    return hay.includes(query)
  })
  const totalFiltered = filteredLeads.length
  const start = (page - 1) * pageSize
  const pageLeads = filteredLeads.slice(start, start + pageSize)

  if (exportKind === 'submissions-by-day') {
    return csvResponse(
      'submissions-by-day.csv',
      ['date', 'submitted', 'committed', 'approved', 'denied', 'pending', 'fulfilled'],
      daily.map((row) => [
        row.date,
        row.submitted,
        row.committed,
        row.approved,
        row.denied,
        row.pending,
        row.fulfilled,
      ]),
    )
  }

  if (exportKind === 'rejects-by-day') {
    return csvResponse(
      'rejects-by-day.csv',
      ['date', 'reject_reason', 'count'],
      rejectionDaily.map((row) => [row.date, row.reason, row.count]),
    )
  }

  if (exportKind === 'miner-submissions-by-day') {
    return csvResponse(
      'miner-submissions-by-day.csv',
      ['date', 'miner_hotkey', 'count', 'committed', 'approved', 'denied', 'pending', 'fulfilled'],
      minerDaily.map((row) => [
        row.date,
        row.minerHotkey,
        row.count,
        row.committed,
        row.approved,
        row.denied,
        row.pending,
        row.fulfilled,
      ]),
    )
  }

  if (wantsCsv) {
    const headers = [
      'status',
      'fulfilled',
      'lead_id',
      'submission_id',
      'request_id',
      'request_label',
      'client_company',
      'miner_hotkey',
      'activity_at',
      'submitted_at',
      'consensus_at',
      'company',
      'contact',
      'email',
      'role',
      'country',
      'score',
      'intent_score',
      'rep_score',
      'icp_fit',
      'tier2_passed',
      'intent_details',
      'rejection_reason',
      'rejection_detail',
      'request_icp',
      'raw_lead_data',
    ]
    const rows = filteredLeads.map((lead) => [
      lead.status,
      lead.fulfilled,
      lead.leadId,
      lead.submissionId,
      lead.requestId,
      lead.requestLabel,
      lead.clientCompany,
      lead.minerHotkey,
      lead.activityAt,
      lead.submittedAt,
      lead.consensusAt,
      lead.company,
      lead.contact,
      lead.email,
      lead.role,
      lead.country,
      lead.score,
      lead.intentScore,
      lead.repScore,
      lead.icpFit,
      lead.tier2Passed,
      lead.intentDetails,
      lead.rejectionReason,
      lead.rejectionDetail,
      JSON.stringify(lead.requestIcp),
      JSON.stringify(lead.leadData),
    ])
    return csvResponse('submitted-leads.csv', headers, rows)
  }

  return NextResponse.json(
    {
      leads: pageLeads,
      daily,
      rejectionDaily,
      rejectTypes,
      minerDaily,
      minerHotkeys,
      requestOptions,
      stats: {
        submissions: submissions.length,
        submitted: baseFilteredLeads.length,
        committed: baseFilteredLeads.filter((lead) => lead.status === 'committed').length,
        approved: baseFilteredConsensus.filter(
          (row) => row.is_winner || row.is_chain_held || (row.consensus_final_score ?? 0) > 0,
        ).length,
        denied: baseFilteredConsensus.filter(
          (row) => !(row.is_winner || row.is_chain_held || (row.consensus_final_score ?? 0) > 0),
        ).length,
        pending: baseFilteredLeads.filter((lead) => lead.status === 'pending').length,
        fulfilled: baseFilteredConsensus.filter((row) => row.is_winner).length,
      },
      page,
      pageSize,
      totalFiltered,
      totalPages: Math.max(1, Math.ceil(totalFiltered / pageSize)),
      filters: {
        requestId: requestFilter,
        minerHotkey: minerFilter,
        from: searchParams.get('from') ?? '',
        to: searchParams.get('to') ?? '',
        bucket,
      },
      maxSubmissions: MAX_SUBMISSIONS,
      fetchedAt: new Date().toISOString(),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
