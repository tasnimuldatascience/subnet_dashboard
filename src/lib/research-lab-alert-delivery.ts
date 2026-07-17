import type { ResearchLabEvaluatedAlert } from './research-lab-alerts'

/**
 * Server-side outbound delivery for alerts that have already been evaluated.
 *
 * This module deliberately does not read `process.env`, persist state, or log.
 * Callers must pass server-only configuration and own transition/deduplication
 * state before invoking delivery.
 */

export type ResearchLabAlert = ResearchLabEvaluatedAlert

export type ResearchLabAlertTransition = 'open' | 'escalate' | 'remind' | 'recover'

export type ResearchLabDiscordAlertChannel = Readonly<{
  webhookUrl: string
  username?: string
}>

export type ResearchLabEmailAlertChannel = Readonly<{
  apiKey: string
  from: string
  to: readonly string[]
  replyTo?: string
}>

export type ResearchLabAlertChannelConfig = Readonly<{
  /** Required whenever at least one outbound channel is configured. */
  dashboardUrl?: string | null
  /** Applies independently to every provider request. */
  timeoutMs?: number
  discord?: ResearchLabDiscordAlertChannel | null
  email?: ResearchLabEmailAlertChannel | null
}>

export type ResearchLabAlertDeliveryEnv = Readonly<Record<string, string | undefined>>

export type ResearchLabAlertFetch = (
  input: string,
  init: RequestInit,
) => Promise<Response>

export type ResearchLabAlertTimer = Readonly<{
  set: (callback: () => void, delayMs: number) => unknown
  clear: (handle: unknown) => void
}>

export type ResearchLabAlertDeliveryDependencies = Readonly<{
  fetch?: ResearchLabAlertFetch
  timer?: ResearchLabAlertTimer
}>

export type ResearchLabAlertDeliveryRequest = Readonly<{
  alert: ResearchLabAlert
  transition: ResearchLabAlertTransition
  config: ResearchLabAlertChannelConfig
  /** Stable across retries; forwarded to providers that support idempotency. */
  idempotencyKey?: string
}>

export type ResearchLabDiscordWebhookRequest = Readonly<{
  webhookUrl: string
  payload: ResearchLabDiscordAlertPayload
  timeoutMs?: number
}>

export type ResearchLabAlertDeliveryChannel = 'discord' | 'email'

export type ResearchLabAlertDeliveryStatus =
  | 'sent'
  | 'retryable_failure'
  | 'permanent_failure'

export type ResearchLabAlertDeliveryErrorCode =
  | 'timeout'
  | 'network_error'
  | 'provider_error'

export type ResearchLabAlertChannelDeliveryResult = Readonly<{
  channel: ResearchLabAlertDeliveryChannel
  status: ResearchLabAlertDeliveryStatus
  httpStatus: number | null
  errorCode: ResearchLabAlertDeliveryErrorCode | null
  /** Sanitized, whitespace-normalized, and bounded to PROVIDER_ERROR_MAX_LENGTH. */
  error: string | null
}>

export type ResearchLabAlertDeliveryResult = Readonly<{
  outcome: 'noop' | 'sent' | 'partial_failure' | 'failed'
  deliveries: readonly ResearchLabAlertChannelDeliveryResult[]
}>

export type ResearchLabOperatorAlertMessage = Readonly<{
  transition: ResearchLabAlertTransition
  transitionLabel: 'OPEN' | 'ESCALATED' | 'REMINDER' | 'CLEARED' | 'CLOSED'
  severityLabel: 'WARNING' | 'CRITICAL'
  headline: string
  subject: string
  detail: string
  scope: string
  evidence: string
  dashboardUrl: string
  fingerprint: string
  text: string
}>

export type ResearchLabDiscordAlertPayload = Readonly<{
  username?: string
  allowed_mentions: Readonly<{ parse: readonly string[] }>
  embeds: readonly Readonly<{
    title: string
    description: string
    url: string
    color: number
    fields: readonly Readonly<{
      name: string
      value: string
      inline: boolean
    }>[]
    footer: Readonly<{ text: string }>
    timestamp?: string
  }>[]
}>

