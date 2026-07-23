// Simple in-memory cache for precalc data
// Dashboard data refreshes every 5 minutes (matches pg_cron schedule)
// Model competition data refreshes every 1 minute

interface CacheEntry<T> {
  data: T
  timestamp: number
}

// Use global to persist cache across hot reloads in dev mode
const globalForCache = globalThis as unknown as {
  precalcCache: Map<string, CacheEntry<unknown>>
  refreshInterval: NodeJS.Timeout | null
  modelCompetitionRefreshInterval: NodeJS.Timeout | null
  lastBackgroundRefresh: Date | null  // Separate timestamp for background refresh only
  lastModelCompetitionRefresh: Date | null
}

if (!globalForCache.precalcCache) {
  globalForCache.precalcCache = new Map()
}
if (!globalForCache.lastBackgroundRefresh) {
  globalForCache.lastBackgroundRefresh = null
}
if (!globalForCache.lastModelCompetitionRefresh) {
  globalForCache.lastModelCompetitionRefresh = null
}

const cache = globalForCache.precalcCache

// Cache TTL: 5 minutes (matches pg_cron refresh schedule)
const FRESH_TTL = 5 * 60 * 1000   // 5 minutes - serve cached data
const STALE_TTL = 10 * 60 * 1000  // 10 minutes - max age before forcing refresh

// Track in-flight requests to prevent thundering herd
const inFlight = new Map<string, Promise<unknown>>()

export function getCached<T>(key: string): { data: T; fresh: boolean } | null {
  const entry = cache.get(key) as CacheEntry<T> | undefined
  if (!entry) return null

  const age = Date.now() - entry.timestamp
  if (age > STALE_TTL) {
    // Too old, don't use
    cache.delete(key)
    return null
  }

  return {
    data: entry.data,
    fresh: age <= FRESH_TTL
  }
}

export function setCache<T>(key: string, data: T): void {
  cache.set(key, {
    data,
    timestamp: Date.now()
  })
}

// Get the timestamp when cache was last refreshed by background task
export function getCacheTimestamp(key: string): Date | null {
  // Return the background refresh timestamp (not the cache entry timestamp)
  // This ensures we show when data was actually refreshed, not when it was last fetched
  if (key === 'dashboard_precalc' && globalForCache.lastBackgroundRefresh) {
    return globalForCache.lastBackgroundRefresh
  }
  // Fallback to cache entry timestamp
  const entry = cache.get(key)
  if (!entry) return null
  return new Date(entry.timestamp)
}

// Set the background refresh timestamp (called only during background refresh)
export function setBackgroundRefreshTimestamp(): void {
  globalForCache.lastBackgroundRefresh = new Date()
}

// Clear cache entry to force fresh fetch
export function clearCache(key: string): void {
  cache.delete(key)
}

// Warm cache on server start - called from instrumentation.ts
export async function warmCache(): Promise<void> {
  console.log('[Cache] Warming cache...')
  const startTime = Date.now()

  try {
    // Import here to avoid circular dependencies
    const { fetchMetagraph } = await import('./metagraph')
    const { fetchAllDashboardData, warmLatestLeadsCache } = await import('./db-precalc')

    // Fetch metagraph first (needed for dashboard data)
    const metagraph = await fetchMetagraph()
    console.log('[Cache] Metagraph cached')

    // Fetch dashboard data (forceRefresh=true to transform and cache)
    await fetchAllDashboardData(0, metagraph, true)
    console.log('[Cache] Dashboard data cached')

    // Warm latest leads cache
    await warmLatestLeadsCache(metagraph)
    console.log('[Cache] Latest leads cached')

    // Set the background refresh timestamp
    setBackgroundRefreshTimestamp()

    console.log(`[Cache] Warm-up completed in ${Date.now() - startTime}ms`)
  } catch (error) {
    console.error('[Cache] Warm-up error:', error)
    throw error
  }
}

// Background refresh interval (5 minutes)
const REFRESH_INTERVAL = 5 * 60 * 1000

