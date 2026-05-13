/**
 * GET /api/admin/requests/[request_id]/csv
 *
 * Streams every winning lead in the chain as a CSV. Mirrors the same
 * data shape the operator sees in the UI: business, contact info,
 * role, location, scoring outcomes, intent signal context.
 *
 * The CSV uses field-level quoting on every column so commas / line
 * breaks / quotes inside business descriptions don't corrupt the
 * output. We do NOT use a streaming response because the row count
 * is bounded by `num_leads` (single digits in practice), so the
 * payload is small and the synchronous path is simpler.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/admin-supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function csvCell(v: unknown): string {
  // Coerce to a clean string, then escape per RFC 4180. Always quote
  // so a future schema addition that introduces commas can't break
  // existing readers.
  if (v === null || v === undefined) return '""'
  const s = String(v)
  return `"${s.replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`
}

interface LeadDataLite {
  business?: string
  full_name?: string
  email?: string
  phone?: string | null
  role?: string
  role_type?: string
  seniority?: string
  linkedin_url?: string
  company_website?: string
  company_linkedin?: string
  industry?: string
  sub_industry?: string
  employee_count?: string
  city?: string
  state?: string
  country?: string
  company_hq_city?: string
  company_hq_state?: string
  company_hq_country?: string
  description?: string
  intent_signals?: Array<{ url?: string; description?: string }>
}

interface LeadDataEntry {
  lead_id: string
  data?: LeadDataLite
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ request_id: string }> },
) {
  const { request_id } = await ctx.params
  if (!/^[0-9a-f-]{36}$/i.test(request_id || '')) {
    return new NextResponse('invalid request_id', { status: 400 })
  }

  let supabase
  try {
    supabase = getAdminSupabase()
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'admin supabase not configured'
    return new NextResponse(msg, { status: 503 })
  }

  // Walk the chain so the CSV always includes every winner the
  // client got, even when they came from a predecessor row.
  // We reuse the simple in-place walk rather than depending on
  // the JSON endpoint so this route stays standalone.
  const collected = new Set<string>([request_id])
  // Walk back
  let head = request_id
  for (let i = 0; i < 50; i++) {
    const { data: pred } = await supabase
      .from('fulfillment_requests')
      .select('request_id')
      .eq('successor_request_id', head)
      .limit(1)
      .maybeSingle()
    if (!pred?.request_id || collected.has(pred.request_id)) break
    collected.add(pred.request_id)
    head = pred.request_id
  }
  // Walk forward
  let tail = request_id
  for (let i = 0; i < 50; i++) {
    const { data: cur } = await supabase
      .from('fulfillment_requests')
      .select('successor_request_id')
      .eq('request_id', tail)
      .limit(1)
      .maybeSingle()
    const next = cur?.successor_request_id
    if (!next || collected.has(next)) break
    collected.add(next)
    tail = next
  }
  const chainIds = Array.from(collected)

  // Pull root for the filename + verify chain exists.
  const { data: rootRow } = await supabase
    .from('fulfillment_requests')
    .select('request_id, internal_label, company')
    .in('request_id', chainIds)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (!rootRow) {
    return new NextResponse('request not found', { status: 404 })
  }

  const { data: winnersData, error: winnersErr } = await supabase
    .from('fulfillment_score_consensus')
    .select(
      'consensus_id, request_id, submission_id, lead_id, miner_hotkey, ' +
        'consensus_final_score, consensus_intent_signal_final, consensus_rep_score, ' +
        'reward_pct, intent_details, computed_at',
    )
    .in('request_id', chainIds)
    .eq('is_winner', true)
    .order('consensus_final_score', { ascending: false })

  if (winnersErr) {
    return new NextResponse(`supabase error: ${winnersErr.message}`, { status: 502 })
  }

  // Explicit shape so the typeguard around winnersErr above narrows
  // winnersData correctly. The `.select(...)` column list above
  // determines what fields are present.
  interface WinnerRow {
    consensus_id: string
    request_id: string
    submission_id: string
    lead_id: string
    miner_hotkey: string
    consensus_final_score: number | null
    consensus_intent_signal_final: number | null
    consensus_rep_score: number | null
    reward_pct: number | null
    intent_details: string | null
    computed_at: string
  }
  const winnerRows = (winnersData || []) as unknown as WinnerRow[]

  // Dedup by lead_id (highest score wins).
  const winnersByLead = new Map<string, WinnerRow>()
  for (const w of winnerRows) {
    const prev = winnersByLead.get(w.lead_id)
    if (!prev || (w.consensus_final_score ?? 0) > (prev.consensus_final_score ?? 0)) {
      winnersByLead.set(w.lead_id, w)
    }
  }
  const winners = Array.from(winnersByLead.values())

  // Hydrate lead_data for each winning submission.
  const winningSubIds = Array.from(new Set(winners.map((w) => w.submission_id)))
  const leadDataBySub = new Map<string, LeadDataEntry[]>()
  if (winningSubIds.length > 0) {
    const { data: subs } = await supabase
      .from('fulfillment_submissions')
      .select('submission_id, lead_data')
      .in('submission_id', winningSubIds)
    for (const s of subs || []) {
      leadDataBySub.set(s.submission_id, (s.lead_data || []) as LeadDataEntry[])
    }
  }

  const columns = [
    'business',
    'full_name',
    'role',
    'email',
    'phone',
    'linkedin_url',
    'company_website',
    'company_linkedin',
    'industry',
    'sub_industry',
    'employee_count',
    'company_hq_city',
    'company_hq_state',
    'company_hq_country',
    'description',
    'final_score',
    'intent_signal_score',
    'rep_score',
    'reward_pct',
    'miner_hotkey',
    'intent_details',
    'computed_at',
    'lead_id',
  ]

  const lines: string[] = [columns.join(',')]
  for (const w of winners) {
    const entry = (leadDataBySub.get(w.submission_id) || []).find(
      (e) => e.lead_id === w.lead_id,
    )
    const ld = entry?.data || {}
    const row = [
      ld.business,
      ld.full_name,
      ld.role,
      ld.email,
      ld.phone ?? '',
      ld.linkedin_url,
      ld.company_website,
      ld.company_linkedin,
      ld.industry,
      ld.sub_industry,
      ld.employee_count,
      ld.company_hq_city,
      ld.company_hq_state,
      ld.company_hq_country,
      ld.description,
      w.consensus_final_score,
      w.consensus_intent_signal_final,
      w.consensus_rep_score,
      w.reward_pct,
      w.miner_hotkey,
      w.intent_details,
      w.computed_at,
      w.lead_id,
    ].map(csvCell)
    lines.push(row.join(','))
  }

  const labelSlug = (rootRow.internal_label || rootRow.company || 'request')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
  const fname = `${labelSlug}-${rootRow.request_id.slice(0, 8)}-winners.csv`

  return new NextResponse(lines.join('\n') + '\n', {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${fname}"`,
      'Cache-Control': 'no-store',
    },
  })
}