export type ResearchLabResendEmailPayload = Readonly<{
  from: string
  to: readonly string[]
  subject: string
  text: string
  html: string
  reply_to?: string
}>

export const RESEARCH_LAB_ALERT_ENV_KEYS = Object.freeze({
  dashboardUrl: 'RESEARCH_LAB_ALERT_DASHBOARD_URL',
  timeoutMs: 'RESEARCH_LAB_ALERT_TIMEOUT_MS',
  discordWebhookUrl: 'RESEARCH_LAB_ALERT_DISCORD_WEBHOOK_URL',
  discordUsername: 'RESEARCH_LAB_ALERT_DISCORD_USERNAME',
  resendApiKey: 'RESEARCH_LAB_ALERT_RESEND_API_KEY',
  emailFrom: 'RESEARCH_LAB_ALERT_EMAIL_FROM',
  emailTo: 'RESEARCH_LAB_ALERT_EMAIL_TO',
  emailReplyTo: 'RESEARCH_LAB_ALERT_EMAIL_REPLY_TO',
} as const)

export const DEFAULT_RESEARCH_LAB_ALERT_TIMEOUT_MS = 10_000
export const MIN_RESEARCH_LAB_ALERT_TIMEOUT_MS = 250
export const MAX_RESEARCH_LAB_ALERT_TIMEOUT_MS = 60_000
export const PROVIDER_ERROR_MAX_LENGTH = 320
export const RESEND_EMAIL_ENDPOINT = 'https://api.resend.com/emails'

const DISCORD_EMBED_COLORS = Object.freeze({
  warning: 0xf59e0b,
  critical: 0xdc2626,
  cleared: 0x16a34a,
  terminal: 0x64748b,
})

const TRANSITION_LABELS: Readonly<
  Record<ResearchLabAlertTransition, ResearchLabOperatorAlertMessage['transitionLabel']>
> = Object.freeze({
  open: 'OPEN',
  escalate: 'ESCALATED',
  remind: 'REMINDER',
  recover: 'CLEARED',
})

const RETRYABLE_HTTP_STATUSES = new Set([408, 409, 425, 429])

const DEFAULT_TIMER: ResearchLabAlertTimer = Object.freeze({
  set(callback: () => void, delayMs: number): ReturnType<typeof setTimeout> {
    return setTimeout(callback, delayMs)
  },
  clear(handle: unknown): void {
    clearTimeout(handle as ReturnType<typeof setTimeout>)
  },
})

type NormalizedDeliveryConfig = Readonly<{
  dashboardUrl: string | null
  timeoutMs: number
  discord: ResearchLabDiscordAlertChannel | null
  email: ResearchLabEmailAlertChannel | null
}>

type ProviderRequest = Readonly<{
  channel: ResearchLabAlertDeliveryChannel
  url: string
  init: Omit<RequestInit, 'signal'>
  secrets: readonly string[]
}>

/**
 * Parse a deliberately small, server-only env surface. Empty values disable a
 * channel; partially configured channels throw without echoing their values.
 */
