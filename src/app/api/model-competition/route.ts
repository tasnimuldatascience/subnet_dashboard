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

// Types for model competition data
interface QualificationModel {
  id: string
  miner_hotkey: string
  model_name: string | null
  status: string
  score: number | null
  score_breakdown: Record<string, number> | null
  code_hash: string
  s3_path: string | null
  created_at: string
  evaluated_at: string | null
  is_champion: boolean | null
  payment_amount_tao: number | null
  evaluation_time_seconds: number | null
  evaluation_cost_usd: number | null
}

interface CurrentChampion {
  model_id: string
  miner_hotkey: string
  model_name: string | null
  code_hash: string
  s3_path: string | null
  score: number
  champion_at: string
  evaluated_at: string | null
}

interface LeaderboardEntry {
  model_id: string
  miner_hotkey: string
  model_name: string | null
  score: number
  rank: number
  is_champion: boolean | null
  evaluated_at: string | null
}

export async function GET() {
  try {
    // Create fresh client for each request - ensures no stale data
    const supabase = getFreshSupabaseClient()

    // Calculate 24 hours ago for filtering recent submissions
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

    // Fetch all data in parallel - fresh from database
    const [
      modelsResult,
      championResult,
      leaderboardResult,
    ] = await Promise.all([
      // Recent submissions (last 24 hours only)
      supabase
        .from('qualification_models')
        .select('id,miner_hotkey,model_name,status,score,score_breakdown,code_hash,s3_path,created_at,evaluated_at,is_champion,payment_amount_tao,evaluation_time_seconds,evaluation_cost_usd')
        .gte('created_at', twentyFourHoursAgo)
        .order('created_at', { ascending: false })
        .limit(100),

      // Current champion (from VIEW)
      supabase
        .from('qualification_current_champion')
        .select('*')
        .limit(1)
        .single(),

      // Leaderboard (from VIEW - top 20)
      supabase
        .from('qualification_leaderboard')
        .select('*')
        .order('rank', { ascending: true })
        .limit(20),
    ])

    // Calculate stats
    const models = (modelsResult.data || []) as QualificationModel[]
    const champion = championResult.data as CurrentChampion | null
    const leaderboard = (leaderboardResult.data || []) as LeaderboardEntry[]

    // Status breakdown
    const statusCounts = {
      submitted: 0,
      evaluating: 0,
      evaluated: 0,
      failed: 0,
    }

    for (const model of models) {
      const status = model.status?.toLowerCase() || 'submitted'
      if (status in statusCounts) {
        statusCounts[status as keyof typeof statusCounts]++
      }
    }

    // Total submissions all-time
    const totalResult = await supabase
      .from('qualification_models')
      .select('id', { count: 'exact', head: true })

    const totalSubmissions = totalResult.count || models.length

    // Unique miners
    const uniqueMiners = new Set(models.map(m => m.miner_hotkey)).size

    // Build response with no-cache headers
    const response = NextResponse.json({
      success: true,
      data: {
        // Current champion
        champion: champion ? {
          modelId: champion.model_id,
          minerHotkey: champion.miner_hotkey,
          modelName: champion.model_name || 'Unnamed',
          codeHash: champion.code_hash,
          score: champion.score,
          championAt: champion.champion_at,
          evaluatedAt: champion.evaluated_at,
        } : null,

        // Leaderboard
        leaderboard: leaderboard.map(l => ({
          modelId: l.model_id,
          minerHotkey: l.miner_hotkey,
          modelName: l.model_name || 'Unnamed',
          score: l.score,
          rank: l.rank,
          isChampion: l.is_champion,
          evaluatedAt: l.evaluated_at,
        })),

        // Recent submissions (last 24 hours)
        recentSubmissions: models.map(m => ({
          id: m.id,
          minerHotkey: m.miner_hotkey,
          modelName: m.model_name || 'Unnamed',
          status: m.status,
          score: m.score,
          scoreBreakdown: m.score_breakdown,
          codeHash: m.code_hash,
          s3Path: m.s3_path,
          createdAt: m.created_at,
          evaluatedAt: m.evaluated_at,
          isChampion: m.is_champion,
          paymentTao: m.payment_amount_tao,
          evaluationTime: m.evaluation_time_seconds,
          evaluationCost: m.evaluation_cost_usd,
        })),

        // Stats
        stats: {
          totalSubmissions,
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
