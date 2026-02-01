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

    // Fetch model from database (fresh, no cache)
    const { data: model, error } = await supabase
      .from('qualification_models')
      .select('id, status, code_content, code_hash, miner_hotkey')
      .eq('id', modelId)
      .single()

    if (error || !model) {
      return NextResponse.json(
        { success: false, error: 'Model not found' },
        { status: 404 }
      )
    }

    // Only allow viewing code for evaluated models
    if (model.status.toLowerCase() !== 'evaluated') {
      return NextResponse.json(
        { success: false, error: 'Code is only available for evaluated models' },
        { status: 403 }
      )
    }

    // Check if code content exists
    if (!model.code_content) {
      return NextResponse.json({
        success: false,
        error: 'Code content not yet available. Code storage is being set up.',
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
      modelId: model.id,
      codeHash: model.code_hash,
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
