export type GatewayCommitFreshness =
  | 'latest'
  | 'behind'
  | 'ahead'
  | 'diverged'
  | 'unknown'

export type GatewayCommitComparison = {
  freshness: GatewayCommitFreshness
  commitsBehind: number | null
}

export type GatewayDeployment = {
  sourceAvailable: boolean
  unavailableReason: string | null
  commitSha: string | null
  branch: string | null
  buildId: string | null
  builtAt: string | null
  loadedAt: string | null
  commitSource: string | null
  repositoryUrl: string | null
  checkedAt: string | null
}

type DeploymentFetch = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>

export function parseGatewayDeployment(value: unknown): GatewayDeployment {
  const document = objectRecord(value)
  const gateway = objectRecord(document?.gateway)
  const buildInfo = objectRecord(gateway?.build_info)
  const commitSha =
    commitShaOrNull(gateway?.commit) ??
    commitShaOrNull(buildInfo?.git_commit)
  const buildInfoError = stringOr(buildInfo?.build_info_error)

  return {
    sourceAvailable: Boolean(commitSha),
    unavailableReason: commitSha
      ? null
      : buildInfoError ?? 'Gateway did not report its deployed commit',
    commitSha,
    branch: stringOr(buildInfo?.git_branch),
    buildId: stringOr(buildInfo?.build_id),
    builtAt:
      isoStringOr(document?.build_time_utc) ??
      isoStringOr(buildInfo?.build_time_utc),
    loadedAt: isoStringOr(buildInfo?.loaded_at_utc),
    commitSource: stringOr(buildInfo?.commit_source),
    repositoryUrl: stringOr(buildInfo?.git_remote),
    checkedAt: isoStringOr(document?.generated_at_utc),
  }
}

export async function fetchGatewayDeployment({
  gatewayUrl,
  fetchImpl = fetch,
  timeoutMs = 5_000,
}: {
  gatewayUrl: string
  fetchImpl?: DeploymentFetch
  timeoutMs?: number
}): Promise<GatewayDeployment> {
  let url: URL
  try {
    url = new URL('/attestation/deploy-readiness', gatewayUrl)
  } catch {
    return unavailableDeployment('Production gateway URL is invalid.')
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(url, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
    if (!response.ok) {
      return unavailableDeployment(`Production gateway returned HTTP ${response.status}.`)
    }
    return parseGatewayDeployment(await response.json())
  } catch (error) {
    const reason = error instanceof Error && error.name === 'AbortError'
      ? 'Production gateway commit check timed out.'
      : 'Production gateway commit could not be reached.'
    return unavailableDeployment(reason)
  } finally {
    clearTimeout(timeout)
  }
}

export function gatewayCommitFreshness(
  gatewayCommitSha: string | null,
  latestCommitSha: string | null,
): GatewayCommitFreshness {
  const gatewaySha = commitShaOrNull(gatewayCommitSha)
  const latestSha = commitShaOrNull(latestCommitSha)
  if (!gatewaySha || !latestSha) return 'unknown'

  const gateway = gatewaySha.toLowerCase()
  const latest = latestSha.toLowerCase()
  return gateway === latest || gateway.startsWith(latest) || latest.startsWith(gateway)
    ? 'latest'
    : 'behind'
}

export function parseGatewayCommitComparison(
  value: unknown,
  gatewayCommitSha: string | null,
  latestCommitSha: string | null,
): GatewayCommitComparison {
  const fallbackFreshness = gatewayCommitFreshness(gatewayCommitSha, latestCommitSha)
  if (fallbackFreshness === 'latest') {
    return { freshness: 'latest', commitsBehind: 0 }
  }

  const document = objectRecord(value)
  const status = stringOr(document?.status)?.toLowerCase()
  const aheadBy = nonNegativeIntegerOrNull(document?.ahead_by)

  if (status === 'identical') return { freshness: 'latest', commitsBehind: 0 }
  if (status === 'ahead') {
    return { freshness: 'behind', commitsBehind: aheadBy }
  }
  if (status === 'behind') return { freshness: 'ahead', commitsBehind: null }
  if (status === 'diverged') return { freshness: 'diverged', commitsBehind: null }

  return { freshness: fallbackFreshness, commitsBehind: null }
}

function unavailableDeployment(unavailableReason: string): GatewayDeployment {
  return {
    sourceAvailable: false,
    unavailableReason,
    commitSha: null,
    branch: null,
    buildId: null,
    builtAt: null,
    loadedAt: null,
    commitSource: null,
    repositoryUrl: null,
    checkedAt: null,
  }
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function commitShaOrNull(value: unknown): string | null {
  const text = stringOr(value)
  return text && /^[0-9a-f]{7,64}$/i.test(text) ? text : null
}

function stringOr(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function nonNegativeIntegerOrNull(value: unknown): number | null {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isInteger(number) && number >= 0 ? number : null
}

function isoStringOr(value: unknown): string | null {
  const text = stringOr(value)
  if (!text) return null
  const timestamp = Date.parse(text)
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null
}
