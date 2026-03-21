import { NextResponse } from 'next/server'
import { fetchMetagraph } from '@/lib/metagraph'

// Metagraph changes slowly on-chain, but keep cache aligned with server memory TTL
export async function GET() {
  try {
    const result = await fetchMetagraph()

    const response = NextResponse.json({
      ...result,
      cachedAt: Date.now()
    })

    // HTTP cache headers - aligned with server memory TTL (2 min) to avoid stale CDN data
    // max-age=60: Browser caches for 1 minute
    // s-maxage=120: CDN caches for 2 minutes (matches METAGRAPH_TTL)
    // stale-while-revalidate=60: Serve stale for 1 minute while revalidating
    response.headers.set(
      'Cache-Control',
      'public, max-age=60, s-maxage=120, stale-while-revalidate=60'
    )

    return response
  } catch (error) {
    console.error('Error fetching metagraph:', error)

    return NextResponse.json({
      hotkeyToUid: {},
      uidToHotkey: {},
      incentives: {},
      emissions: {},
      stakes: {},
      isValidator: {},
      totalNeurons: 0,
      error: error instanceof Error ? error.message : 'Failed to fetch metagraph data'
    })
  }
}
