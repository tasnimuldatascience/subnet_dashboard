/**
 * POST /api/admin/requests/[request_id]/deep-research/rerun
 *
 * Resets the deep research state on the chain LEAF and immediately
 * fires the worker so the operator sees results within ~90s without
 * having to wait for the background sweep tick. Useful when:
 *   - The first run failed (LLM timeout, rate limit, parse error)
 *   - The lead data changed since the last analysis
 *   - The operator wants a fresh second opinion
 *
 * Returns the post-call state in the response so the dashboard can
 * decide whether to show success / failure / try-again without an
 * extra round-trip.
 *
 * Requires the LEAF row to already have status='fulfilled' — we
 * don't allow forcing a QA pass on an unfulfilled chain because the
 * leads aren't final yet.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getAdminSupabase, AdminFulfillmentRequest } from '@/lib/admin-supabase'
import { runForRequest } from '@/lib/deep-research/worker'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Same rationale as the sweep route: Deep Research takes ~90s and we
// want the rerun's HTTP response to carry the final result rather
// than just a queued ack.
export const maxDuration = 300

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
    return NextResponse.json({ error: 'invalid request_id' }, { status: 400 })
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
    return NextResponse.json({ error: 'request not found' }, { status: 404 })
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

  // Reset the state machine so the worker's claim transition succeeds.
  // We null analysis + error so the dashboard immediately stops showing
  // the prior (stale or failed) state.
  const { error: resetErr } = await supabase
    .from('fulfillment_requests')
    .update({
      deep_research_status: 'pending',
      deep_research_attempts: 0,
      deep_research_error: null,
      deep_research_started_at: null,
      deep_research_analysis: null,
    })
    .eq('request_id', leaf.request_id)
  if (resetErr) {
    return NextResponse.json(
      { error: `Supabase error: ${resetErr.message}` },
      { status: 502 },
    )
  }

  // Fire the worker inline. The HTTP response holds the call open for
  // up to 5 minutes (maxDuration above), so the operator's "Re-run"
  // button completes with the actual result, not just a queued ack.
  const result = await runForRequest(supabase, leaf.request_id)

  return NextResponse.json(
    {
      ok: result.ok,
      leaf_request_id: leaf.request_id,
      run_status: result.status,
      error: result.error,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
