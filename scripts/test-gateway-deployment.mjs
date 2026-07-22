import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const outDir = await mkdtemp(join(tmpdir(), 'gateway-deployment-'))

try {
  const tsc = spawnSync(process.execPath, [
    resolve('node_modules/typescript/bin/tsc'),
    resolve('src/lib/gateway-deployment.ts'),
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

  assert.equal(tsc.status, 0, 'gateway deployment helper should compile')

  const require = createRequire(import.meta.url)
  const {
    fetchGatewayDeployment,
    gatewayCommitFreshness,
    parseGatewayCommitComparison,
    parseGatewayDeployment,
  } = require(join(outDir, 'gateway-deployment.js'))

  const deployment = parseGatewayDeployment({
    generated_at_utc: '2026-07-16T01:48:24Z',
    build_time_utc: '2026-07-15T23:59:31Z',
    gateway: {
      commit: 'c2d33853d6325fa666041134e8b027526adf3716',
      build_info: {
        build_id: 'production-gateway-tee',
        git_commit: 'c2d33853d6325fa666041134e8b027526adf3716',
        git_branch: 'main',
        git_remote: 'https://github.com/leadpoet/leadpoet.git',
        commit_source: 'env:GITHUB_SHA',
        loaded_at_utc: '2026-07-16T00:01:02Z',
      },
    },
  })

  assert.equal(deployment.sourceAvailable, true)
  assert.equal(deployment.commitSha, 'c2d33853d6325fa666041134e8b027526adf3716')
  assert.equal(deployment.branch, 'main')
  assert.equal(deployment.buildId, 'production-gateway-tee')
  assert.equal(deployment.builtAt, '2026-07-15T23:59:31.000Z')
  assert.equal(deployment.checkedAt, '2026-07-16T01:48:24.000Z')

  assert.equal(
    gatewayCommitFreshness('c2d33853d6325fa666041134e8b027526adf3716', 'c2d33853d6325fa666041134e8b027526adf3716'),
    'latest',
  )
  assert.equal(
    gatewayCommitFreshness('c2d33853', 'c2d33853d6325fa666041134e8b027526adf3716'),
    'latest',
  )
  assert.equal(
    gatewayCommitFreshness('c2d33853d6325fa666041134e8b027526adf3716', '63ced9eb46a2d51c7141164bfbfefe83af15511e1'),
    'behind',
  )
  assert.equal(gatewayCommitFreshness(null, '63ced9eb46a2d51c7141164bfbfefe83af15511e1'), 'unknown')

  const sixBehind = parseGatewayCommitComparison(
    { status: 'ahead', ahead_by: 6 },
    'c2d33853d6325fa666041134e8b027526adf3716',
    '63ced9eb46a2d51c7141164bfbfefe83af15511e1',
  )
  assert.deepEqual(sixBehind, { freshness: 'behind', commitsBehind: 6 })
  assert.deepEqual(
    parseGatewayCommitComparison(
      { status: 'identical', ahead_by: 0 },
      'c2d33853d6325fa666041134e8b027526adf3716',
      'c2d33853d6325fa666041134e8b027526adf3716',
    ),
    { freshness: 'latest', commitsBehind: 0 },
  )
  assert.deepEqual(
    parseGatewayCommitComparison(
      { status: 'behind', ahead_by: 0 },
      'c2d33853d6325fa666041134e8b027526adf3716',
      '63ced9eb46a2d51c7141164bfbfefe83af15511e1',
    ),
    { freshness: 'ahead', commitsBehind: null },
  )
  assert.deepEqual(
    parseGatewayCommitComparison(
      { status: 'diverged', ahead_by: 3 },
      'c2d33853d6325fa666041134e8b027526adf3716',
      '63ced9eb46a2d51c7141164bfbfefe83af15511e1',
    ),
    { freshness: 'diverged', commitsBehind: null },
  )

  let requestedUrl = null
  const fetched = await fetchGatewayDeployment({
    gatewayUrl: 'http://gateway.example:8000/base',
    fetchImpl: async (url) => {
      requestedUrl = String(url)
      return {
        ok: true,
        status: 200,
        json: async () => ({ gateway: { commit: 'c2d33853' } }),
      }
    },
  })

  assert.equal(new URL(requestedUrl).pathname, '/attestation/deploy-readiness')
  assert.equal(fetched.commitSha, 'c2d33853')

  const unavailable = parseGatewayDeployment({ gateway: { commit: 'unknown' } })
  assert.equal(unavailable.sourceAvailable, false)
  assert.match(unavailable.unavailableReason, /did not report/)

  const routeSource = await readFile(resolve('src/app/api/admin/research-lab/route.ts'), 'utf8')
  assert.match(routeSource, /fetchGatewayDeployment\(\{ gatewayUrl: LEADPOET_GATEWAY_URL \}\)/)
  assert.match(routeSource, /fetchLeadpoetCommitComparison/)
  assert.match(routeSource, /commitsBehind: comparison\.commitsBehind/)
  assert.match(routeSource, /LEADPOET_REPOSITORY_COMPARE_API_URL/)
  assert.match(routeSource, /buildValidatorDeploymentSummary\(/)
  assert.match(routeSource, /latestValidator\?\.gitSha \?\? null/)
  assert.match(routeSource, /'validator'/)
  assert.match(routeSource, /distinctCommitCount:/)

  const componentSource = await readFile(resolve('src/app/admin/_components/AdminResearchLab.tsx'), 'utf8')
  assert.match(componentSource, /const isLatest = repository\.commitFreshness === 'latest'/)
  assert.match(componentSource, /const isBehind = repository\.commitFreshness === 'behind'/)
  assert.match(componentSource, /repository\.commitsBehind === 1 \? 'commit' : 'commits'/)
  assert.match(componentSource, /commitsBehindCopy \?\? 'Behind'/)
  assert.match(componentSource, /Gateway is \$\{commitsBehindCopy \?\? 'behind'\} latest/)
  assert.match(componentSource, /label="Gateway commit"/)
  assert.match(componentSource, /function ValidatorRepositoryPopover/)
  assert.match(componentSource, /deployment=\{ops\.validatorDeployment\}/)
  assert.match(componentSource, /Validator is on the latest/)
  assert.match(componentSource, /label="Validator commit"/)
  assert.match(componentSource, /Reported validator commits/)

  console.log('gateway-deployment: gateway and validator commit distance, comparison states, and status UI wiring passed')
} finally {
  await rm(outDir, { recursive: true, force: true })
}