export function parseResearchLabAlertDeliveryConfig(
  env: ResearchLabAlertDeliveryEnv,
): ResearchLabAlertChannelConfig {
  const dashboardUrlValue = optionalEnvValue(env, RESEARCH_LAB_ALERT_ENV_KEYS.dashboardUrl)
  const timeoutValue = optionalEnvValue(env, RESEARCH_LAB_ALERT_ENV_KEYS.timeoutMs)
  const discordWebhookUrl = optionalEnvValue(
    env,
    RESEARCH_LAB_ALERT_ENV_KEYS.discordWebhookUrl,
  )
  const discordUsername = optionalEnvValue(env, RESEARCH_LAB_ALERT_ENV_KEYS.discordUsername)
  const resendApiKey = optionalEnvValue(env, RESEARCH_LAB_ALERT_ENV_KEYS.resendApiKey)
  const emailFrom = optionalEnvValue(env, RESEARCH_LAB_ALERT_ENV_KEYS.emailFrom)
  const emailToValue = optionalEnvValue(env, RESEARCH_LAB_ALERT_ENV_KEYS.emailTo)
  const emailReplyTo = optionalEnvValue(env, RESEARCH_LAB_ALERT_ENV_KEYS.emailReplyTo)

  if (discordUsername && !discordWebhookUrl) {
    throw new Error(
      'Research Lab Discord alerts require RESEARCH_LAB_ALERT_DISCORD_WEBHOOK_URL when a username is configured.',
    )
  }

  const emailValuesPresent = [resendApiKey, emailFrom, emailToValue, emailReplyTo]
    .some((value) => value !== null)
  if (emailValuesPresent && (!resendApiKey || !emailFrom || !emailToValue)) {
    throw new Error(
      'Research Lab email alerts require RESEARCH_LAB_ALERT_RESEND_API_KEY, RESEARCH_LAB_ALERT_EMAIL_FROM, and RESEARCH_LAB_ALERT_EMAIL_TO.',
    )
  }

  const discord = discordWebhookUrl
    ? Object.freeze({
        webhookUrl: normalizeDiscordWebhookUrl(discordWebhookUrl),
        ...(discordUsername
          ? { username: truncate(normalizeInlineText(discordUsername), 80) }
          : {}),
      })
    : null

  const email = resendApiKey && emailFrom && emailToValue
    ? Object.freeze({
        apiKey: resendApiKey,
        from: normalizeFromAddress(emailFrom),
        to: Object.freeze(parseResearchLabAlertEmailRecipients(emailToValue)),
        ...(emailReplyTo ? { replyTo: normalizeEmailAddress(emailReplyTo, 'reply-to') } : {}),
      })
    : null

  const channelConfigured = discord !== null || email !== null
  const dashboardUrl = dashboardUrlValue
    ? normalizeDashboardUrl(dashboardUrlValue)
    : null

  if (channelConfigured && !dashboardUrl) {
    throw new Error(
      'Research Lab alert delivery requires RESEARCH_LAB_ALERT_DASHBOARD_URL when a channel is configured.',
    )
  }

  return Object.freeze({
    dashboardUrl,
    timeoutMs: timeoutValue ? parseTimeoutMs(timeoutValue) : DEFAULT_RESEARCH_LAB_ALERT_TIMEOUT_MS,
    discord,
    email,
  })
}

/** Accept comma, semicolon, or newline-delimited mailboxes and deduplicate them. */
export function parseResearchLabAlertEmailRecipients(value: string): string[] {
  const recipients: string[] = []
  const seen = new Set<string>()

  for (const candidate of value.split(/[,;\n]/)) {
    const recipient = candidate.trim()
    if (!recipient) continue
    const normalized = normalizeEmailAddress(recipient, 'recipient')
    const dedupeKey = normalized.toLowerCase()
    if (!seen.has(dedupeKey)) {
      seen.add(dedupeKey)
      recipients.push(normalized)
    }
  }

  if (recipients.length === 0) {
    throw new Error('Research Lab alert EMAIL_TO must contain at least one valid recipient.')
  }

  return recipients
}

