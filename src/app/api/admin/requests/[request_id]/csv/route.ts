/**
 * GET /api/admin/requests/[request_id]/csv
 *
 * Streams every winning lead in the chain as a CSV.  The column set
 * mirrors the admin dashboard "Winning leads" table 1:1 — the operator
 * sends this file to the client, so we deliberately exclude every
 * internal / operational column (consensus_final_score,
 * intent_signal_score, rep_score, reward_pct, miner_hotkey,
 * computed_at, lead_id).  Those still exist in Supabase for ops; they
 * just don't belong in a client-facing artifact.
 *
 * Intent signals are exploded into per-signal columns (one set of
 * columns per credited signal) instead of being collapsed into a
 * single JSON-ish cell.  The column count is sized to the lead with
 * the most credited signals in this export, and leads with fewer
 * signals leave their trailing signal columns blank.  Each signal
 * gets seven columns matching the cards in the dashboard's "Intent
 * Signals" cell: Source, Date, Matched ICP Signal, Description, URL,
 * Snippet, Score.
 *
 * The CSV uses field-level quoting on every column so commas / line
 * breaks / quotes inside business descriptions or snippets don't
 * corrupt the output.  We do NOT use a streaming response because
 * the row count is bounded by `num_leads` (single digits in
 * practice), so the payload is small and the synchronous path is
 * simpler.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/admin-supabase'
import type {
  IntentSignalMappingEntry,
  IntentBreakdown,
} from '@/lib/admin-supabase'

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
  linkedin_url?: string
  company_website?: string
  company_linkedin?: string
  industry?: string
  sub_industry?: string
  employee_count?: string
  city?: string
  state?: string
  country?: string
  company_hq_state?: string
  company_hq_country?: string
  description?: string
}

interface LeadDataEntry {
  lead_id: string
  data?: LeadDataLite
}

// Mirror of admin-format.ts::creditedSignals — kept inline so this
// route has no dependency on the React-side helpers.
function creditedSignals(
  mapping: IntentSignalMappingEntry[] | null | undefined,
): IntentSignalMappingEntry[] {
  if (!Array.isArray(mapping)) return []
  return mapping.filter(
    (s) => (s.after_decay_score ?? s.raw_score ?? 0) > 0,
  )
}

// Mirror the dashboard's "use LLM breakdown text when present, fall
// back to raw description" resolution.  Keep the lookup identical to
// IntentSignalsList in AdminRequestDetail.tsx (index into credited[]).
function resolveSignalDescription(
  credited: IntentSignalMappingEntry[],
  breakdown: IntentBreakdown | null,
  i: number,
): string {
  const byIdx = new Map<number, string>()
  for (const b of breakdown?.per_signal ?? []) {
    if (typeof b.source_index === 'number' && b.details) {
      byIdx.set(b.source_index, b.details)
    }
  }
  return byIdx.get(i) || credited[i]?.description || ''
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

  // consensus_final_score is still selected (for stable sort order
  // only); it is NOT emitted as a column.
  const { data: winnersData, error: winnersErr } = await supabase
    .from('fulfillment_score_consensus')
    .select(
      'consensus_id, request_id, submission_id, lead_id, ' +
        'consensus_final_score, intent_details, intent_breakdown, ' +
        'intent_signal_mapping',
    )
    .in('request_id', chainIds)
    .eq('is_winner', true)
    .order('consensus_final_score', { ascending: false })

  if (winnersErr) {
    return new NextResponse(`supabase error: ${winnersErr.message}`, { status: 502 })
  }

  interface WinnerRow {
    consensus_id: string
    request_id: string
    submission_id: string
    lead_id: string
    consensus_final_score: number | null
    intent_details: string | null
    intent_breakdown: IntentBreakdown | null
    intent_signal_mapping: IntentSignalMappingEntry[] | null
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

  // First pass: figure out how many per-signal column blocks we
  // need.  This is the max credited-signal count across every
  // winning lead in the export.  Leads with fewer signals leave
  // trailing blocks blank.
  let maxSignals = 0
  const creditedByConsensus = new Map<string, IntentSignalMappingEntry[]>()
  for (const w of winners) {
    const credited = creditedSignals(w.intent_signal_mapping)
    creditedByConsensus.set(w.consensus_id, credited)
    if (credited.length > maxSignals) maxSignals = credited.length
  }

  // Base lead columns mirror the dashboard table in
  // src/app/admin/requests/[request_id]/_components/AdminRequestDetail.tsx
  // (TABLE_COLUMNS).  Keep the order identical so the CSV reads
  // left-to-right exactly like the UI.
  const baseColumns: string[] = [
    'Name',
    'Email',
    'Role',
    'Company',
    'LinkedIn',
    'Website',
    'Company LinkedIn',
    'Industry',
    'Sub Industry',
    'City',
    'State',
    'Country',
    'HQ State',
    'HQ Country',
    'Employee Count',
    'Description',
    'Intent Details',
    'Phone',
  ]

  // Per-signal column block.  Seven columns per credited signal,
  // matching the fields rendered in IntentSignalsList.
  const signalSubColumns = [
    'Source',
    'Date',
    'Matched ICP Signal',
    'Description',
    'URL',
    'Snippet',
    'Score',
  ]
  const signalColumns: string[] = []
  for (let i = 1; i <= maxSignals; i++) {
    for (const sub of signalSubColumns) {
      signalColumns.push(`Intent Signal ${i} — ${sub}`)
    }
  }

  const header = [...baseColumns, ...signalColumns]
  const lines: string[] = [header.map(csvCell).join(',')]

  for (const w of winners) {
    const entry = (leadDataBySub.get(w.submission_id) || []).find(
      (e) => e.lead_id === w.lead_id,
    )
    const ld = entry?.data || {}

    const baseRow: unknown[] = [
      ld.full_name,
      ld.email,
      ld.role,
      ld.business,
      ld.linkedin_url,
      ld.company_website,
      ld.company_linkedin,
      ld.industry,
      ld.sub_industry,
      ld.city,
      ld.state,
      ld.country,
      ld.company_hq_state,
      ld.company_hq_country,
      ld.employee_count,
      ld.description,
      w.intent_details,
      ld.phone ?? '',
    ]

    const credited = creditedByConsensus.get(w.consensus_id) || []
    const signalRow: unknown[] = []
    for (let i = 0; i < maxSignals; i++) {
      const s = credited[i]
      if (!s) {
        // Lead has fewer signals than this column block; emit
        // seven blank cells so column alignment stays sane.
        for (let j = 0; j < signalSubColumns.length; j++) signalRow.push('')
        continue
      }
      const desc = resolveSignalDescription(credited, w.intent_breakdown, i)
      signalRow.push(
        s.source ?? '',
        s.date ?? '',
        s.matched_icp_signal ?? '',
        desc,
        s.url ?? '',
        s.snippet ?? '',
        typeof s.after_decay_score === 'number'
          ? s.after_decay_score.toFixed(2)
          : '',
      )
    }

    lines.push([...baseRow, ...signalRow].map(csvCell).join(','))
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
