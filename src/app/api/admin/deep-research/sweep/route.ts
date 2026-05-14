/**
 * POST /api/admin/deep-research/sweep
 *
 * Runs one sweep iteration: resets stranded in_progress rows and
 * dispatches the worker for up to N pending fulfilled chains.
 *
 * Callers:
 *   - The boot-time background interval (instrumentation.ts) hits this
 *     route every 60s. That's what makes "auto-run on fulfilled
 *     status change" actually automatic.
 *   - An admin can also POST it manually as a force-refresh — useful
 *     when the boot interval hasn't fired yet or you want to drain
 *     a backlog immediately.
 *
 * Single-tenant admin product, so we don't gate this with extra auth
 * beyond the HTTP Basic prompt that already protects /admin. The
 * middleware that protects the rest of /api/admin applies here too.
 */

import { NextResponse } from 'next/server'
import { runSweep } from '@/lib/deep-research/sweep'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Long-running route: Deep Research can take ~90s per call and we run
// up to 2 in parallel. 300s gives plenty of headroom on EC2.
export const maxDuration = 300

async function handle() {
  try {
    const result = await runSweep()
    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[deep_research] sweep route error', msg)
    return NextResponse.json(
      { error: `Sweep failed: ${msg}` },
      { status: 500 },
    )
  }
}

export async function POST() {
  return handle()
}

// Allow GET too so a vanilla cron/curl ping works without a body.
export async function GET() {
  return handle()
}
