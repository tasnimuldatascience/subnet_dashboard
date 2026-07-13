import os from 'node:os'
import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { getDashboardCacheHealth } from '@/lib/db-precalc'
import { getMetagraphCacheHealth } from '@/lib/metagraph'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_CACHE_AGE_MS = 10 * 60 * 1000
const DEFAULT_MAX_RSS_MB = 1_300
const DEFAULT_MIN_FREE_MEMORY_MB = 192

function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export async function GET() {
  const checkedAt = new Date().toISOString()
  const dashboard = getDashboardCacheHealth()
  const metagraph = getMetagraphCacheHealth()
  const rssMb = process.memoryUsage().rss / (1024 * 1024)
  const freeMemoryMb = os.freemem() / (1024 * 1024)
  const maxRssMb = positiveNumber(process.env.HEALTH_MAX_RSS_MB, DEFAULT_MAX_RSS_MB)
  const minFreeMemoryMb = positiveNumber(
    process.env.HEALTH_MIN_FREE_MEMORY_MB,
    DEFAULT_MIN_FREE_MEMORY_MB,
  )

  let databaseOk = false
  let databaseDetail: string | null = null
  try {
    const { error } = await supabase
      .from('dashboard_precalc')
      .select('updated_at')
      .eq('id', 1)
      .limit(1)
      .abortSignal(AbortSignal.timeout(3_000))
    databaseOk = !error
    databaseDetail = error?.message ?? null
  } catch (error) {
    databaseDetail = error instanceof Error ? error.message : 'Database readiness check failed'
  }

  const dashboardOk = dashboard.available && (dashboard.ageMs ?? Infinity) <= MAX_CACHE_AGE_MS
  const metagraphOk = metagraph.available && (metagraph.ageMs ?? Infinity) <= MAX_CACHE_AGE_MS
  const memoryOk = rssMb <= maxRssMb && freeMemoryMb >= minFreeMemoryMb
  const ok = databaseOk && dashboardOk && metagraphOk && memoryOk

  return NextResponse.json(
    {
      ok,
      status: ok ? 'ready' : 'degraded',
      buildVersion: process.env.BUILD_TIME ?? null,
      checks: {
        database: { ok: databaseOk, detail: databaseDetail },
        dashboardCache: { ok: dashboardOk, ageMs: dashboard.ageMs },
        metagraphCache: {
          ok: metagraphOk,
          ageMs: metagraph.ageMs,
          refreshing: metagraph.refreshing,
          totalNeurons: metagraph.totalNeurons,
        },
        memory: {
          ok: memoryOk,
          rssMb: Math.round(rssMb),
          maxRssMb,
          freeMemoryMb: Math.round(freeMemoryMb),
          minFreeMemoryMb,
        },
      },
      checkedAt,
    },
    {
      status: ok ? 200 : 503,
      headers: { 'Cache-Control': 'no-store' },
    },
  )
}
