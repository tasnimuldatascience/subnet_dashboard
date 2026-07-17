export type AdminLabOverviewResponseKind = 'refresh' | 'full' | 'invalid'

/**
 * Classify the two successful Admin Research Lab overview response shapes.
 *
 * The endpoint normally returns the compact refresh shape when `mode=refresh`,
 * but a client that remains open across a deployment can briefly receive the
 * full overview shape. Keep this decoder deliberately structural: it protects
 * the client from unsafe array iteration without duplicating the full API type.
 */
export function classifyAdminLabOverviewResponse(
  value: unknown,
): AdminLabOverviewResponseKind {
  if (!isRecord(value) || !hasCommonOverviewFields(value)) return 'invalid'

  if (
    Array.isArray(value.recentLoops) &&
    Array.isArray(value.loopStates) &&
    Array.isArray(value.loopStatusOptions) &&
    isRecord(value.loopPagination)
  ) {
    return 'refresh'
  }

  if (
    Array.isArray(value.loops) &&
    Array.isArray(value.loopStatusOptions) &&
    isRecord(value.loopPagination)
  ) {
    return 'full'
  }

  return 'invalid'
}

/** Return only top-level field names so diagnostics never log response data. */
export function adminLabOverviewResponseKeys(value: unknown): string[] {
  return isRecord(value) ? Object.keys(value).sort() : []
}

function hasCommonOverviewFields(value: Record<string, unknown>): boolean {
  return (
    isRecord(value.ops) &&
    isRecord(value.stats) &&
    typeof value.fetchedAt === 'string'
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
