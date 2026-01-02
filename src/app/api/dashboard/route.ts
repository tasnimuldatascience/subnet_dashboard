import { NextResponse } from 'next/server'
import { fetchAllDashboardData } from '@/lib/db-precalc'
import { fetchMetagraph } from '@/lib/metagraph'
import { getRelativeTime, BUILD_VERSION } from '@/lib/server-data'
import { clearCache } from '@/lib/cache'

// Force dynamic - never cache this route
export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET() {
  try {
    console.log('[Dashboard API] Fetching FRESH data from precalc...')

    // Clear ALL caches to force fresh data from DB
    clearCache('dashboard_precalc')
    clearCache('metagraph')

    // Fetch metagraph first (needed for filtering active miners)
    const metagraph = await fetchMetagraph()
    console.log('[Dashboard API] Metagraph fetched')

    // Fetch pre-calculated dashboard data
    const data = await fetchAllDashboardData(0, metagraph)
    console.log('[Dashboard API] Data fetched, total submissions:', data.totalSubmissionCount, 'updatedAt:', data.updatedAt)

    // Use Supabase updatedAt directly - this is when pg_cron last refreshed the data
    const serverRefreshedAt = data.updatedAt
    const serverRelativeTime = getRelativeTime(new Date(serverRefreshedAt))

    const response = NextResponse.json({
      ...data,
      hours: 0,
      fetchedAt: Date.now(),
      serverRefreshedAt,
      serverRelativeTime,
      buildVersion: BUILD_VERSION,
    })

    // No HTTP caching - always return fresh data from server cache
    response.headers.set(
      'Cache-Control',
      'no-store, no-cache, must-revalidate'
    )

    return response
  } catch (error) {
    console.error('[Dashboard API] Error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch dashboard data' },
      { status: 500 }
    )
  }
}
