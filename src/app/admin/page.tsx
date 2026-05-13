import { headers } from 'next/headers'
import { AdminRequestList, ChainSummary } from './_components/AdminRequestList'

export const dynamic = 'force-dynamic'

async function fetchChains(): Promise<ChainSummary[]> {
  // Build the absolute URL so this works on Vercel, on EC2 behind
  // nginx, or in dev. Next 15 makes headers() async, so we await it.
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host')
  const proto = h.get('x-forwarded-proto') ?? 'https'
  const base = host ? `${proto}://${host}` : ''
  // Forward the operator's session cookie so the API call re-passes
  // the auth gate. Without this, the server-side fetch would hit
  // /api/admin and bounce off middleware with 401.
  const cookie = h.get('cookie')
  const res = await fetch(`${base}/api/admin/requests`, {
    cache: 'no-store',
    headers: cookie ? { cookie } : undefined,
  })
  if (!res.ok) {
    throw new Error(`API returned ${res.status}: ${await res.text()}`)
  }
  const body = await res.json()
  return body.chains ?? []
}

export default async function AdminLandingPage() {
  let chains: ChainSummary[] = []
  let error: string | null = null
  try {
    chains = await fetchChains()
  } catch (e) {
    error = e instanceof Error ? e.message : 'Unknown error loading requests'
  }

  return <AdminRequestList chains={chains} error={error} />
}
