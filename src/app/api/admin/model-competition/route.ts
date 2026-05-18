import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/admin-supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MODEL_COMPETITION_ADMIN_START = '2026-05-14T00:00:00.000Z'
const BENCHMARK_HISTORY_START = '2026-05-13T00:00:00.000Z'

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

type BenchmarkIcpSetRow = {
  set_id: number
  icps: unknown[] | null
  icp_set_hash: string | null
  industry_distribution: Record<string, number> | null
  active_from: string | null
  active_until: string | null
  is_active: boolean | null
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

  let benchmarkError: string | null = null
  let benchmarkHistory: Array<{
    setId: number
    date: string
    activeFrom: string | null
    activeUntil: string | null
    isActive: boolean
    icpSetHash: string | null
    industryDistribution: Record<string, number> | null
    icps: unknown[]
    icpCount: number
  }> = []

  const { data: benchmarkData, error: benchmarkErr } = await supabase
    .from('qualification_private_icp_sets')
    .select('set_id, icps, icp_set_hash, industry_distribution, active_from, active_until, is_active')
    .gte('active_from', BENCHMARK_HISTORY_START)
    .order('active_from', { ascending: false, nullsFirst: false })
    .limit(100)

  if (benchmarkErr) {
    benchmarkError = benchmarkErr.message || 'Could not load benchmark history'
  } else {
    benchmarkHistory = ((benchmarkData ?? []) as BenchmarkIcpSetRow[]).map((row) => {
      return {
        setId: row.set_id,
        date: row.active_from
          ? row.active_from.slice(0, 10)
          : String(row.set_id),
        activeFrom: row.active_from,
        activeUntil: row.active_until,
        isActive: Boolean(row.is_active),
        icpSetHash: row.icp_set_hash,
        industryDistribution: row.industry_distribution,
        icps: Array.isArray(row.icps) ? row.icps : [],
        icpCount: Array.isArray(row.icps) ? row.icps.length : 0,
      }
    })
  }

  return NextResponse.json(
    {
      models,
      benchmarkHistory,
      benchmarkError,
      stats: {
        totalModels: models.length,
        withCode: codeCount ?? 0,
        evaluated: models.filter((model) => model.status === 'evaluated').length,
        activeChampion: models.find((model) => model.isChampion) ?? null,
      },
      fetchedAt: new Date().toISOString(),
      startsAt: MODEL_COMPETITION_ADMIN_START,
      benchmarkStartsAt: BENCHMARK_HISTORY_START,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
