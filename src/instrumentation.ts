// Next.js instrumentation - runs once when server starts
// Pre-warms cache so first users don't wait

export async function register() {
  // Only run on server (not edge)
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    console.log('[Server] Starting cache warm-up...')

    // Dynamic import to avoid issues with client-side code
    const { warmCache, startBackgroundRefresh, startModelCompetitionRefresh } = await import('./lib/cache')

    // Warm cache in background (don't block server start)
    warmCache().then(() => {
      console.log('[Server] Cache warm-up complete')
      // Start background refresh every 5 minutes (dashboard data)
      startBackgroundRefresh()
      // Start model competition refresh every 1 minute
      startModelCompetitionRefresh()
    }).catch((err) => {
      console.error('[Server] Cache warm-up failed:', err)
    })
  }
}
