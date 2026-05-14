/**
 * Next.js instrumentation hook.
 *
 * Runs once when the Node.js server process boots. We use it to start
 * the Deep Research auto-sweep loop — a background interval that
 * triggers the sweep route every 60 seconds. Combined with the
 * gateway already writing status='fulfilled' on chain completion, this
 * is what makes the QA pass run *automatically* the moment a chain
 * reaches fulfilled.
 *
 * Why not a Vercel/Linux cron? The deployment is EC2 self-hosted, so
 * an in-process interval is the simplest path that requires no extra
 * deployment surface area. If the dashboard process restarts, the
 * interval restarts with it; the stranded-run sweep recovers anything
 * caught mid-flight.
 *
 * Guardrails:
 *   - Only runs on the Node.js runtime (skipped during build, edge,
 *     and dev-server compile passes via the NEXT_RUNTIME check below).
 *   - Refuses to schedule a second interval if the function is called
 *     twice (HMR / Next.js sometimes re-imports instrumentation in
 *     dev mode).
 *   - Catches every error so a single bad sweep doesn't kill the
 *     interval.
 */

// Module-level flag so a re-import (Next.js HMR, dev-mode reload)
// doesn't stack a second timer on top of the first one.
let sweepIntervalHandle: NodeJS.Timeout | null = null

const SWEEP_INTERVAL_MS = 60_000

// Skip the very first tick by this much. Lets the rest of the server
// finish booting (DB pool, route handlers) before we start firing
// off background OpenRouter calls.
const SWEEP_INITIAL_DELAY_MS = 15_000

export async function register(): Promise<void> {
  // The `register()` hook also fires for the Edge runtime, but our
  // sweep relies on Node-only APIs (setInterval, env vars, Node
  // supabase client). The runtime check keeps the import graph clean.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  if (sweepIntervalHandle !== null) {
    console.log('[deep_research] sweep interval already running, skipping')
    return
  }

  // Allow opt-out via env var. Useful for build hosts, smoke tests,
  // or any environment where we don't want the dashboard to spend
  // OpenRouter credit.
  if (process.env.DEEP_RESEARCH_SWEEP_DISABLED === 'true') {
    console.log(
      '[deep_research] sweep disabled by DEEP_RESEARCH_SWEEP_DISABLED env',
    )
    return
  }

  const tick = async () => {
    try {
      // Lazy import so the module isn't pulled into the build graph
      // for routes that don't need it. instrumentation.ts is loaded
      // BEFORE the rest of the app boots, so a top-level import would
      // force-load the supabase client at boot even if no sweep ever
      // runs.
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

  // Delayed first tick so server boot doesn't race against any DB
  // warm-up the route handlers depend on.
  setTimeout(() => {
    void tick()
    sweepIntervalHandle = setInterval(() => {
      void tick()
    }, SWEEP_INTERVAL_MS)
  }, SWEEP_INITIAL_DELAY_MS)
}
