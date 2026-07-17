import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager'
import { pathToFileURL } from 'node:url'

export const REQUIRED_RUNTIME_SECRET_KEYS = Object.freeze([
  'SUPABASE_SECRET_KEY',
  'OPENROUTER_KEY',
  'ADMIN_USER',
  'ADMIN_PASS',
  'ADMIN_SESSION_SECRET',
  'RESEARCH_LAB_ALERT_DISCORD_WEBHOOK_URL',
  'RESEARCH_LAB_IMPROVEMENT_DISCORD_WEBHOOK_URL',
])

export const OPTIONAL_RUNTIME_SECRET_KEYS = Object.freeze([
  'SOURCING_MODEL_GITHUB_TOKEN',
  'RESEARCH_LAB_ALERT_RESEND_API_KEY',
  'RESEARCH_LAB_ALERT_EMAIL_FROM',
  'RESEARCH_LAB_ALERT_EMAIL_TO',
  'RESEARCH_LAB_ALERT_EMAIL_REPLY_TO',
])

export const RUNTIME_SECRET_KEYS = Object.freeze([
  ...REQUIRED_RUNTIME_SECRET_KEYS,
  ...OPTIONAL_RUNTIME_SECRET_KEYS,
])

export function parseRuntimeSecret(secretString) {
  let document
  try {
    document = JSON.parse(secretString)
  } catch {
    throw new Error('Runtime secret is not valid JSON.')
  }
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw new Error('Runtime secret must be a JSON object.')
  }

  const values = {}
  for (const key of REQUIRED_RUNTIME_SECRET_KEYS) {
    const value = document[key]
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error(`Runtime secret is missing non-empty ${key}.`)
    }
    if (value !== value.trim()) {
      throw new Error(`Runtime secret ${key} has leading or trailing whitespace.`)
    }
    values[key] = value
  }
  for (const key of OPTIONAL_RUNTIME_SECRET_KEYS) {
    const value = document[key]
    if (value === undefined || value === null || value === '') continue
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error(`Runtime secret ${key} must be a non-empty string when configured.`)
    }
    if (value !== value.trim()) {
      throw new Error(`Runtime secret ${key} has leading or trailing whitespace.`)
    }
    values[key] = value
  }
  return Object.freeze(values)
}

function quoteForPosixShell(value) {
  return `'${value.replaceAll("'", "'\"'\"'")}'`
}

export function formatShellEnvironment(values) {
  const configured = RUNTIME_SECRET_KEYS.filter((key) => typeof values[key] === 'string')
  return `${configured.map((key) => `${key}=${quoteForPosixShell(values[key])}`).join('\n')}\n`
}

export async function loadRuntimeSecretValues({
  env = process.env,
  client,
} = {}) {
  const secretId = env.SUBNET_DASHBOARD_SECRET_ID?.trim()
  const region = env.AWS_REGION?.trim() || env.AWS_DEFAULT_REGION?.trim()
  if (!secretId) throw new Error('SUBNET_DASHBOARD_SECRET_ID is required.')
  if (!region) throw new Error('AWS_REGION is required.')

  const secretsManager = client ?? new SecretsManagerClient({ region })
  const response = await secretsManager.send(new GetSecretValueCommand({ SecretId: secretId }))
  if (typeof response.SecretString !== 'string') {
    throw new Error('Runtime secret must use SecretString JSON, not SecretBinary.')
  }
  return parseRuntimeSecret(response.SecretString)
}

async function main() {
  const values = await loadRuntimeSecretValues()
  process.stdout.write(formatShellEnvironment(values))
  console.error(`Loaded ${Object.keys(values).length} validated runtime secrets from AWS Secrets Manager.`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const detail = error instanceof Error ? error.message : 'Unknown error'
    console.error(`Could not load subnet dashboard runtime secret: ${detail}`)
    process.exitCode = 1
  })
}
