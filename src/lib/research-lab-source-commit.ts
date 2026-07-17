export const SOURCING_MODEL_REPOSITORY = 'leadpoet/Sourcing_model'
export const GITHUB_API_VERSION = '2022-11-28'

const MAX_FILES = 30
const MAX_PATCH_CHARS_PER_FILE = 6_000
const MAX_TOTAL_PATCH_CHARS = 40_000
const DEFAULT_TIMEOUT_MS = 20_000

export type ResearchLabSourceCommitEvidence = Readonly<{
  repository: string
  available: boolean
  unavailableReason: string | null
  commitSha: string | null
  parentShas: readonly string[]
  commitMessage: string | null
  stats: Readonly<{
    additions: number | null
    deletions: number | null
    total: number | null
  }>
  files: readonly Readonly<{
    filename: string
    previousFilename: string | null
    status: string | null
    additions: number | null
    deletions: number | null
    changes: number | null
    patch: string | null
    patchTruncated: boolean
  }>[]
  truncated: boolean
  fetchedAt: string | null
}>

export type ResearchLabSourceCommitDependencies = Readonly<{
  fetch?: typeof fetch
  setTimeout?: typeof globalThis.setTimeout
  clearTimeout?: typeof globalThis.clearTimeout
  now?: () => Date
}>

export async function fetchResearchLabSourceCommit(
  input: Readonly<{
    commitSha: string | null
    token: string | null
    repository?: string
    timeoutMs?: number
  }>,
  dependencies: ResearchLabSourceCommitDependencies = {},
): Promise<ResearchLabSourceCommitEvidence> {
  const repository = normalizeRepository(input.repository)
  const commitSha = normalizeCommitSha(input.commitSha)
  const token = input.token?.trim() || null
  if (!commitSha) return unavailable(repository, null, 'No pushed source commit SHA was recorded for this candidate.')
  if (!token) {
    return unavailable(
      repository,
      commitSha,
      'SOURCING_MODEL_GITHUB_TOKEN is not configured; repository code was not read.',
    )
  }

  const controller = new AbortController()
  const setTimer = dependencies.setTimeout ?? globalThis.setTimeout
  const clearTimer = dependencies.clearTimeout ?? globalThis.clearTimeout
  const timeoutMs = normalizeTimeout(input.timeoutMs)
  const timeout = setTimer(() => controller.abort(), timeoutMs)
  const fetchImpl = dependencies.fetch ?? fetch

  try {
    const response = await fetchImpl(
      `https://api.github.com/repos/${repository}/commits/${commitSha}`,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'User-Agent': 'Leadpoet-Research-Lab-Improvement-Analyzer',
          'X-GitHub-Api-Version': GITHUB_API_VERSION,
        },
        signal: controller.signal,
      },
    )
    if (!response.ok) {
      return unavailable(
        repository,
        commitSha,
        `GitHub repository read returned HTTP ${response.status}; no source patch was supplied to the analyzer.`,
      )
    }

    const body = await response.json().catch(() => null)
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return unavailable(repository, commitSha, 'GitHub returned an invalid commit document.')
    }
    const row = body as Record<string, unknown>
    const rawFiles = Array.isArray(row.files) ? row.files : []
    let remainingPatchChars = MAX_TOTAL_PATCH_CHARS
    let truncated = rawFiles.length > MAX_FILES
    const files = rawFiles.slice(0, MAX_FILES).flatMap((value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return []
      const file = value as Record<string, unknown>
      const filename = stringOrNull(file.filename)
      if (!filename) return []
      const rawPatch = stringOrNull(file.patch)
      const allowedPatchChars = Math.min(MAX_PATCH_CHARS_PER_FILE, remainingPatchChars)
      const patch = rawPatch && allowedPatchChars > 0
        ? rawPatch.slice(0, allowedPatchChars)
        : null
      const patchTruncated = Boolean(rawPatch && (!patch || patch.length < rawPatch.length))
      remainingPatchChars -= patch?.length ?? 0
      truncated ||= patchTruncated
      return [Object.freeze({
        filename,
        previousFilename: stringOrNull(file.previous_filename),
        status: stringOrNull(file.status),
        additions: numberOrNull(file.additions),
        deletions: numberOrNull(file.deletions),
        changes: numberOrNull(file.changes),
        patch,
        patchTruncated,
      })]
    })
    const commit = recordOrEmpty(row.commit)
    const stats = recordOrEmpty(row.stats)

    return Object.freeze({
      repository,
      available: true,
      unavailableReason: null,
      commitSha: normalizeCommitSha(row.sha) ?? commitSha,
      parentShas: Object.freeze(arrayOfRecords(row.parents)
        .map((parent) => normalizeCommitSha(parent.sha))
        .filter((sha): sha is string => Boolean(sha))),
      commitMessage: truncate(stringOrNull(commit.message), 2_000),
      stats: Object.freeze({
        additions: numberOrNull(stats.additions),
        deletions: numberOrNull(stats.deletions),
        total: numberOrNull(stats.total),
      }),
      files: Object.freeze(files),
      truncated,
      fetchedAt: (dependencies.now?.() ?? new Date()).toISOString(),
    })
  } catch {
    const reason = controller.signal.aborted
      ? `GitHub repository read timed out after ${timeoutMs} ms.`
      : 'GitHub repository read failed before a source patch was available.'
    return unavailable(repository, commitSha, reason)
  } finally {
    clearTimer(timeout)
  }
}

function normalizeRepository(value: string | undefined): string {
  const candidate = value?.trim() || SOURCING_MODEL_REPOSITORY
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(candidate)) {
    return SOURCING_MODEL_REPOSITORY
  }
  return candidate
}

function normalizeCommitSha(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const candidate = value.trim()
  return /^[0-9a-f]{7,64}$/i.test(candidate) ? candidate : null
}

function normalizeTimeout(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_TIMEOUT_MS
  return Math.min(60_000, Math.max(1_000, Math.trunc(value as number)))
}

function unavailable(
  repository: string,
  commitSha: string | null,
  unavailableReason: string,
): ResearchLabSourceCommitEvidence {
  return Object.freeze({
    repository,
    available: false,
    unavailableReason,
    commitSha,
    parentShas: Object.freeze([]),
    commitMessage: null,
    stats: Object.freeze({ additions: null, deletions: null, total: null }),
    files: Object.freeze([]),
    truncated: false,
    fetchedAt: null,
  })
}

function arrayOfRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    : []
}

function recordOrEmpty(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function numberOrNull(value: unknown): number | null {
  if ((typeof value !== 'number' && typeof value !== 'string') || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function truncate(value: string | null, maximum: number): string | null {
  if (!value) return null
  return value.length <= maximum ? value : `${value.slice(0, maximum - 1)}…`
}
