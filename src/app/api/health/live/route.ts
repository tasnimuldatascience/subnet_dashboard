import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json(
    {
      ok: true,
      status: 'live',
      buildVersion: process.env.BUILD_TIME ?? null,
      uptimeSeconds: Math.round(process.uptime()),
      checkedAt: new Date().toISOString(),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
