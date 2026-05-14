/**
 * POST /api/admin/requests/[request_id]/deep-research/rerun
 *
 * Resets the deep research state on the chain LEAF so the next
 * gateway lifecycle tick re-runs the Perplexity Sonar Deep Research
 * QA pass. Useful when:
 *   - The first run failed (LLM timeout, rate limit, parse error)
 *   - The lead data changed since the last analysis
 *   - The operator wants a fresh second opinion
 *
 * Idempotent: clobbers any prior status, attempts, error, and analysis
 * back to (pending, 0, null, null). The gateway sweep will then claim
 * the row on its next tick.
 *
 * Requires that the LEAF row already has status='fulfilled' — we
 * don't allow forcing a QA pass on an unfulfilled chain because the
 * leads aren't final yet.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getAdminSupabase, AdminFulfillmentRequest } from '@/lib/admin-supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Walk forward from any chain row to the leaf so the caller can pass
// any request_id in the chain and we still target the correct row.
async function findLeafRequest(
  supabase: ReturnType<typeof getAdminSupabase>,
  startId: string,
): Promise<AdminFulfillmentRequest | null> {
  let cur = startId
  for (let i = 0; i < 50; i++) {
    const { data, error } = await supabase
      .from('fulfillment_requests')
      .select('request_id, status, successor_request_id')
      .eq('request_id', cur)
      .limit(1)
      .maybeSingle()
    if (error || !data) return null
    if (!data.successor_request_id) {
      return data as unknown as AdminFulfillmentRequest
    }
    cur = data.successor_request_id
  }
  return null
}

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ request_id: string }> },
) {
  const { request_id } = await ctx.params
  if (!request_id || !/^[0-9a-f-]{36}$/i.test(request_id)) {
    return NextResponse.json(
      { error: 'invalid request_id' },
      { status: 400 },
    )
  }

  let supabase
  try {
    supabase = getAdminSupabase()
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'admin supabase not configured'
    return NextResponse.json({ error: msg }, { status: 503 })
  }

  const leaf = await findLeafRequest(supabase, request_id)
  if (!leaf) {
    return NextResponse.json(
      { error: 'request not found' },
      { status: 404 },
    )
  }
  if (leaf.status !== 'fulfilled') {
    return NextResponse.json(
      {
        error:
          'Deep research analysis can only be run on fulfilled chains. ' +
          `Current chain status: ${leaf.status}.`,
      },
      { status: 409 },
    )
  }

  // Reset to pending so the gateway sweep picks it up on next tick.
  // We also clear analysis + error so the dashboard immediately stops
  // showing the prior (stale or failed) state. The gateway will write
  // fresh values when the new run completes.
  const { error: updateErr } = await supabase
    .from('fulfillment_requests')
    .update({
      deep_research_status: 'pending',
      deep_research_attempts: 0,
      deep_research_error: null,
      deep_research_started_at: null,
      deep_research_analysis: null,
    })
    .eq('request_id', leaf.request_id)

  if (updateErr) {
    return NextResponse.json(
      { error: `Supabase error: ${updateErr.message}` },
      { status: 502 },
    )
  }

  return NextResponse.json(
    {
      ok: true,
      leaf_request_id: leaf.request_id,
      message:
        'Deep research analysis queued. The gateway sweep runs every ' +
        '30 seconds — refresh in 1-2 minutes for results.',
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
