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

    // The neuron snapshot is deduplicated server-side, but the live best-head
    // block must never be retained by a browser, CDN, or Next.js response
    // cache. A failed live chain read is represented as null, not a stale head.
    response.headers.set('Cache-Control', 'private, no-store, max-age=0')
    response.headers.set('Pragma', 'no-cache')
    response.headers.set('Expires', '0')

    return response
  } catch (error) {
    console.error('Error fetching metagraph:', error)

    const response = NextResponse.json({
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
      tempo: null,
      lastEpochBlock: null,
      subnetEpochIndex: null,
      pendingEpochAt: null,
      lastMechanismStepBlock: null,
      totalNeurons: 0,
      alphaPrice: null,
      error: error instanceof Error ? error.message : 'Failed to fetch metagraph data'
    })
    response.headers.set('Cache-Control', 'private, no-store, max-age=0')
    response.headers.set('Pragma', 'no-cache')
    response.headers.set('Expires', '0')
    return response
  }
}
