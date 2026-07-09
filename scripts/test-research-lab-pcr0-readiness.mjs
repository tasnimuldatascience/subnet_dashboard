import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const outDir = await mkdtemp(join(tmpdir(), 'research-lab-pcr0-readiness-'))

try {
  const tsc = spawnSync(process.execPath, [
    resolve('node_modules/typescript/bin/tsc'),
    resolve('src/lib/research-lab-pcr0-readiness.ts'),
    '--target',
    'ES2022',
    '--module',
    'CommonJS',
    '--moduleResolution',
    'Node',
    '--lib',
    'ES2022,DOM',
    '--outDir',
    outDir,
    '--strict',
    '--skipLibCheck',
  ], { stdio: 'inherit' })

  assert.equal(tsc.status, 0, 'PCR0 readiness helper should compile')

  const require = createRequire(import.meta.url)
  const {
    fetchGatewayPcr0Acceptance,
    parseGatewayPcr0Readiness,
  } = require(join(outDir, 'research-lab-pcr0-readiness.js'))

  const mismatch = parseGatewayPcr0Readiness({
    generated_at_utc: '2026-07-09T21:30:00Z',
    validator: {
      pcr0_accepted: false,
      pcr0_static_allowlist: { allowed: false },
      pcr0_dynamic_cache: {
        valid: false,
        verification: { message: 'PCR0 not in cache. Valid PCR0s: 3' },
        cache_status: { cache_size: 3 },
      },
    },
  })

  assert.equal(mismatch.checked, true)
  assert.equal(mismatch.accepted, false)
  assert.equal(mismatch.staticAllowed, false)
  assert.equal(mismatch.dynamicAllowed, false)
  assert.equal(mismatch.cacheSize, 3)
  assert.match(mismatch.detail, /Production gateway rejects this validator PCR0/)
  assert.match(mismatch.detail, /PCR0 not in cache/)

  const accepted = parseGatewayPcr0Readiness({
    validator: {
      pcr0_accepted: true,
      pcr0_static_allowlist: { allowed: true },
      pcr0_dynamic_cache: { valid: false },
    },
  })
  assert.equal(accepted.checked, true)
  assert.equal(accepted.accepted, true)
  assert.match(accepted.detail, /accepts this validator PCR0/)

  let requestedUrl = null
  const fetched = await fetchGatewayPcr0Acceptance({
    gatewayUrl: 'http://gateway.example:8000/base',
    pcr0: 'abc123',
    commit: 'def456',
    fetchImpl: async (url) => {
      requestedUrl = String(url)
      return {
        ok: true,
        status: 200,
        json: async () => ({ validator: { pcr0_accepted: false } }),
      }
    },
  })

  assert.equal(fetched.accepted, false)
  const parsedUrl = new URL(requestedUrl)
  assert.equal(parsedUrl.pathname, '/attestation/deploy-readiness')
  assert.equal(parsedUrl.searchParams.get('validator_pcr0'), 'abc123')
  assert.equal(parsedUrl.searchParams.get('validator_commit'), 'def456')
  assert.equal(parsedUrl.searchParams.get('require_pcr0'), 'true')
  assert.equal(parsedUrl.searchParams.get('require_pcr0_commit_match'), 'true')

  const routeSource = await readFile(resolve('src/app/api/admin/research-lab/route.ts'), 'utf8')
  assert.match(routeSource, /verificationMode: gatewayAcceptanceAvailable \? 'gateway_acceptance'/)
  assert.match(routeSource, /fetchGatewayPcr0Acceptance/)
  assert.match(routeSource, /audited weight publication is blocked/)

  const componentSource = await readFile(resolve('src/app/admin/_components/AdminResearchLab.tsx'), 'utf8')
  assert.match(componentSource, /PCR0 mismatch — weight publication blocked/)
  assert.match(componentSource, /Production gateway readiness/)
  assert.match(componentSource, /label=\{gatewayAcceptance \? 'Rejected'/)
  assert.match(componentSource, /role="alert"/)
  assert.match(componentSource, /emphasizedMismatch/)
  assert.match(routeSource, /\? 'Unverified'/)

  console.log('research-lab-pcr0-readiness: gateway acceptance and mismatch UI wiring passed')
} finally {
  await rm(outDir, { recursive: true, force: true })
}
