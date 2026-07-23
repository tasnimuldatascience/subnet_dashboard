import { NextResponse } from 'next/server'
import { getModelCompetitionCache } from '@/lib/cache'
import { createClient } from '@supabase/supabase-js'

const MODEL_COMPETITION_SUBMISSIONS_LIVE_AT = '2026-05-14T00:00:00Z'

function todayMidnightUtc(): Date {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0))
}

async function fetchPastSubmissionsFallback() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SECRET_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const supabase = createClient(url, key, { auth: { persistSession: false } })
  // code_content deliberately not selected: the dialog lazy-loads code via
  // /api/model-code (same 24h public lock), so this per-request fallback stays
  // metadata-sized instead of shipping every model's code.
  const { data, error } = await supabase
    .from('qualification_models')
    .select('id, miner_hotkey, model_name, status, score, score_breakdown, created_at, evaluated_at, is_champion')
    .gte('created_at', MODEL_COMPETITION_SUBMISSIONS_LIVE_AT)
    .order('created_at', { ascending: false })
    .limit(100)

  if (error) {
    console.error('[Model Competition API] past submissions fallback failed:', error)
    return []
  }

  const midnight = todayMidnightUtc().getTime()
  const twentyFourHoursAgo = Date.now() - 24 * 60 * 60 * 1000

  return (data || [])
    .filter((m) => new Date(m.created_at).getTime() < midnight)
    .map((m) => {
      const createdAtMs = new Date(m.created_at).getTime()
      const canShowCode = createdAtMs < twentyFourHoursAgo

      return {
        id: m.id,
        minerHotkey: m.miner_hotkey,
        modelName: m.model_name || 'Unnamed',
        status: m.status,
        score: m.score,
        scoreBreakdown: m.score_breakdown,
        // Lazy-loaded by the dialog via /api/model-code when canShowCode.
        codeContent: null,
        createdAt: m.created_at,
        evaluatedAt: m.evaluated_at,
        isChampion: Boolean(m.is_champion),
        canShowCode,
      }
    })
}

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

    const data =
      cached.data && typeof cached.data === 'object'
        ? {
            ...(cached.data as Record<string, unknown>),
            pastSubmissions:
              Array.isArray((cached.data as { pastSubmissions?: unknown }).pastSubmissions) &&
              ((cached.data as { pastSubmissions?: unknown[] }).pastSubmissions?.length ?? 0) > 0
                ? (cached.data as { pastSubmissions?: unknown }).pastSubmissions
                : await fetchPastSubmissionsFallback(),
          }
        : cached.data

    return NextResponse.json({
      success: true,
      data,
    })
  } catch (error) {
    console.error('Error fetching model competition data:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to fetch data' },
      { status: 500 }
    )
  }
}
