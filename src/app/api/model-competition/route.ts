import { NextResponse } from 'next/server'
import { getModelCompetitionCache } from '@/lib/cache'

export async function GET() {
  try {
    // Get cached model competition data
    const cached = getModelCompetitionCache()

    if (!cached || !cached.data) {
      return NextResponse.json(
        { success: false, error: 'Data not available yet, please try again' },
        { status: 503 }
      )
    }

    return NextResponse.json({
      success: true,
      data: cached.data,
    })
  } catch (error) {
    console.error('Error fetching model competition data:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to fetch data' },
      { status: 500 }
    )
  }
}
