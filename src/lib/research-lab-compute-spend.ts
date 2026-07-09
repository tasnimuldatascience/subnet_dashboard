const DAY_MS = 24 * 60 * 60 * 1000

export type ResearchLabTerminalReceiptEvent = {
  receipt_id?: string | null
  event_type?: string | null
  event_doc?: Record<string, unknown> | null
  created_at?: string | null
}

export type ResearchLabDailyComputeSpendPoint = {
  date: string
  spendUsd: number
  runCount: number
}

export type ResearchLabDailyComputeSpend = {
  days: number
  points: ResearchLabDailyComputeSpendPoint[]
  totalUsd: number
  averageDailyUsd: number
  latestDayUsd: number
  runCount: number
}

export type ResearchLabFinalizedRunReconciliation = {
  reachedScoringCount: number
  candidateNotScoredCount: number
  noCandidateCount: number
  noCandidateFailedCount: number
  noCandidateCompletedCount: number
}

type LatestTerminalRun = {
  createdAtMs: number
  costMicrousd: number
  eventType?: string
}

export function buildResearchLabDailyComputeSpend({
  events,
  receiptRunIds = new Map(),
  days = 30,
  now = new Date(),
}: {
  events: ResearchLabTerminalReceiptEvent[]
  receiptRunIds?: ReadonlyMap<string, string>
  days?: number
  now?: Date
}): ResearchLabDailyComputeSpend {
  const dayCount = Math.max(1, Math.floor(days))
  const endDayMs = utcDayStart(now.getTime())
  const startDayMs = endDayMs - (dayCount - 1) * DAY_MS
  const latestByRun = latestTerminalRunsByRun({ events, receiptRunIds, startDayMs, endDayMs })

  const byDate = new Map<string, ResearchLabDailyComputeSpendPoint>()
  for (let index = 0; index < dayCount; index += 1) {
    const date = utcDayKey(startDayMs + index * DAY_MS)
    byDate.set(date, { date, spendUsd: 0, runCount: 0 })
  }

  for (const event of latestByRun.values()) {
    const date = utcDayKey(event.createdAtMs)
    const point = byDate.get(date)
    if (!point) continue
    point.spendUsd += microusdToUsd(event.costMicrousd)
    point.runCount += 1
  }

  const points = Array.from(byDate.values()).map((point) => ({
    ...point,
    spendUsd: roundUsd(point.spendUsd),
  }))
  const totalUsd = roundUsd(points.reduce((sum, point) => sum + point.spendUsd, 0))

  return {
    days: dayCount,
    points,
    totalUsd,
    averageDailyUsd: roundUsd(totalUsd / dayCount),
    latestDayUsd: points.at(-1)?.spendUsd ?? 0,
    runCount: points.reduce((sum, point) => sum + point.runCount, 0),
  }
}

export function researchLabFinalizedRunIds({
  events,
  receiptRunIds = new Map(),
  days = 30,
  now = new Date(),
}: {
  events: ResearchLabTerminalReceiptEvent[]
  receiptRunIds?: ReadonlyMap<string, string>
  days?: number
  now?: Date
}): string[] {
  const dayCount = Math.max(1, Math.floor(days))
  const endDayMs = utcDayStart(now.getTime())
  const startDayMs = endDayMs - (dayCount - 1) * DAY_MS
  return Array.from(
    latestTerminalRunsByRun({ events, receiptRunIds, startDayMs, endDayMs }).keys(),
  )
}

export function buildResearchLabFinalizedRunReconciliation({
  events,
  receiptRunIds = new Map(),
  candidateRunIds,
  scoringRunIds,
  days = 30,
  now = new Date(),
}: {
  events: ResearchLabTerminalReceiptEvent[]
  receiptRunIds?: ReadonlyMap<string, string>
  candidateRunIds: ReadonlySet<string>
  scoringRunIds: ReadonlySet<string>
  days?: number
  now?: Date
}): ResearchLabFinalizedRunReconciliation {
  const dayCount = Math.max(1, Math.floor(days))
  const endDayMs = utcDayStart(now.getTime())
  const startDayMs = endDayMs - (dayCount - 1) * DAY_MS
  const latestByRun = latestTerminalRunsByRun({ events, receiptRunIds, startDayMs, endDayMs })
  const result: ResearchLabFinalizedRunReconciliation = {
    reachedScoringCount: 0,
    candidateNotScoredCount: 0,
    noCandidateCount: 0,
    noCandidateFailedCount: 0,
    noCandidateCompletedCount: 0,
  }

  for (const [runId, terminalRun] of latestByRun) {
    if (scoringRunIds.has(runId)) {
      result.reachedScoringCount += 1
      continue
    }
    if (candidateRunIds.has(runId)) {
      result.candidateNotScoredCount += 1
      continue
    }

    result.noCandidateCount += 1
    if (terminalRun.eventType === 'failed') result.noCandidateFailedCount += 1
    if (terminalRun.eventType === 'completed') result.noCandidateCompletedCount += 1
  }

  return result
}

export function receiptEventCostMicrousd(eventDoc: Record<string, unknown>): number {
  const ledger = objectRecord(eventDoc.final_cost_ledger)
  if (!ledger) return 0

  const directMicrousd = nullableCostNumber(ledger.actual_openrouter_cost_microusd)
  if (directMicrousd !== null) return Math.max(0, Math.round(directMicrousd))

  const openRouterUsd = nullableCostNumber(ledger.actual_openrouter_cost_usd)
  const totalUsd = nullableCostNumber(ledger.total_usd)
  return Math.max(0, Math.round((openRouterUsd ?? totalUsd ?? 0) * 1_000_000))
}

export function microusdToUsd(value: unknown): number {
  return Math.max(0, numberOr(value, 0)) / 1_000_000
}

export function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}

function latestTerminalRunsByRun({
  events,
  receiptRunIds,
  startDayMs,
  endDayMs,
}: {
  events: ResearchLabTerminalReceiptEvent[]
  receiptRunIds: ReadonlyMap<string, string>
  startDayMs: number
  endDayMs: number
}): Map<string, LatestTerminalRun> {
  const latestByRun = new Map<string, LatestTerminalRun>()

  for (const row of events) {
    const doc = objectRecord(row.event_doc) ?? {}
    const receiptId = stringOr(row.receipt_id)
    const runId = stringOr(doc.run_id) ?? (receiptId ? receiptRunIds.get(receiptId) : undefined)
    if (!runId) continue

    const createdAtMs = timestampOrZero(row.created_at)
    if (createdAtMs < startDayMs || createdAtMs >= endDayMs + DAY_MS) continue

    const current = latestByRun.get(runId)
    if (!current || createdAtMs > current.createdAtMs) {
      latestByRun.set(runId, {
        createdAtMs,
        costMicrousd: receiptEventCostMicrousd(doc),
        eventType: stringOr(row.event_type),
      })
    }
  }

  return latestByRun
}

function nullableCostNumber(value: unknown): number | null {
  if (typeof value === 'string' && value.trim() === '') return null
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function numberOr(value: unknown, fallback: number): number {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function stringOr(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function timestampOrZero(value: unknown): number {
  const text = typeof value === 'string' ? value : undefined
  const time = text ? new Date(text).getTime() : Number(value)
  return Number.isFinite(time) ? time : 0
}

function utcDayStart(value: number): number {
  const date = new Date(value)
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
}

function utcDayKey(value: number): string {
  return new Date(utcDayStart(value)).toISOString().slice(0, 10)
}
