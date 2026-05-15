import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/admin-supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MODEL_COMPETITION_ADMIN_START = '2026-05-14T00:00:00.000Z'

function normalizeCodeContent(value: unknown): Record<string, string> | null {
  if (!value) return null

  let parsed = value
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value)
    } catch {
      return { 'raw_code.txt': value }
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null

  const files: Record<string, string> = {}
  for (const [filename, content] of Object.entries(parsed)) {
    if (typeof content === 'string') {
      files[filename] = content
    } else if (content !== null && content !== undefined) {
      files[filename] = JSON.stringify(content, null, 2)
    }
  }

  return Object.keys(files).length > 0 ? files : null
}

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ model_id: string }> },
) {
  const { model_id } = await ctx.params
  if (!model_id) {
    return NextResponse.json({ error: 'model_id is required' }, { status: 400 })
  }

  let supabase
  try {
    supabase = getAdminSupabase()
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'admin supabase not configured'
    return NextResponse.json({ error: msg }, { status: 503 })
  }

  const { data, error } = await supabase
    .from('qualification_models')
    .select('id, code_content, score_breakdown, created_at')
    .eq('id', model_id)
    .gte('created_at', MODEL_COMPETITION_ADMIN_START)
    .limit(1)
    .maybeSingle()

  if (error) {
    return NextResponse.json(
      { error: `Supabase error: ${error.message}` },
      { status: 502 },
    )
  }
  if (!data) {
    return NextResponse.json({ error: 'Model not found' }, { status: 404 })
  }

  return NextResponse.json(
    {
      modelId: data.id,
      codeContent: normalizeCodeContent(data.code_content),
      scoreBreakdown: data.score_breakdown ?? null,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