// Calculate ms until next refresh time (synced to :02, :07, :12, :17, etc.)
// This ensures we refresh 2 minutes after Supabase updates at :00, :05, :10, etc.
function getMsUntilNextRefresh(): number {
  const now = new Date()
  const minutes = now.getMinutes()
  const seconds = now.getSeconds()
  const ms = now.getMilliseconds()

  // Find next minute ending in 2 or 7 (i.e., 2, 7, 12, 17, 22, 27, 32, 37, 42, 47, 52, 57)
  const currentMinuteInCycle = minutes % 5
  let minutesUntilNext: number

  if (currentMinuteInCycle < 2) {
    // Current minute is 0-1, 5-6, 10-11, etc. - next refresh is in (2 - currentMinuteInCycle) minutes
    minutesUntilNext = 2 - currentMinuteInCycle
  } else {
    // Current minute is 2-4, 7-9, etc. - next refresh is in (7 - currentMinuteInCycle) minutes
    minutesUntilNext = 7 - currentMinuteInCycle
  }

  // Subtract current seconds and ms
  const msUntilNext = (minutesUntilNext * 60 * 1000) - (seconds * 1000) - ms

  return msUntilNext > 0 ? msUntilNext : REFRESH_INTERVAL
}

// Perform the actual refresh
async function doRefresh(): Promise<void> {
  console.log('[Cache] Background refresh starting...')
  const startTime = Date.now()

  try {
    const { fetchMetagraphFresh, setMetagraphCache } = await import('./metagraph')
    const { fetchAllDashboardData, warmLatestLeadsCache } = await import('./db-precalc')

    // Fetch first, then atomically replace the cache while retaining any
    // last-known validator names that the identity enrichment omitted.
    const refreshedMetagraph = await fetchMetagraphFresh()
    const newMetagraph = setMetagraphCache(refreshedMetagraph)

    // Clear dashboard cache and refresh with new metagraph
    clearCache('dashboard_precalc')

    // Refresh dashboard data (forceRefresh=true to re-transform)
    await fetchAllDashboardData(0, newMetagraph, true)

    // Refresh latest leads
    await warmLatestLeadsCache(newMetagraph)

    // Set the background refresh timestamp
    setBackgroundRefreshTimestamp()

    console.log(`[Cache] Background refresh completed in ${Date.now() - startTime}ms`)
  } catch (error) {
    console.error('[Cache] Background refresh error:', error)
  }
}

// Start background refresh - synced to Supabase's 5-minute schedule
export function startBackgroundRefresh(): void {
  if (globalForCache.refreshInterval) {
    console.log('[Cache] Background refresh already running')
    return
  }

  const msUntilFirst = getMsUntilNextRefresh()
  const nextRefreshTime = new Date(Date.now() + msUntilFirst)
  console.log(`[Cache] Starting background refresh (synced to Supabase schedule)`)
  console.log(`[Cache] First refresh in ${Math.round(msUntilFirst / 1000)}s at ${nextRefreshTime.toLocaleTimeString()}`)

  // First refresh synced to schedule
  setTimeout(() => {
    doRefresh()

    // Then refresh every 5 minutes
    globalForCache.refreshInterval = setInterval(doRefresh, REFRESH_INTERVAL)
    console.log('[Cache] Background refresh interval started (every 5 minutes)')
  }, msUntilFirst)
}

// Model Competition refresh interval (1 minute)
const MODEL_COMPETITION_REFRESH_INTERVAL = 60 * 1000

// =================================================================
// MODEL_COMPETITION_V2_LIVE_AT
// =================================================================
// Cutover instant for the company-mode model competition (v2). Any
// champion crowned BEFORE this instant ran the old leads-with-contacts
// scoring pipeline and is no longer comparable to current champions.
// We hide those rows from the dashboard so the lineage strip and
// "current champion" slot only show the new-era competition.
//
// Default value: 2026-05-14T04:00:00Z — a few minutes before the
// hard-cutover commit ``313b7997 refactor(qualification): hard cutover
// to company-mode model competition`` (committed 2026-05-13T21:03:17
// PT / 2026-05-14T04:03:17Z). Conservative — picks up the cutover
// commit itself and anything crowned after the gateway restart.
//
// Override via env if the deploy slips, or push the cutover forward if
// any old-era rows leak through after the production restart. The
// constant is intentionally evaluated at module load so a value change
// requires a dashboard restart (matches the deploy-time semantics of
// the rest of this cache).
const MODEL_COMPETITION_V2_LIVE_AT =
  process.env.MODEL_COMPETITION_V2_LIVE_AT || '2026-05-14T04:00:00Z'
