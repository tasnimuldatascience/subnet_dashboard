import assert from 'node:assert/strict'
import {
  RUNTIME_SECRET_KEYS,
  formatShellEnvironment,
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

console.log('runtime-secret-loader: strict allowlist, validation, and shell escaping passed')
