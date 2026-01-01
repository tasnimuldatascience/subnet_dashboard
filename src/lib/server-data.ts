// Server-side data fetching for Server Components
// Uses pre-calculated data from dashboard_precalc table

import { fetchAllDashboardData, type AllDashboardData } from './db-precalc'
import { fetchMetagraph } from './metagraph'
import { getCacheTimestamp } from './cache'
import type { MetagraphData } from './types'

// Helper function to calculate relative time string (server-side)
export function getRelativeTime(date: Date): string {
  const now = new Date()
  const diff = Math.floor((now.getTime() - date.getTime()) / 1000)
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)} minute${Math.floor(diff / 60) === 1 ? '' : 's'} ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)} hour${Math.floor(diff / 3600) === 1 ? '' : 's'} ago`
  return `${Math.floor(diff / 86400)} day${Math.floor(diff / 86400) === 1 ? '' : 's'} ago`
}

export interface InitialPageData {
  dashboardData: AllDashboardData & { hours: number; fetchedAt: number; serverRefreshedAt: string; serverRelativeTime: string }
  metagraph: MetagraphData | null
}

// Fetch initial page data (from pre-calculated table)
export async function getInitialPageData(): Promise<InitialPageData> {
  console.log('[Server] Fetching initial page data from precalc...')
  const startTime = Date.now()

  // Fetch metagraph first (needed for filtering active miners)
  const metagraph = await fetchMetagraph()

  // Fetch pre-calculated dashboard data
  const dashboardData = await fetchAllDashboardData(0, metagraph)

  // Get server cache refresh time (fallback to Supabase updatedAt if cache not yet populated)
  const serverRefreshedAt = getCacheTimestamp('precalc')?.toISOString() || dashboardData.updatedAt
  const serverRelativeTime = getRelativeTime(new Date(serverRefreshedAt))

  const fetchTime = Date.now() - startTime
  console.log(`[Server] Initial data fetched in ${fetchTime}ms (precalc)`)

  return {
    dashboardData: {
      ...dashboardData,
      hours: 0,
      fetchedAt: Date.now(),
      serverRefreshedAt,
      serverRelativeTime,
    },
    metagraph,
  }
}
