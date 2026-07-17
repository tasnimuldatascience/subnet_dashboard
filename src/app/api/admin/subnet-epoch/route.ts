import { NextResponse } from 'next/server'
import { fetchBestSubnetEpochState } from '@/lib/subnet-epoch-state'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0
export const fetchCache = 'force-no-store'

const NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0, must-revalidate',
  Pragma: 'no-cache',
  Expires: '0',
}

export async function GET() {
  const errorTag = `admin-subnet-epoch:${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`
  try {
    const snapshot = await fetchBestSubnetEpochState()
    return NextResponse.json(snapshot, { headers: NO_STORE_HEADERS })
  } catch (error) {
    console.error(`[${errorTag}] Live subnet epoch state request failed`, error)
    return NextResponse.json(
      { error: 'Live subnet epoch state is temporarily unavailable.', errorTag },
      { status: 502, headers: NO_STORE_HEADERS },
    )
  }
}
