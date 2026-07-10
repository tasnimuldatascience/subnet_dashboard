export type AdminLabTelemetryState =
  | 'active'
  | 'completed'
  | 'failed'
  | 'stalled'
  | 'idle'
  | 'unknown'

export type AdminLabCompanyDetail = {
  id: string
  name: string
  website: string | null
  linkedin: string | null
  finalScore: number | null
  modelSide: string | null
  fitPassed: boolean | null
  intentPassed: boolean | null
  failureReason: string | null
  industry: string | null
  country: string | null
  capturedAt: string | null
}

export type AdminLabErrorDetail = {
  id: string
  source: 'provider' | 'dispatch' | 'candidate' | 'score_bundle'
  title: string
  detail: string | null
  statusCode: number | null
  provider: string | null
  endpoint: string | null
  icpRef: string | null
  candidateId: string | null
  runId: string | null
  count: number
  occurredAt: string | null
}

export type AdminLabFunnelDetail = {
  sourced: number
  fitPass: number
  verified: number
  intentValid: number
  scored: number
}

export type AdminLabIcpDetail = {
  icpRef: string
  icpHash: string | null
  label: string
  industry: string | null
  subIndustry: string | null
  status: string
  score: number | null
  baseScore: number | null
  delta: number | null
  spendUsd: number
  budgetUsd: number | null
  providerEventCount: number
  errorCount: number
  failureReason: string | null
  hardFailure: boolean
  funnel: AdminLabFunnelDetail | null
  companyScoreCount: number
  companies: AdminLabCompanyDetail[]
}

export type AdminLabDailyBenchmark = {
  state: AdminLabTelemetryState
  stateLabel: string
  detail: string
  benchmarkDate: string | null
  attempt: number | null
  rollingWindowHash: string | null
  workerRef: string | null
  startedAt: string | null
  lastActivityAt: string | null
  completedAt: string | null
  icpsTotal: number
  icpsProcessed: number
  icpsRemaining: number
  progressPercent: number
  provisionalScore: number | null
  completedAverageScore: number | null
  spendUsd: number
  budgetUsd: number | null
  providerEventCount: number
  companyCount: number
  errorCount: number
  icps: AdminLabIcpDetail[]
  errors: AdminLabErrorDetail[]
}

export type AdminLabChampionSummary = {
  championRewardId: string
  candidateId: string
  ticketId: string | null
  runId: string | null
  scoreBundleId: string
  minerHotkey: string
  status: string
  reason: string | null
  promotedAt: string | null
  improvementPoints: number | null
  thresholdPoints: number | null
  candidateScore: number | null
  baseScore: number | null
  meanDelta: number | null
  deltaLcb: number | null
  spendUsd: number
  budgetUsd: number | null
  icpCount: number
  successfulIcpCount: number
  companyCount: number
  errorCount: number
  icps: AdminLabIcpDetail[]
  errors: AdminLabErrorDetail[]
}

export type AdminLabCandidateRunDetail = {
  candidateId: string
  status: string
  reason: string | null
  summary: string | null
  scoreBundleId: string | null
  createdAt: string | null
  statusAt: string | null
  candidateScore: number | null
  baseScore: number | null
  meanDelta: number | null
  deltaLcb: number | null
  spendUsd: number
  budgetUsd: number | null
  providerEventCount: number
  companyCount: number
  errorCount: number
  icps: AdminLabIcpDetail[]
  errors: AdminLabErrorDetail[]
}

export type AdminLabRunDetail = {
  ticketId: string
  runId: string | null
  state: AdminLabTelemetryState
  phase: string
  totalSpendUsd: number
  totalBudgetUsd: number | null
  providerEventCount: number
  companyCount: number
  errorCount: number
  candidates: AdminLabCandidateRunDetail[]
  errors: AdminLabErrorDetail[]
  fetchedAt: string
}
