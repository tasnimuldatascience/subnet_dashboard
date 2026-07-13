import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const outDir = await mkdtemp(join(tmpdir(), 'admin-research-lab-telemetry-'))

try {
  const tsc = spawnSync(process.execPath, [
    resolve('node_modules/typescript/bin/tsc'),
    resolve('src/lib/admin-research-lab-telemetry.ts'),
    '--target',
    'ES2022',
    '--module',
    'CommonJS',
    '--moduleResolution',
    'Node',
    '--outDir',
    outDir,
    '--strict',
    '--skipLibCheck',
  ], { stdio: 'inherit' })

  assert.equal(tsc.status, 0, 'admin telemetry helper should compile')

  const require = createRequire(import.meta.url)
  const {
    normalizeAdminLabCompanyIntent,
    normalizeAdminLabGatewayControl,
  } = require(join(outDir, 'admin-research-lab-telemetry.js'))
  assert.deepEqual(
    normalizeAdminLabCompanyIntent({
      intent_signal: '54',
      intent_claimed_signal: 'Launched or announced a new product',
      intent_source: 'news',
      intent_evidence_url: 'https://example.com/product-launch',
      intent_evidence_date: '2026-06-23',
    }),
    {
      intentScore: 54,
      intentClaimedSignal: 'Launched or announced a new product',
      intentSource: 'news',
      intentEvidenceUrl: 'https://example.com/product-launch',
      intentEvidenceDate: '2026-06-23',
    },
  )
  assert.deepEqual(
    normalizeAdminLabCompanyIntent({ intent_signal: '', intent_claimed_signal: '  ' }),
    {
      intentScore: null,
      intentClaimedSignal: null,
      intentSource: null,
      intentEvidenceUrl: null,
      intentEvidenceDate: null,
    },
  )
  assert.deepEqual(
    normalizeAdminLabGatewayControl({
      current_event_type: 'pause_requested',
      current_control_status: 'active',
      current_reason: 'operator_requested',
      current_status_at: '2026-07-10T15:47:43.575724+00:00',
    }),
    {
      state: 'paused',
      label: 'Paused',
      source: 'gateway_control',
      reason: 'operator_requested',
      updatedAt: '2026-07-10T15:47:43.575724+00:00',
    },
  )
  assert.equal(
    normalizeAdminLabGatewayControl({
      current_event_type: 'resume_requested',
      current_control_status: 'inactive',
    }).state,
    'active',
  )
  assert.equal(normalizeAdminLabGatewayControl(null).state, 'unknown')

  const routeSource = await readFile(resolve('src/app/api/admin/research-lab/route.ts'), 'utf8')
  assert.match(routeSource, /'intent_claimed_signal'/)
  assert.match(routeSource, /'intent_evidence_url'/)
  assert.match(routeSource, /'intent_evidence_date'/)
  assert.match(routeSource, /'intent_source'/)
  assert.equal(
    routeSource.match(/\.select\(COMPANY_TELEMETRY_SELECT\)/g)?.length,
    3,
    'all three company telemetry queries should retain model intent fields',
  )
  assert.match(routeSource, /normalizeAdminLabCompanyIntent\(row\)/)
  assert.match(routeSource, /research_lab_gateway_control_current/)
  assert.match(routeSource, /rowFor\('scoring_maintenance'\)/)
  assert.match(routeSource, /rowFor\('autoresearch_maintenance'\)/)
  const healthSignalsSource = routeSource.slice(
    routeSource.indexOf('function buildHealthSignals'),
    routeSource.indexOf('async function fetchOptionalRows'),
  )
  assert.doesNotMatch(healthSignalsSource, /label: 'Scoring'/)
  assert.match(routeSource, /request\.nextUrl\.searchParams\.get\('runId'\)/)
  assert.match(routeSource, /candidateQuery = candidateQuery\.eq\('run_id', runId\)/)
  assert.match(routeSource, /bundleQuery = bundleQuery\.eq\('run_id', runId\)/)
  assert.match(routeSource, /companyQuery = companyQuery\.eq\('run_id', runId\)/)
  assert.match(routeSource, /dispatchQuery = dispatchQuery\.eq\('run_id', runId\)/)
  assert.match(routeSource, /timeline\.runs\.some\(\(run\) => run\.runId === requestedRunId\)/)
  assert.match(routeSource, /fetchAlertOperationsSummary/)
  assert.match(routeSource, /ops_alert_monitor_state/)
  assert.match(routeSource, /ops_alert_delivery_events/)
  assert.match(routeSource, /ops_validator_registry/)
  assert.match(routeSource, /configurationBlockers/)
  assert.match(routeSource, /No validator hotkeys are registered/)
  assert.match(routeSource, /id: 'alert_delivery'/)
  assert.match(routeSource, /export async function POST\(request: NextRequest\)/)
  assert.match(routeSource, /Cross-origin validator registry writes are not allowed/)
  assert.match(routeSource, /decodeAddress\(value\)\.length === 32/)
  assert.match(routeSource, /upsert_validator_monitor/)
  assert.match(routeSource, /remove_validator_monitor/)
  assert.match(routeSource, /ADMIN_LAB_OVERVIEW_CACHE_MS/)
  assert.match(routeSource, /adminLabOverviewInFlight/)
  assert.match(routeSource, /adminLabTimelineInFlight/)
  assert.match(routeSource, /X-Admin-Lab-Cache/)
  assert.match(routeSource, /const mode = request\.nextUrl\.searchParams\.get\('mode'\)/)
  assert.match(routeSource, /const refreshView = mode === 'refresh'/)
  assert.match(routeSource, /mode === 'loops'/)
  assert.match(routeSource, /status: 'stale'/)
  assert.match(routeSource, /buildAdminLabRefreshPayload/)
  assert.match(routeSource, /ADMIN_LAB_REFRESH_RECENT_LOOP_LIMIT = 25/)
  assert.match(routeSource, /ALL_TIME_STATS_BATCH_SIZE = 1_000/)
  assert.match(routeSource, /fetchAdminLabAllTimeStats\(supabase\)/)
  assert.match(routeSource, /\.range\(offset, offset \+ ALL_TIME_STATS_BATCH_SIZE - 1\)/)
  assert.match(routeSource, /loop\.statusKey === 'promoted'/)
  assert.match(routeSource, /fetchLeadpoetRepositorySummary\(\)/)
  assert.match(routeSource, /api\.github\.com\/repos\/\$\{LEADPOET_REPOSITORY_OWNER\}\/\$\{LEADPOET_REPOSITORY_NAME\}\/commits/)
  assert.match(routeSource, /next: \{ revalidate: 300 \}/)

  const componentSource = await readFile(resolve('src/app/admin/_components/AdminResearchLabTelemetry.tsx'), 'utf8')
  assert.match(componentSource, /Model intent/)
  assert.match(componentSource, /View intent evidence ↗/)
  assert.match(componentSource, /score=\{company\.intentScore\}/)
  assert.match(componentSource, /safeExternalUrl\(company\.intentEvidenceUrl\)/)
  assert.match(componentSource, /const runLevelErrors = detail\.errors\.filter\(\(error\) => !error\.candidateId\)/)
  assert.match(componentSource, /title="Run-level errors"/)

  const adminComponentSource = await readFile(resolve('src/app/admin/_components/AdminResearchLab.tsx'), 'utf8')
  assert.match(adminComponentSource, /const inLine = active && model\.commitFreshness === 'latest'/)
  assert.match(adminComponentSource, /const freshnessLabel = inLine \? 'In line' : outOfLine \? 'Out of line' : 'Unknown'/)
  assert.match(adminComponentSource, /rgba\(80, 176, 112, 0\.46\)/)
  assert.match(adminComponentSource, /rgba\(207, 157, 97, 0\.44\)/)
  assert.match(adminComponentSource, /SourcingModelAlignmentPill/)
  assert.match(adminComponentSource, /LeadpoetRepositoryPopover/)
  assert.match(adminComponentSource, /githubCommitUrl\(model\.repositoryUrl, model\.gitCommitSha\)/)
  assert.match(adminComponentSource, /target="_blank"/)
  assert.match(adminComponentSource, /rel="noopener noreferrer"/)
  assert.match(adminComponentSource, /function RunSelector/)
  assert.match(adminComponentSource, /runSelectionKey\(selectedLoop\.ticketId, selectedRunId\)/)
  assert.match(adminComponentSource, /params\.set\('runId', selectedRunId\)/)
  assert.match(adminComponentSource, /Every metric and error below is isolated to the selected run\./)
  assert.match(adminComponentSource, /function AlertOperationsControlPlane/)
  assert.match(adminComponentSource, /Paging control plane/)
  assert.match(adminComponentSource, /Failed 24h/)
  assert.match(adminComponentSource, /Validator registry/)
  assert.match(adminComponentSource, /Observed, not monitored/)
  assert.match(adminComponentSource, /Validator hotkey/)
  assert.match(adminComponentSource, /Stop monitoring validator/)
  assert.match(adminComponentSource, /ADMIN_TERMINAL_RUN_REFRESH_MS = 120_000/)
  assert.match(adminComponentSource, /document\.addEventListener\('visibilitychange'/)
  assert.match(adminComponentSource, /controller\?\.abort\(\)/)
  assert.match(adminComponentSource, /ADMIN_OVERVIEW_REFRESH_MS = 30_000/)
  assert.match(adminComponentSource, /Live · 30s overview · 15s active run/)
  assert.match(adminComponentSource, /label="All-time loops"/)
  assert.match(adminComponentSource, /label="Model improvements"/)
  assert.match(adminComponentSource, /\/api\/admin\/research-lab\?mode=refresh/)
  assert.match(adminComponentSource, /function mergeAdminResearchLabRefresh/)
  assert.match(adminComponentSource, /champions: current\.ops\.champions/)
  assert.match(adminComponentSource, /function WorkflowControlPill/)
  assert.match(adminComponentSource, /label="Scoring" control=\{ops\.controls\.scoring\}/)
  assert.match(adminComponentSource, /label="Loops" control=\{ops\.controls\.loops\}/)
  assert.match(adminComponentSource, /sm:grid-cols-2 lg:grid-cols-5/)

  console.log('admin-research-lab-telemetry: workflow controls, run scoping, alerts, and model telemetry passed')
} finally {
  await rm(outDir, { recursive: true, force: true })
}
