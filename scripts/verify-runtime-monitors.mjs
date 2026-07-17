import { createClient } from '@supabase/supabase-js'

const MONITORS = Object.freeze([
  Object.freeze({
    label: 'incident alert monitor',
    table: 'ops_alert_monitor_state',
    id: 'research-lab-alerts:v1',
  }),
  Object.freeze({
    label: 'event notification monitor',
    table: 'ops_research_lab_event_monitor_state',
    id: 'research-lab-events:v1',
  }),
])

function requiredEnv(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required.`)
  return value
}

async function readMonitor(client, monitor) {
  const { data, error } = await client
    .from(monitor.table)
    .select('monitor_id,last_started_at,last_completed_at,last_error_at,last_error,updated_at')
    .eq('monitor_id', monitor.id)
    .maybeSingle()
  if (error) throw new Error(`${monitor.label} verification failed: ${error.message}`)
  return data
}

async function main() {
  const url = requiredEnv('NEXT_PUBLIC_SUPABASE_URL')
  const serviceKey = requiredEnv('SUPABASE_SECRET_KEY')
  const notBefore = new Date(requiredEnv('VERIFY_MONITOR_AFTER'))
  if (!Number.isFinite(notBefore.getTime())) throw new Error('VERIFY_MONITOR_AFTER must be an ISO timestamp.')

  const client = createClient(url, serviceKey, { auth: { persistSession: false } })
  const deadline = Date.now() + 180_000
  let latest = []

  while (Date.now() < deadline) {
    latest = await Promise.all(MONITORS.map(async (monitor) => ({
      monitor,
      state: await readMonitor(client, monitor),
    })))

    const settled = latest.every(({ state }) => {
      const startedAt = new Date(state?.last_started_at ?? '').getTime()
      const completedAt = new Date(state?.last_completed_at ?? '').getTime()
      const errorAt = new Date(state?.last_error_at ?? '').getTime()
      return Number.isFinite(startedAt) &&
        startedAt >= notBefore.getTime() &&
        ((Number.isFinite(completedAt) && completedAt >= notBefore.getTime()) ||
          (Number.isFinite(errorAt) && errorAt >= notBefore.getTime()))
    })
    if (settled) break
    await new Promise((resolve) => setTimeout(resolve, 5_000))
  }

  for (const { monitor, state } of latest) {
    const startedAt = new Date(state?.last_started_at ?? '').getTime()
    if (!Number.isFinite(startedAt) || startedAt < notBefore.getTime()) {
      throw new Error(`${monitor.label} did not claim its durable lease after the production reload.`)
    }
    const completedAt = new Date(state.last_completed_at ?? '').getTime()
    const errorAt = new Date(state.last_error_at ?? '').getTime()
    if (
      (!Number.isFinite(completedAt) || completedAt < notBefore.getTime()) &&
      (!Number.isFinite(errorAt) || errorAt < notBefore.getTime())
    ) {
      throw new Error(`${monitor.label} did not complete its first production tick within 180 seconds.`)
    }
    if (state.last_error_at && (!state.last_completed_at || state.last_error_at > state.last_completed_at)) {
      throw new Error(`${monitor.label} reported an unresolved runtime error: ${state.last_error ?? 'unknown error'}`)
    }
    console.log(
      `${monitor.label} started at ${state.last_started_at}` +
        `${state.last_completed_at ? ` and completed at ${state.last_completed_at}` : ''}.`,
    )
  }
}

main().catch((error) => {
  const detail = error instanceof Error ? error.message : 'Unknown error'
  console.error(`Runtime monitor verification failed: ${detail}`)
  process.exitCode = 1
})
