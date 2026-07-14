export type GatewayPcr0Acceptance = {
  checked: boolean
  accepted: boolean | null
  checkedAt: string | null
  detail: string
  staticAllowed: boolean | null
  dynamicAllowed: boolean | null
  cacheSize: number | null
}

type ReadinessFetch = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>

export function parseGatewayPcr0Readiness(value: unknown): GatewayPcr0Acceptance {
  const document = objectRecord(value)
  const validator = objectRecord(document?.validator)
  const staticAllowlist = objectRecord(validator?.pcr0_static_allowlist)
  const dynamicCache = objectRecord(validator?.pcr0_dynamic_cache)
  const verification = objectRecord(dynamicCache?.verification)
  const cacheStatus = objectRecord(dynamicCache?.cache_status)
  const accepted = booleanOrNull(validator?.pcr0_accepted)
  const staticAllowed = booleanOrNull(staticAllowlist?.allowed)
  const dynamicAllowed = booleanOrNull(dynamicCache?.valid)
  const cacheSize = finiteNumberOrNull(cacheStatus?.cache_size)
  const buildInProgress = booleanOrNull(cacheStatus?.build_in_progress) === true
  const checkedAt = isoStringOr(document?.generated_at_utc)
  const gatewayMessage = stringOr(verification?.message)

  if (accepted === true) {
    return {
      checked: true,
      accepted,
      checkedAt,
      detail: 'Production gateway accepts this validator PCR0.',
      staticAllowed,
      dynamicAllowed,
      cacheSize,
    }
  }

  if (accepted === false && buildInProgress) {
    return {
      checked: true,
      accepted: null,
      checkedAt,
      detail:
        'Gateway is rebuilding its PCR0 verification cache after a deploy; acceptance is re-checked automatically.',
      staticAllowed,
      dynamicAllowed,
      cacheSize,
    }
  }

  if (accepted === false) {
    const gatewayDetail = gatewayMessage
      ? ` ${/[.!?]$/.test(gatewayMessage) ? gatewayMessage : `${gatewayMessage}.`}`
      : ''
    const cacheDetail = cacheSize === null
      ? ''
      : ` The gateway currently recognizes ${cacheSize} PCR0${cacheSize === 1 ? '' : 's'}.`
    return {
      checked: true,
      accepted,
      checkedAt,
      detail: `Production gateway rejects this validator PCR0.${gatewayDetail}${cacheDetail}`,
      staticAllowed,
      dynamicAllowed,
      cacheSize,
    }
  }

  return {
    checked: false,
    accepted: null,
    checkedAt,
    detail: 'Production gateway did not return a PCR0 acceptance result.',
    staticAllowed,
    dynamicAllowed,
    cacheSize,
  }
}

export async function fetchGatewayPcr0Acceptance({
  gatewayUrl,
  pcr0,
  commit,
  fetchImpl = fetch,
  timeoutMs = 15_000,
}: {
  gatewayUrl: string
  pcr0: string | null
  commit: string | null
  fetchImpl?: ReadinessFetch
  timeoutMs?: number
}): Promise<GatewayPcr0Acceptance> {
  if (!pcr0) {
    return unavailableAcceptance('Validator has not published a PCR0 to check.')
  }

  let url: URL
  try {
    url = new URL('/attestation/deploy-readiness', gatewayUrl)
  } catch {
    return unavailableAcceptance('Production gateway URL is invalid.')
  }

  url.searchParams.set('validator_pcr0', pcr0)
  if (commit) url.searchParams.set('validator_commit', commit)
  url.searchParams.set('require_pcr0', 'true')
  url.searchParams.set('require_pcr0_commit_match', 'true')

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(url, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
    if (!response.ok) {
      return unavailableAcceptance(`Production gateway readiness check returned HTTP ${response.status}.`)
    }
    return parseGatewayPcr0Readiness(await response.json())
  } catch (error) {
    const detail = error instanceof Error && error.name === 'AbortError'
      ? 'Production gateway readiness check timed out.'
      : 'Production gateway readiness check could not be reached.'
    return unavailableAcceptance(detail)
  } finally {
    clearTimeout(timeout)
  }
}

function unavailableAcceptance(detail: string): GatewayPcr0Acceptance {
  return {
    checked: false,
    accepted: null,
    checkedAt: null,
    detail,
    staticAllowed: null,
    dynamicAllowed: null,
    cacheSize: null,
  }
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function booleanOrNull(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function finiteNumberOrNull(value: unknown): number | null {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : null
}

function stringOr(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function isoStringOr(value: unknown): string | null {
  const text = stringOr(value)
  if (!text) return null
  const timestamp = Date.parse(text)
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null
}
