import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const outDir = await mkdtemp(join(tmpdir(), 'research-lab-alert-delivery-'))
let compiledDeliver = null

try {
  const tsc = spawnSync(process.execPath, [
    resolve('node_modules/typescript/bin/tsc'),
    resolve('src/lib/research-lab-alert-delivery.ts'),
    '--target', 'ES2022',
    '--module', 'CommonJS',
    '--moduleResolution', 'Node',
    '--lib', 'ES2022,DOM',
    '--outDir', outDir,
    '--strict',
    '--skipLibCheck',
  ], { stdio: 'inherit' })

  assert.equal(tsc.status, 0, 'research-lab alert delivery should compile')

  const require = createRequire(import.meta.url)
  const {
    DEFAULT_RESEARCH_LAB_ALERT_TIMEOUT_MS,
    PROVIDER_ERROR_MAX_LENGTH,
    RESEND_EMAIL_ENDPOINT,
    buildResearchLabDiscordPayload,
    buildResearchLabResendEmailPayload,
    deliverResearchLabAlert,
    parseResearchLabAlertDeliveryConfig,
    parseResearchLabAlertEmailRecipients,
    renderResearchLabOperatorAlert,
    sanitizeResearchLabProviderError,
  } = require(join(outDir, 'research-lab-alert-delivery.js'))

  const DASHBOARD_URL = 'https://dashboard.example.com/admin?tab=research-lab'
  const DISCORD_WEBHOOK = 'https://discord.com/api/webhooks/123456789/super-secret-webhook-token'
  const RESEND_API_KEY = 're_super_secret_api_key_123456'
  const alertFixture = Object.freeze({
    fingerprint: 'research-lab:v1:pcr0_mismatch:validator:validator-7',
    signal: 'pcr0_mismatch',
    severity: 'critical',
    scope: 'validator',
    entityId: 'validator-7',
    validatorId: 'validator-7',
    title: 'Validator validator-7 PCR0 mismatch',
    detail: 'Expected PCR0 abc123 but observed def456. <Inspect> & confirm.',
    observedAt: '2026-07-10T12:00:00.000Z',
    ageMs: 3_723_000,
    ageBlocks: null,
    sources: ['chain audit', 'weight publisher'],
    occurrences: 2,
  })

  const operatorMessage = renderResearchLabOperatorAlert(alertFixture, 'open', DASHBOARD_URL)
  assert.deepEqual(operatorMessage, {
    transition: 'open',
    transitionLabel: 'OPEN',
    severityLabel: 'CRITICAL',
    headline: 'OPEN · CRITICAL · Validator validator-7 PCR0 mismatch',
    subject: '[Research Lab][OPEN][CRITICAL] Validator validator-7 PCR0 mismatch',
    detail: 'Expected PCR0 abc123 but observed def456. <Inspect> & confirm.',
    scope: 'Validator: validator-7',
    evidence: 'Signal: PCR0 Mismatch · Age: 1h 2m · Observed: 2026-07-10T12:00:00.000Z · Sources: chain audit, weight publisher · Occurrences: 2',
    dashboardUrl: DASHBOARD_URL,
    fingerprint: 'research-lab:v1:pcr0_mismatch:validator:validator-7',
    text: [
      'OPEN · CRITICAL · Validator validator-7 PCR0 mismatch',
      '',
      'Expected PCR0 abc123 but observed def456. <Inspect> & confirm.',
      '',
      'Scope: Validator: validator-7',
      'Evidence: Signal: PCR0 Mismatch · Age: 1h 2m · Observed: 2026-07-10T12:00:00.000Z · Sources: chain audit, weight publisher · Occurrences: 2',
      `Dashboard: ${DASHBOARD_URL}`,
      'Fingerprint: research-lab:v1:pcr0_mismatch:validator:validator-7',
    ].join('\n'),
  })

  const payloadFixtures = {
    discord: buildResearchLabDiscordPayload(
      alertFixture,
      'open',
      DASHBOARD_URL,
      { username: 'Research Lab Ops' },
    ),
    email: buildResearchLabResendEmailPayload(
      alertFixture,
      'escalate',
      DASHBOARD_URL,
      {
        apiKey: RESEND_API_KEY,
        from: 'Research Lab <alerts@example.com>',
        to: ['ops@example.com', 'team@example.com'],
        replyTo: 'oncall@example.com',
      },
    ),
  }

  assert.deepEqual(payloadFixtures.discord, {
    username: 'Research Lab Ops',
    allowed_mentions: { parse: [] },
    embeds: [{
      title: 'OPEN · CRITICAL · Validator validator-7 PCR0 mismatch',
      description: 'Expected PCR0 abc123 but observed def456. <Inspect> & confirm.',
      url: DASHBOARD_URL,
      color: 0xdc2626,
      fields: [
        { name: 'Scope', value: 'Validator: validator-7', inline: false },
        {
          name: 'Evidence',
          value: 'Signal: PCR0 Mismatch · Age: 1h 2m · Observed: 2026-07-10T12:00:00.000Z · Sources: chain audit, weight publisher · Occurrences: 2',
          inline: false,
        },
        {
          name: 'Dashboard',
          value: `[Open Research Lab admin](${DASHBOARD_URL})`,
          inline: false,
        },
      ],
      footer: { text: 'Fingerprint: research-lab:v1:pcr0_mismatch:validator:validator-7' },
      timestamp: '2026-07-10T12:00:00.000Z',
    }],
  })
  assert.equal(payloadFixtures.email.from, 'Research Lab <alerts@example.com>')
  assert.deepEqual(payloadFixtures.email.to, ['ops@example.com', 'team@example.com'])
  assert.equal(payloadFixtures.email.reply_to, 'oncall@example.com')
  assert.match(payloadFixtures.email.subject, /\[ESCALATED\]\[CRITICAL\]/)
  assert.match(payloadFixtures.email.text, new RegExp(`Dashboard: ${escapeRegex(DASHBOARD_URL)}`))
  assert.match(payloadFixtures.email.html, /&lt;Inspect&gt; &amp; confirm/)
  assert.match(payloadFixtures.email.html, /Open Research Lab admin/)
  assert.doesNotMatch(JSON.stringify(payloadFixtures.email), /re_super_secret/)

  const recoveredDiscord = buildResearchLabDiscordPayload(
    alertFixture,
    'recover',
    DASHBOARD_URL,
  )
  assert.equal(recoveredDiscord.embeds[0].color, 0x16a34a)
  assert.match(recoveredDiscord.embeds[0].title, /^RECOVERED · CRITICAL/)
  assert.throws(
    () => renderResearchLabOperatorAlert(alertFixture, 'invalid-transition', DASHBOARD_URL),
    /open, escalate, or recover/,
  )

  assert.deepEqual(
    parseResearchLabAlertEmailRecipients('Ops@Example.com, team@example.com\nops@example.com; third@example.com'),
    ['Ops@Example.com', 'team@example.com', 'third@example.com'],
  )
  assert.throws(
    () => parseResearchLabAlertEmailRecipients('not-an-email'),
    /recipient address is invalid/,
  )

  const unconfigured = parseResearchLabAlertDeliveryConfig({})
  assert.deepEqual(unconfigured, {
    dashboardUrl: null,
    timeoutMs: DEFAULT_RESEARCH_LAB_ALERT_TIMEOUT_MS,
    discord: null,
    email: null,
  })

  const parsedConfig = parseResearchLabAlertDeliveryConfig({
    RESEARCH_LAB_ALERT_DASHBOARD_URL: DASHBOARD_URL,
    RESEARCH_LAB_ALERT_TIMEOUT_MS: '2750',
    RESEARCH_LAB_ALERT_DISCORD_WEBHOOK_URL: DISCORD_WEBHOOK,
    RESEARCH_LAB_ALERT_DISCORD_USERNAME: 'Research Lab Ops',
    RESEARCH_LAB_ALERT_RESEND_API_KEY: RESEND_API_KEY,
    RESEARCH_LAB_ALERT_EMAIL_FROM: 'Research Lab <alerts@example.com>',
    RESEARCH_LAB_ALERT_EMAIL_TO: 'ops@example.com, team@example.com;OPS@example.com',
    RESEARCH_LAB_ALERT_EMAIL_REPLY_TO: 'oncall@example.com',
  })
  assert.equal(parsedConfig.timeoutMs, 2_750)
  assert.equal(parsedConfig.discord.webhookUrl, DISCORD_WEBHOOK)
  assert.equal(parsedConfig.discord.username, 'Research Lab Ops')
  assert.deepEqual(parsedConfig.email.to, ['ops@example.com', 'team@example.com'])
  assert.equal(parsedConfig.email.apiKey, RESEND_API_KEY)
  assert.equal(parsedConfig.dashboardUrl, DASHBOARD_URL)

  assertSafeConfigFailure(
    () => parseResearchLabAlertDeliveryConfig({
      RESEARCH_LAB_ALERT_RESEND_API_KEY: RESEND_API_KEY,
    }),
    RESEND_API_KEY,
    /require RESEARCH_LAB_ALERT_RESEND_API_KEY, RESEARCH_LAB_ALERT_EMAIL_FROM, and RESEARCH_LAB_ALERT_EMAIL_TO/,
  )
  assertSafeConfigFailure(
    () => parseResearchLabAlertDeliveryConfig({
      RESEARCH_LAB_ALERT_DASHBOARD_URL: DASHBOARD_URL,
      RESEARCH_LAB_ALERT_DISCORD_WEBHOOK_URL: 'https://attacker.example/webhooks/private-token',
    }),
    'private-token',
    /supported HTTPS webhook URL/,
  )
  assert.throws(
    () => parseResearchLabAlertDeliveryConfig({
      RESEARCH_LAB_ALERT_TIMEOUT_MS: '249',
    }),
    /between 250 and 60000 ms/,
  )
  assert.throws(
    () => parseResearchLabAlertDeliveryConfig({
      RESEARCH_LAB_ALERT_DISCORD_WEBHOOK_URL: DISCORD_WEBHOOK,
    }),
    /requires RESEARCH_LAB_ALERT_DASHBOARD_URL/,
  )
  assert.throws(
    () => parseResearchLabAlertDeliveryConfig({
      RESEARCH_LAB_ALERT_DISCORD_USERNAME: 'Research Lab Ops',
    }),
    /require RESEARCH_LAB_ALERT_DISCORD_WEBHOOK_URL/,
  )

  let noOpFetchCalls = 0
  const noOpResult = await deliverResearchLabAlert(
    { alert: alertFixture, transition: 'open', config: {} },
    { fetch: async () => {
      noOpFetchCalls += 1
      throw new Error('must not run')
    } },
  )
  assert.deepEqual(noOpResult, { outcome: 'noop', deliveries: [] })
  assert.equal(noOpFetchCalls, 0, 'unconfigured delivery is a true no-op')

  const successCalls = []
  const successTimer = createRecordingTimer()
  const successFixture = await deliverResearchLabAlert(
    {
      alert: alertFixture,
      transition: 'open',
      config: parsedConfig,
      idempotencyKey: 'incident-1:open:email',
    },
    {
      fetch: async (url, init) => {
        successCalls.push({ url, init })
        return url === RESEND_EMAIL_ENDPOINT
          ? new Response('{"id":"email-1"}', { status: 200 })
          : new Response(null, { status: 204 })
      },
      timer: successTimer.timer,
    },
  )
  assert.deepEqual(successFixture, {
    outcome: 'sent',
    deliveries: [
      { channel: 'discord', status: 'sent', httpStatus: 204, errorCode: null, error: null },
      { channel: 'email', status: 'sent', httpStatus: 200, errorCode: null, error: null },
    ],
  })
  assert.deepEqual(successCalls.map((call) => call.url), [DISCORD_WEBHOOK, RESEND_EMAIL_ENDPOINT])
  assert.equal(successCalls[0].init.method, 'POST')
  assert.equal(successCalls[0].init.headers['Content-Type'], 'application/json')
  assert.equal(successCalls[0].init.signal instanceof AbortSignal, true)
  assert.deepEqual(JSON.parse(successCalls[0].init.body), buildResearchLabDiscordPayload(
    alertFixture,
    'open',
    DASHBOARD_URL,
    { username: 'Research Lab Ops' },
  ))
  assert.equal(successCalls[1].init.headers.Authorization, `Bearer ${RESEND_API_KEY}`)
  assert.equal(successCalls[1].init.headers['Idempotency-Key'], 'incident-1:open:email')
  assert.equal(successCalls[1].init.signal instanceof AbortSignal, true)
  assert.deepEqual(successTimer.delays, [2_750, 2_750])
  assert.deepEqual(successTimer.cleared, [1, 2])
  assertSafeResult(successFixture, [DISCORD_WEBHOOK, RESEND_API_KEY])

  const retryableResponseFixture = await deliverWithResponse(
    alertFixture,
    {
      dashboardUrl: DASHBOARD_URL,
      discord: { webhookUrl: DISCORD_WEBHOOK },
    },
    new Response(
      JSON.stringify({
        message: `rate limited ${DISCORD_WEBHOOK} ${RESEND_API_KEY} ${'x'.repeat(1_000)}`,
      }),
      { status: 429 },
    ),
  )
  assert.equal(retryableResponseFixture.outcome, 'failed')
  assert.deepEqual(
    pickFailureShape(retryableResponseFixture.deliveries[0]),
    { channel: 'discord', status: 'retryable_failure', httpStatus: 429, errorCode: 'provider_error' },
  )
  assert.equal(retryableResponseFixture.deliveries[0].error.length <= PROVIDER_ERROR_MAX_LENGTH, true)
  assert.match(retryableResponseFixture.deliveries[0].error, /HTTP 429/)
  assertSafeResult(retryableResponseFixture, [DISCORD_WEBHOOK, RESEND_API_KEY])

  const retryableServerFixture = await deliverWithResponse(
    alertFixture,
    {
      dashboardUrl: DASHBOARD_URL,
      email: {
        apiKey: RESEND_API_KEY,
        from: 'alerts@example.com',
        to: ['ops@example.com'],
      },
    },
    new Response('upstream unavailable', { status: 503 }),
  )
  assert.deepEqual(
    pickFailureShape(retryableServerFixture.deliveries[0]),
    { channel: 'email', status: 'retryable_failure', httpStatus: 503, errorCode: 'provider_error' },
  )

  const permanentFailureFixture = await deliverWithResponse(
    alertFixture,
    {
      dashboardUrl: DASHBOARD_URL,
      email: {
        apiKey: RESEND_API_KEY,
        from: 'alerts@example.com',
        to: ['ops@example.com'],
      },
    },
    new Response(`{"message":"invalid sender","api_key":"${RESEND_API_KEY}"}`, { status: 400 }),
  )
  assert.deepEqual(
    pickFailureShape(permanentFailureFixture.deliveries[0]),
    { channel: 'email', status: 'permanent_failure', httpStatus: 400, errorCode: 'provider_error' },
  )
  assertSafeResult(permanentFailureFixture, [RESEND_API_KEY])

  const partialFailureFixture = await deliverResearchLabAlert(
    { alert: alertFixture, transition: 'escalate', config: parsedConfig },
    {
      fetch: async (url) => url === RESEND_EMAIL_ENDPOINT
        ? new Response('invalid request', { status: 422 })
        : new Response(null, { status: 204 }),
      timer: createRecordingTimer().timer,
    },
  )
  assert.equal(partialFailureFixture.outcome, 'partial_failure')
  assert.deepEqual(
    partialFailureFixture.deliveries.map(({ channel, status }) => ({ channel, status })),
    [
      { channel: 'discord', status: 'sent' },
      { channel: 'email', status: 'permanent_failure' },
    ],
  )

  const networkFailureFixture = await deliverResearchLabAlert(
    {
      alert: alertFixture,
      transition: 'open',
      config: {
        dashboardUrl: DASHBOARD_URL,
        discord: { webhookUrl: DISCORD_WEBHOOK },
      },
    },
    {
      fetch: async () => {
        throw new Error(`fetch failed for ${DISCORD_WEBHOOK}`)
      },
      timer: createRecordingTimer().timer,
    },
  )
  assert.deepEqual(
    pickFailureShape(networkFailureFixture.deliveries[0]),
    { channel: 'discord', status: 'retryable_failure', httpStatus: null, errorCode: 'network_error' },
  )
  assertSafeResult(networkFailureFixture, [DISCORD_WEBHOOK])

  let timeoutCallback = null
  let timeoutDelay = null
  let timeoutClearHandle = null
  const timeoutPromise = deliverResearchLabAlert(
    {
      alert: alertFixture,
      transition: 'open',
      config: {
        dashboardUrl: DASHBOARD_URL,
        timeoutMs: 500,
        discord: { webhookUrl: DISCORD_WEBHOOK },
      },
    },
    {
      fetch: async (_url, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      }),
      timer: {
        set(callback, delayMs) {
          timeoutCallback = callback
          timeoutDelay = delayMs
          return 'deterministic-timer'
        },
        clear(handle) {
          timeoutClearHandle = handle
        },
      },
    },
  )
  assert.equal(timeoutDelay, 500)
  assert.equal(typeof timeoutCallback, 'function')
  timeoutCallback()
  const timeoutFixture = await timeoutPromise
  assert.deepEqual(timeoutFixture, {
    outcome: 'failed',
    deliveries: [{
      channel: 'discord',
      status: 'retryable_failure',
      httpStatus: null,
      errorCode: 'timeout',
      error: 'Provider request timed out after 500 ms.',
    }],
  })
  assert.equal(timeoutClearHandle, 'deterministic-timer')
  assertSafeResult(timeoutFixture, [DISCORD_WEBHOOK])

  const sanitized = sanitizeResearchLabProviderError(
    `Bearer ${RESEND_API_KEY}\n${DISCORD_WEBHOOK}\napi_key=${RESEND_API_KEY}`,
    [RESEND_API_KEY, DISCORD_WEBHOOK],
  )
  assertSafeResult({ sanitized }, [RESEND_API_KEY, DISCORD_WEBHOOK])
  assert.match(sanitized, /\[redacted\]/i)

  console.log('research-lab alert delivery tests passed')
} finally {
  await rm(outDir, { recursive: true, force: true })
}

