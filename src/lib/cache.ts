// Simple in-memory cache for precalc data
// Data refreshes every 5 minutes (matches pg_cron schedule)

interface CacheEntry<T> {
  data: T
  timestamp: number
}

// Use global to persist cache across hot reloads in dev mode
const globalForCache = globalThis as unknown as {
  precalcCache: Map<string, CacheEntry<unknown>>
  refreshInterval: NodeJS.Timeout | null
}

if (!globalForCache.precalcCache) {
  globalForCache.precalcCache = new Map()
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

    // Fetch dashboard data
    await fetchAllDashboardData(0, metagraph)
    console.log('[Cache] Dashboard data cached')

    // Warm latest leads cache
    await warmLatestLeadsCache(metagraph)
    console.log('[Cache] Latest leads cached')

    console.log(`[Cache] Warm-up completed in ${Date.now() - startTime}ms`)
  } catch (error) {
    console.error('[Cache] Warm-up error:', error)
    throw error
  }
}

// Background refresh interval (5 minutes)
const REFRESH_INTERVAL = 5 * 60 * 1000

// Calculate ms until next refresh time (synced to :01, :06, :11, :16, etc.)
// This ensures we refresh 1 minute after Supabase updates at :00, :05, :10, etc.
function getMsUntilNextRefresh(): number {
  const now = new Date()
  const minutes = now.getMinutes()
  const seconds = now.getSeconds()
  const ms = now.getMilliseconds()

  // Find next minute ending in 1 or 6 (i.e., 1, 6, 11, 16, 21, 26, 31, 36, 41, 46, 51, 56)
  const currentMinuteInCycle = minutes % 5
  let minutesUntilNext: number

  if (currentMinuteInCycle < 1) {
    // Current minute is 0, 5, 10, etc. - next refresh is in (1 - currentMinuteInCycle) minutes
    minutesUntilNext = 1 - currentMinuteInCycle
  } else {
    // Current minute is 1-4, 6-9, etc. - next refresh is in (6 - currentMinuteInCycle) minutes
    minutesUntilNext = 6 - currentMinuteInCycle
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
    const { fetchMetagraph } = await import('./metagraph')
    const { fetchAllDashboardData, warmLatestLeadsCache } = await import('./db-precalc')

    // Refresh metagraph
    const metagraph = await fetchMetagraph()

    // Refresh dashboard data
    await fetchAllDashboardData(0, metagraph)

    // Refresh latest leads
    await warmLatestLeadsCache(metagraph)

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
