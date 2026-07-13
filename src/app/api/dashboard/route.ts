import { NextResponse } from 'next/server'
import { fetchAllDashboardData } from '@/lib/db-precalc'
import { fetchMetagraph } from '@/lib/metagraph'
import { getQualificationMinerHotkeys } from '@/lib/cache'
import { getRelativeTime, BUILD_VERSION } from '@/lib/server-data'

// Force dynamic - always run on request
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    console.log('[Dashboard API] Fetching data...')

    // Fetch metagraph (uses server cache, refreshes every 5 min via background task)
    const metagraph = await fetchMetagraph()

    // Fetch dashboard data (uses server cache, refreshes every 5 min via background task)
    const data = await fetchAllDashboardData(0, metagraph)
    console.log('[Dashboard API] Returning data, total:', data.totalSubmissionCount, 'updated:', data.updatedAt)

    // Use Supabase updatedAt directly - this is when pg_cron last refreshed the data
    const serverRefreshedAt = data.updatedAt
    const serverRelativeTime = getRelativeTime(new Date(serverRefreshedAt))

    // Get qualification miner hotkeys from cache
    const qualificationMinerHotkeys = getQualificationMinerHotkeys()

    const response = NextResponse.json({
      ...data,
      hours: 0,
      fetchedAt: Date.now(),
      serverRefreshedAt,
      serverRelativeTime,
      buildVersion: BUILD_VERSION,
      qualificationMinerHotkeys,
    })

    // The payload is identical for every public visitor. Let browsers and
    // shared caches absorb synchronized one-minute polling while the server's
    // stale-safe caches refresh independently.
    response.headers.set(
      'Cache-Control',
      'public, max-age=15, s-maxage=45, stale-while-revalidate=300'
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
