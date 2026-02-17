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
    // Clear existing cache to force fresh fetch from database
    clearCache('dashboard_precalc')
    clearCache('metagraph')

    const { fetchMetagraph } = await import('./metagraph')
    const { fetchAllDashboardData, warmLatestLeadsCache } = await import('./db-precalc')

    // Refresh metagraph
    const metagraph = await fetchMetagraph()

    // Refresh dashboard data (forceRefresh=true to re-transform)
    await fetchAllDashboardData(0, metagraph, true)

    // Refresh latest leads
    await warmLatestLeadsCache(metagraph)

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

// Fetch model competition data from Supabase
async function fetchModelCompetitionData(): Promise<unknown> {
  const { createClient } = await import('@supabase/supabase-js')

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const supabase = createClient(url, key, {
    auth: { persistSession: false },
  })

  const [championResult, leaderboardResult] = await Promise.all([
    supabase
      .from('qualification_current_champion')
      .select('*')
      .limit(1)
      .single(),
    supabase
      .from('qualification_leaderboard')
      .select('*')
      .limit(100),
  ])

  const champion = championResult.data
  const allModels = leaderboardResult.data || []


  // Filter to only today's submissions (created after 12 AM UTC)
  const todaysModels = allModels.filter((m: { created_at: string }) => isToday(m.created_at))

  // Filter evaluated models that were evaluated today
  const evaluatedModelsToday = todaysModels.filter((m: { status: string; score: number | null; evaluated_at: string | null }) =>
    m.status === 'evaluated' && m.score !== null && isToday(m.evaluated_at)
  )
  const submittedModels = todaysModels.filter((m: { status: string }) => m.status === 'submitted')

  const totalToday = todaysModels.length
  const uniqueMiners = new Set(todaysModels.map((l: { miner_hotkey: string }) => l.miner_hotkey)).size

  const statusCounts = {
    submitted: submittedModels.length,
    evaluating: 0,
    evaluated: evaluatedModelsToday.length,
    failed: 0,
  }

  // Check if champion was evaluated today
  const championEvaluatedToday = champion && isToday(champion.evaluated_at)

  // Get champion's created_at from qualification_leaderboard using is_champion = TRUE or matching model_id
  const championFromLeaderboard = allModels.find((m: { is_champion: boolean | null; model_id: string; created_at?: string }) =>
    m.is_champion === true || (champion && m.model_id === champion.model_id)
  )
  const championCreatedAt = championFromLeaderboard?.created_at || champion?.champion_at || new Date().toISOString()

  return {
    champion: champion ? {
      modelId: champion.model_id,
      minerHotkey: champion.miner_hotkey,
      modelName: champion.model_name || 'Unnamed',
      codeHash: champion.code_hash,
      score: champion.score,
      championAt: champion.champion_at,
      createdAt: championCreatedAt,
      evaluatedAt: champion.evaluated_at,
      evaluatedToday: championEvaluatedToday,
    } : null,
    leaderboard: evaluatedModelsToday
      .sort((a: { score: number | null }, b: { score: number | null }) => (b.score || 0) - (a.score || 0))
      .slice(0, 20)
      .map((l: { model_id: string; miner_hotkey: string; model_name: string | null; score: number | null; rank: number | null; is_champion: boolean | null; evaluated_at: string | null }, index: number) => ({
        modelId: l.model_id,
        minerHotkey: l.miner_hotkey,
        modelName: l.model_name || 'Unnamed',
        score: l.score,
        rank: index + 1,  // Re-rank based on today's evaluations
        isChampion: l.is_champion,
        evaluatedAt: l.evaluated_at,
      })),
    recentSubmissions: todaysModels
      .sort((a: { created_at: string }, b: { created_at: string }) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .map((m: { model_id: string; miner_hotkey: string; model_name: string | null; status: string; score: number | null; code_hash: string | null; code_content: string | null; created_at: string; evaluated_at: string | null; is_champion: boolean | null; rank: number | null }) => ({
        id: m.model_id,
        minerHotkey: m.miner_hotkey,
        modelName: m.model_name || 'Unnamed',
        status: m.status,
        score: m.score,
        codeHash: m.code_hash || '',
        codeContent: m.code_content,
        createdAt: m.created_at,
        evaluatedAt: m.evaluated_at,
        isChampion: m.is_champion && isToday(m.evaluated_at),  // Only show champion badge if evaluated today
        rank: m.rank,
      })),
    stats: {
      totalSubmissions: totalToday,
      uniqueMiners,
      statusCounts,
      championScore: champion?.score || 0,
    },
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
