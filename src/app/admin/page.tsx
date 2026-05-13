import { AdminRequestList, ChainSummary } from './_components/AdminRequestList'
import { listChains } from '@/lib/admin-data'

export const dynamic = 'force-dynamic'

export default async function AdminLandingPage() {
  let chains: ChainSummary[] = []
  let error: string | null = null
  // Call the Supabase data layer directly — no HTTP round-trip, no
  // cookie forwarding, no host-resolution. Errors here surface as a
  // styled error block, not a raw 500. The /api/admin/requests
  // route is still available for any future client-side use.
  try {
    const result = await listChains()
    chains = result.chains
  } catch (e) {
    error = e instanceof Error ? e.message : 'Unknown error loading requests'
    // Surface to Vercel/EC2 logs so the operator can debug from
    // their deployment logs without hitting the page repeatedly.
    console.error('[admin] /admin page failed to load chains:', e)
  }

  return <AdminRequestList chains={chains} error={error} />
}
