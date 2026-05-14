/**
 * Next.js instrumentation hook.
 *
 * Runs once when the Node.js server process boots. This file owns two
 * unrelated boot-time responsibilities:
 *
 *   1. Cache warm-up + background refresh for the public dashboard.
 *      Pre-warms `dashboard_precalc` so the first user doesn't pay the
 *      cold-start cost, then schedules 5-minute dashboard refreshes and
 *      1-minute Model Competition refreshes. Without these timers
 *      running, `/api/model-competition` returns 503 forever and the
 *      UI shows "Failed to fetch data".
 *
 *   2. Deep Research auto-sweep loop. A background interval that calls
 *      the QA sweep every 60 seconds so chains hitting status='fulfilled'
 *      get analyzed automatically, without anyone opening /admin.
 *
 * IMPORTANT — webpack runtime gating:
 *   This hook is bundled for BOTH the Node.js and Edge runtimes. The
 *   transitive deps below (cache.ts -> metagraph.ts) use Node-only
 *   APIs (child_process, fs, path). Webpack's tree-shaker recognizes
 *   the literal `if (process.env.NEXT_RUNTIME === 'nodejs') { ... }`
 *   wrapper as a Node-only branch and elides those imports from the
 *   edge bundle. An early-return shape (`if (... !== 'nodejs') return`)
 *   defeats that analysis and triggers
 *   "Module not found: Can't resolve 'child_process'" at build time.
 *   Keep the wrapper. Do not "tidy" it.
 *
 * Why not a Vercel/Linux cron? The deployment is EC2 self-hosted, so an
 * in-process interval is the simplest path that requires no extra
 * deployment surface area. If the dashboard process restarts, the
 * intervals restart with it; for deep research, the stranded-run sweep
 * recovers anything caught mid-flight.
 */

// Module-level flag so a re-import (Next.js HMR, dev-mode reload)
// doesn't stack a second deep-research timer on top of the first one.
let sweepIntervalHandle: NodeJS.Timeout | null = null

const SWEEP_INTERVAL_MS = 60_000

// Skip the very first deep-research tick by this much. Lets the rest
// of the server finish booting (DB pool, route handlers, cache warm-up)
// before we start firing off background OpenRouter calls.
const SWEEP_INITIAL_DELAY_MS = 15_000

export async function register(): Promise<void> {
  // Wrapper form (not early return) is load-bearing — see file header.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // -------------------------------------------------------------
    // 1. Public dashboard cache warm-up + background refresh.
    //    Fire and forget. The cache module guards against duplicate
    //    intervals on its own, so it's safe even if register() is
    //    invoked twice.
    // -------------------------------------------------------------
    try {
      const {
        warmCache,
        startBackgroundRefresh,
        startModelCompetitionRefresh,
      } = await import('./lib/cache')

      console.log('[Server] Starting cache warm-up...')

      warmCache()
        .then(() => {
          console.log('[Server] Cache warm-up complete')
          startBackgroundRefresh()
          startModelCompetitionRefresh()
        })
        .catch((err) => {
          console.error('[Server] Cache warm-up failed:', err)
          // Even on warm-up failure, start the refresh loops so the
          // cache can self-heal on the next tick instead of being
          // permanently empty (which is what made the Model
          // Competition tab show "Failed to fetch data").
          try {
            startBackgroundRefresh()
            startModelCompetitionRefresh()
          } catch (innerErr) {
            console.error(
              '[Server] Failed to start refresh loops after warm-up failure:',
              innerErr,
            )
          }
        })
    } catch (err) {
      console.error('[Server] Cache module failed to load:', err)
    }

    // -------------------------------------------------------------
    // 2. Deep Research auto-sweep loop.
    // -------------------------------------------------------------
    if (sweepIntervalHandle !== null) {
      console.log('[deep_research] sweep interval already running, skipping')
      return
    }

    if (process.env.DEEP_RESEARCH_SWEEP_DISABLED === 'true') {
      console.log(
        '[deep_research] sweep disabled by DEEP_RESEARCH_SWEEP_DISABLED env',
      )
      return
    }

    const tick = async () => {
      try {
        // Lazy import so the supabase client isn't pulled into the
        // boot graph if the sweep never runs.
        const { runSweep } = await import('./lib/deep-research/sweep')
        await runSweep()
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[deep_research] sweep tick failed:', msg)
      }
    }

    console.log(
      `[deep_research] starting auto-sweep loop ` +
        `(first tick in ${SWEEP_INITIAL_DELAY_MS / 1000}s, ` +
        `then every ${SWEEP_INTERVAL_MS / 1000}s)`,
    )

    setTimeout(() => {
      void tick()
      sweepIntervalHandle = setInterval(() => {
        void tick()
      }, SWEEP_INTERVAL_MS)
    }, SWEEP_INITIAL_DELAY_MS)
  }
}