const MODEL_COMPETITION_SUBMISSIONS_LIVE_AT = '2026-05-14T00:00:00Z'
const BASELINE_MODEL_DIRECTORY = 'miner_models/qualification_model'
const BASELINE_MODEL_SOURCE_URL =
  `https://github.com/leadpoet/leadpoet/tree/main/${BASELINE_MODEL_DIRECTORY}`
const BASELINE_MODEL_TREE_API_URL =
  'https://api.github.com/repos/leadpoet/leadpoet/git/trees/main?recursive=1'
const BASELINE_MODEL_RAW_BASE_URL =
  'https://raw.githubusercontent.com/leadpoet/leadpoet/main'

// Get today's 12 AM UTC timestamp
function getTodayMidnightUTC(): Date {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0))
}

// Check if a date is after today's 12 AM UTC
function isToday(dateStr: string | null): boolean {
  if (!dateStr) return false
  const date = new Date(dateStr)
  const midnightUTC = getTodayMidnightUTC()
  return date.getTime() >= midnightUTC.getTime()
}

function normalizeCodeContent(value: unknown, context: string): Record<string, string> | null {
  if (!value) return null

  try {
    let parsed: unknown
    if (typeof value === 'string') {
      try {
        parsed = JSON.parse(value)
      } catch {
        return value.trim() ? { 'baseline_model.py': value } : null
      }
    } else {
      parsed = value
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null

    const files: Record<string, string> = {}
    for (const [filename, content] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof content === 'string') files[filename] = content
    }
    return Object.keys(files).length > 0 ? files : null
  } catch {
    console.error(`[Cache] Failed to parse code_content for ${context}`)
    return null
  }
}

async function fetchOpenSourceBaselineCode(): Promise<Record<string, string> | null> {
  try {
    const treeRes = await fetch(BASELINE_MODEL_TREE_API_URL, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'leadpoet-dashboard',
      },
      cache: 'no-store',
    })
    if (!treeRes.ok) {
      console.error(`[Cache] Failed to fetch baseline model tree: ${treeRes.status}`)
      return null
    }

    const payload = await treeRes.json() as {
      tree?: Array<{ path?: string; type?: string }>
    }
    const paths = (payload.tree ?? [])
      .filter((entry) =>
        entry.type === 'blob' &&
        typeof entry.path === 'string' &&
        entry.path.startsWith(`${BASELINE_MODEL_DIRECTORY}/`)
      )
      .map((entry) => entry.path as string)
      .sort((a, b) => a.localeCompare(b))

    if (paths.length === 0) {
      console.error('[Cache] Baseline model directory contained no files')
      return null
    }

    const files: Record<string, string> = {}
    await Promise.all(paths.map(async (path) => {
      const rawRes = await fetch(`${BASELINE_MODEL_RAW_BASE_URL}/${path}`, {
        headers: { Accept: 'text/plain' },
        cache: 'no-store',
      })
      if (!rawRes.ok) {
        throw new Error(`Failed to fetch ${path}: ${rawRes.status}`)
      }

      files[path] = await rawRes.text()
    }))

    return Object.keys(files).length > 0 ? files : null
  } catch (error) {
    console.error('[Cache] Failed to fetch baseline model source:', error)
    return null
  }
}

