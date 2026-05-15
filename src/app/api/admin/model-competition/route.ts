import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/admin-supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MODEL_COMPETITION_ADMIN_START = '2026-05-14T00:00:00.000Z'

type QualificationModelRow = {
  id: string
  miner_hotkey: string | null
  model_name: string | null
  status: string | null
  score: number | null
  created_at: string | null
  evaluated_at: string | null
  is_champion: boolean | null
  champion_at: string | null
}

export async function GET() {
  let supabase
  try {
    supabase = getAdminSupabase()
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'admin supabase not configured'
    return NextResponse.json({ error: msg }, { status: 503 })
  }

  const { data, error } = await supabase
    .from('qualification_models')
    .select(
      'id, miner_hotkey, model_name, status, score, created_at, evaluated_at, is_champion, champion_at',
    )
    .gte('created_at', MODEL_COMPETITION_ADMIN_START)
    .order('created_at', { ascending: false, nullsFirst: false })
    .limit(1000)

  if (error) {
    return NextResponse.json(
      { error: `Supabase error: ${error.message}` },
      { status: 502 },
    )
  }

  const { count: codeCount } = await supabase
    .from('qualification_models')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', MODEL_COMPETITION_ADMIN_START)
    .not('code_content', 'is', null)

  const models = ((data ?? []) as QualificationModelRow[]).map((row) => ({
      id: row.id,
      minerHotkey: row.miner_hotkey ?? '',
      modelName: row.model_name || 'Unnamed',
      status: row.status || 'unknown',
      score: row.score,
      createdAt: row.created_at,
      evaluatedAt: row.evaluated_at,
      isChampion: row.is_champion ?? false,
      championAt: row.champion_at,
    }))

  return NextResponse.json(
    {
      models,
      stats: {
        totalModels: models.length,
        withCode: codeCount ?? 0,
        evaluated: models.filter((model) => model.status === 'evaluated').length,
        activeChampion: models.find((model) => model.isChampion) ?? null,
      },
      fetchedAt: new Date().toISOString(),
      startsAt: MODEL_COMPETITION_ADMIN_START,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
