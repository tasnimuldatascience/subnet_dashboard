import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Force dynamic - no caching for model competition data
export const dynamic = 'force-dynamic'
export const revalidate = 0

// Create a fresh Supabase client for each request (no caching)
function getFreshSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  return createClient(url, key, {
    auth: { persistSession: false },
  })
}

// Types matching the VIEW schemas

// qualification_current_champion VIEW
interface CurrentChampion {
  model_id: string
  miner_hotkey: string
  model_name: string | null
  code_hash: string
  score: number
  champion_at: string
  evaluated_at: string | null
}

// qualification_leaderboard VIEW (includes last 24h submitted + evaluated models)
interface LeaderboardEntry {
  model_id: string
  miner_hotkey: string
  model_name: string | null
  status: string              // 'submitted' or 'evaluated'
  score: number | null        // NULL for submitted models
  code_hash: string | null
  is_champion: boolean | null
  champion_at: string | null
  created_at: string          // When model was submitted
  evaluated_at: string | null // When model was evaluated (NULL for submitted)
  icp_set_id: string | null
  code_content: string | null
  rank: number | null         // NULL for submitted models
}

export async function GET() {
  try {
    // Create fresh client for each request - ensures no stale data
    const supabase = getFreshSupabaseClient()

    // Fetch all data in parallel from VIEWS only (not the private table)
    const [
      championResult,
      leaderboardResult,
    ] = await Promise.all([
      // Current champion (from VIEW - always shows current champion)
      supabase
        .from('qualification_current_champion')
        .select('*')
        .limit(1)
        .single(),

      // Leaderboard (from VIEW - last 24h submitted + evaluated models)
      supabase
        .from('qualification_leaderboard')
        .select('*')
        .limit(100),
    ])

    const champion = championResult.data as CurrentChampion | null
    const allModels = (leaderboardResult.data || []) as LeaderboardEntry[]

    // Separate evaluated and submitted models
    const evaluatedModels = allModels.filter(m => m.status === 'evaluated' && m.score !== null)
    const submittedModels = allModels.filter(m => m.status === 'submitted')

    // Stats
    const totalLast24h = allModels.length
    const uniqueMiners = new Set(allModels.map(l => l.miner_hotkey)).size

    // Status counts
    const statusCounts = {
      submitted: submittedModels.length,
      evaluating: 0,  // View doesn't include 'evaluating' status
      evaluated: evaluatedModels.length,
      failed: 0,      // View doesn't include 'failed' status
    }

    // Build response with no-cache headers
    const response = NextResponse.json({
      success: true,
      data: {
        // Current champion (from dedicated VIEW - always available)
        champion: champion ? {
          modelId: champion.model_id,
          minerHotkey: champion.miner_hotkey,
          modelName: champion.model_name || 'Unnamed',
          codeHash: champion.code_hash,
          score: champion.score,
          championAt: champion.champion_at,
          evaluatedAt: champion.evaluated_at,
        } : null,

        // Leaderboard - top 20 EVALUATED models only (sorted by score)
        leaderboard: evaluatedModels
          .sort((a, b) => (b.score || 0) - (a.score || 0))
          .slice(0, 20)
          .map((l, index) => ({
            modelId: l.model_id,
            minerHotkey: l.miner_hotkey,
            modelName: l.model_name || 'Unnamed',
            score: l.score,
            rank: l.rank || index + 1,
            isChampion: l.is_champion,
            evaluatedAt: l.evaluated_at,
          })),

        // Recent submissions (last 24 hours) - ALL models (submitted + evaluated)
        // Sorted by newest first (latest submissions at top)
        recentSubmissions: allModels
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
          .map(m => ({
          id: m.model_id,
          minerHotkey: m.miner_hotkey,
          modelName: m.model_name || 'Unnamed',
          status: m.status,
          score: m.score,
          codeHash: m.code_hash || '',
          codeContent: m.code_content,
          createdAt: m.created_at,
          evaluatedAt: m.evaluated_at,
          isChampion: m.is_champion,
          rank: m.rank,
        })),

        // Stats
        stats: {
          totalSubmissions: totalLast24h,
          uniqueMiners,
          statusCounts,
          championScore: champion?.score || 0,
        },

        // Metadata
        fetchedAt: new Date().toISOString(),
      }
    })

    // Ensure no caching for model competition data
    response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
    response.headers.set('Pragma', 'no-cache')

    return response
  } catch (error) {
    console.error('Error fetching model competition data:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to fetch data' },
      { status: 500 }
    )
  }
}
