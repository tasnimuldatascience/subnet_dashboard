import { NextResponse } from 'next/server'
import {
  fetchBestSubnetEpochState,
  getLastSuccessfulSubnetEpochState,
} from '@/lib/subnet-epoch-state'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0
export const fetchCache = 'force-no-store'

const LAST_GOOD_MAX_AGE_MS = 5 * 60_000

const NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0, must-revalidate',
  Pragma: 'no-cache',
  Expires: '0',
}

export async function GET() {
  const errorTag = `admin-subnet-epoch:${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`
  try {
    const snapshot = await fetchBestSubnetEpochState()
    return NextResponse.json(
      { ...snapshot, freshness: 'live' },
      { headers: { ...NO_STORE_HEADERS, 'X-Subnet-Epoch-Freshness': 'live' } },
    )
  } catch (error) {
    console.error(`[${errorTag}] Live subnet epoch state request failed`, error)
    const lastGood = getLastSuccessfulSubnetEpochState(LAST_GOOD_MAX_AGE_MS)
    if (lastGood) {
      return NextResponse.json(
        {
          ...lastGood,
          freshness: 'stale',
          refreshError: 'Live subnet epoch state is temporarily unavailable.',
          errorTag,
        },
        { headers: { ...NO_STORE_HEADERS, 'X-Subnet-Epoch-Freshness': 'stale' } },
      )
    }
    return NextResponse.json(
      { error: 'Live subnet epoch state is temporarily unavailable.', errorTag },
      { status: 502, headers: NO_STORE_HEADERS },
    )
  }
}
