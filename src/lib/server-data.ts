// Server-side data fetching for Server Components
// Uses pre-calculated data from dashboard_precalc table

import { fetchAllDashboardData, type AllDashboardData } from './db-precalc'
import { fetchMetagraph } from './metagraph'
import type { MetagraphData } from './types'

export interface InitialPageData {
  dashboardData: AllDashboardData & { hours: number; fetchedAt: number }
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

  const fetchTime = Date.now() - startTime
  console.log(`[Server] Initial data fetched in ${fetchTime}ms (precalc)`)

  return {
    dashboardData: {
      ...dashboardData,
      hours: 0,
      fetchedAt: Date.now(),
    },
    metagraph,
  }
}
