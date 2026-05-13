/**
 * GET /api/admin/requests/[request_id]
 *
 * Thin wrapper around getRequestDetail() in src/lib/admin-data.ts.
 * See route.ts in the parent dir for the design rationale.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getRequestDetail } from '@/lib/admin-data'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ request_id: string }> },
) {
  const { request_id } = await ctx.params
  if (!request_id || typeof request_id !== 'string') {
    return NextResponse.json({ error: 'invalid request_id' }, { status: 400 })
  }
  if (!/^[0-9a-f-]{36}$/i.test(request_id)) {
    return NextResponse.json({ error: 'invalid request_id format' }, { status: 400 })
  }
  try {
    const payload = await getRequestDetail(request_id)
    if (!payload) {
      return NextResponse.json({ error: 'request not found' }, { status: 404 })
    }
    return NextResponse.json(payload, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown error'
    console.error(`[admin] /api/admin/requests/${request_id} failed:`, e)
    const isConfigError =
      msg.includes('SUPABASE_SECRET_KEY') || msg.includes('NEXT_PUBLIC_SUPABASE_URL')
    return NextResponse.json(
      { error: msg },
      { status: isConfigError ? 503 : 502 },
    )
  }
}
