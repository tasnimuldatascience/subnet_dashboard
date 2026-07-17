import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import {
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

const { startProduction } = await import('./start-production.mjs')
const launchedEnv = {}
let nextStarted = false
const launcherLogs = []
await startProduction({
  env: launchedEnv,
  loadSecrets: async () => document,
  runNext: async () => {
    nextStarted = true
  },
  log: (message) => launcherLogs.push(message),
})
assert.deepEqual(launchedEnv, document)
assert.equal(nextStarted, true)
assert.deepEqual(launcherLogs, [
  `Loaded ${RUNTIME_SECRET_KEYS.length} validated runtime secrets from AWS Secrets Manager into the production worker.`,
])

const require = createRequire(import.meta.url)
const ecosystem = require('../ecosystem.config.cjs')
assert.deepEqual(ecosystem.apps[0].filter_env, [...RUNTIME_SECRET_KEYS])
assert.match(ecosystem.apps[0].script, /scripts\/start-production\.mjs$/)
assert.equal(ecosystem.apps[0].env.RESEARCH_LAB_ALERT_MONITOR_ENABLED, 'true')
assert.equal(ecosystem.apps[0].env.RESEARCH_LAB_EVENT_MONITOR_ENABLED, 'true')

const { readFile } = await import('node:fs/promises')
const deployment = await readFile(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8')
assert.match(deployment, /scripts\/verify-runtime-monitors\.mjs/)
assert.match(deployment, /VERIFY_MONITOR_AFTER/)

console.log('runtime-secret-loader: strict allowlist, validation, and shell escaping passed')
