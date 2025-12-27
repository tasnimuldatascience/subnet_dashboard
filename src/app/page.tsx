// Server Component - data is fetched on the server for instant page loads
import { getInitialPageData } from '@/lib/server-data'
import { DashboardClient } from '@/components/dashboard'

// Force dynamic rendering to always show fresh data
export const dynamic = 'force-dynamic'

export default async function Dashboard() {
  // Fetch aggregated data server-side (no raw data caching!)
  const { dashboardData, metagraph } = await getInitialPageData()

  // Pass pre-fetched data to client component
  return (
    <DashboardClient
      initialData={dashboardData}
      metagraph={metagraph}
    />
  )
}