async function deliverWithResponse(alert, config, response) {
  const timer = createRecordingTimer().timer
  return deliverCompiled()(
    { alert, transition: 'open', config },
    { fetch: async () => response, timer },
  )
}

function deliverCompiled() {
  if (compiledDeliver) return compiledDeliver
  const require = createRequire(import.meta.url)
  // This helper is invoked before the temp directory is removed by the outer finally.
  compiledDeliver = require(join(outDir, 'research-lab-alert-delivery.js')).deliverResearchLabAlert
  return compiledDeliver
}

function createRecordingTimer() {
  const delays = []
  const cleared = []
  let sequence = 0
  return {
    delays,
    cleared,
    timer: {
      set(_callback, delayMs) {
        sequence += 1
        delays.push(delayMs)
        return sequence
      },
      clear(handle) {
        cleared.push(handle)
      },
    },
  }
}

function pickFailureShape(result) {
  return {
    channel: result.channel,
    status: result.status,
    httpStatus: result.httpStatus,
    errorCode: result.errorCode,
  }
}

function assertSafeConfigFailure(operation, secret, expectedPattern) {
  let thrown = null
  try {
    operation()
  } catch (error) {
    thrown = error
  }
  assert.ok(thrown instanceof Error, 'expected configuration to fail')
  assert.match(thrown.message, expectedPattern)
  assert.doesNotMatch(thrown.message, new RegExp(escapeRegex(secret)))
}

function assertSafeResult(result, secrets) {
  const serialized = JSON.stringify(result)
  for (const secret of secrets) {
    assert.doesNotMatch(serialized, new RegExp(escapeRegex(secret)))
  }
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
