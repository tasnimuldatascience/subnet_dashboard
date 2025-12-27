import { NextResponse } from 'next/server'
import { fetchMetagraph } from '@/lib/metagraph'

// Metagraph changes slowly on-chain, so HTTP caching is sufficient
export async function GET() {
  try {
    const result = await fetchMetagraph()

    const response = NextResponse.json(result)

    // HTTP cache headers - aggressive caching since metagraph changes slowly
    response.headers.set(
      'Cache-Control',
      'public, max-age=300, s-maxage=1800, stale-while-revalidate=600'
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
