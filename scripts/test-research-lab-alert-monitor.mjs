import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const tsc = spawnSync(process.execPath, [
  resolve('node_modules/typescript/bin/tsc'),
  '--noEmit',
  '--pretty',
  'false',
], { stdio: 'inherit' })
assert.equal(tsc.status, 0, 'the durable alert monitor and application should compile')

const monitor = await readFile(resolve('src/lib/research-lab-alert-monitor.ts'), 'utf8')
const instrumentation = await readFile(resolve('src/instrumentation.ts'), 'utf8')
const route = await readFile(resolve('src/app/api/admin/research-lab/route.ts'), 'utf8')
const leaseMigration = await readFile(
  resolve('supabase/migrations/20260710093000_research_lab_alert_monitor_lease.sql'),
  'utf8',
)

assert.match(monitor, /claim_ops_alert_monitor_lease/)
assert.match(monitor, /const MONITOR_OWNER = `\$\{process\.pid\}:\$\{crypto\.randomUUID\(\)\}`/)
assert.match(monitor, /dependencies\.owner \?\? MONITOR_OWNER/)
assert.match(monitor, /planResearchLabAlertLifecycle/)
assert.match(monitor, /ops_alert_current/)
assert.match(monitor, /ops_alert_events/)
assert.match(monitor, /ops_alert_delivery_events/)
assert.match(monitor, /deliverResearchLabAlert/)
assert.match(monitor, /RESEARCH_LAB_ALERT_SIGNALS/)
assert.match(monitor, /enabledSignals\.has\(alert\.signal\)/)
assert.match(monitor, /idempotencyKey: intent\.idempotencyKey/)
assert.match(monitor, /\.eq\('status', 'pending'\)/)
const persistenceBlock = monitor.slice(
  monitor.indexOf('async function persistLifecyclePlan'),
  monitor.indexOf('async function deliverDueIntents'),
)
assert.ok(
  persistenceBlock.indexOf(".from('ops_alert_events')") <
    persistenceBlock.indexOf(".from('ops_alert_current')"),
  'append-only transition events must persist before the mutable incident row',
)
assert.ok(
  persistenceBlock.indexOf(".from('ops_alert_delivery_events')") <
    persistenceBlock.indexOf(".from('ops_alert_current')"),
  'delivery intents must persist before the mutable incident row',
)
assert.match(instrumentation, /RESEARCH_LAB_ALERT_MONITOR_ENABLED/)
assert.match(instrumentation, /runResearchLabAlertMonitor/)
assert.match(route, /evaluatedAlerts: ResearchLabEvaluatedAlert\[\]/)
assert.match(route, /evaluatedAlerts,/)
assert.match(leaseMigration, /security definer/)
assert.match(leaseMigration, /revoke all on function[\s\S]*from public, anon, authenticated/)
assert.match(leaseMigration, /grant execute on function[\s\S]*to service_role/)

console.log('research-lab-alert-monitor: lease, persistence, queue, delivery, and scheduler wiring passed')
