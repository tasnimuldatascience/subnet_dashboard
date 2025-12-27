import { NextResponse } from 'next/server'
import { fetchAllDashboardData } from '@/lib/db-precalc'
import { fetchMetagraph } from '@/lib/metagraph'

export async function GET() {
  try {
    console.log('[Dashboard API] Fetching data from precalc...')

    // Fetch metagraph first (needed for filtering active miners)
    const metagraph = await fetchMetagraph()

    // Fetch pre-calculated dashboard data
    const data = await fetchAllDashboardData(0, metagraph)

    const response = NextResponse.json({
      ...data,
      hours: 0,
      fetchedAt: Date.now(),
    })

    // Short HTTP cache (data refreshes every 5 min via pg_cron)
    response.headers.set(
      'Cache-Control',
      'public, max-age=60, stale-while-revalidate=30'
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