// Fetch model competition data from Supabase
// Fetches from both qualification_leaderboard (today's evaluations) and qualification_champion_history
async function fetchModelCompetitionData(): Promise<unknown> {
  const { createClient } = await import('@supabase/supabase-js')

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SECRET_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const supabase = createClient(url, key, {
    auth: { persistSession: false },
  })

  // Query qualification_leaderboard for today's evaluations
  // Explicit metadata columns: code_content is never viewable for today's
  // (<24h) models, so the every-60s refresh must not ship it.
  const { data: allModels, error: leaderboardError } = await supabase
    .from('qualification_leaderboard')
    .select('model_id, miner_hotkey, model_name, status, score, score_breakdown, created_at, evaluated_at, is_champion')
    .limit(500)

  if (leaderboardError) {
    console.error('[Cache] Error fetching qualification_leaderboard:', leaderboardError)
  }

  const models = allModels || []

  // Filter to only today's submissions (created after 12 AM UTC)
  const todaysModels = models.filter((m: { created_at: string }) => isToday(m.created_at))
  const evaluatedModelsToday = todaysModels.filter((m: { status: string; score: number | null; evaluated_at: string | null }) =>
    m.status === 'evaluated' && m.score !== null && isToday(m.evaluated_at)
  )
  const submittedModels = todaysModels.filter((m: { status: string }) => m.status === 'submitted')

  // Check if submission is more than 24 hours ago (code can be shown)
  const now = new Date()
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)

  // Fetch current champion from qualification_models (persistent, not cleared daily)
  const { data: champModel } = await supabase
    .from('qualification_models')
    .select('id, miner_hotkey, model_name, score, score_breakdown, champion_at, created_at')
    .eq('is_champion', true)
    .limit(1)
    .single()

  // Fetch reference model baseline score (daily benchmark on today's ICP set)
  const { data: baselineData } = await supabase
    .from('qualification_baselines')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  const baselineRow = (baselineData ?? null) as Record<string, unknown> | null
  const baselineCodeSource =
    baselineRow?.code_content ??
    baselineRow?.model_code ??
    baselineRow?.reference_model_code ??
    baselineRow?.baseline_code ??
    baselineRow?.source_code ??
    null
  const baselineCodeContent =
    (await fetchOpenSourceBaselineCode()) ??
    normalizeCodeContent(baselineCodeSource, 'baseline model')
  const baselineScore = Number(baselineRow?.baseline_score ?? 0)
  const baselineSetIdRaw = baselineRow?.set_id
  const baselineSetId =
    typeof baselineSetIdRaw === 'number'
      ? baselineSetIdRaw
      : typeof baselineSetIdRaw === 'string'
        ? Number(baselineSetIdRaw)
        : null
  const baselineModel = baselineRow
    ? {
        id: String(baselineRow.id ?? baselineRow.baseline_id ?? `baseline:${baselineRow.set_id ?? 'latest'}`),
        modelName:
          typeof baselineRow.model_name === 'string' && baselineRow.model_name.trim()
            ? baselineRow.model_name
            : 'Reference implementation',
        score: baselineScore,
        setId: Number.isFinite(baselineSetId) ? baselineSetId : null,
        scoredAt:
          typeof baselineRow.scored_at === 'string'
            ? baselineRow.scored_at
            : typeof baselineRow.created_at === 'string'
              ? baselineRow.created_at
              : null,
        codeContent: baselineCodeContent,
        canShowCode: Boolean(baselineCodeContent),
        sourceUrl: BASELINE_MODEL_SOURCE_URL,
      }
    : null

  // Fetch evaluating models from qualification_models (not always in leaderboard)
  const { data: evaluatingFromModels } = await supabase
    .from('qualification_models')
    .select('id, miner_hotkey, model_name, status, score, score_breakdown, created_at, evaluated_at')
    .eq('status', 'evaluating')

  // Fetch recent historical submissions directly from the source table so the
  // public UI can show activity even when the today-only leaderboard view is
  // empty. code_content is deliberately NOT selected: it multiplied this
  // every-60s refresh to ~6.7 MB across ~40 rows. The dialog lazy-loads code
  // on open via /api/model-code (which enforces the same 24h public lock).
  const { data: recentModelsFromSource, error: recentModelsError } = await supabase
    .from('qualification_models')
    .select('id, miner_hotkey, model_name, status, score, score_breakdown, created_at, evaluated_at, is_champion')
    .gte('created_at', MODEL_COMPETITION_SUBMISSIONS_LIVE_AT)
    .order('created_at', { ascending: false })
    .limit(100)

  if (recentModelsError) {
    console.error('[Cache] Error fetching qualification_models recent submissions:', recentModelsError)
  }

  // Merge evaluating models into todaysModels if not already present
  if (evaluatingFromModels && evaluatingFromModels.length > 0) {
    const existingIds = new Set(todaysModels.map((m: { model_id: string }) => m.model_id))
    for (const em of evaluatingFromModels) {
      if (!existingIds.has(em.id)) {
        todaysModels.push({
          model_id: em.id,
          miner_hotkey: em.miner_hotkey,
          model_name: em.model_name,
          status: em.status,
          score: em.score,
          score_breakdown: em.score_breakdown,
          created_at: em.created_at,
          evaluated_at: em.evaluated_at,
          is_champion: false,
        })
      }
    }
  }

  // Recalculate stats after merge
  const evaluatingModels = todaysModels.filter((m: { status: string }) => m.status === 'evaluating')
  const totalToday = todaysModels.length
  const uniqueMinersToday = new Set(todaysModels.map((l: { miner_hotkey: string }) => l.miner_hotkey)).size

  // Map today's submissions
  const recentSubmissions = todaysModels
    .sort((a: { created_at: string }, b: { created_at: string }) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .map((m: { model_id: string; miner_hotkey: string; model_name: string | null; status: string; score: number | null; score_breakdown: unknown | null; created_at: string; evaluated_at: string | null; is_champion: boolean | null }) => {
      const createdAt = new Date(m.created_at)
      const canShowCode = createdAt < twentyFourHoursAgo

      return {
        id: m.model_id,
        minerHotkey: m.miner_hotkey,
        modelName: m.model_name || 'Unnamed',
        status: m.status,
        score: m.score,
        scoreBreakdown: m.score_breakdown,
        // Lazy-loaded by the dialog via /api/model-code when canShowCode.
        codeContent: null,
        createdAt: m.created_at,
        evaluatedAt: m.evaluated_at,
        isChampion: champModel ? m.model_id === champModel.id : false,
        canShowCode,
      }
    })

  const todayIds = new Set(recentSubmissions.map((m: { id: string }) => m.id))
  const pastSubmissions = ((recentModelsFromSource || []) as Array<{
    id: string
    miner_hotkey: string
    model_name: string | null
    status: string
    score: number | null
    score_breakdown: unknown | null
    created_at: string
    evaluated_at: string | null
    is_champion: boolean | null
  }>)
    .filter((m) => !todayIds.has(m.id))
    .map((m) => {
      const createdAt = new Date(m.created_at)
      const canShowCode = createdAt < twentyFourHoursAgo

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
        isChampion: champModel ? m.id === champModel.id : Boolean(m.is_champion),
        canShowCode,
      }
    })

  // Query qualification_champion_history for all champions with score
  // > 0, restricted to the company-mode v2 era. The cutover is enforced
  // at the supabase query level so the row count stays bounded (old
  // history can grow large) and stale-row detection downstream sees a
  // clean post-cutover view.
  // Metadata only: champion code is lazy-loaded by the dialog via
  // /api/model-code (same 24h lock), never shipped in the minute refresh.
  const { data: championHistory, error: historyError } = await supabase
    .from('qualification_champion_history')
    .select('model_id, miner_hotkey, model_name, score, champion_at, dethroned_at, reign_duration')
    .gt('score', 0)
    .gte('champion_at', MODEL_COMPETITION_V2_LIVE_AT)
    .order('champion_at', { ascending: false })
    // Bound this every-60s scan so it can never grow unbounded as history
    // accumulates (well above the current post-cutover row count).
    .limit(1000)

  if (historyError) {
    console.error('[Cache] Error fetching qualification_champion_history:', historyError)
    throw historyError
  }

  const champions = championHistory || []

  // Map champions to the expected format
  // (twentyFourHoursAgo already declared above for submissions)
  //
  // Build a score_breakdown lookup from TWO sources, in this order of
  // preference:
  //   1. qualification_models. Persistent source of truth, has every
  //      historic model. This is the one that matters for past champions.
  //   2. qualification_leaderboard. Today's evaluations only; used as a
  //      fallback for models that don't show up in (1) for any reason.
  //
  // Previously we only built the map from (2), which is a today-only,
  // 500-row working set, so past champions almost always missed their
  // breakdown and the detail dialog showed "Score breakdown not available."
  const championModelMetadata = new Map<string, { scoreBreakdown: unknown; createdAt: string }>()
  const championModelIds = champions
    .map((c: { model_id: string }) => c.model_id)
    .filter((id: string) => Boolean(id))
  if (championModelIds.length > 0) {
    const { data: pastChampModels, error: pastChampError } = await supabase
      .from('qualification_models')
      .select('id, score_breakdown, created_at')
      .in('id', championModelIds)
    if (pastChampError) {
      console.error('[Cache] Error fetching qualification_models for champions:', pastChampError)
    }
    for (const row of (pastChampModels || []) as Array<{ id: string; score_breakdown: unknown; created_at: string }>) {
      championModelMetadata.set(row.id, {
        scoreBreakdown: row.score_breakdown,
        createdAt: row.created_at,
      })
    }
  }
  // Fallback: anything not found above, try the today-only leaderboard.
  for (const m of models) {
    const mid = (m as { model_id: string }).model_id
    if (!mid || championModelMetadata.get(mid)?.scoreBreakdown) continue
    const sb = (m as { score_breakdown: unknown }).score_breakdown
    if (sb) {
      const existing = championModelMetadata.get(mid)
      championModelMetadata.set(mid, {
        scoreBreakdown: sb,
        createdAt: existing?.createdAt ?? (m as { created_at: string }).created_at,
      })
    }
  }

  const championsList = champions.map((c: {
    model_id: string
    miner_hotkey: string
    model_name: string | null
    score: number
    champion_at: string
    dethroned_at: string | null
    reign_duration: string | null
  }) => {
    const metadata = championModelMetadata.get(c.model_id)
    const createdAt = metadata?.createdAt ?? c.champion_at
    const canShowCode = new Date(createdAt) < twentyFourHoursAgo

    return {
      modelId: c.model_id,
      minerHotkey: c.miner_hotkey,
      modelName: c.model_name || 'Unnamed',
      score: c.score,
      createdAt,
      championAt: c.champion_at,
      dethronedAt: c.dethroned_at,
      reignDuration: c.reign_duration,
      // Lazy-loaded by the champion dialog via /api/model-code.
      codeContent: null,
      hasCode: canShowCode,
      canShowCode,
      scoreBreakdown: metadata?.scoreBreakdown || null,
    }
  })

  // Current champion: qualification_models is source of truth.
  //
  // ``qualification_models.is_champion=true`` can still point at a row
  // that was crowned under the OLD leads-with-contacts pipeline if no
  // v2-era model has dethroned it yet. We must NOT surface those —
  // the dashboard would show an old-era score in the throne and an
  // empty lineage strip, which is misleading. Drop the current
  // champion if its ``champion_at`` predates the v2 cutover; the UI
  // then falls through to its "vacant throne" state, which is the
  // correct read of the world until a v2 champion emerges.
  const v2CutoverMs = new Date(MODEL_COMPETITION_V2_LIVE_AT).getTime()
  const champIsV2 =
    champModel && new Date(champModel.champion_at).getTime() >= v2CutoverMs
  if (champModel && champIsV2) {
    const champEntry = championsList.find((c: { modelId: string }) => c.modelId === champModel.id)
    if (champEntry) {
      // Override history. qualification_models says this is champion.
      champEntry.dethronedAt = null
      champEntry.scoreBreakdown = champModel.score_breakdown || champEntry.scoreBreakdown
      champEntry.createdAt = champModel.created_at
      champEntry.canShowCode = new Date(champModel.created_at) < twentyFourHoursAgo
      champEntry.hasCode = champEntry.canShowCode
      // Code is lazy-loaded by the dialog via /api/model-code.
    } else {
      // Champion not in history yet. Add it directly from qualification_models
      // (metadata only; the dialog lazy-loads code via /api/model-code).
      const canShowCode = new Date(champModel.created_at) < twentyFourHoursAgo
      championsList.unshift({
        modelId: champModel.id,
        minerHotkey: champModel.miner_hotkey,
        modelName: champModel.model_name || 'Unnamed',
        score: champModel.score,
        createdAt: champModel.created_at,
        championAt: champModel.champion_at,
        dethronedAt: null,
        reignDuration: null,
        codeContent: null,
        hasCode: canShowCode,
        canShowCode,
        scoreBreakdown: champModel.score_breakdown || null,
      })
    }
  }

  // Mark any other undethroned history entries as stale
  for (const c of championsList) {
    if (!c.dethronedAt && (!champModel || c.modelId !== champModel.id)) {
      c.dethronedAt = 'stale'
    }
  }

  // Stats
  const uniqueChampionMiners = new Set(champions.map((c: { miner_hotkey: string }) => c.miner_hotkey)).size

  return {
    championHistory: championsList,
    recentSubmissions,
    pastSubmissions,
    stats: {
      totalSubmissions: totalToday,
      uniqueMiners: uniqueMinersToday,
      statusCounts: {
        submitted: submittedModels.length,
        evaluating: evaluatingModels.length,
        evaluated: evaluatedModelsToday.length,
        failed: 0,
      },
      totalChampions: championsList.length,
      uniqueChampionMiners,
      currentChampionScore: champModel?.score || 0,
      baselineScore,
      baselineSetId: Number.isFinite(baselineSetId) ? baselineSetId : null,
    },
    baselineModel,
    fetchedAt: new Date().toISOString(),
  }
}