export function renderResearchLabOperatorAlert(
  alert: ResearchLabAlert,
  transition: ResearchLabAlertTransition,
  dashboardUrl: string,
): ResearchLabOperatorAlertMessage {
  assertTransition(transition)
  const normalizedDashboardUrl = normalizeDashboardUrl(dashboardUrl)
  const transitionLabel = transition === 'recover' && alert.resolution?.kind === 'terminal'
    ? 'CLOSED'
    : TRANSITION_LABELS[transition]
  const severityLabel = alert.severity === 'critical' ? 'CRITICAL' : 'WARNING'
  const title = truncate(normalizeInlineText(alert.title) || 'Research Lab alert', 180)
  const originalDetail = truncate(
    normalizeMultilineText(alert.detail) || 'No additional detail was supplied.',
    1_800,
  )
  const detail = transition === 'recover' && alert.resolution?.kind !== 'terminal'
    ? truncate(
        'The alert condition is no longer observed. This closes the alert; it does not by itself ' +
          `confirm that the underlying workflow succeeded. Last alert evidence: ${originalDetail}`,
        1_800,
      )
    : originalDetail
  const scope = truncate(renderAlertScope(alert), 360)
  const evidence = truncate(renderAlertEvidence(alert), 960)
  const headline = `${transitionLabel} · ${severityLabel} · ${title}`
  const subject = truncate(`[Research Lab][${transitionLabel}][${severityLabel}] ${title}`, 240)
  const fingerprint = truncate(normalizeInlineText(alert.fingerprint), 240)
  const text = [
    headline,
    '',
    detail,
    '',
    `Scope: ${scope}`,
    `Evidence: ${evidence}`,
    `Dashboard: ${normalizedDashboardUrl}`,
    `Fingerprint: ${fingerprint}`,
  ].join('\n')

  return Object.freeze({
    transition,
    transitionLabel,
    severityLabel,
    headline,
    subject,
    detail,
    scope,
    evidence,
    dashboardUrl: normalizedDashboardUrl,
    fingerprint,
    text,
  })
}

export function buildResearchLabDiscordPayload(
  alert: ResearchLabAlert,
  transition: ResearchLabAlertTransition,
  dashboardUrl: string,
  channel: Pick<ResearchLabDiscordAlertChannel, 'username'> = {},
): ResearchLabDiscordAlertPayload {
  const message = renderResearchLabOperatorAlert(alert, transition, dashboardUrl)
  const color = transition === 'recover'
    ? alert.resolution?.kind === 'terminal'
      ? DISCORD_EMBED_COLORS.terminal
      : DISCORD_EMBED_COLORS.cleared
    : DISCORD_EMBED_COLORS[alert.severity]
  const observedAt = optionalIsoTimestamp(alert.observedAt)
  const username = channel.username
    ? truncate(normalizeInlineText(channel.username), 80)
    : null

  return Object.freeze({
    ...(username ? { username } : {}),
    allowed_mentions: Object.freeze({ parse: Object.freeze([]) }),
    embeds: Object.freeze([
      Object.freeze({
        title: truncate(message.headline, 256),
        description: truncate(message.detail, 4_096),
        url: message.dashboardUrl,
        color,
        fields: Object.freeze([
          Object.freeze({ name: 'Scope', value: truncate(message.scope, 1_024), inline: false }),
          Object.freeze({ name: 'Evidence', value: truncate(message.evidence, 1_024), inline: false }),
          Object.freeze({
            name: 'Dashboard',
            value: `[Open Research Lab admin](${message.dashboardUrl})`,
            inline: false,
          }),
        ]),
        footer: Object.freeze({ text: truncate(`Fingerprint: ${message.fingerprint}`, 2_048) }),
        ...(observedAt ? { timestamp: observedAt } : {}),
      }),
    ]),
  })
}

