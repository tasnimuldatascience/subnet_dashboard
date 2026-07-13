import { NextResponse } from 'next/server'
import { fetchMetagraph } from '@/lib/metagraph'

export const dynamic = 'force-dynamic'

// Metagraph changes slowly on-chain, but keep cache aligned with server memory TTL
export async function GET() {
  try {
    const result = await fetchMetagraph()

    const response = NextResponse.json({
      ...result,
      cachedAt: Date.now()
    })

    // Keep HTTP caching aligned with the 30-second in-memory snapshot. Admin
    // clients also add a cache buster and poll every 30 seconds.
    response.headers.set(
      'Cache-Control',
      'public, max-age=15, s-maxage=30, stale-while-revalidate=15'
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
      active: {},
      names: {},
      ranks: {},
      trusts: {},
      validatorTrusts: {},
      consensus: {},
      dividends: {},
      axons: {},
      lastUpdates: {},
      currentBlock: null,
      totalNeurons: 0,
      alphaPrice: null,
      error: error instanceof Error ? error.message : 'Failed to fetch metagraph data'
    })
  }
}
