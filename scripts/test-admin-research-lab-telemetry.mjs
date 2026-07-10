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
  const { normalizeAdminLabCompanyIntent } = require(join(outDir, 'admin-research-lab-telemetry.js'))
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

  const componentSource = await readFile(resolve('src/app/admin/_components/AdminResearchLabTelemetry.tsx'), 'utf8')
  assert.match(componentSource, /Model intent/)
  assert.match(componentSource, /View intent evidence ↗/)
  assert.match(componentSource, /score=\{company\.intentScore\}/)
  assert.match(componentSource, /safeExternalUrl\(company\.intentEvidenceUrl\)/)

  const adminComponentSource = await readFile(resolve('src/app/admin/_components/AdminResearchLab.tsx'), 'utf8')
  assert.match(adminComponentSource, /const inLine = active && model\.commitFreshness === 'latest'/)
  assert.match(adminComponentSource, /const freshnessLabel = inLine \? 'In line' : outOfLine \? 'Out of line' : 'Unknown'/)
  assert.match(adminComponentSource, /rgba\(80, 176, 112, 0\.46\)/)
  assert.match(adminComponentSource, /rgba\(207, 157, 97, 0\.44\)/)
  assert.match(adminComponentSource, /SourcingModelAlignmentPill/)

  console.log('admin-research-lab-telemetry: model intent details, evidence links, and model alignment tones passed')
} finally {
  await rm(outDir, { recursive: true, force: true })
}