export function buildResearchLabResendEmailPayload(
  alert: ResearchLabAlert,
  transition: ResearchLabAlertTransition,
  dashboardUrl: string,
  channel: ResearchLabEmailAlertChannel,
): ResearchLabResendEmailPayload {
  const message = renderResearchLabOperatorAlert(alert, transition, dashboardUrl)
  const from = normalizeFromAddress(channel.from)
  const to = Object.freeze(normalizeRecipientList(channel.to))
  const replyTo = channel.replyTo
    ? normalizeEmailAddress(channel.replyTo, 'reply-to')
    : null
  const html = [
    '<!doctype html><html><body style="font-family:ui-sans-serif,system-ui,sans-serif;color:#111827">',
    `<h2>${escapeHtml(message.headline)}</h2>`,
    `<p>${escapeHtml(message.detail).replace(/\n/g, '<br>')}</p>`,
    `<p><strong>Scope:</strong> ${escapeHtml(message.scope)}<br>`,
    `<strong>Evidence:</strong> ${escapeHtml(message.evidence)}</p>`,
    `<p><a href="${escapeHtmlAttribute(message.dashboardUrl)}">Open Research Lab admin</a></p>`,
    `<p style="color:#6b7280;font-size:12px">Fingerprint: ${escapeHtml(message.fingerprint)}</p>`,
    '</body></html>',
  ].join('')

  return Object.freeze({
    from,
    to,
    subject: message.subject,
    text: message.text,
    html,
    ...(replyTo ? { reply_to: replyTo } : {}),
  })
}

/**
 * Deliver one evaluated transition to every configured channel. Delivery order
 * is stable (Discord, then email); each channel receives an independent timeout.
 */
