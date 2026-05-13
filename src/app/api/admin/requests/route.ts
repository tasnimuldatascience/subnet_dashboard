/**
 * GET /api/admin/requests
 *
 * Thin wrapper around listChains() in src/lib/admin-data.ts. The
 * server-rendered /admin page bypasses this and calls listChains()
 * directly; this endpoint exists for any future client-side use
 * (live polling, etc.) and for parity with the rest of the admin
 * surface.
 */

import { NextResponse } from 'next/server'
import { listChains } from '@/lib/admin-data'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const result = await listChains()
    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown error'
    console.error('[admin] /api/admin/requests failed:', e)
    const isConfigError = msg.includes('SUPABASE_SECRET_KEY') || msg.includes('NEXT_PUBLIC_SUPABASE_URL')
    return NextResponse.json(
      { error: msg },
      { status: isConfigError ? 503 : 502 },
    )
  }
}
