import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Force dynamic - no caching
export const dynamic = 'force-dynamic'
export const revalidate = 0

// Create a fresh Supabase client for each request
function getFreshSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  return createClient(url, key, {
    auth: { persistSession: false },
  })
}

export async function GET(request: NextRequest) {
  try {
    // Create fresh client for each request
    const supabase = getFreshSupabaseClient()

    const { searchParams } = new URL(request.url)
    const modelId = searchParams.get('modelId')

    if (!modelId) {
      return NextResponse.json(
        { success: false, error: 'Model ID is required' },
        { status: 400 }
      )
    }

    // Fetch model from qualification_leaderboard VIEW (public, last 24h models)
    // The view contains both submitted and evaluated models
    const { data: model, error } = await supabase
      .from('qualification_leaderboard')
      .select('model_id, status, code_content, miner_hotkey, created_at')
      .eq('model_id', modelId)
      .single()

    if (error || !model) {
      return NextResponse.json(
        { success: false, error: 'Model not found or no longer available (only last 24h models are accessible)' },
        { status: 404 }
      )
    }

    // Only allow viewing code for evaluated models
    if (model.status !== 'evaluated') {
      return NextResponse.json({
        success: false,
        error: 'Code is only available for evaluated models. This model is still pending evaluation.',
      }, { status: 403 })
    }

    // Check if this is the current champion - if so, apply 24-hour protection
    const { data: champion } = await supabase
      .from('qualification_current_champion')
      .select('model_id')
      .limit(1)
      .single()

    const isCurrentChampion = champion && champion.model_id === modelId

    if (isCurrentChampion && model.created_at) {
      const createdAt = new Date(model.created_at)
      const now = new Date()
      const hoursSinceSubmission = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60)

      if (hoursSinceSubmission < 24) {
        const hoursRemaining = Math.ceil(24 - hoursSinceSubmission)
        return NextResponse.json({
          success: false,
          error: `Champion code will be available in ${hoursRemaining} hour${hoursRemaining === 1 ? '' : 's'}. The champion model is protected for 24 hours after submission.`,
          hoursRemaining,
        }, { status: 403 })
      }
    }

    // Check if code content exists
    if (!model.code_content) {
      return NextResponse.json({
        success: false,
        error: 'Code content not available for this model.',
      })
    }

    // Parse code content (stored as JSON object with filename -> content)
    let codeFiles: Record<string, string>
    try {
      codeFiles = typeof model.code_content === 'string'
        ? JSON.parse(model.code_content)
        : model.code_content
    } catch {
      return NextResponse.json({
        success: false,
        error: 'Invalid code content format',
      })
    }

    return NextResponse.json({
      success: true,
      modelId: model.model_id,
      code: codeFiles,
    })
  } catch (err) {
    console.error('Error fetching model code:', err)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