export async function deliverResearchLabAlert(
  request: ResearchLabAlertDeliveryRequest,
  dependencies: ResearchLabAlertDeliveryDependencies = {},
): Promise<ResearchLabAlertDeliveryResult> {
  assertTransition(request.transition)
  const config = normalizeDeliveryConfig(request.config)
  const requests: ProviderRequest[] = []

  if (config.discord) {
    const payload = buildResearchLabDiscordPayload(
      request.alert,
      request.transition,
      requiredDashboardUrl(config.dashboardUrl),
      config.discord,
    )
    requests.push({
      channel: 'discord',
      url: config.discord.webhookUrl,
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
      secrets: [config.discord.webhookUrl],
    })
  }

  if (config.email) {
    const payload = buildResearchLabResendEmailPayload(
      request.alert,
      request.transition,
      requiredDashboardUrl(config.dashboardUrl),
      config.email,
    )
    requests.push({
      channel: 'email',
      url: RESEND_EMAIL_ENDPOINT,
      init: {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.email.apiKey}`,
          'Content-Type': 'application/json',
          ...(request.idempotencyKey
            ? { 'Idempotency-Key': normalizeIdempotencyKey(request.idempotencyKey) }
            : {}),
        },
        body: JSON.stringify(payload),
      },
      secrets: [config.email.apiKey],
    })
  }

  if (requests.length === 0) {
    return Object.freeze({ outcome: 'noop', deliveries: Object.freeze([]) })
  }

  const fetchImpl = dependencies.fetch ?? defaultFetch
  const timer = dependencies.timer ?? DEFAULT_TIMER
  const deliveries = Object.freeze(await Promise.all(
    requests.map((providerRequest) => sendProviderRequest(
      providerRequest,
      config.timeoutMs,
      fetchImpl,
      timer,
    )),
  ))
  const sentCount = deliveries.filter((delivery) => delivery.status === 'sent').length
  const outcome = sentCount === deliveries.length
    ? 'sent'
    : sentCount > 0
      ? 'partial_failure'
      : 'failed'

  return Object.freeze({ outcome, deliveries })
}

/** Deliver a pre-rendered Research Lab event embed through the same hardened
 * Discord transport used by incident alerts. */
export async function deliverResearchLabDiscordWebhook(
  request: ResearchLabDiscordWebhookRequest,
  dependencies: ResearchLabAlertDeliveryDependencies = {},
): Promise<ResearchLabAlertChannelDeliveryResult> {
  const webhookUrl = normalizeDiscordWebhookUrl(request.webhookUrl)
  const timeoutMs = request.timeoutMs === undefined
    ? DEFAULT_RESEARCH_LAB_ALERT_TIMEOUT_MS
    : parseTimeoutMs(String(request.timeoutMs))
  return sendProviderRequest(
    {
      channel: 'discord',
      url: webhookUrl,
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request.payload),
      },
      secrets: [webhookUrl],
    },
    timeoutMs,
    dependencies.fetch ?? defaultFetch,
    dependencies.timer ?? DEFAULT_TIMER,
  )
}

function normalizeIdempotencyKey(value: string): string {
  const normalized = value.trim()
  if (!normalized) throw new Error('Alert delivery idempotency key cannot be empty.')
  return normalized.slice(0, 256)
}

/** Public for focused validation; callers should pass every relevant secret. */
export function sanitizeResearchLabProviderError(
  value: unknown,
  secrets: readonly string[] = [],
): string {
  let message = errorText(value)

  for (const secret of secrets) {
    if (secret) message = replaceAllLiteral(message, secret, '[redacted]')
  }

  message = message
    .replace(
      /https:\/\/(?:canary\.|ptb\.)?(?:discord(?:app)?\.com)\/api(?:\/v\d+)?\/webhooks\/[^\s/]+\/[^\s?"']+/gi,
      '[redacted Discord webhook]',
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/\bre_[A-Za-z0-9._-]{8,}\b/g, '[redacted API key]')
    .replace(
      /((?:api[_-]?key|authorization|secret|token|webhook(?:_url)?)\s*[=:]\s*)[^\s,;}]+/gi,
      '$1[redacted]',
    )
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return truncate(message || 'Provider request failed.', PROVIDER_ERROR_MAX_LENGTH)
}

async function sendProviderRequest(
  request: ProviderRequest,
  timeoutMs: number,
  fetchImpl: ResearchLabAlertFetch,
  timer: ResearchLabAlertTimer,
): Promise<ResearchLabAlertChannelDeliveryResult> {
  const controller = new AbortController()
  let timedOut = false
  let timerHandle: unknown

  try {
    timerHandle = timer.set(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)

    const response = await fetchImpl(request.url, {
      ...request.init,
      signal: controller.signal,
    })

    if (response.ok) {
      return channelResult(request.channel, 'sent', response.status, null, null)
    }

    const providerBody = await readProviderErrorBody(response, request.secrets)
    const message = sanitizeResearchLabProviderError(
      providerBody
        ? `Provider returned HTTP ${response.status}: ${providerBody}`
        : `Provider returned HTTP ${response.status}.`,
      request.secrets,
    )

    return channelResult(
      request.channel,
      isRetryableHttpStatus(response.status) ? 'retryable_failure' : 'permanent_failure',
      response.status,
      'provider_error',
      message,
    )
  } catch (error) {
    if (timedOut) {
      return channelResult(
        request.channel,
        'retryable_failure',
        null,
        'timeout',
        `Provider request timed out after ${timeoutMs} ms.`,
      )
    }

    return channelResult(
      request.channel,
      'retryable_failure',
      null,
      'network_error',
      sanitizeResearchLabProviderError(error, request.secrets),
    )
  } finally {
    if (timerHandle !== undefined) timer.clear(timerHandle)
  }
}

async function readProviderErrorBody(
  response: Response,
  secrets: readonly string[],
): Promise<string> {
  try {
    return sanitizeResearchLabProviderError(await response.text(), secrets)
  } catch (error) {
    return sanitizeResearchLabProviderError(error, secrets)
  }
}

function normalizeDeliveryConfig(config: ResearchLabAlertChannelConfig): NormalizedDeliveryConfig {
  const discord = config.discord
    ? Object.freeze({
        webhookUrl: normalizeDiscordWebhookUrl(config.discord.webhookUrl),
        ...(config.discord.username
          ? { username: truncate(normalizeInlineText(config.discord.username), 80) }
          : {}),
      })
    : null
  const email = config.email
    ? Object.freeze({
        apiKey: requiredSecret(config.email.apiKey, 'Resend API key'),
        from: normalizeFromAddress(config.email.from),
        to: Object.freeze(normalizeRecipientList(config.email.to)),
        ...(config.email.replyTo
          ? { replyTo: normalizeEmailAddress(config.email.replyTo, 'reply-to') }
          : {}),
      })
    : null
  const channelConfigured = discord !== null || email !== null
  const dashboardUrl = config.dashboardUrl
    ? normalizeDashboardUrl(config.dashboardUrl)
    : null

  if (channelConfigured && !dashboardUrl) {
    throw new Error('Research Lab alert delivery requires a dashboard URL.')
  }

  return Object.freeze({
    dashboardUrl,
    timeoutMs: normalizeTimeoutMs(config.timeoutMs),
    discord,
    email,
  })
}

function normalizeRecipientList(values: readonly string[]): string[] {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error('Research Lab email alerts require at least one recipient.')
  }

  const recipients: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    const normalized = normalizeEmailAddress(value, 'recipient')
    const key = normalized.toLowerCase()
    if (!seen.has(key)) {
      seen.add(key)
      recipients.push(normalized)
    }
  }
  return recipients
}

function normalizeDashboardUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    throw new Error('Research Lab alert dashboard URL must be a valid HTTP(S) URL.')
  }

  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Research Lab alert dashboard URL must be a credential-free HTTP(S) URL.')
  }
  url.hash = ''
  return url.toString()
}

function normalizeDiscordWebhookUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    throw new Error('Research Lab Discord webhook must be a supported HTTPS webhook URL.')
  }

  const allowedHosts = new Set([
    'discord.com',
    'canary.discord.com',
    'ptb.discord.com',
    'discordapp.com',
    'canary.discordapp.com',
    'ptb.discordapp.com',
  ])
  const webhookPath = /^\/api(?:\/v\d+)?\/webhooks\/[^/]+\/[^/]+\/?$/
  if (
    url.protocol !== 'https:' ||
    !allowedHosts.has(url.hostname.toLowerCase()) ||
    !webhookPath.test(url.pathname) ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw new Error('Research Lab Discord webhook must be a supported HTTPS webhook URL.')
  }

  return url.toString()
}

function normalizeFromAddress(value: string): string {
  const normalized = normalizeInlineText(value)
  const displayAddressMatch = normalized.match(/^.{1,160}\s<([^<>]+)>$/)
  if (displayAddressMatch) {
    normalizeEmailAddress(displayAddressMatch[1], 'from')
    return normalized
  }
  return normalizeEmailAddress(normalized, 'from')
}

function normalizeEmailAddress(value: string, label: string): string {
  const normalized = value.trim()
  const valid = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(normalized)
  if (!valid || normalized.length > 254) {
    throw new Error(`Research Lab alert ${label} address is invalid.`)
  }
  return normalized
}

function normalizeTimeoutMs(value: number | undefined): number {
  if (value === undefined) return DEFAULT_RESEARCH_LAB_ALERT_TIMEOUT_MS
  if (!Number.isSafeInteger(value)) {
    throw new Error('Research Lab alert timeout must be a whole number of milliseconds.')
  }
  return boundedTimeoutMs(value)
}

function parseTimeoutMs(value: string): number {
  if (!/^\d+$/.test(value)) {
    throw new Error('Research Lab alert timeout must be a whole number of milliseconds.')
  }
  return boundedTimeoutMs(Number(value))
}

function boundedTimeoutMs(value: number): number {
  if (value < MIN_RESEARCH_LAB_ALERT_TIMEOUT_MS || value > MAX_RESEARCH_LAB_ALERT_TIMEOUT_MS) {
    throw new Error(
      `Research Lab alert timeout must be between ${MIN_RESEARCH_LAB_ALERT_TIMEOUT_MS} and ${MAX_RESEARCH_LAB_ALERT_TIMEOUT_MS} ms.`,
    )
  }
  return value
}

function requiredDashboardUrl(value: string | null): string {
  if (!value) throw new Error('Research Lab alert delivery requires a dashboard URL.')
  return value
}

function requiredSecret(value: string, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Research Lab alert ${label} is required.`)
  }
  return value.trim()
}

function optionalEnvValue(env: ResearchLabAlertDeliveryEnv, key: string): string | null {
  const value = env[key]
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function requiredId(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  return normalizeInlineText(value) || fallback
}

function renderAlertScope(alert: ResearchLabAlert): string {
  const parts = [
    `${humanize(alert.scope)}: ${requiredId(alert.entityId, 'unknown')}`,
  ]
  if (alert.validatorId && alert.validatorId !== alert.entityId) {
    parts.push(`Validator: ${requiredId(alert.validatorId, 'unknown')}`)
  }
  return parts.join(' · ')
}

function renderAlertEvidence(alert: ResearchLabAlert): string {
  const evidence = [`Signal: ${humanize(alert.signal)}`]
  if (alert.ageMs !== null && Number.isFinite(alert.ageMs) && alert.ageMs >= 0) {
    evidence.push(`Age: ${formatDuration(alert.ageMs)}`)
  }
  if (alert.ageBlocks !== null && Number.isFinite(alert.ageBlocks) && alert.ageBlocks >= 0) {
    evidence.push(`Chain age: ${Math.floor(alert.ageBlocks).toLocaleString('en-US')} blocks`)
  }
  const observedAt = optionalIsoTimestamp(alert.observedAt)
  if (observedAt) evidence.push(`Observed: ${observedAt}`)
  if (Array.isArray(alert.sources) && alert.sources.length > 0) {
    const sources = alert.sources
      .map((source) => normalizeInlineText(source))
      .filter(Boolean)
      .slice(0, 4)
    if (sources.length > 0) evidence.push(`Sources: ${sources.join(', ')}`)
  }
  if (Number.isFinite(alert.occurrences) && alert.occurrences > 1) {
    evidence.push(`Occurrences: ${Math.floor(alert.occurrences).toLocaleString('en-US')}`)
  }
  return evidence.join(' · ')
}

function formatDuration(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1_000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours}h ${minutes % 60}m`
  const days = Math.floor(hours / 24)
  return `${days}d ${hours % 24}h`
}

function humanize(value: string): string {
  return normalizeInlineText(value)
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase())
    .replace(/\bPcr0\b/g, 'PCR0')
}

function normalizeInlineText(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
}

function normalizeMultilineText(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function optionalIsoTimestamp(value: string | null): string | null {
  if (!value) return null
  const milliseconds = Date.parse(value)
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null
}

function assertTransition(value: string): asserts value is ResearchLabAlertTransition {
  if (!['open', 'escalate', 'remind', 'recover'].includes(value)) {
    throw new Error('Research Lab alert transition must be open, escalate, remind, or recover.')
  }
}

function isRetryableHttpStatus(status: number): boolean {
  return RETRYABLE_HTTP_STATUSES.has(status) || status >= 500
}

function channelResult(
  channel: ResearchLabAlertDeliveryChannel,
  status: ResearchLabAlertDeliveryStatus,
  httpStatus: number | null,
  errorCode: ResearchLabAlertDeliveryErrorCode | null,
  error: string | null,
): ResearchLabAlertChannelDeliveryResult {
  return Object.freeze({ channel, status, httpStatus, errorCode, error })
}

function errorText(value: unknown): string {
  if (value instanceof Error) return value.message || value.name
  if (typeof value === 'string') return value
  if (value === null || value === undefined) return ''
  try {
    return JSON.stringify(value)
  } catch {
    return 'Provider request failed.'
  }
}

function replaceAllLiteral(value: string, search: string, replacement: string): string {
  return search ? value.split(search).join(replacement) : value
}

function truncate(value: string, maximumLength: number): string {
  if (value.length <= maximumLength) return value
  if (maximumLength <= 1) return value.slice(0, maximumLength)
  return `${value.slice(0, maximumLength - 1).trimEnd()}…`
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function escapeHtmlAttribute(value: string): string {
  return escapeHtml(value).replace(/`/g, '&#96;')
}

async function defaultFetch(input: string, init: RequestInit): Promise<Response> {
  return fetch(input, init)
}
