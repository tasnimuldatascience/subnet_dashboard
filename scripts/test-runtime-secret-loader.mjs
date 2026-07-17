import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import {
  OPTIONAL_RUNTIME_SECRET_KEYS,
  REQUIRED_RUNTIME_SECRET_KEYS,
  RUNTIME_SECRET_KEYS,
  formatShellEnvironment,
  loadRuntimeSecretValues,
  parseRuntimeSecret,
} from './load-runtime-secret.mjs'

const document = Object.fromEntries(
  RUNTIME_SECRET_KEYS.map((key, index) => [key, `value-${index}`]),
)
document.ADMIN_PASS = "spaces $dollar 'quote'\nand newline"

const parsed = parseRuntimeSecret(JSON.stringify({ ...document, IGNORED_EXTRA_KEY: 'not-exported' }))
assert.deepEqual(parsed, document)

const requiredOnly = Object.fromEntries(
  REQUIRED_RUNTIME_SECRET_KEYS.map((key, index) => [key, `required-${index}`]),
)
assert.deepEqual(
  parseRuntimeSecret(JSON.stringify(requiredOnly)),
  requiredOnly,
  'GitHub source access and Resend stay optional until configured',
)
assert.equal(OPTIONAL_RUNTIME_SECRET_KEYS.length, 5)
assert.ok(OPTIONAL_RUNTIME_SECRET_KEYS.includes('SOURCING_MODEL_GITHUB_TOKEN'))

const shell = formatShellEnvironment(parsed)
assert.match(shell, /^SUPABASE_SECRET_KEY='value-0'$/m)
assert.match(shell, /ADMIN_PASS='spaces \$dollar '\"'\"'quote'\"'\"'\nand newline'/)
assert.doesNotMatch(shell, /IGNORED_EXTRA_KEY/)
assert.equal(shell.trimEnd().split('\n').filter((line) => /^[A-Z0-9_]+=/.test(line)).length, RUNTIME_SECRET_KEYS.length)

assert.throws(
  () => parseRuntimeSecret(JSON.stringify({ ...document, OPENROUTER_KEY: '' })),
  /missing non-empty OPENROUTER_KEY/,
)
assert.throws(
  () => parseRuntimeSecret(JSON.stringify({ ...document, ADMIN_USER: ' admin' })),
  /ADMIN_USER has leading or trailing whitespace/,
)
assert.throws(() => parseRuntimeSecret('not-json'), /not valid JSON/)

const requested = []
const loaded = await loadRuntimeSecretValues({
  env: {
    SUBNET_DASHBOARD_SECRET_ID: 'leadpoet/prod/subnet-dashboard/env',
    AWS_REGION: 'us-east-1',
  },
  client: {
    async send(command) {
      requested.push(command.input)
      return { SecretString: JSON.stringify(document) }
    },
  },
})
assert.deepEqual(loaded, document)
assert.deepEqual(requested, [{ SecretId: 'leadpoet/prod/subnet-dashboard/env' }])

const { readFile } = await import('node:fs/promises')
const launcher = await readFile(new URL('./start-production.mjs', import.meta.url), 'utf8')
assert.match(launcher, /const values = await loadSecrets\(\{ env \}\)/)
assert.match(launcher, /for \(const key of RUNTIME_SECRET_KEYS\)/)
assert.match(launcher, /typeof values\[key\] === 'string'/)
assert.match(launcher, /else delete env\[key\]/)
assert.match(launcher, /globalThis\.__leadpoetSubnetDashboardRuntimeSecretsV1 = values/)
assert.match(launcher, /await runNext\(\)/)
assert.match(launcher, /startProduction\(\)\.catch/)
assert.doesNotMatch(launcher, /if \(process\.argv\[1\]/)

const require = createRequire(import.meta.url)
const ecosystem = require('../ecosystem.config.cjs')
assert.deepEqual(ecosystem.apps[0].filter_env, [...RUNTIME_SECRET_KEYS])
assert.match(ecosystem.apps[0].script, /scripts\/start-production\.mjs$/)
assert.equal(ecosystem.apps[0].env.RESEARCH_LAB_ALERT_MONITOR_ENABLED, 'true')
assert.equal(ecosystem.apps[0].env.RESEARCH_LAB_EVENT_MONITOR_ENABLED, 'true')

const deployment = await readFile(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8')
assert.match(deployment, /scripts\/verify-runtime-monitors\.mjs/)
assert.match(deployment, /VERIFY_MONITOR_AFTER/)
assert.match(deployment, /Correcting stale slot pointer/)
assert.match(deployment, /Runtime monitor verification failed; restoring \$ACTIVE_SLOT/)

const runtimeSecretEnvironment = await readFile(
  new URL('../src/lib/runtime-secret-environment.ts', import.meta.url),
  'utf8',
)
assert.match(runtimeSecretEnvironment, /runtimeSecretStore\(\)\?\.\[name\] \?\? process\.env\[name\]/)
assert.match(runtimeSecretEnvironment, /installRuntimeSecretEnvironment/)

const instrumentation = await readFile(new URL('../src/instrumentation.ts', import.meta.url), 'utf8')
assert.match(instrumentation, /import\('\.\.\/scripts\/load-runtime-secret\.mjs'\)/)
assert.match(instrumentation, /await loadRuntimeSecretValues\(\)/)
assert.match(instrumentation, /installRuntimeSecretEnvironment\(runtimeSecretValues\)/)

console.log('runtime-secret-loader: strict allowlist, validation, and shell escaping passed')
