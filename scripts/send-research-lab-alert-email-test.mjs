import path from 'node:path'
import { pathToFileURL } from 'node:url'

function requiredEnv(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required.`)
  return value
}

function parseRecipients(value) {
  const recipients = []
  const seen = new Set()
  for (const candidate of value.split(/[,;\n]/)) {
    const recipient = candidate.trim()
    if (!recipient) continue
    const key = recipient.toLowerCase()
    if (!seen.has(key)) {
      seen.add(key)
      recipients.push(recipient)
    }
  }
  return recipients
}

function sameRecipients(actual, expected) {
  const normalizedActual = actual.map((value) => value.toLowerCase()).sort()
  const normalizedExpected = expected.map((value) => value.toLowerCase()).sort()
  return normalizedActual.length === normalizedExpected.length
    && normalizedActual.every((value, index) => value === normalizedExpected[index])
}

const appRoot = process.env.SUBNET_DASHBOARD_APP_ROOT?.trim() || process.cwd()
const secretLoaderUrl = pathToFileURL(path.join(appRoot, 'scripts/load-runtime-secret.mjs')).href
const { loadRuntimeSecretValues } = await import(secretLoaderUrl)

const values = await loadRuntimeSecretValues()
const apiKey = values.RESEARCH_LAB_ALERT_RESEND_API_KEY
const from = values.RESEARCH_LAB_ALERT_EMAIL_FROM
const to = parseRecipients(values.RESEARCH_LAB_ALERT_EMAIL_TO ?? '')
const replyTo = values.RESEARCH_LAB_ALERT_EMAIL_REPLY_TO
const expectedFrom = requiredEnv('RESEARCH_LAB_EMAIL_TEST_EXPECTED_FROM')
const expectedTo = parseRecipients(requiredEnv('RESEARCH_LAB_EMAIL_TEST_EXPECTED_TO'))
const expectedReplyTo = requiredEnv('RESEARCH_LAB_EMAIL_TEST_EXPECTED_REPLY_TO')
const idempotencyKey = requiredEnv('RESEARCH_LAB_EMAIL_TEST_IDEMPOTENCY_KEY')

if (!apiKey) {
  throw new Error('RESEARCH_LAB_ALERT_RESEND_API_KEY is not configured.')
}
const settingMatches = Object.freeze({
  sender: from === expectedFrom,
  recipients: sameRecipients(to, expectedTo),
  recipientCount: to.length,
  replyTo: replyTo === expectedReplyTo,
})
if (!settingMatches.sender || !settingMatches.recipients || !settingMatches.replyTo) {
  throw new Error(
    `Stored email fallback settings do not match the workflow-approved settings: ${JSON.stringify(settingMatches)}`,
  )
}

const response = await fetch('https://api.resend.com/emails', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'Idempotency-Key': idempotencyKey,
  },
  body: JSON.stringify({
    from,
    to,
    reply_to: replyTo,
    subject: '[Research Lab][TEST] Email fallback verification',
    text: [
      'TEST ONLY — no incident is open.',
      '',
      'This verifies that the Research Lab alert system can send its email fallback when Discord delivery fails.',
      'No Discord alert was created and no alert state was changed by this test.',
    ].join('\n'),
    html: [
      '<h2>TEST ONLY — no incident is open</h2>',
      '<p>This verifies that the Research Lab alert system can send its email fallback when Discord delivery fails.</p>',
      '<p>No Discord alert was created and no alert state was changed by this test.</p>',
    ].join(''),
  }),
})

let responseBody = {}
try {
  responseBody = await response.json()
} catch {
  // Do not echo a non-JSON provider body, which could contain sensitive data.
}

if (!response.ok) {
  const providerMessage = typeof responseBody?.message === 'string'
    ? responseBody.message.replaceAll(apiKey, '[REDACTED]')
    : 'Resend rejected the request.'
  throw new Error(`Resend returned HTTP ${response.status}: ${providerMessage}`)
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  status: response.status,
  providerMessageId: typeof responseBody?.id === 'string' ? responseBody.id : null,
  sender: from,
  recipientCount: to.length,
  replyTo,
})}\n`)