// Perform model competition refresh
async function doModelCompetitionRefresh(): Promise<void> {
  console.log('[Cache] Model competition refresh starting...')
  const startTime = Date.now()

  try {
    const data = await fetchModelCompetitionData()
    setCache('model_competition', data)
    globalForCache.lastModelCompetitionRefresh = new Date()
    console.log(`[Cache] Model competition refresh completed in ${Date.now() - startTime}ms`)
  } catch (error) {
    console.error('[Cache] Model competition refresh error:', error)
  }
}

// Start model competition background refresh (every 1 minute)
export function startModelCompetitionRefresh(): void {
  if (globalForCache.modelCompetitionRefreshInterval) {
    console.log('[Cache] Model competition refresh already running')
    return
  }

  console.log('[Cache] Starting model competition refresh (every 1 minute)')

  // First refresh immediately
  doModelCompetitionRefresh()

  // Then refresh every 1 minute
  globalForCache.modelCompetitionRefreshInterval = setInterval(doModelCompetitionRefresh, MODEL_COMPETITION_REFRESH_INTERVAL)
}

// Get cached model competition data
export function getModelCompetitionCache(): { data: unknown; timestamp: Date | null } | null {
  const cached = getCached<unknown>('model_competition')
  if (!cached) return null
  return {
    data: cached.data,
    timestamp: globalForCache.lastModelCompetitionRefresh,
  }
}

// Get all qualification miner hotkeys from cache
export function getQualificationMinerHotkeys(): string[] {
  const cached = getModelCompetitionCache()
  if (!cached?.data) return []
  const data = cached.data as { allQualificationMiners?: string[] }
  return data.allQualificationMiners || []
}

// Fetch with deduplication - prevents multiple concurrent fetches for same key
export async function fetchWithCache<T>(
  key: string,
  fetcher: () => Promise<T>
): Promise<T> {
  // Check cache first
  const cached = getCached<T>(key)

  if (cached?.fresh) {
    // Fresh cache, return immediately
    return cached.data
  }

  // Check if fetch already in flight
  if (inFlight.has(key)) {
    // Wait for existing fetch, but return stale data if available
    if (cached) {
      // Don't wait, return stale data
      return cached.data
    }
    // No stale data, must wait
    return inFlight.get(key) as Promise<T>
  }

  // Start fetch
  const fetchPromise = (async () => {
    try {
      const data = await fetcher()
      setCache(key, data)
      return data
    } finally {
      inFlight.delete(key)
    }
  })()

  inFlight.set(key, fetchPromise)

  // If we have stale data, return it immediately while refresh happens
  if (cached) {
    return cached.data
  }

  // No cached data, must wait for fetch
  return fetchPromise
}
