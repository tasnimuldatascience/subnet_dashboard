'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Clock3,
  CircleDollarSign,
  ChevronLeft,
  ChevronRight,
  Container,
  Database,
  Gauge,
  GitCommitHorizontal,
  Github,
  Loader2,
  PauseCircle,
  PlayCircle,
  Plus,
  Search,
  ShieldCheck,
  ShieldX,
  Siren,
  Trash2,
} from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { formatDateTime, formatRelative, shortHotkey } from '@/lib/admin-format'
import {
  adminLabRefreshErrorMessage,
  adminLabOverviewResponseKeys,
  classifyAdminLabOverviewResponse,
} from '@/lib/admin-research-lab-refresh'
import type { ResearchLabStatusFilterOption } from '@/lib/research-lab-status'
import {
  DailyBenchmarkTelemetry,
  RunTelemetry,
} from './AdminResearchLabTelemetry'
import { AdminMetagraph } from './AdminMetagraph'
import type {
  AdminLabBenchmarkRunSummary,
  AdminLabChampionSummary,
  AdminLabDailyBenchmark,
  AdminLabRunDetail,
} from '@/lib/admin-research-lab-telemetry'

type LabTimelinePhase =
  | 'ticket'
  | 'queue'
  | 'auto_research'
  | 'candidate'
  | 'scoring'
  | 'promotion'
  | 'public_projection'

type LabTimelineTimestampKind =
  | 'entered_stage'
  | 'projection_written'
  | 'last_activity_represented'

type AdminHealthState = 'healthy' | 'degraded' | 'critical' | 'unknown'
type AdminScoringState = 'active' | 'paused' | 'stalled' | 'blocked' | 'idle' | 'unknown'

const ADMIN_OVERVIEW_REFRESH_MS = 30_000
const ADMIN_ACTIVE_RUN_REFRESH_MS = 15_000
const ADMIN_TERMINAL_RUN_REFRESH_MS = 120_000

export type AdminLabLoopSummary = {
  cardId: string
  ticketId: string
  runId: string | null
  receiptId: string | null
  minerHotkey: string
  researchArea: string
  researchFocusSummary: string
  topicTags: string[]
  topicSignatureHash: string
  outcomeLabel: string
  outcomeBand: string
  publicStatus?: string
  paymentState?: string
  executionState?: string
  candidateState?: string
  resultState?: string
  opsReason?: string
  statusDetail?: string
  opsWarnings?: string[]
  statusKey: string
  statusLabel: string
  statusNote?: AdminLoopStatusNote
  actionNote?: AdminLoopStatusNote
  candidateCount: number
  scoredCandidateCount: number
  bestCandidatePublicSummary: string
  lastActivityAt: string
  submittedAt: string
}

type AdminLoopStatusNote = {
  tone: 'info' | 'warning' | 'error'
  label: string
  detail: string
}

type AdminLabHealthSignal = {
  id: string
  label: string
  value: string
  state: AdminHealthState
  detail: string
  updatedAt?: string | null
}

type AdminLabScoringSummary = {
  state: AdminScoringState
  label: string
  detail: string
  source: 'explicit' | 'inferred' | 'missing'
  paused: boolean
  pauseReason: string | null
  controlUpdatedAt: string | null
  activeRuns: number
  scoringRuns: number
  queuedRuns: number
  blockedRuns: number
  staleRuns: number
  candidatesRemaining: number
  icpsRemaining: number | null
  scoreBundlesLastHour: number
  scoreBundlesLast24h: number
  lastScoringAt: string | null
  oldestActiveRunAt: string | null
}

type AdminLabWorkflowControlSummary = {
  state: 'active' | 'paused' | 'unknown'
  label: 'Active' | 'Paused' | 'Unknown'
  source: 'gateway_control' | 'missing'
  reason: string | null
  updatedAt: string | null
}

type AdminLabWorkflowControls = {
  scoring: AdminLabWorkflowControlSummary
  loops: AdminLabWorkflowControlSummary
}

type AdminLabActiveRun = {
  ticketId: string
  runId: string | null
  receiptId: string | null
  minerHotkey: string
  researchFocusSummary: string
  topicTags: string[]
  statusKey: string
  statusLabel: string
  phase: string
  candidateCount: number
  scoredCandidateCount: number
  candidatesRemaining: number
  icpTotal: number | null
  icpsScored: number | null
  icpsRemaining: number | null
  scoreBundleId: string | null
  scoreBundleStatus: string | null
  blocker: string | null
  submittedAt: string
  lastActivityAt: string
  ageMs: number
  idleMs: number
  stale: boolean
}

type AdminLabPipelineStage = {
  id: string
  label: string
  count: number
  staleCount: number
  percent: number
}

type AdminLabBenchmarkSummary = {
  state: AdminHealthState
  reportId: string | null
  benchmarkDate: string | null
  rollingWindowHash: string | null
  aggregateScore: number | null
  itemCount: number
  publicIcpCount: number
  privateHoldoutIcpCount: number
  currentStatusAt: string | null
  ageMs: number | null
  issueCount: number
  topIssues: Array<{ key: string; count: number }>
  detail: string
}

type AdminLabAlertSummary = {
  state: AdminHealthState
  source: 'ops_telemetry' | 'public_transparency_log' | 'canonical_evaluator' | 'combined' | 'none'
  sourceAvailable: boolean
  unavailableReason: string | null
  totalLast24h: number
  criticalLast24h: number
  warningLast24h: number
  activeCount: number
  verifiedEventCount: number
  weightSubmissionCount: number
  epochAuditCount: number
  latestObservedAt: string | null
  latestCheckpointAt: string | null
  latestCheckpointUrl: string | null
  operations: AdminLabAlertOperationsSummary
  recent: AdminLabAlert[]
}

type AdminLabAlertOperationsSummary = {
  state: AdminHealthState
  sourceAvailable: boolean
  unavailableReason: string | null
  monitorEnabled: boolean
  monitorIntervalMs: number
  monitoredValidatorCount: number
  validators: AdminLabMonitoredValidator[]
  emailConfigured: boolean
  discordConfigured: boolean
  deliveryReady: boolean
  configurationBlockers: string[]
  lastStartedAt: string | null
  lastCompletedAt: string | null
  lastErrorAt: string | null
  lastError: string | null
  heartbeatAgeMs: number | null
  leaseActive: boolean
  pendingDeliveryCount: number
  overdueDeliveryCount: number
  succeededDeliveryCount24h: number
  failedDeliveryCount24h: number
  latestDeliveryAt: string | null
  oldestPendingAt: string | null
  detail: string
}

type AdminLabMonitoredValidator = {
  hotkey: string
  label: string | null
  source: 'database' | 'environment'
  enabled: boolean
  monitorPcr0: boolean
  monitorOffchainWeights: boolean
  monitorOnchainWeights: boolean
  expectedPcr0: string | null
  updatedAt: string | null
}

type AdminLabAlert = {
  id: string
  severity: string
  source: string
  title: string
  fingerprint: string
  status: string
  count: number
  firstSeenAt: string | null
  lastSeenAt: string | null
  detail?: string | null
  signal?: string | null
  scope?: string | null
  entityId?: string | null
  validatorId?: string | null
  ageBlocks?: number | null
  sources?: string[]
}

type AdminLabAttestationSummary = {
  state: AdminHealthState
  source: 'ops_attestation_current' | 'published_weight_bundles' | 'none'
  verificationMode: 'expected_match' | 'gateway_acceptance' | 'observation_only'
  sourceAvailable: boolean
  unavailableReason: string | null
  totalNodes: number
  matchedNodes: number
  mismatchedNodes: number
  missingNodes: number
  expectedPcr0: string | null
  latestAttestedAt: string | null
  latestEpoch: number | null
  acceptanceCheckedAt: string | null
  acceptanceDetail: string | null
  nodes: AdminLabAttestationNode[]
}

type AdminLabAttestationNode = {
  id: string
  component: string
  nodeId: string
  hotkey: string | null
  expectedPcr0: string | null
  observedPcr0: string | null
  matched: boolean | null
  buildId: string | null
  gitSha: string | null
  attestedAt: string | null
  epoch: number | null
  transparencyEventHash: string | null
  acceptanceCheckedAt: string | null
  acceptanceDetail: string | null
}

type AdminLabSourcingModelSummary = {
  sourceAvailable: boolean
  unavailableReason: string | null
  status: string | null
  commitFreshness: 'latest' | 'behind' | 'unknown'
  commitComparisonAvailable: boolean
  commitComparisonReason: string | null
  latestKnownCommitSha: string | null
  latestKnownCommitAt: string | null
  latestKnownCommitSource: string | null
  comparisonBranch: string | null
  comparisonCheckedAt: string | null
  versionId: string | null
  gitCommitSha: string | null
  imageRefHash: string | null
  buildId: string | null
  branch: string | null
  source: string | null
  actorRef: string | null
  componentRegistryVersion: string | null
  scoringAdapterVersion: string | null
  modelArtifactHash: string | null
  manifestHash: string | null
  currentPointerUri: string | null
  activatedAt: string | null
  repositoryUrl: string | null
}

type AdminLabRepositorySummary = {
  sourceAvailable: boolean
  unavailableReason: string | null
  owner: string
  name: string
  branch: string
  repositoryUrl: string
  commitSha: string | null
  commitUrl: string | null
  committedAt: string | null
  commitMessage: string | null
  authorLogin: string | null
  checkedAt: string
  gatewaySourceAvailable: boolean
  gatewayUnavailableReason: string | null
  gatewayCommitSha: string | null
  gatewayBranch: string | null
  gatewayBuildId: string | null
  gatewayBuiltAt: string | null
  gatewayLoadedAt: string | null
  gatewayCommitSource: string | null
  gatewayCheckedAt: string | null
  commitFreshness: 'latest' | 'behind' | 'ahead' | 'diverged' | 'unknown'
  commitsBehind: number | null
}

type AdminLabValidatorDeploymentSummary = {
  sourceAvailable: boolean
  unavailableReason: string | null
  source: AdminLabAttestationSummary['source']
  commitSha: string | null
  buildId: string | null
  reportedAt: string | null
  nodeId: string | null
  hotkey: string | null
  checkedAt: string
  commitFreshness: 'latest' | 'behind' | 'ahead' | 'diverged' | 'unknown'
  commitsBehind: number | null
  reportingNodeCount: number
  distinctCommitCount: number
  commitShas: string[]
}

type AdminLabDataFreshness = {
  state: AdminHealthState
  latestActivityAt: string | null
  ageMs: number | null
  loopCount: number
}

type AdminLabComputeSpendPoint = {
  date: string
  spendUsd: number
  runCount: number
}

type AdminLabComputeSpendSummary = {
  sourceAvailable: boolean
  unavailableReason: string | null
  days: number
  points: AdminLabComputeSpendPoint[]
  totalUsd: number
  averageDailyUsd: number
  latestDayUsd: number
  runCount: number
  reconciliation: {
    sourceAvailable: boolean
    unavailableReason: string | null
    reachedScoringCount: number
    candidateNotScoredCount: number
    noCandidateCount: number
    noCandidateFailedCount: number
    noCandidateCompletedCount: number
  }
}

type AdminLabImprovementAnalysis = {
  eventKey: string
  sourceId: string
  status: 'pending_analysis' | 'analyzing' | 'pending_delivery' | 'delivered'
  occurredAt: string
  analyzedAt: string | null
  deliveredAt: string | null
  candidateId: string | null
  minerHotkey: string | null
  improvementPoints: number | null
  model: string | null
  reasoningEffort: string | null
  summary: string | null
  minerDirection: string | null
  directionImplementation: string | null
  directionAlignment: 'aligned' | 'partially_aligned' | 'not_aligned' | 'insufficient_evidence' | null
  directionAssessment: string | null
  improvementMade: string | null
  helpedIcps: Array<{
    icpRef: string
    icpLabel: string
    deltaVsBase: number | null
    whyItHelped: string
  }>
  genuineImprovement: 'genuine' | 'likely' | 'uncertain' | 'not_genuine' | null
  genuineAssessment: string | null
  caveats: string[]
  lastError: string | null
}

type AdminLabOpsSummary = {
  state: AdminHealthState
  healthSignals: AdminLabHealthSignal[]
  dataFreshness: AdminLabDataFreshness
  controls: AdminLabWorkflowControls
  scoring: AdminLabScoringSummary
  activeRuns: AdminLabActiveRun[]
  pipeline: AdminLabPipelineStage[]
  benchmark: AdminLabBenchmarkSummary
  alerts: AdminLabAlertSummary
  attestation: AdminLabAttestationSummary
  sourcingModel: AdminLabSourcingModelSummary
  leadpoetRepository: AdminLabRepositorySummary
  validatorDeployment: AdminLabValidatorDeploymentSummary
  computeSpend: AdminLabComputeSpendSummary
  dailyBenchmark: AdminLabDailyBenchmark
  benchmarkRuns: AdminLabBenchmarkRunSummary[]
  champions: AdminLabChampionSummary[]
  improvementAnalyses: AdminLabImprovementAnalysis[]
}

export type AdminResearchLabPayload = {
  loops: AdminLabLoopSummary[]
  loopPagination: AdminLabLoopPagination
  loopStatusOptions: ResearchLabStatusFilterOption[]
  ops: AdminLabOpsSummary
  stats: {
    totalLoops: number
    runningLoops: number
    scoredLoops: number
    failedLoops: number
    uniqueMiners: number
    modelImprovementLoops: number
  }
  fetchedAt: string
}

type AdminLabLoopPagination = {
  page: number
  pageSize: number
  total: number
  totalPages: number
  status: string
  query: string
}

type AdminLabLoopRefresh = Pick<
  AdminLabLoopSummary,
  | 'ticketId'
  | 'runId'
  | 'receiptId'
  | 'outcomeLabel'
  | 'outcomeBand'
  | 'publicStatus'
  | 'paymentState'
  | 'executionState'
  | 'candidateState'
  | 'resultState'
  | 'opsReason'
  | 'statusDetail'
  | 'opsWarnings'
  | 'statusKey'
  | 'statusLabel'
  | 'statusNote'
  | 'actionNote'
  | 'candidateCount'
  | 'scoredCandidateCount'
  | 'lastActivityAt'
>

type AdminResearchLabRefreshPayload = {
  recentLoops: AdminLabLoopSummary[]
  loopStates: AdminLabLoopRefresh[]
  loopPagination: AdminLabLoopPagination
  loopStatusOptions: ResearchLabStatusFilterOption[]
  ops: Omit<AdminLabOpsSummary, 'champions' | 'benchmarkRuns' | 'evaluatedAlerts'>
  stats: AdminResearchLabPayload['stats']
  fetchedAt: string
}

type LabTimelineEvent = {
  id: string
  phase: LabTimelinePhase
  stage: string
  status?: string
  enteredAt: string
  seq?: number
  source?: string
  summary?: string
  metadata?: Record<string, unknown>
  timestampKind?: LabTimelineTimestampKind
  lastActivityAt?: string
  runId?: string
  receiptId?: string
  durationSincePreviousMs?: number
}

type LabTimelineRun = {
  runId?: string
  receiptId?: string
  isCurrent?: boolean
  events: LabTimelineEvent[]
}

type LabTimeline = {
  ticketId: string
  currentRunId?: string
  runs: LabTimelineRun[]
  sourceNotes?: string[]
}

type LabTimelinePayload = {
  loop: AdminLabLoopSummary
  timeline: LabTimeline
  runDetail: AdminLabRunDetail
  fetchedAt: string
}

export function AdminResearchLab({
  payload,
  error,
}: {
  payload: AdminResearchLabPayload | null
  error: string | null
}) {
  const [livePayload, setLivePayload] = useState(payload)
  const [initialLoading, setInitialLoading] = useState(!payload)
  const [slowInitialLoading, setSlowInitialLoading] = useState(false)
  const [liveRefreshError, setLiveRefreshError] = useState<string | null>(null)
  const [liveRefreshing, setLiveRefreshing] = useState(false)
  const [loopPageLoading, setLoopPageLoading] = useState(false)
  const loops = useMemo(() => livePayload?.loops ?? [], [livePayload?.loops])
  const ops = livePayload?.ops ?? null
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [loopPage, setLoopPage] = useState(1)
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(loops[0]?.ticketId ?? null)
  const [selectedRunId, setSelectedRunId] = useState<string | null>(loops[0]?.runId ?? null)
  const [detailBySelection, setDetailBySelection] = useState<Record<string, LabTimelinePayload | null>>({})
  const [loadingSelectionKey, setLoadingSelectionKey] = useState<string | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)
  const runInspectorRef = useRef<HTMLElement | null>(null)
  const runDetailRef = useRef<HTMLDivElement | null>(null)
  const urlSelectionAppliedRef = useRef(false)

  const selectRunForInspection = (ticketId: string, runId?: string | null) => {
    const loop = loops.find((item) => item.ticketId === ticketId)
    const nextRunId = runId === undefined ? loop?.runId ?? null : runId
    setSelectedTicketId(ticketId)
    setSelectedRunId(nextRunId)
    writeRunSelectionUrl(ticketId, nextRunId)
    window.requestAnimationFrame(() => {
      const target = window.matchMedia('(max-width: 1279px)').matches
        ? runDetailRef.current
        : runInspectorRef.current
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  useEffect(() => setLivePayload(payload), [payload])

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedQuery(query.trim()), 250)
    return () => window.clearTimeout(timeout)
  }, [query])

  // Render the admin shell immediately. The large operational snapshot is
  // loaded client-side so a cold cache can no longer delay the first byte of
  // the page by several seconds.
  useEffect(() => {
    if (payload) {
      setInitialLoading(false)
      return
    }
    const controller = new AbortController()
    const loadInitial = async () => {
      setInitialLoading(true)
      try {
        const res = await fetch('/api/admin/research-lab', {
          cache: 'no-store',
          signal: controller.signal,
        })
        const body = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(body.error || `Initial Lab load failed with ${res.status}`)
        const responseKind = classifyAdminLabOverviewResponse(body)
        if (responseKind !== 'full') {
          console.error('[admin:research-lab] invalid initial overview response', {
            responseView: res.headers.get('X-Admin-Lab-View'),
            responseKind,
            keys: adminLabOverviewResponseKeys(body),
          })
          throw new Error('The server returned an incomplete Lab overview response')
        }
        setLivePayload(body as AdminResearchLabPayload)
        setLiveRefreshError(null)
      } catch (e) {
        if (!controller.signal.aborted) {
          setLiveRefreshError(e instanceof Error ? e.message : 'Initial Lab load failed')
        }
      } finally {
        if (!controller.signal.aborted) setInitialLoading(false)
      }
    }
    void loadInitial()
    return () => controller.abort()
  }, [payload])

  const isInitialOverviewLoading = initialLoading && !livePayload

  useEffect(() => {
    if (!isInitialOverviewLoading) {
      setSlowInitialLoading(false)
      return
    }
    const timer = window.setTimeout(() => setSlowInitialLoading(true), 5_000)
    return () => window.clearTimeout(timer)
  }, [isInitialOverviewLoading])

  useEffect(() => {
    if (urlSelectionAppliedRef.current || loops.length === 0) return
    urlSelectionAppliedRef.current = true
    const params = new URLSearchParams(window.location.search)
    const ticketId = params.get('ticketId')
    if (!ticketId) return
    const loop = loops.find((item) => item.ticketId === ticketId)
    if (!loop) return
    setSelectedTicketId(ticketId)
    setSelectedRunId(params.get('runId') || loop.runId)
  }, [loops])

  useEffect(() => {
    const restoreSelection = () => {
      const params = new URLSearchParams(window.location.search)
      const ticketId = params.get('ticketId')
      if (!ticketId) return
      const loop = loops.find((item) => item.ticketId === ticketId)
      if (!loop) return
      setSelectedTicketId(ticketId)
      setSelectedRunId(params.get('runId') || loop.runId)
    }
    window.addEventListener('popstate', restoreSelection)
    return () => window.removeEventListener('popstate', restoreSelection)
  }, [loops])

  useEffect(() => {
    let cancelled = false
    let inFlight = false
    let timeout: number | null = null
    let controller: AbortController | null = null
    const clearScheduled = () => {
      if (timeout !== null) window.clearTimeout(timeout)
      timeout = null
    }
    const schedule = () => {
      clearScheduled()
      if (!cancelled && !document.hidden) {
        timeout = window.setTimeout(() => void refresh(), ADMIN_OVERVIEW_REFRESH_MS)
      }
    }
    const refresh = async () => {
      if (cancelled || document.hidden || inFlight) return
      inFlight = true
      controller = new AbortController()
      setLiveRefreshing(true)
      try {
        const res = await fetch('/api/admin/research-lab?mode=refresh', {
          cache: 'no-store',
          signal: controller.signal,
        })
        const body = await res.json().catch(() => ({}))
        if (!res.ok) {
          throw new Error(adminLabRefreshErrorMessage(res.status, body.error))
        }
        const responseKind = classifyAdminLabOverviewResponse(body)
        if (responseKind === 'invalid') {
          console.error('[admin:research-lab] invalid overview refresh response', {
            responseView: res.headers.get('X-Admin-Lab-View'),
            keys: adminLabOverviewResponseKeys(body),
          })
          throw new Error('The server returned an incomplete Lab refresh response')
        }
        const fullOverview = responseKind === 'full'
          ? body as AdminResearchLabPayload
          : null
        const refreshPayload = fullOverview
          ? refreshPayloadFromAdminResearchLabOverview(fullOverview)
          : body as AdminResearchLabRefreshPayload
        if (!cancelled) {
          setLivePayload((current) => current
            ? mergeAdminResearchLabRefresh(current, refreshPayload)
            : fullOverview)
          setLiveRefreshError(null)
        }
      } catch (e) {
        if (!cancelled && !controller.signal.aborted) {
          setLiveRefreshError(e instanceof Error ? e.message : 'Live refresh failed')
        }
      } finally {
        inFlight = false
        controller = null
        if (!cancelled) setLiveRefreshing(false)
        schedule()
      }
    }
    const handleVisibility = () => {
      if (document.hidden) {
        clearScheduled()
        controller?.abort()
      } else {
        void refresh()
      }
    }
    schedule()
    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('online', handleVisibility)
    return () => {
      cancelled = true
      clearScheduled()
      controller?.abort()
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('online', handleVisibility)
    }
  }, [])

  useEffect(() => {
    if (selectedTicketId || loops.length === 0) return
    setSelectedTicketId(loops[0].ticketId)
    setSelectedRunId(loops[0].runId)
  }, [loops, selectedTicketId])

  const statusOptions = useMemo(
    () => livePayload?.loopStatusOptions ?? [{ value: 'all', label: 'All', count: 0 }],
    [livePayload?.loopStatusOptions],
  )
  const filteredLoops = loops
  const pagination = livePayload?.loopPagination ?? {
    page: 1,
    pageSize: 50,
    total: loops.length,
    totalPages: 1,
    status: 'all',
    query: '',
  }

  useEffect(() => {
    if (statusFilter === 'all') return
    if (statusOptions.some((option) => option.value === statusFilter)) return
    setStatusFilter('all')
  }, [statusFilter, statusOptions])

  useEffect(() => {
    if (filteredLoops.length === 0) return
    if (filteredLoops.some((loop) => loop.ticketId === selectedTicketId)) return
    setSelectedTicketId(filteredLoops[0].ticketId)
    setSelectedRunId(filteredLoops[0].runId)
  }, [filteredLoops, selectedTicketId])

  useEffect(() => {
    if (!livePayload) return
    const currentPage = livePayload.loopPagination
    if (
      currentPage.page === loopPage &&
      currentPage.status === statusFilter &&
      currentPage.query === debouncedQuery
    ) return

    const controller = new AbortController()
    const loadLoopPage = async () => {
      setLoopPageLoading(true)
      try {
        const params = new URLSearchParams({
          mode: 'loops',
          page: String(loopPage),
          status: statusFilter,
        })
        if (debouncedQuery) params.set('query', debouncedQuery)
        const res = await fetch(`/api/admin/research-lab?${params.toString()}`, {
          cache: 'no-store',
          signal: controller.signal,
        })
        const body = await res.json().catch(() => ({})) as {
          loops?: AdminLabLoopSummary[]
          loopPagination?: AdminLabLoopPagination
          loopStatusOptions?: ResearchLabStatusFilterOption[]
          error?: string
        }
        if (!res.ok) throw new Error(body.error || `Loop page failed with ${res.status}`)
        if (!body.loopPagination || !body.loopStatusOptions) {
          throw new Error('Loop page response was incomplete')
        }
        setLivePayload((current) => current ? {
          ...current,
          loops: body.loops ?? [],
          loopPagination: body.loopPagination!,
          loopStatusOptions: body.loopStatusOptions!,
        } : current)
        setLoopPage(body.loopPagination.page)
        setLiveRefreshError(null)
      } catch (e) {
        if (!controller.signal.aborted) {
          setLiveRefreshError(e instanceof Error ? e.message : 'Could not load the ticket page')
        }
      } finally {
        if (!controller.signal.aborted) setLoopPageLoading(false)
      }
    }
    void loadLoopPage()
    return () => controller.abort()
  }, [debouncedQuery, livePayload, loopPage, statusFilter])

  const selectedLoop =
    loops.find((loop) => loop.ticketId === selectedTicketId) ??
    filteredLoops[0] ??
    loops[0] ??
    null
  const selectedKey = selectedLoop ? runSelectionKey(selectedLoop.ticketId, selectedRunId) : null
  const selectedTimeline = selectedKey ? detailBySelection[selectedKey] ?? null : null
  const loadingSelected = Boolean(selectedKey && loadingSelectionKey === selectedKey)
  const eventCount = selectedTimeline?.timeline.runs.reduce((sum, run) => sum + run.events.length, 0) ?? 0
  const selectHistoricalRun = (runId: string) => {
    if (!selectedLoop) return
    setSelectedRunId(runId)
    writeRunSelectionUrl(selectedLoop.ticketId, runId)
  }

  useEffect(() => {
    if (!selectedLoop) return
    const ticketId = selectedLoop.ticketId
    const selectionKey = runSelectionKey(ticketId, selectedRunId)
    let cancelled = false
    let inFlight = false
    let timeout: number | null = null
    let controller: AbortController | null = null
    let terminal = ['completed', 'failed'].includes(
      detailBySelection[selectionKey]?.runDetail.state ?? '',
    )
    const clearScheduled = () => {
      if (timeout !== null) window.clearTimeout(timeout)
      timeout = null
    }
    const schedule = () => {
      clearScheduled()
      if (cancelled || document.hidden) return
      timeout = window.setTimeout(
        () => void load(true),
        terminal ? ADMIN_TERMINAL_RUN_REFRESH_MS : ADMIN_ACTIVE_RUN_REFRESH_MS,
      )
    }
    const load = async (silent: boolean) => {
      if (cancelled || document.hidden || inFlight) return
      inFlight = true
      controller = new AbortController()
      if (!silent) setLoadingSelectionKey(selectionKey)
      setDetailError(null)
      try {
        const params = new URLSearchParams({ ticketId })
        if (selectedRunId) params.set('runId', selectedRunId)
        const res = await fetch(`/api/admin/research-lab?${params.toString()}`, {
          cache: 'no-store',
          signal: controller.signal,
        })
        const body = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(body.error || `Timeline request failed with ${res.status}`)
        if (!cancelled) {
          const payload = body as LabTimelinePayload
          terminal = payload.runDetail.state === 'completed' || payload.runDetail.state === 'failed'
          setDetailBySelection((prev) => ({ ...prev, [selectionKey]: payload }))
        }
      } catch (e) {
        if (cancelled || controller.signal.aborted) return
        setDetailError(e instanceof Error ? e.message : 'Could not load Lab timeline')
      } finally {
        inFlight = false
        controller = null
        if (!cancelled) setLoadingSelectionKey(null)
        schedule()
      }
    }
    void load(Object.prototype.hasOwnProperty.call(detailBySelection, selectionKey))
    const handleVisibility = () => {
      if (document.hidden) {
        clearScheduled()
        controller?.abort()
      } else {
        void load(true)
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('online', handleVisibility)

    return () => {
      cancelled = true
      clearScheduled()
      controller?.abort()
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('online', handleVisibility)
    }
    // The selected ticket is the polling scope. Cached payload state is
    // intentionally excluded so a successful refresh does not restart polling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLoop?.ticketId, selectedRunId])

  return (
    <div className="space-y-6" aria-busy={isInitialOverviewLoading}>
      <section>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1
              className="text-2xl font-medium tracking-tight"
              style={{ color: 'var(--text-primary)' }}
            >
              Lab Activity
            </h1>
            <p
              className="mt-1 max-w-2xl text-sm"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Internal Research Lab execution stream with every ticket, queue, auto-research, candidate, scoring, promotion, and public projection event.
            </p>
          </div>
          {isInitialOverviewLoading ? (
            <div
              role="status"
              aria-live="polite"
              className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-[11px]"
              style={{
                borderColor: 'var(--surface-border)',
                background: 'var(--surface)',
                color: 'var(--text-tertiary)',
              }}
            >
              <span className="dot-gold live-pulse h-1.5 w-1.5 rounded-full motion-reduce:animate-none" />
              {slowInitialLoading
                ? 'Still loading—this can take a moment.'
                : 'Loading latest Lab snapshot...'}
            </div>
          ) : livePayload?.fetchedAt ? (
            <div
              className="rounded-lg border px-3 py-2 text-[11px]"
              style={{
                borderColor: 'var(--surface-border)',
                background: 'var(--surface)',
                color: 'var(--text-tertiary)',
              }}
            >
              <span className="inline-flex items-center gap-2">
                <span className={cn('h-1.5 w-1.5 rounded-full', liveRefreshError ? 'bg-[var(--accent-negative)]' : 'bg-[var(--accent-positive)]', liveRefreshing ? 'live-pulse' : '')} />
                {liveRefreshError ? 'Live refresh degraded' : 'Live · 30s overview · 15s active run'} · {formatDateTime(livePayload.fetchedAt)}
              </span>
            </div>
          ) : null}
        </div>
      </section>

      {error ? (
        <div role="alert" className="rounded-xl border border-red-500/40 bg-red-500/[0.06] p-4 text-sm text-red-300/90">
          {error}
        </div>
      ) : null}
      {liveRefreshError ? (
        <div role="alert" className="rounded-xl border border-red-500/40 bg-red-500/[0.06] px-4 py-3 text-xs text-red-300/90">
          {livePayload ? 'Live refresh error' : 'Initial load error'}: {liveRefreshError}.
          {livePayload ? ' Showing the most recent successful snapshot.' : ''}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Stat label="All-time loops" value={livePayload?.stats.totalLoops} loading={isInitialOverviewLoading} />
        <Stat label="Running" value={livePayload?.stats.runningLoops} loading={isInitialOverviewLoading} />
        <Stat label="Scored" value={livePayload?.stats.scoredLoops} accent="gold" loading={isInitialOverviewLoading} />
        <Stat label="Failed" value={livePayload?.stats.failedLoops} loading={isInitialOverviewLoading} />
        <Stat label="Miners" value={livePayload?.stats.uniqueMiners} loading={isInitialOverviewLoading} />
        <Stat label="Model improvements" value={livePayload?.stats.modelImprovementLoops} accent="gold" loading={isInitialOverviewLoading} />
      </div>

      {ops ? (
        <>
          <OpsHealthStrip ops={ops} />

          <AdminMetagraph />

          <DailyBenchmarkTelemetry
            benchmark={ops.dailyBenchmark}
            benchmarkRuns={ops.benchmarkRuns}
            champions={ops.champions}
          />

          <ImprovementAnalysesPanel analyses={ops.improvementAnalyses} />

          <ComputeSpendPanel spend={ops.computeSpend} />

          <section className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.7fr)]">
            <ScoringPanel scoring={ops.scoring} />
            <PipelinePanel stages={ops.pipeline} />
          </section>

          <ActiveRunsPanel
            runs={ops.activeRuns}
            selectedTicketId={selectedLoop?.ticketId ?? null}
            selectedRunId={selectedRunId}
            onSelect={selectRunForInspection}
          />

          <section className="grid gap-4 xl:grid-cols-3">
            <BenchmarkPanel benchmark={ops.benchmark} />
            <AlertsPanel alerts={ops.alerts} observedNodes={ops.attestation.nodes} />
            <AttestationPanel attestation={ops.attestation} />
          </section>
        </>
      ) : null}

      <section
        ref={runInspectorRef}
        id="run-inspector"
        className="grid min-h-[640px] w-full min-w-0 scroll-mt-24 gap-4 xl:grid-cols-[420px_minmax(0,1fr)]"
      >
        <div className="min-w-0 space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative min-w-0 flex-1">
              <Search
                className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2"
                style={{ color: 'var(--text-tertiary)' }}
              />
              <input
                type="text"
                value={query}
                disabled={isInitialOverviewLoading}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setLoopPage(1)
                }}
                placeholder="Search ticket, run, hotkey, topic..."
                className="premium-focus w-full rounded-lg border px-9 py-2 text-sm placeholder:text-white/30 bg-transparent disabled:cursor-wait disabled:opacity-45"
                style={{
                  borderColor: 'var(--surface-border)',
                  background: 'var(--surface)',
                  color: 'var(--text-primary)',
                }}
              />
            </div>

            <Select
              value={statusFilter}
              disabled={isInitialOverviewLoading}
              onValueChange={(value) => {
                setStatusFilter(value)
                setLoopPage(1)
              }}
            >
              <SelectTrigger
                className="h-10 w-full border-[var(--surface-border)] bg-[var(--surface)] font-mono text-xs text-[var(--text-secondary)] shadow-none sm:w-[210px]"
                aria-label="Filter Lab loops by status"
              >
                {isInitialOverviewLoading ? (
                  <Skeleton className="h-3 w-20 bg-white/[0.06] motion-reduce:animate-none" />
                ) : (
                  <SelectValue placeholder="All statuses" />
                )}
              </SelectTrigger>
              <SelectContent className="border-[var(--surface-border)] bg-[var(--surface-base)] text-[var(--text-primary)]">
                {statusOptions.map((option) => (
                  <SelectItem
                    key={option.value}
                    value={option.value}
                    className="font-mono text-xs text-[var(--text-secondary)] focus:bg-white/[0.06] focus:text-[var(--text-primary)]"
                  >
                    {option.label} ({option.count ?? 0})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div
            className="max-h-[740px] overflow-auto rounded-xl border"
            style={{
              borderColor: 'var(--surface-border)',
              background: 'var(--surface-base)',
            }}
          >
            {isInitialOverviewLoading ? (
              <LoopListSkeleton />
            ) : !livePayload ? (
              <div className="p-8 text-center text-sm" style={{ color: 'var(--text-secondary)' }}>
                Lab overview unavailable. Refresh to try again.
              </div>
            ) : filteredLoops.length === 0 ? (
              <div className="p-8 text-center text-sm" style={{ color: 'var(--text-secondary)' }}>
                No Lab loops match the current filters.
              </div>
            ) : (
              <div className="space-y-px p-1">
                {filteredLoops.map((loop) => (
                  <LoopButton
                    key={loop.cardId}
                    loop={loop}
                    active={selectedLoop?.ticketId === loop.ticketId}
                    onSelect={() => selectRunForInspection(loop.ticketId)}
                  />
                ))}
              </div>
            )}
          </div>
          {livePayload ? (
            <div
              className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-xs"
              style={{ borderColor: 'var(--surface-border)', color: 'var(--text-secondary)' }}
            >
              <span className="min-w-0 truncate font-mono">
                {pagination.total === 0
                  ? '0 tickets'
                  : `${(pagination.page - 1) * pagination.pageSize + 1}–${Math.min(
                    pagination.page * pagination.pageSize,
                    pagination.total,
                  )} of ${pagination.total}`}
              </span>
              <div className="flex shrink-0 items-center gap-2">
                {loopPageLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                <button
                  type="button"
                  onClick={() => setLoopPage((page) => Math.max(1, page - 1))}
                  disabled={loopPageLoading || pagination.page <= 1}
                  className="premium-focus rounded-md border p-1.5 disabled:opacity-35"
                  style={{ borderColor: 'var(--surface-border)' }}
                  aria-label="Previous ticket page"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                <span className="min-w-[74px] text-center font-mono">
                  Page {pagination.page} of {pagination.totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setLoopPage((page) => Math.min(pagination.totalPages, page + 1))}
                  disabled={loopPageLoading || pagination.page >= pagination.totalPages}
                  className="premium-focus rounded-md border p-1.5 disabled:opacity-35"
                  style={{ borderColor: 'var(--surface-border)' }}
                  aria-label="Next ticket page"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ) : null}
        </div>

        <div
          ref={runDetailRef}
          className="min-w-0 rounded-xl border"
          style={{
            borderColor: 'var(--surface-border)',
            background: 'var(--surface)',
          }}
        >
          {isInitialOverviewLoading ? (
            <RunInspectorSkeleton />
          ) : !selectedLoop ? (
            <div className="p-12 text-center text-sm" style={{ color: 'var(--text-secondary)' }}>
              {livePayload
                ? 'Select a Lab loop to inspect its run logs.'
                : 'Run details are unavailable until the Lab overview loads.'}
            </div>
          ) : (
            <div className="min-w-0">
              <div
                className="border-b p-5"
                style={{ borderColor: 'var(--surface-border)' }}
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusPill label={selectedLoop.outcomeLabel} band={selectedLoop.outcomeBand} />
                      <span className="font-mono text-xs" style={{ color: 'var(--text-tertiary)' }}>
                        Ticket {shortId(selectedLoop.ticketId)}
                      </span>
                      {selectedLoop.runId ? (
                        <span className="font-mono text-xs" style={{ color: 'var(--text-tertiary)' }}>
                          Run {shortId(selectedLoop.runId)}
                        </span>
                      ) : null}
                    </div>
                    <h2
                      className="mt-3 break-words text-lg font-medium leading-snug [overflow-wrap:anywhere]"
                      style={{ color: 'var(--text-primary)' }}
                    >
                      {selectedLoop.researchFocusSummary || 'No focus summary published'}
                    </h2>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {(selectedLoop.topicTags.length ? selectedLoop.topicTags : [selectedLoop.researchArea]).slice(0, 6).map((tag) => (
                        <Tag key={tag}>{readableTag(tag)}</Tag>
                      ))}
                    </div>
                  </div>
                  <div className="grid w-full min-w-0 grid-cols-2 gap-2 lg:w-auto lg:min-w-[280px]">
                    <Meta label="Miner" value={shortHotkey(selectedLoop.minerHotkey)} title={selectedLoop.minerHotkey} />
                    <Meta label="Events" value={loadingSelected ? 'Loading' : String(eventCount)} />
                    <Meta label="Submitted" value={formatDateTime(selectedLoop.submittedAt)} />
                    <Meta label="Last activity" value={formatDateTime(selectedLoop.lastActivityAt)} />
                  </div>
                </div>
              </div>

              <div className="max-h-[1000px] overflow-auto p-5">
                {loadingSelected && !selectedTimeline ? (
                  <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
                    <Loader2 className="h-5 w-5 animate-spin text-gold" />
                    Loading detailed run activity...
                  </div>
                ) : detailError && !selectedTimeline ? (
                  <div className="rounded-lg border border-burgundy-soft bg-burgundy-soft p-5 text-sm text-burgundy">
                    {detailError}
                  </div>
                ) : !selectedTimeline ? (
                  <div className="rounded-lg border p-8 text-center text-sm" style={{ borderColor: 'var(--surface-border)', color: 'var(--text-secondary)' }}>
                    No detailed events are available for this loop.
                  </div>
                ) : (
                  <>
                    {detailError ? (
                      <div className="mb-4 rounded-lg border border-burgundy-soft bg-burgundy-soft px-4 py-3 text-xs text-burgundy">
                        Live run refresh error: {detailError}. Showing the most recent successful detail.
                      </div>
                    ) : null}
                    <RunSelector
                      runs={selectedTimeline.timeline.runs}
                      selectedRunId={selectedTimeline.runDetail.runId}
                      onSelect={selectHistoricalRun}
                    />
                    <RunTelemetry detail={selectedTimeline.runDetail} />
                    {eventCount > 0 ? (
                      <TimelineView
                        timeline={selectedTimeline.timeline}
                        selectedRunId={selectedTimeline.runDetail.runId}
                        onSelectRun={selectHistoricalRun}
                      />
                    ) : (
                      <div className="rounded-lg border p-8 text-center text-sm" style={{ borderColor: 'var(--surface-border)', color: 'var(--text-secondary)' }}>
                        No ticket or run events have been emitted yet.
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

function OpsHealthStrip({ ops }: { ops: AdminLabOpsSummary }) {
  return (
    <section
      className="rounded-xl border"
      style={{
        borderColor: 'var(--surface-border)',
        background: 'var(--surface)',
      }}
    >
      <div
        className="flex flex-col gap-3 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
        style={{ borderColor: 'var(--surface-border)' }}
      >
        <div className="flex items-center gap-2">
          <Activity className={cn('h-4 w-4', stateTextClass(ops.state))} />
          <div>
            <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
              Lab Ops
            </div>
            <div suppressHydrationWarning className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
              {ops.dataFreshness.latestActivityAt
                ? `Latest activity ${formatRelative(ops.dataFreshness.latestActivityAt)}`
                : 'No Lab activity returned'}
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <SourcingModelPopover model={ops.sourcingModel} />
            <LeadpoetRepositoryPopover repository={ops.leadpoetRepository} />
            <ValidatorRepositoryPopover
              deployment={ops.validatorDeployment}
              repository={ops.leadpoetRepository}
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <WorkflowControlPill label="Scoring" control={ops.controls.scoring} />
          <WorkflowControlPill label="Loops" control={ops.controls.loops} />
          <StatePill state={ops.state} label={stateLabel(ops.state)} />
        </div>
      </div>
      <div className="grid gap-px p-1 sm:grid-cols-2 lg:grid-cols-5">
        {ops.healthSignals.map((signal) => (
          <HealthSignalCard key={signal.id} signal={signal} />
        ))}
      </div>
    </section>
  )
}

function WorkflowControlPill({
  label,
  control,
}: {
  label: 'Scoring' | 'Loops'
  control: AdminLabWorkflowControlSummary
}) {
  const detail = [
    `${label} ${control.label.toLowerCase()}`,
    control.reason ? readableTag(control.reason) : null,
    control.updatedAt ? `Updated ${formatRelative(control.updatedAt)}` : null,
  ].filter(Boolean).join(' · ')

  return (
    <span title={detail}>
      <StatePill
        state={control.state === 'active' ? 'healthy' : control.state === 'paused' ? 'degraded' : 'unknown'}
        label={`${label} ${control.label}`}
      />
    </span>
  )
}

function useHoverPopover() {
  const [open, setOpenState] = useState(false)
  const [pinned, setPinned] = useState(false)

  const openPreview = () => {
    if (!pinned) setOpenState(true)
  }
  const closePreview = () => {
    if (!pinned) setOpenState(false)
  }
  const setOpen = (nextOpen: boolean) => {
    setOpenState(nextOpen)
    if (!nextOpen) setPinned(false)
  }
  const togglePinned = () => {
    setPinned((current) => {
      const nextPinned = !current
      setOpenState(nextPinned)
      return nextPinned
    })
  }

  return { open, setOpen, openPreview, closePreview, togglePinned }
}

function SourcingModelPopover({ model }: { model: AdminLabSourcingModelSummary }) {
  const hoverPopover = useHoverPopover()
  const active = model.status?.toLowerCase() === 'active'
  const inLine = active && model.commitFreshness === 'latest'
  const outOfLine = model.sourceAvailable && (
    !active || model.commitFreshness === 'behind'
  )
  const alignmentTone = sourcingModelAlignmentTone(inLine, outOfLine)
  const freshnessState: AdminHealthState = inLine
    ? 'healthy'
    : outOfLine
      ? 'degraded'
      : 'unknown'
  const freshnessLabel = inLine ? 'In line' : outOfLine ? 'Out of line' : 'Unknown'
  const comparisonBranch = model.comparisonBranch ?? model.branch ?? 'repository'
  const comparisonCopy = model.commitFreshness === 'latest'
    ? `Matches the latest known ${comparisonBranch} commit`
    : model.commitFreshness === 'behind'
      ? `Behind latest known ${comparisonBranch} commit${model.latestKnownCommitSha ? ` ${compactHash(model.latestKnownCommitSha)}` : ''}`
      : 'Latest-commit comparison is unavailable'
  const triggerLabel = model.gitCommitSha
    ? `Active sourcing model commit ${model.gitCommitSha} · ${freshnessLabel}`
    : 'View active sourcing model image details'
  const activeCommitUrl = githubCommitUrl(model.repositoryUrl, model.gitCommitSha)

  return (
    <Popover open={hoverPopover.open} onOpenChange={hoverPopover.setOpen}>
      <PopoverAnchor asChild>
        <button
          type="button"
          aria-label={triggerLabel}
          aria-expanded={hoverPopover.open}
          aria-haspopup="dialog"
          title={triggerLabel}
          onMouseEnter={hoverPopover.openPreview}
          onMouseLeave={hoverPopover.closePreview}
          onFocus={hoverPopover.openPreview}
          onBlur={hoverPopover.closePreview}
          onClick={hoverPopover.togglePinned}
          className="premium-focus inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border transition-colors hover-bg-warm"
          style={{
            borderColor: alignmentTone.borderColor,
            background: alignmentTone.background,
            color: alignmentTone.color,
          }}
        >
          <Container className="h-3.5 w-3.5" aria-hidden />
        </button>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        sideOffset={8}
        onOpenAutoFocus={(event) => event.preventDefault()}
        className="w-[min(calc(100vw-2rem),30rem)] rounded-xl p-0 shadow-2xl shadow-black/50"
        style={{
          borderColor: 'var(--surface-border)',
          background: 'var(--surface-base)',
          color: 'var(--text-primary)',
        }}
      >
        <div className="flex items-start justify-between gap-4 border-b px-4 py-3" style={{ borderColor: 'var(--surface-border)' }}>
          <div className="flex min-w-0 items-start gap-2.5">
            <div
              className="mt-0.5 rounded-md border p-1.5"
              style={{ borderColor: alignmentTone.borderColor, background: alignmentTone.background }}
            >
              <GitCommitHorizontal className="h-3.5 w-3.5" style={{ color: alignmentTone.color }} aria-hidden />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-medium">Sourcing model image</div>
              <div className="mt-0.5 text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                Commit mapped to the currently active ECR image
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <StatePill
              state={!model.sourceAvailable ? 'unknown' : active ? 'healthy' : 'degraded'}
              label={!model.sourceAvailable ? 'Unavailable' : model.status ?? 'Not reported'}
            />
            <SourcingModelAlignmentPill label={freshnessLabel} tone={alignmentTone} />
          </div>
        </div>

        <div className="space-y-3 p-4">
          <div
            className="rounded-lg border px-3 py-2.5"
            style={{ borderColor: alignmentTone.borderColor, background: alignmentTone.background }}
          >
            <div className="text-[10px] uppercase tracking-[0.12em]" style={{ color: 'var(--text-tertiary)' }}>
              Active commit
            </div>
            {model.gitCommitSha && activeCommitUrl ? (
              <a
                href={activeCommitUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="premium-focus mt-1.5 block rounded-sm break-all font-mono text-xs leading-relaxed underline-offset-4 hover:underline"
                style={{ color: alignmentTone.color }}
                title="Open commit in a new tab"
              >
                {model.gitCommitSha}
              </a>
            ) : (
              <code className="mt-1.5 block text-xs leading-relaxed" style={{ color: alignmentTone.color }}>
                Not reported
              </code>
            )}
            <div className="mt-2 flex items-center gap-2 text-[10px]" style={{ color: alignmentTone.color }}>
              <span
                className={cn('h-1.5 w-1.5 shrink-0 rounded-full', stateDotClass(freshnessState))}
                style={{ background: alignmentTone.color }}
                aria-hidden
              />
              <span>{comparisonCopy}</span>
            </div>
          </div>

          {!model.sourceAvailable ? (
            <div className="rounded-lg border border-burgundy-soft bg-burgundy-soft px-3 py-2 text-[11px] leading-relaxed text-burgundy">
              Sourcing-model telemetry is unavailable{model.unavailableReason ? `: ${model.unavailableReason}` : '.'}
            </div>
          ) : null}

          {model.sourceAvailable && !model.commitComparisonAvailable ? (
            <div
              className="rounded-lg border px-3 py-2 text-[11px] leading-relaxed"
              style={{ borderColor: 'var(--surface-border)', background: 'var(--surface)', color: 'var(--text-secondary)' }}
            >
              Latest-commit comparison is incomplete{model.commitComparisonReason ? `: ${model.commitComparisonReason}` : '.'}
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-2">
            <SourcingModelDetail
              label="Latest known commit"
              value={model.latestKnownCommitSha}
              href={githubCommitUrl(model.repositoryUrl, model.latestKnownCommitSha)}
              compact
            />
            <SourcingModelDetail
              label="Latest observed"
              value={model.latestKnownCommitAt ? formatDateTime(model.latestKnownCommitAt) : null}
            />
            <SourcingModelDetail
              label="Comparison source"
              value={model.latestKnownCommitSource ? readableTag(model.latestKnownCommitSource) : null}
            />
            <SourcingModelDetail
              label="Checked"
              value={model.comparisonCheckedAt ? formatDateTime(model.comparisonCheckedAt) : null}
            />
            <SourcingModelDetail label="Image ref" value={model.imageRefHash} compact />
            <SourcingModelDetail label="Build" value={model.buildId} />
            <SourcingModelDetail label="Branch" value={model.branch} />
            <SourcingModelDetail
              label="Activated"
              value={model.activatedAt ? formatDateTime(model.activatedAt) : null}
            />
            <SourcingModelDetail label="Version" value={model.versionId} compact />
            <SourcingModelDetail label="Model artifact" value={model.modelArtifactHash} compact />
            <SourcingModelDetail label="Manifest" value={model.manifestHash} compact />
            <SourcingModelDetail label="Component registry" value={model.componentRegistryVersion} />
            <SourcingModelDetail label="Scoring adapter" value={model.scoringAdapterVersion} />
            <SourcingModelDetail label="Reported by" value={model.actorRef} />
            <SourcingModelDetail label="Provenance" value={model.source ? readableTag(model.source) : null} />
            <SourcingModelDetail label="Current pointer" value={model.currentPointerUri} compact />
          </div>
          <p className="text-[10px] leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>
            Freshness compares the active image SHA with the newest {comparisonBranch} commit reported by model-version sync and successful private-repo push telemetry.
          </p>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function LeadpoetRepositoryPopover({
  repository,
}: {
  repository: AdminLabRepositorySummary
}) {
  const hoverPopover = useHoverPopover()
  const isLatest = repository.commitFreshness === 'latest'
  const isBehind = repository.commitFreshness === 'behind'
  const isAhead = repository.commitFreshness === 'ahead'
  const isDiverged = repository.commitFreshness === 'diverged'
  const isOutOfLine = isBehind || isAhead || isDiverged
  const tone = sourcingModelAlignmentTone(isLatest, isOutOfLine)
  const gatewayCommitUrl = githubCommitUrl(repository.repositoryUrl, repository.gatewayCommitSha)
  const latestCommitUrl = githubCommitUrl(repository.repositoryUrl, repository.commitSha)
  const state: AdminHealthState = isLatest ? 'healthy' : isOutOfLine ? 'degraded' : 'unknown'
  const commitsBehindCopy = repository.commitsBehind === null
    ? null
    : `${repository.commitsBehind} ${repository.commitsBehind === 1 ? 'commit' : 'commits'} behind`
  const stateLabel = isLatest
    ? 'Current'
    : isBehind
      ? commitsBehindCopy ?? 'Behind'
      : isAhead
        ? 'Ahead'
        : isDiverged
          ? 'Diverged'
      : repository.gatewaySourceAvailable
        ? 'Unknown'
        : 'Unavailable'
  const comparisonCopy = isLatest
    ? `Gateway is on the latest ${repository.branch} commit`
    : isBehind
      ? `Gateway is ${commitsBehindCopy ?? 'behind'} latest ${repository.branch} commit${repository.commitSha ? ` ${compactHash(repository.commitSha)}` : ''}`
      : isAhead
        ? `Gateway commit is ahead of current ${repository.branch} commit${repository.commitSha ? ` ${compactHash(repository.commitSha)}` : ''}`
        : isDiverged
          ? `Gateway commit has diverged from current ${repository.branch} commit${repository.commitSha ? ` ${compactHash(repository.commitSha)}` : ''}`
      : !repository.gatewaySourceAvailable
        ? 'Gateway commit is unavailable'
        : 'Latest-commit comparison is unavailable'
  const triggerLabel = repository.gatewayCommitSha
    ? `LeadPoet gateway commit ${repository.gatewayCommitSha} · ${stateLabel}`
    : 'View LeadPoet gateway commit details'

  return (
    <Popover open={hoverPopover.open} onOpenChange={hoverPopover.setOpen}>
      <PopoverAnchor asChild>
        <button
          type="button"
          aria-label={triggerLabel}
          aria-expanded={hoverPopover.open}
          aria-haspopup="dialog"
          title={triggerLabel}
          onMouseEnter={hoverPopover.openPreview}
          onMouseLeave={hoverPopover.closePreview}
          onFocus={hoverPopover.openPreview}
          onBlur={hoverPopover.closePreview}
          onClick={hoverPopover.togglePinned}
          className="premium-focus inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border transition-colors hover-bg-warm"
          style={{
            borderColor: tone.borderColor,
            background: tone.background,
            color: tone.color,
          }}
        >
          <Github className="h-3.5 w-3.5" aria-hidden />
        </button>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        sideOffset={8}
        onOpenAutoFocus={(event) => event.preventDefault()}
        className="w-[min(calc(100vw-2rem),30rem)] rounded-xl p-0 shadow-2xl shadow-black/50"
        style={{
          borderColor: 'var(--surface-border)',
          background: 'var(--surface-base)',
          color: 'var(--text-primary)',
        }}
      >
        <div className="flex items-start justify-between gap-4 border-b px-4 py-3" style={{ borderColor: 'var(--surface-border)' }}>
          <div className="flex min-w-0 items-start gap-2.5">
            <div
              className="mt-0.5 rounded-md border p-1.5"
              style={{ borderColor: tone.borderColor, background: tone.background }}
            >
              <Github className="h-3.5 w-3.5" style={{ color: tone.color }} aria-hidden />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-medium">LeadPoet gateway</div>
              <div className="mt-0.5 text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                Deployed commit vs latest {repository.owner}/{repository.name}
              </div>
            </div>
          </div>
          <StatePill state={state} label={stateLabel} />
        </div>

        <div className="space-y-3 p-4">
          <div
            className="rounded-lg border px-3 py-2.5"
            style={{ borderColor: tone.borderColor, background: tone.background }}
          >
            <div className="text-[10px] uppercase tracking-[0.12em]" style={{ color: 'var(--text-tertiary)' }}>
              Gateway commit
            </div>
            {repository.gatewayCommitSha && gatewayCommitUrl ? (
              <a
                href={gatewayCommitUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="premium-focus mt-1.5 block rounded-sm break-all font-mono text-xs leading-relaxed underline-offset-4 hover:underline"
                style={{ color: tone.color }}
                title="Open commit in a new tab"
              >
                {repository.gatewayCommitSha}
              </a>
            ) : (
              <code className="mt-1.5 block text-xs leading-relaxed" style={{ color: tone.color }}>
                Not reported
              </code>
            )}
            <div className="mt-2 flex items-center gap-2 text-[10px]" style={{ color: tone.color }}>
              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: tone.color }} aria-hidden />
              <span>{comparisonCopy}</span>
            </div>
          </div>

          {!repository.gatewaySourceAvailable || !repository.sourceAvailable ? (
            <div
              className="rounded-lg border px-3 py-2 text-[11px] leading-relaxed"
              style={{ borderColor: 'var(--surface-border)', background: 'var(--surface)', color: 'var(--text-secondary)' }}
            >
              {!repository.gatewaySourceAvailable
                ? `Gateway deployment telemetry is unavailable${repository.gatewayUnavailableReason ? `: ${repository.gatewayUnavailableReason}` : '.'}`
                : `LeadPoet repository telemetry is unavailable${repository.unavailableReason ? `: ${repository.unavailableReason}` : '.'}`}
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-2">
            <SourcingModelDetail
              label="Gateway commit"
              value={repository.gatewayCommitSha}
              href={gatewayCommitUrl}
              compact
            />
            <SourcingModelDetail
              label={`Latest ${repository.branch}`}
              value={repository.commitSha}
              href={latestCommitUrl}
              compact
            />
            <SourcingModelDetail label="Gateway branch" value={repository.gatewayBranch ?? repository.branch} />
            <SourcingModelDetail
              label="Gateway built"
              value={repository.gatewayBuiltAt ? formatDateTime(repository.gatewayBuiltAt) : null}
            />
            <SourcingModelDetail
              label={`Latest ${repository.branch} committed`}
              value={repository.committedAt ? formatDateTime(repository.committedAt) : null}
            />
            <SourcingModelDetail label={`Latest ${repository.branch} author`} value={repository.authorLogin} />
            <SourcingModelDetail label="Repository" value={`${repository.owner}/${repository.name}`} />
            <SourcingModelDetail
              label="Checked"
              value={formatDateTime(repository.gatewayCheckedAt ?? repository.checkedAt)}
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function ValidatorRepositoryPopover({
  deployment,
  repository,
}: {
  deployment: AdminLabValidatorDeploymentSummary
  repository: AdminLabRepositorySummary
}) {
  const hoverPopover = useHoverPopover()
  const isMixed = deployment.distinctCommitCount > 1
  const isLatest = !isMixed && deployment.commitFreshness === 'latest'
  const isBehind = !isMixed && deployment.commitFreshness === 'behind'
  const isAhead = !isMixed && deployment.commitFreshness === 'ahead'
  const isDiverged = !isMixed && deployment.commitFreshness === 'diverged'
  const isOutOfLine = isMixed || isBehind || isAhead || isDiverged
  const tone = sourcingModelAlignmentTone(isLatest, isOutOfLine)
  const validatorCommitUrl = githubCommitUrl(repository.repositoryUrl, deployment.commitSha)
  const latestCommitUrl = githubCommitUrl(repository.repositoryUrl, repository.commitSha)
  const state: AdminHealthState = isLatest ? 'healthy' : isOutOfLine ? 'degraded' : 'unknown'
  const commitsBehindCopy = deployment.commitsBehind === null
    ? null
    : `${deployment.commitsBehind} ${deployment.commitsBehind === 1 ? 'commit' : 'commits'} behind`
  const stateLabel = isMixed
    ? 'Mixed'
    : isLatest
      ? 'Current'
      : isBehind
        ? commitsBehindCopy ?? 'Behind'
        : isAhead
          ? 'Ahead'
          : isDiverged
            ? 'Diverged'
            : deployment.sourceAvailable
              ? 'Unknown'
              : 'Unavailable'
  const comparisonCopy = isMixed
    ? `${deployment.reportingNodeCount} reporting validators are split across ${deployment.distinctCommitCount} commits`
    : isLatest
      ? deployment.reportingNodeCount > 1
        ? `All ${deployment.reportingNodeCount} reporting validators are on the latest ${repository.branch} commit`
        : `Validator is on the latest ${repository.branch} commit`
      : isBehind
        ? `Validator is ${commitsBehindCopy ?? 'behind'} latest ${repository.branch} commit${repository.commitSha ? ` ${compactHash(repository.commitSha)}` : ''}`
        : isAhead
          ? `Validator commit is ahead of current ${repository.branch} commit${repository.commitSha ? ` ${compactHash(repository.commitSha)}` : ''}`
          : isDiverged
            ? `Validator commit has diverged from current ${repository.branch} commit${repository.commitSha ? ` ${compactHash(repository.commitSha)}` : ''}`
            : !deployment.sourceAvailable
              ? 'Validator commit is unavailable'
              : 'Latest-commit comparison is unavailable'
  const triggerLabel = deployment.commitSha
    ? `LeadPoet validator commit ${deployment.commitSha} · ${stateLabel}`
    : 'View LeadPoet validator commit details'
  const reportingNode = deployment.hotkey ?? deployment.nodeId

  return (
    <Popover open={hoverPopover.open} onOpenChange={hoverPopover.setOpen}>
      <PopoverAnchor asChild>
        <button
          type="button"
          aria-label={triggerLabel}
          aria-expanded={hoverPopover.open}
          aria-haspopup="dialog"
          title={triggerLabel}
          onMouseEnter={hoverPopover.openPreview}
          onMouseLeave={hoverPopover.closePreview}
          onFocus={hoverPopover.openPreview}
          onBlur={hoverPopover.closePreview}
          onClick={hoverPopover.togglePinned}
          className="premium-focus inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border transition-colors hover-bg-warm"
          style={{
            borderColor: tone.borderColor,
            background: tone.background,
            color: tone.color,
          }}
        >
          <GitCommitHorizontal className="h-3.5 w-3.5" aria-hidden />
        </button>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        sideOffset={8}
        onOpenAutoFocus={(event) => event.preventDefault()}
        className="w-[min(calc(100vw-2rem),30rem)] rounded-xl p-0 shadow-2xl shadow-black/50"
        style={{
          borderColor: 'var(--surface-border)',
          background: 'var(--surface-base)',
          color: 'var(--text-primary)',
        }}
      >
        <div className="flex items-start justify-between gap-4 border-b px-4 py-3" style={{ borderColor: 'var(--surface-border)' }}>
          <div className="flex min-w-0 items-start gap-2.5">
            <div
              className="mt-0.5 rounded-md border p-1.5"
              style={{ borderColor: tone.borderColor, background: tone.background }}
            >
              <GitCommitHorizontal className="h-3.5 w-3.5" style={{ color: tone.color }} aria-hidden />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-medium">LeadPoet validator</div>
              <div className="mt-0.5 text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                Reported commit vs latest {repository.owner}/{repository.name}
              </div>
            </div>
          </div>
          <StatePill state={state} label={stateLabel} />
        </div>

        <div className="space-y-3 p-4">
          <div
            className="rounded-lg border px-3 py-2.5"
            style={{ borderColor: tone.borderColor, background: tone.background }}
          >
            <div className="text-[10px] uppercase tracking-[0.12em]" style={{ color: 'var(--text-tertiary)' }}>
              Validator commit
            </div>
            {deployment.commitSha && validatorCommitUrl ? (
              <a
                href={validatorCommitUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="premium-focus mt-1.5 block rounded-sm break-all font-mono text-xs leading-relaxed underline-offset-4 hover:underline"
                style={{ color: tone.color }}
                title="Open commit in a new tab"
              >
                {deployment.commitSha}
              </a>
            ) : (
              <code className="mt-1.5 block text-xs leading-relaxed" style={{ color: tone.color }}>
                Not reported
              </code>
            )}
            <div className="mt-2 flex items-center gap-2 text-[10px]" style={{ color: tone.color }}>
              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: tone.color }} aria-hidden />
              <span>{comparisonCopy}</span>
            </div>
          </div>

          {!deployment.sourceAvailable || !repository.sourceAvailable ? (
            <div
              className="rounded-lg border px-3 py-2 text-[11px] leading-relaxed"
              style={{ borderColor: 'var(--surface-border)', background: 'var(--surface)', color: 'var(--text-secondary)' }}
            >
              {!deployment.sourceAvailable
                ? `Validator deployment telemetry is unavailable${deployment.unavailableReason ? `: ${deployment.unavailableReason}` : '.'}`
                : `LeadPoet repository telemetry is unavailable${repository.unavailableReason ? `: ${repository.unavailableReason}` : '.'}`}
            </div>
          ) : null}

          {isMixed ? (
            <div className="rounded-lg border px-3 py-2.5" style={{ borderColor: tone.borderColor, background: tone.background }}>
              <div className="text-[9px] uppercase tracking-[0.12em]" style={{ color: 'var(--text-tertiary)' }}>
                Reported validator commits
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {deployment.commitShas.map((commitSha) => (
                  <a
                    key={commitSha}
                    href={githubCommitUrl(repository.repositoryUrl, commitSha) ?? undefined}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="premium-focus rounded border px-2 py-1 font-mono text-[10px] underline-offset-2 hover:underline"
                    style={{ borderColor: tone.borderColor, color: tone.color }}
                    title={`${commitSha} · Open in a new tab`}
                  >
                    {compactHash(commitSha)}
                  </a>
                ))}
              </div>
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-2">
            <SourcingModelDetail
              label="Validator commit"
              value={deployment.commitSha}
              href={validatorCommitUrl}
              compact
            />
            <SourcingModelDetail
              label={`Latest ${repository.branch}`}
              value={repository.commitSha}
              href={latestCommitUrl}
              compact
            />
            <SourcingModelDetail label="Reported by" value={reportingNode} compact />
            <SourcingModelDetail label="Validator build" value={deployment.buildId} />
            <SourcingModelDetail
              label="Validator reported"
              value={deployment.reportedAt ? formatDateTime(deployment.reportedAt) : null}
            />
            <SourcingModelDetail
              label={`Latest ${repository.branch} committed`}
              value={repository.committedAt ? formatDateTime(repository.committedAt) : null}
            />
            <SourcingModelDetail label={`Latest ${repository.branch} author`} value={repository.authorLogin} />
            <SourcingModelDetail label="Repository" value={`${repository.owner}/${repository.name}`} />
            <SourcingModelDetail label="Reporting nodes" value={String(deployment.reportingNodeCount)} />
            <SourcingModelDetail label="Distinct commits" value={String(deployment.distinctCommitCount)} />
            <SourcingModelDetail label="Telemetry source" value={readableTag(deployment.source)} />
            <SourcingModelDetail label="Checked" value={formatDateTime(deployment.checkedAt)} />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

type SourcingModelAlignmentTone = {
  borderColor: string
  background: string
  color: string
}

function sourcingModelAlignmentTone(
  inLine: boolean,
  outOfLine: boolean,
): SourcingModelAlignmentTone {
  if (inLine) {
    return {
      borderColor: 'rgba(80, 176, 112, 0.46)',
      background: 'rgba(80, 176, 112, 0.11)',
      color: '#8fd2a8',
    }
  }
  if (outOfLine) {
    return {
      borderColor: 'rgba(207, 157, 97, 0.44)',
      background: 'rgba(207, 157, 97, 0.10)',
      color: '#d9ad77',
    }
  }
  return {
    borderColor: 'var(--surface-border)',
    background: 'var(--surface-base)',
    color: 'var(--text-tertiary)',
  }
}

function SourcingModelAlignmentPill({
  label,
  tone,
}: {
  label: string
  tone: SourcingModelAlignmentTone
}) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em]"
      style={{ borderColor: tone.borderColor, background: tone.background, color: tone.color }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: tone.color }} />
      {label}
    </span>
  )
}

function SourcingModelDetail({
  label,
  value,
  href = null,
  compact = false,
}: {
  label: string
  value: string | null
  href?: string | null
  compact?: boolean
}) {
  const displayValue = value ? (compact ? compactHash(value) : value) : '—'
  return (
    <div className="min-w-0 rounded-lg border px-2.5 py-2" style={{ borderColor: 'var(--surface-border)', background: 'var(--surface)' }}>
      <div className="text-[9px] uppercase tracking-[0.12em]" style={{ color: 'var(--text-tertiary)' }}>
        {label}
      </div>
      {value && href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="premium-focus mt-1 block truncate rounded-sm font-mono text-[10px] underline-offset-2 hover:underline"
          title={`${value} · Open in a new tab`}
          style={{ color: 'var(--text-secondary)' }}
        >
          {displayValue}
        </a>
      ) : (
        <div className="mt-1 truncate font-mono text-[10px]" title={value ?? undefined} style={{ color: 'var(--text-secondary)' }}>
          {displayValue}
        </div>
      )}
    </div>
  )
}

function githubCommitUrl(repositoryUrl: string | null, sha: string | null): string | null {
  if (!repositoryUrl || !sha || !/^[0-9a-f]{7,64}$/i.test(sha)) return null
  try {
    const url = new URL(repositoryUrl)
    if (url.protocol !== 'https:' || url.hostname !== 'github.com') return null
    const repositoryPath = url.pathname.replace(/\/+$/, '')
    if (!/^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repositoryPath)) return null
    return `https://github.com${repositoryPath}/commit/${sha}`
  } catch {
    return null
  }
}

function HealthSignalCard({ signal }: { signal: AdminLabHealthSignal }) {
  const Icon = signalIcon(signal.id, signal.state)
  const emphasizedMismatch = signal.id === 'pcr0' && signal.state === 'critical'
  return (
    <div
      className="rounded-lg border p-3"
      style={{
        borderColor: emphasizedMismatch ? 'rgba(240, 109, 120, 0.48)' : 'var(--surface-border)',
        background: emphasizedMismatch ? 'rgba(240, 109, 120, 0.10)' : 'var(--surface-base)',
        boxShadow: emphasizedMismatch
          ? 'inset 2px 0 0 #f06d78, 0 0 24px rgba(240, 109, 120, 0.055)'
          : undefined,
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Icon
              className={cn('h-3.5 w-3.5 shrink-0', stateTextClass(signal.state))}
              style={emphasizedMismatch ? { color: '#f06d78' } : undefined}
            />
            <div
              className="truncate text-[10px] uppercase tracking-[0.14em]"
              style={{ color: emphasizedMismatch ? 'rgba(240, 109, 120, 0.78)' : 'var(--text-tertiary)' }}
            >
              {signal.label}
            </div>
          </div>
          <div className="mt-2 truncate text-lg font-medium tabular-nums" style={{ color: emphasizedMismatch ? '#f58a93' : 'var(--text-primary)' }}>
            {signal.value}
          </div>
        </div>
        <span
          className={cn('mt-1 h-2 w-2 shrink-0 rounded-full', stateDotClass(signal.state))}
          style={emphasizedMismatch ? { background: '#f06d78', boxShadow: '0 0 0 3px rgba(240, 109, 120, 0.12)' } : undefined}
        />
      </div>
      <div className="mt-2 line-clamp-2 text-[11px] leading-relaxed" style={{ color: emphasizedMismatch ? '#d9a4a8' : 'var(--text-secondary)' }}>
        {signal.detail}
      </div>
      {signal.updatedAt ? (
        <div suppressHydrationWarning className="mt-2 font-mono text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
          {formatRelative(signal.updatedAt)}
        </div>
      ) : null}
    </div>
  )
}

function ImprovementAnalysesPanel({
  analyses,
}: {
  analyses: AdminLabImprovementAnalysis[]
}) {
  return (
    <section
      id="improvement-analyses"
      className="scroll-mt-24 rounded-xl border"
      style={{ borderColor: 'var(--surface-border)', background: 'var(--surface)' }}
    >
      <PanelHeader
        icon={<GitCommitHorizontal className="h-4 w-4 text-gold" />}
        title="Improvement analyses"
        aside={(
          <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
            Sol · extra-high reasoning · latest {analyses.length}
          </span>
        )}
      />
      {analyses.length === 0 ? (
        <div className="p-6 text-sm" style={{ color: 'var(--text-secondary)' }}>
          No post-activation improvement analysis has been queued yet.
        </div>
      ) : (
        <div className="grid gap-3 p-4 xl:grid-cols-2">
          {analyses.map((analysis) => {
            const state: AdminHealthState = analysis.lastError
              ? 'critical'
              : analysis.status === 'delivered'
                ? 'healthy'
                : analysis.status === 'pending_delivery'
                  ? 'degraded'
                  : 'unknown'
            const statusLabel = analysis.genuineImprovement
              ? readableTag(analysis.genuineImprovement)
              : readableTag(analysis.status)
            return (
              <article
                key={analysis.eventKey}
                className="min-w-0 rounded-lg border p-4"
                style={{ borderColor: 'var(--surface-border)', background: 'var(--surface-base)' }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[10px] uppercase tracking-[0.14em]" style={{ color: 'var(--text-tertiary)' }}>
                      {analysis.improvementPoints === null
                        ? 'Promoted improvement'
                        : `${analysis.improvementPoints >= 0 ? '+' : ''}${analysis.improvementPoints.toFixed(3)} points`}
                    </div>
                    <div className="mt-1 font-mono text-[10px]" style={{ color: 'var(--text-tertiary)' }} title={analysis.candidateId ?? analysis.sourceId}>
                      {shortId(analysis.candidateId ?? analysis.sourceId)}
                    </div>
                  </div>
                  <StatePill state={state} label={statusLabel} />
                </div>

                {analysis.summary ? (
                  <p className="mt-3 text-sm leading-relaxed" style={{ color: 'var(--text-primary)' }}>
                    {analysis.summary}
                  </p>
                ) : (
                  <p className="mt-3 text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                    {analysis.status === 'analyzing'
                      ? 'Sol is analyzing the source change and scoring evidence.'
                      : 'Analysis is queued.'}
                  </p>
                )}

                {analysis.minerDirection || analysis.directionImplementation || analysis.directionAssessment || analysis.improvementMade ? (
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <MiniMeta label="Miner direction" value={analysis.minerDirection ?? '—'} />
                    <MiniMeta label="How the system used it" value={analysis.directionImplementation ?? '—'} />
                    <MiniMeta
                      label={analysis.directionAlignment ? `Direction · ${readableTag(analysis.directionAlignment)}` : 'Direction assessment'}
                      value={analysis.directionAssessment ?? '—'}
                    />
                    <MiniMeta label="Improvement made" value={analysis.improvementMade ?? '—'} />
                  </div>
                ) : null}

                {analysis.helpedIcps.length > 0 ? (
                  <div className="mt-3 space-y-2">
                    <div className="text-[10px] uppercase tracking-[0.12em]" style={{ color: 'var(--text-tertiary)' }}>
                      Helped ICPs
                    </div>
                    {analysis.helpedIcps.slice(0, 6).map((icp) => (
                      <div key={`${analysis.eventKey}:${icp.icpRef}`} className="rounded-md border px-3 py-2" style={{ borderColor: 'var(--surface-border)' }}>
                        <div className="flex items-start justify-between gap-3 text-xs">
                          <span className="min-w-0 font-medium" style={{ color: 'var(--text-primary)' }}>{icp.icpLabel}</span>
                          <span className="shrink-0 font-mono text-[10px] text-gold">
                            {icp.deltaVsBase === null ? '—' : `${icp.deltaVsBase >= 0 ? '+' : ''}${icp.deltaVsBase.toFixed(3)}`}
                          </span>
                        </div>
                        <p className="mt-1 text-[11px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{icp.whyItHelped}</p>
                      </div>
                    ))}
                  </div>
                ) : null}

                {analysis.genuineAssessment ? (
                  <div className="mt-3 rounded-md border px-3 py-2 text-xs leading-relaxed" style={{ borderColor: 'var(--surface-border)', color: 'var(--text-secondary)' }}>
                    {analysis.genuineAssessment}
                  </div>
                ) : null}
                {analysis.lastError ? (
                  <div className="mt-3 rounded-md border border-burgundy-soft bg-burgundy-soft px-3 py-2 text-xs text-burgundy">
                    {analysis.lastError}
                  </div>
                ) : null}
                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                  <span>{formatRelative(analysis.analyzedAt ?? analysis.occurredAt)}</span>
                  {analysis.model ? <span>{analysis.model}</span> : null}
                  {analysis.reasoningEffort ? <span>{analysis.reasoningEffort}</span> : null}
                  {analysis.minerHotkey ? <span>{shortHotkey(analysis.minerHotkey)}</span> : null}
                </div>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}

function ComputeSpendPanel({ spend }: { spend: AdminLabComputeSpendSummary }) {
  return (
    <section
      className="rounded-xl border"
      style={{
        borderColor: 'var(--surface-border)',
        background: 'var(--surface)',
      }}
    >
      <PanelHeader
        icon={<CircleDollarSign className="h-4 w-4 text-gold" />}
        title="Daily compute spend"
        aside={(
          <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
            UTC · last {spend.days} days
          </span>
        )}
      />
      {!spend.sourceAvailable ? (
        <div className="p-6 text-sm" style={{ color: 'var(--text-secondary)' }}>
          Finalized compute-cost ledgers are not available.
        </div>
      ) : (
        <div className="grid gap-5 p-4 xl:grid-cols-[minmax(0,1fr)_220px]">
          <div className="min-w-0">
            <div className="h-[260px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={spend.points} margin={{ top: 12, right: 12, bottom: 4, left: 0 }}>
                  <CartesianGrid vertical={false} stroke="rgba(245, 240, 232, 0.07)" />
                  <XAxis
                    dataKey="date"
                    axisLine={false}
                    tickLine={false}
                    minTickGap={28}
                    tick={{ fill: 'var(--text-tertiary)', fontSize: 10 }}
                    tickFormatter={formatChartDate}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    width={54}
                    tick={{ fill: 'var(--text-tertiary)', fontSize: 10 }}
                    tickFormatter={formatCompactUsd}
                  />
                  <Tooltip
                    cursor={{ fill: 'rgba(245, 240, 232, 0.035)' }}
                    contentStyle={{
                      border: '1px solid var(--surface-border-strong)',
                      borderRadius: 8,
                      background: 'var(--surface-elevated)',
                      color: 'var(--text-primary)',
                      fontSize: 12,
                    }}
                    labelStyle={{ color: 'var(--text-secondary)', marginBottom: 4 }}
                    formatter={(value) => [formatUsd(Number(value)), 'Compute spent']}
                    labelFormatter={(value) => formatChartTooltipDate(String(value))}
                  />
                  <Bar
                    dataKey="spendUsd"
                    name="Compute spent"
                    fill="var(--accent-positive)"
                    fillOpacity={0.72}
                    maxBarSize={42}
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>
              Finalized OpenRouter cost from completed and failed receipt events, assigned to the UTC day the run ended.
            </p>
          </div>
          <div className="self-start">
            <div className="grid grid-cols-2 gap-2 xl:grid-cols-1">
              <MetricBox label={`${spend.days}d spend`} value={formatUsd(spend.totalUsd)} />
              <MetricBox label="Daily average" value={formatUsd(spend.averageDailyUsd)} />
              <MetricBox label="Today (UTC)" value={formatUsd(spend.latestDayUsd)} />
              <MetricBox label="Finalized runs" value={spend.runCount} />
            </div>
            <FinalizedRunReconciliation reconciliation={spend.reconciliation} />
          </div>
        </div>
      )}
    </section>
  )
}

function FinalizedRunReconciliation({
  reconciliation,
}: {
  reconciliation: AdminLabComputeSpendSummary['reconciliation']
}) {
  return (
    <div
      className="mt-2 rounded-lg border px-3 py-3"
      style={{ borderColor: 'var(--surface-border)', background: 'var(--surface-base)' }}
    >
      <div className="text-[10px] uppercase tracking-[0.12em]" style={{ color: 'var(--text-tertiary)' }}>
        Finalized run outcomes
      </div>
      {!reconciliation.sourceAvailable ? (
        <p className="mt-2 text-[11px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          Outcome reconciliation is unavailable.
        </p>
      ) : (
        <>
          <div className="mt-2 divide-y" style={{ borderColor: 'var(--surface-border)' }}>
            <ReconciliationRow
              label="Reached scoring"
              value={reconciliation.reachedScoringCount}
              tone="positive"
            />
            <ReconciliationRow
              label="Candidate, not scored"
              value={reconciliation.candidateNotScoredCount}
            />
            <ReconciliationRow label="No candidate" value={reconciliation.noCandidateCount} />
          </div>
          <div
            className="mt-2 flex items-center justify-between gap-3 border-t pt-2 text-[10px] xl:block"
            style={{ borderColor: 'var(--surface-border)', color: 'var(--text-tertiary)' }}
          >
            <span>No-candidate split</span>
            <span className="shrink-0 tabular-nums xl:mt-1 xl:block">
              {reconciliation.noCandidateFailedCount.toLocaleString()} failed ·{' '}
              {reconciliation.noCandidateCompletedCount.toLocaleString()} completed
            </span>
          </div>
        </>
      )}
    </div>
  )
}

function ReconciliationRow({
  label,
  value,
  tone = 'neutral',
}: {
  label: string
  value: number
  tone?: 'neutral' | 'positive'
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 text-[11px]">
      <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
      <span
        className="font-mono font-medium tabular-nums"
        style={{ color: tone === 'positive' ? 'var(--accent-positive)' : 'var(--text-primary)' }}
      >
        {value.toLocaleString()}
      </span>
    </div>
  )
}

function ScoringPanel({ scoring }: { scoring: AdminLabScoringSummary }) {
  const Icon = scoring.paused ? PauseCircle : scoring.state === 'active' ? PlayCircle : Gauge
  return (
    <section
      className="rounded-xl border"
      style={{
        borderColor: 'var(--surface-border)',
        background: 'var(--surface)',
      }}
    >
      <PanelHeader
        icon={<Icon className={cn('h-4 w-4', stateTextClass(healthStateForScoring(scoring.state)))} />}
        title="Scoring"
        aside={<StatePill state={healthStateForScoring(scoring.state)} label={scoring.label} />}
      />
      <div className="space-y-4 p-4">
        <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          {scoring.detail}
        </p>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <MetricBox label="Active runs" value={scoring.activeRuns} />
          <MetricBox label="Scoring" value={scoring.scoringRuns} />
          <MetricBox label="Queued" value={scoring.queuedRuns} />
          <MetricBox label="Stale" value={scoring.staleRuns} tone={scoring.staleRuns > 0 ? 'critical' : 'neutral'} />
          <MetricBox label="ICPs left" value={scoring.icpsRemaining ?? '—'} />
          <MetricBox label="Candidates left" value={scoring.candidatesRemaining} />
          <MetricBox label="Score bundles 1h" value={scoring.scoreBundlesLastHour} />
          <MetricBox label="Score bundles 24h" value={scoring.scoreBundlesLast24h} />
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <MiniMeta label="Source" value={readableTag(scoring.source)} />
          <MiniMeta label="Last scoring" value={scoring.lastScoringAt ? formatRelative(scoring.lastScoringAt) : '—'} />
          <MiniMeta label="Oldest active" value={scoring.oldestActiveRunAt ? formatRelative(scoring.oldestActiveRunAt) : '—'} />
        </div>
      </div>
    </section>
  )
}

function PipelinePanel({ stages }: { stages: AdminLabPipelineStage[] }) {
  const max = Math.max(1, ...stages.map((stage) => stage.count))
  return (
    <section
      className="rounded-xl border"
      style={{
        borderColor: 'var(--surface-border)',
        background: 'var(--surface)',
      }}
    >
      <PanelHeader
        icon={<BarChart3 className="h-4 w-4 text-gold" />}
        title="Pipeline"
        aside={<span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>{stages.reduce((sum, stage) => sum + stage.count, 0)} stage hits</span>}
      />
      <div className="space-y-3 p-4">
        {stages.map((stage) => (
          <div key={stage.id}>
            <div className="mb-1 flex items-center justify-between gap-3 text-xs">
              <span style={{ color: 'var(--text-secondary)' }}>{stage.label}</span>
              <span className="font-mono" style={{ color: stage.staleCount > 0 ? 'var(--accent-negative)' : 'var(--text-tertiary)' }}>
                {stage.count}{stage.staleCount > 0 ? ` · ${stage.staleCount} stale` : ''}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full" style={{ background: 'rgba(245, 240, 232, 0.06)' }}>
              <div
                className={cn('h-full rounded-full', stage.staleCount > 0 ? 'bg-burgundy-soft' : 'bg-gold-soft')}
                style={{
                  width: `${Math.max(3, Math.round((stage.count / max) * 100))}%`,
                  backgroundColor: stage.staleCount > 0 ? 'rgba(168, 116, 111, 0.55)' : 'rgba(201, 169, 110, 0.55)',
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function ActiveRunsPanel({
  runs,
  selectedTicketId,
  selectedRunId,
  onSelect,
}: {
  runs: AdminLabActiveRun[]
  selectedTicketId: string | null
  selectedRunId: string | null
  onSelect: (ticketId: string, runId: string | null) => void
}) {
  return (
    <section
      className="rounded-xl border"
      style={{
        borderColor: 'var(--surface-border)',
        background: 'var(--surface)',
      }}
    >
      <PanelHeader
        icon={<Clock3 className="h-4 w-4 text-gold" />}
        title="Current Runs"
        aside={<span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>{runs.length} visible · select to inspect</span>}
      />
      {runs.length === 0 ? (
        <div className="p-6 text-sm" style={{ color: 'var(--text-secondary)' }}>
          No active or blocked Lab runs are visible in the current window.
        </div>
      ) : (
        <>
        <div className="space-y-2 p-3 lg:hidden">
          {runs.map((run) => {
            const active = selectedTicketId === run.ticketId && selectedRunId === run.runId
            return (
              <button
                key={`mobile:${run.ticketId}:${run.runId ?? 'ticket'}`}
                type="button"
                aria-pressed={active}
                onClick={() => onSelect(run.ticketId, run.runId)}
                className={cn(
                  'premium-focus block min-h-11 w-full rounded-lg border p-3 text-left transition-colors',
                  active ? 'border-gold-soft bg-gold-soft' : 'hover-bg-warm',
                )}
                style={active ? undefined : { borderColor: 'var(--surface-border)', background: 'var(--surface-base)' }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: run.stale ? 'var(--accent-negative)' : 'var(--accent-positive)' }} />
                      <span className="line-clamp-2 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{run.researchFocusSummary || 'No focus summary'}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <StatusPill label={run.statusLabel || run.statusKey} band={run.stale ? 'failed' : 'running'} compact />
                      <Tag>{readableTag(run.phase)}</Tag>
                    </div>
                  </div>
                  <ChevronRight className="mt-1 h-4 w-4 shrink-0" style={{ color: 'var(--text-tertiary)' }} />
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <MiniMeta label="ICPs left" value={run.icpsRemaining === null ? '—' : String(run.icpsRemaining)} />
                  <MiniMeta label="Candidates" value={`${run.scoredCandidateCount}/${run.candidateCount}`} />
                  <MiniMeta label="Idle" value={formatDurationMs(run.idleMs)} />
                </div>
                {run.blocker ? <p className="mt-2 line-clamp-2 text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{run.blocker}</p> : null}
                <div className="mt-2 truncate font-mono text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                  {run.runId ? `Run ${run.runId}` : `Ticket ${run.ticketId}`}
                </div>
              </button>
            )
          })}
        </div>
        <div className="hidden overflow-x-auto lg:block">
          <table className="w-full min-w-[1080px] text-left text-xs">
            <thead
              className="border-b"
              style={{ borderColor: 'var(--surface-border)', color: 'var(--text-tertiary)' }}
            >
              <tr>
                <th className="px-4 py-3 font-medium">Run</th>
                <th className="px-3 py-3 font-medium">Phase</th>
                <th className="px-3 py-3 text-right font-medium">ICPs left</th>
                <th className="px-3 py-3 text-right font-medium">Candidates</th>
                <th className="px-3 py-3 font-medium">Bundle</th>
                <th className="px-3 py-3 font-medium">Idle</th>
                <th className="px-4 py-3 font-medium">Blocker</th>
                <th className="px-4 py-3 text-right font-medium">Details</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => {
                const active = selectedTicketId === run.ticketId && selectedRunId === run.runId
                return (
                  <tr
                    key={`${run.ticketId}:${run.runId ?? 'ticket'}`}
                    onClick={() => onSelect(run.ticketId, run.runId)}
                    className={cn('cursor-pointer border-b transition-colors hover-bg-warm', active ? 'bg-gold-soft' : '')}
                    style={{ borderColor: 'var(--surface-border)' }}
                  >
                    <td className="max-w-[320px] px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className={cn('h-2 w-2 shrink-0 rounded-full', run.stale ? 'bg-burgundy-soft' : 'bg-gold-soft')} style={{ backgroundColor: run.stale ? 'var(--accent-negative)' : 'var(--accent-positive)' }} />
                        <span className="truncate font-medium" style={{ color: 'var(--text-primary)' }}>
                          {run.researchFocusSummary || 'No focus summary'}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                        <span>{shortHotkey(run.minerHotkey)}</span>
                        <span>Ticket {shortId(run.ticketId)}</span>
                        {run.runId ? <span>Run {shortId(run.runId)}</span> : null}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <StatusPill label={run.statusLabel || run.statusKey} band={run.stale ? 'failed' : 'running'} compact />
                      <div className="mt-1 text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                        {readableTag(run.phase)}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right font-mono" style={{ color: 'var(--text-primary)' }}>
                      {run.icpsRemaining === null ? '—' : run.icpsRemaining}
                      <div className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                        {run.icpTotal === null ? 'unknown total' : `${run.icpsScored ?? 0}/${run.icpTotal}`}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right font-mono" style={{ color: 'var(--text-primary)' }}>
                      {run.candidatesRemaining}
                      <div className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                        {run.scoredCandidateCount}/{run.candidateCount}
                      </div>
                    </td>
                    <td className="max-w-[170px] px-3 py-3">
                      <div className="truncate font-mono text-[11px]" style={{ color: 'var(--text-secondary)' }} title={run.scoreBundleId ?? undefined}>
                        {run.scoreBundleId ? shortId(run.scoreBundleId) : '—'}
                      </div>
                      <div className="mt-1 truncate text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                        {run.scoreBundleStatus ? readableTag(run.scoreBundleStatus) : 'No bundle yet'}
                      </div>
                    </td>
                    <td className="px-3 py-3 font-mono" style={{ color: run.stale ? 'var(--accent-negative)' : 'var(--text-secondary)' }}>
                      {formatDurationMs(run.idleMs)}
                      <div className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                        age {formatDurationMs(run.ageMs)}
                      </div>
                    </td>
                    <td className="max-w-[260px] px-4 py-3">
                      <div className="line-clamp-2 text-[11px] leading-relaxed" style={{ color: run.blocker ? 'var(--text-secondary)' : 'var(--text-tertiary)' }}>
                        {run.blocker || 'No blocker reported'}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation()
                          onSelect(run.ticketId, run.runId)
                        }}
                        className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[10px] font-medium uppercase tracking-[0.08em] transition-colors hover-bg-warm"
                        style={{ borderColor: 'var(--surface-border-strong)', color: 'var(--text-primary)' }}
                      >
                        View details
                        <ChevronRight className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        </>
      )}
    </section>
  )
}

function BenchmarkPanel({ benchmark }: { benchmark: AdminLabBenchmarkSummary }) {
  return (
    <section className="min-w-0 rounded-xl border" style={{ borderColor: 'var(--surface-border)', background: 'var(--surface)' }}>
      <PanelHeader
        icon={<Database className={cn('h-4 w-4', stateTextClass(benchmark.state))} />}
        title="Benchmark"
        aside={<StatePill state={benchmark.state} label={stateLabel(benchmark.state)} />}
      />
      <div className="space-y-4 p-4">
        <div className="grid grid-cols-2 gap-2">
          <MetricBox label="Score" value={benchmark.aggregateScore === null ? '—' : benchmark.aggregateScore.toFixed(2)} />
          <MetricBox label="ICPs" value={benchmark.itemCount} />
          <MetricBox label="Public" value={benchmark.publicIcpCount} />
          <MetricBox label="Holdout" value={benchmark.privateHoldoutIcpCount} />
        </div>
        <MiniMeta label="Date" value={benchmark.benchmarkDate ?? '—'} />
        <MiniMeta label="Updated" value={benchmark.currentStatusAt ? formatRelative(benchmark.currentStatusAt) : '—'} />
        {benchmark.topIssues.length > 0 ? (
          <div className="space-y-1">
            {benchmark.topIssues.slice(0, 3).map((issue) => (
              <div key={issue.key} className="flex items-center justify-between gap-3 text-xs">
                <span className="truncate" style={{ color: 'var(--text-secondary)' }}>{readableTag(issue.key)}</span>
                <span className="font-mono" style={{ color: 'var(--text-tertiary)' }}>{issue.count}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            {benchmark.detail}
          </p>
        )}
      </div>
    </section>
  )
}

function AlertsPanel({
  alerts,
  observedNodes,
}: {
  alerts: AdminLabAlertSummary
  observedNodes: AdminLabAttestationNode[]
}) {
  const sourceLabel = alerts.source === 'public_transparency_log'
    ? 'Public transparency log'
    : alerts.source === 'ops_telemetry'
      ? 'Ops telemetry'
      : alerts.source === 'canonical_evaluator'
        ? 'Canonical evaluator'
        : alerts.source === 'combined'
          ? 'Merged telemetry'
      : 'Unavailable'

  return (
    <section className="min-w-0 rounded-xl border" style={{ borderColor: 'var(--surface-border)', background: 'var(--surface)' }}>
      <PanelHeader
        icon={<Siren className={cn('h-4 w-4', stateTextClass(alerts.state))} />}
        title="Alerts"
        aside={<StatePill state={alerts.state} label={alerts.sourceAvailable ? stateLabel(alerts.state) : 'Not wired'} />}
      />
      <div className="space-y-4 p-4">
        <div className="grid grid-cols-3 gap-2">
          <MetricBox label="24h" value={alerts.totalLast24h} />
          <MetricBox label="Critical" value={alerts.criticalLast24h} tone={alerts.criticalLast24h > 0 ? 'critical' : 'neutral'} />
          <MetricBox label="Active" value={alerts.activeCount} />
        </div>
        <MiniMeta label="Source" value={sourceLabel} />
        <AlertOperationsControlPlane operations={alerts.operations} observedNodes={observedNodes} />
        {alerts.source === 'public_transparency_log' || alerts.source === 'combined' ? (
          <div className="grid grid-cols-2 gap-2">
            <MiniMeta label="Envelope matches" value={String(alerts.verifiedEventCount)} />
            <MiniMeta
              label="Arweave checkpoint"
              value={alerts.latestCheckpointAt ? formatRelative(alerts.latestCheckpointAt) : 'Missing'}
              title={alerts.latestCheckpointAt ?? undefined}
            />
          </div>
        ) : null}
        {alerts.latestCheckpointUrl ? (
          <a
            href={alerts.latestCheckpointUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex text-xs underline decoration-white/20 underline-offset-4 transition-colors hover:text-white"
            style={{ color: 'var(--text-secondary)' }}
          >
            Open latest public Arweave checkpoint
          </a>
        ) : null}
        {!alerts.sourceAvailable ? (
          <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            Supabase could not read alert telemetry or the signed public <span className="font-mono">transparency_log</span> fallback.
          </p>
        ) : alerts.recent.length === 0 ? (
          <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            {alerts.source === 'public_transparency_log' || alerts.source === 'combined'
              ? `${alerts.weightSubmissionCount} weight submissions and ${alerts.epochAuditCount} matching epoch audits were checked. No derived issues.`
              : 'No recent alerts in the telemetry source.'}
          </p>
        ) : (
          <div className="space-y-2">
            {alerts.recent.slice(0, 6).map((alert) => (
              <div key={alert.id} className="border-t pt-2" style={{ borderColor: 'var(--surface-border)' }}>
                <div className="flex items-start justify-between gap-3">
                  <span className="line-clamp-2 min-w-0 text-xs font-medium leading-relaxed" style={{ color: 'var(--text-primary)' }}>{alert.title}</span>
                  <span className="font-mono text-[10px]" style={{ color: alert.severity === 'critical' ? 'var(--accent-negative)' : 'var(--text-tertiary)' }}>
                    {readableTag(alert.severity)}
                  </span>
                </div>
                {alert.detail ? (
                  <p className="mt-1 break-words text-[11px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{alert.detail}</p>
                ) : null}
                {alert.signal || alert.validatorId || alert.ageBlocks !== null && alert.ageBlocks !== undefined ? (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {alert.signal ? <Tag>{readableTag(alert.signal)}</Tag> : null}
                    {alert.validatorId ? <Tag>{shortHotkey(alert.validatorId)}</Tag> : null}
                    {alert.ageBlocks !== null && alert.ageBlocks !== undefined ? <Tag>{`${Math.round(alert.ageBlocks)} blocks old`}</Tag> : null}
                  </div>
                ) : null}
                <div className="mt-1 flex items-center justify-between gap-3 text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                  <span className="truncate">{alert.source}</span>
                  <span suppressHydrationWarning>{alert.lastSeenAt ? formatRelative(alert.lastSeenAt) : '—'}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

function AlertOperationsControlPlane({
  operations,
  observedNodes,
}: {
  operations: AdminLabAlertOperationsSummary
  observedNodes: AdminLabAttestationNode[]
}) {
  const [validators, setValidators] = useState(operations.validators)
  const [hotkeyDraft, setHotkeyDraft] = useState('')
  const [labelDraft, setLabelDraft] = useState('')
  const [registryError, setRegistryError] = useState<string | null>(null)
  const [submittingHotkey, setSubmittingHotkey] = useState<string | null>(null)
  useEffect(() => setValidators(operations.validators), [operations.validators])

  const activeValidatorCount = validators.filter((validator) => validator.enabled).length
  const registeredHotkeys = new Set(validators.map((validator) => validator.hotkey))
  const observedCandidates = observedNodes
    .filter((node) => Boolean(node.hotkey) && !registeredHotkeys.has(node.hotkey!))
    .filter((node, index, rows) => rows.findIndex((candidate) => candidate.hotkey === node.hotkey) === index)

  const saveValidator = async (input: {
    hotkey: string
    label?: string | null
    expectedPcr0?: string | null
  }) => {
    setSubmittingHotkey(input.hotkey)
    setRegistryError(null)
    try {
      const response = await fetch('/api/admin/research-lab', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'upsert_validator_monitor',
          hotkey: input.hotkey,
          label: input.label || null,
          expectedPcr0: input.expectedPcr0 || null,
          enabled: true,
          monitorPcr0: true,
          monitorOffchainWeights: true,
          monitorOnchainWeights: true,
        }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error || `Validator update failed with ${response.status}`)
      const validator = body.validator as AdminLabMonitoredValidator
      setValidators((current) => [validator, ...current.filter((item) => item.hotkey !== validator.hotkey)])
      setHotkeyDraft('')
      setLabelDraft('')
    } catch (error) {
      setRegistryError(error instanceof Error ? error.message : 'Could not update validator monitoring.')
    } finally {
      setSubmittingHotkey(null)
    }
  }

  const removeValidator = async (validator: AdminLabMonitoredValidator) => {
    if (validator.source === 'environment') return
    if (!window.confirm(`Stop monitoring validator ${validator.label || shortHotkey(validator.hotkey)}?`)) return
    setSubmittingHotkey(validator.hotkey)
    setRegistryError(null)
    try {
      const response = await fetch('/api/admin/research-lab', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'remove_validator_monitor', hotkey: validator.hotkey }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error || `Validator removal failed with ${response.status}`)
      setValidators((current) => current.filter((item) => item.hotkey !== validator.hotkey))
    } catch (error) {
      setRegistryError(error instanceof Error ? error.message : 'Could not remove validator monitoring.')
    } finally {
      setSubmittingHotkey(null)
    }
  }

  const channels = [
    operations.emailConfigured ? 'Email' : null,
    operations.discordConfigured ? 'Discord' : null,
  ].filter(Boolean).join(' + ') || 'None'
  const heartbeatLabel = operations.lastCompletedAt
    ? formatRelative(operations.lastCompletedAt)
    : operations.monitorEnabled
      ? 'Never completed'
      : 'Disabled'

  return (
    <div
      className="rounded-lg border p-3"
      style={{
        borderColor: operations.state === 'critical'
          ? 'rgba(240, 109, 120, 0.38)'
          : operations.state === 'degraded'
            ? 'rgba(207, 157, 97, 0.38)'
            : 'var(--surface-border)',
        background: 'var(--surface-base)',
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-medium uppercase tracking-[0.12em]" style={{ color: 'var(--text-tertiary)' }}>
            Paging control plane
          </div>
          <div className="mt-1 text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
            {operations.monitorEnabled ? 'Monitor enabled' : 'Monitor disabled'}
          </div>
        </div>
        <StatePill state={operations.state} label={stateLabel(operations.state)} />
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <MetricBox label="Validators" value={activeValidatorCount} tone={activeValidatorCount === 0 ? 'critical' : 'neutral'} />
        <MetricBox label="Pending" value={operations.pendingDeliveryCount} tone={operations.overdueDeliveryCount > 0 ? 'critical' : 'neutral'} />
        <MetricBox label="Failed 24h" value={operations.failedDeliveryCount24h} tone={operations.failedDeliveryCount24h > 0 ? 'critical' : 'neutral'} />
      </div>

      <div className="mt-3 space-y-1.5">
        <MiniMeta label="Channels" value={channels} />
        <MiniMeta label="Heartbeat" value={heartbeatLabel} title={operations.lastCompletedAt ?? undefined} />
        <MiniMeta
          label="Delivery 24h"
          value={`${operations.succeededDeliveryCount24h} sent · ${operations.failedDeliveryCount24h} failed`}
        />
        {operations.leaseActive ? <MiniMeta label="Worker" value="Evaluation in progress" /> : null}
      </div>

      {operations.configurationBlockers.length > 0 ? (
        <div className="mt-3 space-y-1 border-t pt-2" style={{ borderColor: 'var(--surface-border)' }}>
          {operations.configurationBlockers.map((blocker) => (
            <div key={blocker} className="flex items-start gap-1.5 text-[10px] leading-relaxed" style={{ color: 'var(--accent-pending)' }}>
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              <span>{blocker}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-3 border-t pt-2 text-[10px] leading-relaxed" style={{ borderColor: 'var(--surface-border)', color: 'var(--text-secondary)' }}>
          {operations.detail}
        </p>
      )}

      {operations.lastError ? (
        <p className="mt-2 break-words text-[10px] leading-relaxed" style={{ color: 'var(--accent-negative)' }}>
          Last monitor error: {operations.lastError}
        </p>
      ) : null}

      <details className="mt-3 border-t pt-2" style={{ borderColor: 'var(--surface-border)' }}>
        <summary className="cursor-pointer list-none text-[10px] font-medium uppercase tracking-[0.1em]" style={{ color: 'var(--text-secondary)' }}>
          Validator registry · {activeValidatorCount} monitored
        </summary>
        <div className="mt-3 space-y-3">
          {validators.length > 0 ? (
            <div className="space-y-2">
              {validators.map((validator) => (
                <div key={validator.hotkey} className="flex min-w-0 items-center justify-between gap-2 rounded-md border px-2.5 py-2" style={{ borderColor: 'var(--surface-border)' }}>
                  <div className="min-w-0">
                    <div className="truncate text-[11px] font-medium" style={{ color: 'var(--text-primary)' }}>
                      {validator.label || shortHotkey(validator.hotkey)}
                    </div>
                    <div className="mt-0.5 truncate font-mono text-[9px]" title={validator.hotkey} style={{ color: 'var(--text-tertiary)' }}>
                      {validator.hotkey}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {validator.monitorPcr0 ? <Tag>PCR0</Tag> : null}
                      {validator.monitorOffchainWeights ? <Tag>Bundle</Tag> : null}
                      {validator.monitorOnchainWeights ? <Tag>On-chain</Tag> : null}
                      <Tag>{validator.source === 'environment' ? 'Environment' : 'Admin'}</Tag>
                    </div>
                  </div>
                  {validator.source === 'database' ? (
                    <button
                      type="button"
                      aria-label={`Stop monitoring ${validator.label || shortHotkey(validator.hotkey)}`}
                      disabled={submittingHotkey === validator.hotkey}
                      onClick={() => void removeValidator(validator)}
                      className="rounded-md border p-1.5 transition-colors hover-bg-warm disabled:opacity-50"
                      style={{ borderColor: 'var(--surface-border)', color: 'var(--text-tertiary)' }}
                    >
                      {submittingHotkey === validator.hotkey ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[10px] leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>
              Register every validator the team owns so a completely missing PCR0 or weight bundle still emits an alert.
            </p>
          )}

          {observedCandidates.length > 0 ? (
            <div className="space-y-1.5">
              <div className="text-[9px] uppercase tracking-[0.1em]" style={{ color: 'var(--text-tertiary)' }}>Observed, not monitored</div>
              {observedCandidates.slice(0, 4).map((node) => (
                <button
                  key={node.id}
                  type="button"
                  disabled={submittingHotkey === node.hotkey}
                  onClick={() => void saveValidator({
                    hotkey: node.hotkey!,
                    label: `Validator ${shortHotkey(node.hotkey!)}`,
                    expectedPcr0: node.expectedPcr0,
                  })}
                  className="flex w-full items-center justify-between gap-2 rounded-md border px-2.5 py-2 text-left transition-colors hover-bg-warm disabled:opacity-50"
                  style={{ borderColor: 'var(--surface-border)' }}
                >
                  <span className="min-w-0 truncate font-mono text-[9px]" title={node.hotkey ?? undefined} style={{ color: 'var(--text-secondary)' }}>
                    {node.hotkey}
                  </span>
                  {submittingHotkey === node.hotkey ? <Loader2 className="h-3 w-3 shrink-0 animate-spin" /> : <span className="inline-flex shrink-0 items-center gap-1 text-[9px]" style={{ color: 'var(--accent-positive)' }}><Plus className="h-3 w-3" /> Monitor</span>}
                </button>
              ))}
            </div>
          ) : null}

          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault()
              void saveValidator({ hotkey: hotkeyDraft.trim(), label: labelDraft.trim() || null })
            }}
          >
            <input
              value={hotkeyDraft}
              onChange={(event) => setHotkeyDraft(event.target.value)}
              placeholder="Validator hotkey"
              aria-label="Validator hotkey"
              className="w-full min-w-0 rounded-md border bg-transparent px-2.5 py-2 font-mono text-[10px] outline-none"
              style={{ borderColor: 'var(--surface-border)', color: 'var(--text-primary)' }}
            />
            <div className="flex min-w-0 gap-2">
              <input
                value={labelDraft}
                onChange={(event) => setLabelDraft(event.target.value)}
                placeholder="Label (optional)"
                aria-label="Validator label"
                className="min-w-0 flex-1 rounded-md border bg-transparent px-2.5 py-2 text-[10px] outline-none"
                style={{ borderColor: 'var(--surface-border)', color: 'var(--text-primary)' }}
              />
              <button
                type="submit"
                disabled={!hotkeyDraft.trim() || submittingHotkey !== null}
                className="inline-flex shrink-0 items-center gap-1 rounded-md border px-2.5 py-2 text-[10px] font-medium transition-colors hover-bg-warm disabled:opacity-40"
                style={{ borderColor: 'var(--surface-border-strong)', color: 'var(--text-primary)' }}
              >
                {submittingHotkey === hotkeyDraft.trim() ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                Add
              </button>
            </div>
          </form>
          {registryError ? <p role="alert" className="text-[10px] leading-relaxed" style={{ color: 'var(--accent-negative)' }}>{registryError}</p> : null}
        </div>
      </details>
    </div>
  )
}

function AttestationPanel({ attestation }: { attestation: AdminLabAttestationSummary }) {
  const observationOnly = attestation.verificationMode === 'observation_only'
  const gatewayAcceptance = attestation.verificationMode === 'gateway_acceptance'
  const hasMismatch = attestation.mismatchedNodes > 0
  const observedNodes = attestation.totalNodes - attestation.missingNodes
  const latestNode = attestation.nodes[0] ?? null
  const sourceLabel = gatewayAcceptance
    ? 'Production gateway readiness'
    : attestation.source === 'published_weight_bundles'
      ? 'Published weight bundles'
    : attestation.source === 'ops_attestation_current'
      ? 'Attestation comparison'
      : 'Unavailable'
  const statusLabel = !attestation.sourceAvailable
    ? 'Not wired'
    : hasMismatch
      ? 'Mismatch'
      : gatewayAcceptance
        ? 'Match'
        : stateLabel(attestation.state)

  return (
    <section
      className="min-w-0 rounded-xl border"
      style={{
        borderColor: hasMismatch ? 'rgba(232, 240, 255, 0.24)' : 'var(--surface-border)',
        background: 'var(--surface)',
      }}
    >
      <PanelHeader
        icon={attestation.state === 'critical' ? <ShieldX className="h-4 w-4 text-burgundy" /> : <ShieldCheck className={cn('h-4 w-4', stateTextClass(attestation.state))} />}
        title="PCR0"
        aside={<StatePill state={attestation.state} label={statusLabel} emphasized={hasMismatch} />}
      />
      <div className="space-y-4 p-4">
        {hasMismatch ? (
          <div
            role="alert"
            className="rounded-lg border p-3"
            style={{
              borderColor: 'rgba(232, 240, 255, 0.42)',
              background: 'rgba(232, 240, 255, 0.09)',
              boxShadow: 'inset 3px 0 0 var(--white)',
              color: 'var(--text-primary)',
            }}
          >
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <div className="text-xs font-semibold">PCR0 mismatch — weight publication blocked</div>
                <p className="mt-1 text-[11px] leading-relaxed">
                  The production gateway rejects the validator&apos;s published PCR0. Validators that require audited gateway publication will not submit chain weights until the gateway accepts this PCR0.
                </p>
              </div>
            </div>
          </div>
        ) : null}
        <div className="grid grid-cols-3 gap-2">
          <MetricBox label="Nodes" value={attestation.totalNodes} />
          <MetricBox
            label={gatewayAcceptance ? 'Accepted' : observationOnly ? 'Observed' : 'Matched'}
            value={observationOnly ? observedNodes : attestation.matchedNodes}
          />
          <MetricBox
            label={gatewayAcceptance ? 'Rejected' : observationOnly ? 'Missing' : 'Mismatch'}
            value={observationOnly ? attestation.missingNodes : attestation.mismatchedNodes}
            tone={(observationOnly ? attestation.missingNodes : attestation.mismatchedNodes) > 0 ? 'critical' : 'neutral'}
          />
        </div>
        <MiniMeta label="Source" value={sourceLabel} />
        {attestation.expectedPcr0 ? (
          <MiniMeta label="Expected PCR0" value={compactHash(attestation.expectedPcr0)} title={attestation.expectedPcr0} />
        ) : null}
        {attestation.source === 'published_weight_bundles' && latestNode?.observedPcr0 ? (
          <MiniMeta label="Observed PCR0" value={compactHash(latestNode.observedPcr0)} title={latestNode.observedPcr0} />
        ) : null}
        {attestation.source === 'published_weight_bundles' && (attestation.latestEpoch !== null || latestNode?.gitSha) ? (
          <div className="grid grid-cols-2 gap-2">
            <MiniMeta label="Epoch" value={attestation.latestEpoch === null ? '—' : String(Math.round(attestation.latestEpoch))} />
            <MiniMeta
              label="PCR0 commit"
              value={latestNode?.gitSha ? compactHash(latestNode.gitSha) : '—'}
              title={latestNode?.gitSha ?? undefined}
            />
          </div>
        ) : null}
        {gatewayAcceptance && attestation.acceptanceDetail ? (
          <p className="text-xs leading-relaxed" style={{ color: hasMismatch ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
            {attestation.acceptanceDetail}
          </p>
        ) : null}
        {observationOnly && attestation.sourceAvailable ? (
          <div className="rounded-lg border border-gold-soft bg-gold-soft p-3 text-xs leading-relaxed text-gold">
            Gateway comparison unavailable. {attestation.acceptanceDetail ?? 'The dashboard cannot verify whether the published PCR0 is accepted.'}
          </div>
        ) : null}
        {!attestation.sourceAvailable ? (
          <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            Supabase could not read <span className="font-mono">ops_attestation_current</span> or the published weight-bundle PCR0 fallback.
          </p>
        ) : attestation.nodes.length === 0 ? (
          <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            No attestation rows are reporting.
          </p>
        ) : (
          <div className="space-y-2">
            {attestation.nodes.slice(0, 5).map((node) => (
              <div key={node.id} className="flex items-center justify-between gap-3 border-t pt-2" style={{ borderColor: 'var(--surface-border)' }}>
                <div className="min-w-0">
                  <div className="truncate text-xs" title={node.nodeId} style={{ color: 'var(--text-primary)' }}>{node.component} · {compactHash(node.nodeId)}</div>
                  <div className="mt-1 truncate font-mono text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                    {node.observedPcr0 ? compactHash(node.observedPcr0) : 'missing PCR0'}
                    {node.epoch !== null ? ` · epoch ${Math.round(node.epoch)}` : ''}
                  </div>
                </div>
                <StatePill
                  state={observationOnly
                    ? node.observedPcr0 ? 'healthy' : 'critical'
                    : node.matched === false ? 'critical' : node.matched === null ? 'degraded' : 'healthy'}
                  label={observationOnly
                    ? node.observedPcr0 ? 'Unverified' : 'Missing'
                    : node.matched === false ? 'Mismatch' : node.matched === null ? 'Unverified' : 'Match'}
                  emphasized={node.matched === false}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

function PanelHeader({
  icon,
  title,
  aside,
}: {
  icon: ReactNode
  title: string
  aside?: ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b px-4 py-3" style={{ borderColor: 'var(--surface-border)' }}>
      <div className="flex min-w-0 items-center gap-2">
        {icon}
        <h2 className="truncate text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
          {title}
        </h2>
      </div>
      {aside ? <div className="shrink-0">{aside}</div> : null}
    </div>
  )
}

function MetricBox({
  label,
  value,
  tone = 'neutral',
}: {
  label: string
  value: number | string
  tone?: 'neutral' | 'critical'
}) {
  return (
    <div className="rounded-lg border px-3 py-2" style={{ borderColor: 'var(--surface-border)', background: 'var(--surface-base)' }}>
      <div className="text-[10px] uppercase tracking-[0.12em]" style={{ color: 'var(--text-tertiary)' }}>
        {label}
      </div>
      <div className="mt-1 text-lg font-medium tabular-nums" style={{ color: tone === 'critical' ? 'var(--white)' : 'var(--text-primary)' }}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </div>
    </div>
  )
}

function MiniMeta({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="min-w-0 rounded-lg border px-3 py-2" style={{ borderColor: 'var(--surface-border)', background: 'var(--surface-base)' }}>
      <div className="text-[10px] uppercase tracking-[0.12em]" style={{ color: 'var(--text-tertiary)' }}>{label}</div>
      <div suppressHydrationWarning className="mt-1 truncate font-mono text-[11px]" title={title ?? value} style={{ color: 'var(--text-secondary)' }}>{value}</div>
    </div>
  )
}

function StatePill({
  state,
  label,
  emphasized = false,
}: {
  state: AdminHealthState
  label: string
  emphasized?: boolean
}) {
  return (
    <span
      className={cn('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em]', statePillClass(state))}
      style={emphasized ? {
        borderColor: 'rgba(232, 240, 255, 0.42)',
        background: 'rgba(232, 240, 255, 0.10)',
        color: 'var(--white)',
      } : undefined}
    >
      <span
        className={cn('h-1.5 w-1.5 rounded-full', stateDotClass(state))}
        style={emphasized ? { background: 'var(--white)' } : undefined}
      />
      {label}
    </span>
  )
}

function LoopListSkeleton() {
  return (
    <div className="space-y-px p-1" aria-hidden="true">
      {Array.from({ length: 5 }, (_, index) => (
        <div key={index} className="rounded-lg border border-transparent px-4 py-3">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <Skeleton className="h-3 w-24 bg-white/[0.06] motion-reduce:animate-none" />
                <Skeleton className="h-5 w-16 rounded-full bg-white/[0.05] motion-reduce:animate-none" />
              </div>
              <Skeleton
                className={cn(
                  'mt-3 h-3.5 bg-white/[0.07] motion-reduce:animate-none',
                  index % 2 === 0 ? 'w-4/5' : 'w-2/3',
                )}
              />
              <div className="mt-3 flex gap-1.5">
                <Skeleton className="h-4 w-14 rounded-full bg-white/[0.05] motion-reduce:animate-none" />
                <Skeleton className="h-4 w-20 rounded-full bg-white/[0.05] motion-reduce:animate-none" />
              </div>
            </div>
            <div className="space-y-2">
              <Skeleton className="h-2.5 w-12 bg-white/[0.05] motion-reduce:animate-none" />
              <Skeleton className="h-2.5 w-16 bg-white/[0.05] motion-reduce:animate-none" />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

function RunInspectorSkeleton() {
  return (
    <div aria-hidden="true">
      <div className="border-b p-5" style={{ borderColor: 'var(--surface-border)' }}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex gap-2">
              <Skeleton className="h-5 w-20 rounded-full bg-white/[0.06] motion-reduce:animate-none" />
              <Skeleton className="h-3 w-28 bg-white/[0.05] motion-reduce:animate-none" />
            </div>
            <Skeleton className="mt-4 h-5 w-3/4 bg-white/[0.07] motion-reduce:animate-none" />
            <Skeleton className="mt-2 h-5 w-1/2 bg-white/[0.06] motion-reduce:animate-none" />
            <div className="mt-3 flex gap-2">
              <Skeleton className="h-5 w-16 rounded-full bg-white/[0.05] motion-reduce:animate-none" />
              <Skeleton className="h-5 w-24 rounded-full bg-white/[0.05] motion-reduce:animate-none" />
            </div>
          </div>
          <div className="grid w-full grid-cols-2 gap-2 lg:w-[280px]">
            {Array.from({ length: 4 }, (_, index) => (
              <div
                key={index}
                className="rounded-lg border px-3 py-2"
                style={{
                  borderColor: 'var(--surface-border)',
                  background: 'var(--surface-elevated)',
                }}
              >
                <Skeleton className="h-2.5 w-12 bg-white/[0.05] motion-reduce:animate-none" />
                <Skeleton className="mt-2 h-3 w-20 bg-white/[0.06] motion-reduce:animate-none" />
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="space-y-4 p-5">
        <Skeleton className="h-20 w-full bg-white/[0.045] motion-reduce:animate-none" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton
              key={index}
              className="h-16 w-full bg-white/[0.045] motion-reduce:animate-none"
            />
          ))}
        </div>
        <div className="rounded-lg border p-4" style={{ borderColor: 'var(--surface-border)' }}>
          <Skeleton className="h-3 w-28 bg-white/[0.06] motion-reduce:animate-none" />
          <Skeleton className="mt-4 h-3 w-4/5 bg-white/[0.05] motion-reduce:animate-none" />
          <Skeleton className="mt-3 h-3 w-2/3 bg-white/[0.05] motion-reduce:animate-none" />
          <Skeleton className="mt-3 h-3 w-3/4 bg-white/[0.05] motion-reduce:animate-none" />
        </div>
      </div>
    </div>
  )
}

function LoopButton({
  loop,
  active,
  onSelect,
}: {
  loop: AdminLabLoopSummary
  active: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'block min-w-0 w-full rounded-lg border px-4 py-3 text-left transition-colors',
        active ? 'border-gold-soft bg-gold-soft' : 'border-transparent hover-bg-warm',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate font-mono text-xs" style={{ color: active ? 'var(--gold)' : 'var(--text-secondary)' }}>
              {shortHotkey(loop.minerHotkey)}
            </span>
            <StatusPill label={loop.outcomeLabel} band={loop.outcomeBand} compact />
          </div>
          <div className="mt-2 line-clamp-2 text-sm" style={{ color: 'var(--text-primary)' }}>
            {loop.researchFocusSummary || 'No focus summary'}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {(loop.topicTags.length ? loop.topicTags : [loop.researchArea]).slice(0, 3).map((tag) => (
              <Tag key={tag}>{readableTag(tag)}</Tag>
            ))}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div suppressHydrationWarning className="font-mono text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
            {formatRelative(loop.lastActivityAt)}
          </div>
          <div className="mt-1 font-mono text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
            {loop.candidateCount} cand · {loop.scoredCandidateCount} scored
          </div>
        </div>
      </div>
    </button>
  )
}

function RunSelector({
  runs,
  selectedRunId,
  onSelect,
}: {
  runs: LabTimelineRun[]
  selectedRunId: string | null
  onSelect: (runId: string) => void
}) {
  const selectableRuns = runs.filter((run): run is LabTimelineRun & { runId: string } => Boolean(run.runId))
  if (selectableRuns.length === 0) return null

  return (
    <section className="mb-4 overflow-hidden rounded-lg border" style={{ borderColor: 'var(--surface-border)', background: 'var(--surface-base)' }}>
      <div className="flex items-center justify-between gap-3 border-b px-3 py-2" style={{ borderColor: 'var(--surface-border)' }}>
        <div>
          <div className="text-[10px] uppercase tracking-[0.14em]" style={{ color: 'var(--text-tertiary)' }}>Run scope</div>
          <div className="mt-0.5 text-xs" style={{ color: 'var(--text-secondary)' }}>Every metric and error below is isolated to the selected run.</div>
        </div>
        <span className="shrink-0 font-mono text-[10px]" style={{ color: 'var(--text-tertiary)' }}>{selectableRuns.length} runs</span>
      </div>
      <div className="overflow-x-auto p-2">
        <div className="flex min-w-max gap-2">
          {selectableRuns.map((run, index) => {
            const active = run.runId === selectedRunId
            const latestAt = run.events.at(-1)?.enteredAt
            return (
              <button
                key={run.runId}
                type="button"
                aria-pressed={active}
                onClick={() => onSelect(run.runId)}
                className={cn(
                  'premium-focus min-h-11 w-[210px] rounded-lg border px-3 py-2 text-left transition-colors',
                  active ? 'border-gold-soft bg-gold-soft' : 'hover-bg-warm',
                )}
                style={active ? undefined : { borderColor: 'var(--surface-border)', background: 'var(--surface)' }}
                title={run.runId}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] uppercase tracking-[0.12em]" style={{ color: active ? 'var(--gold)' : 'var(--text-tertiary)' }}>
                    Run {selectableRuns.length - index}
                  </span>
                  {run.isCurrent ? <span className="rounded-full border border-gold-soft px-1.5 py-0.5 text-[9px] uppercase tracking-[0.1em] text-gold">Current</span> : null}
                </div>
                <div className="mt-1 truncate font-mono text-[11px]" style={{ color: 'var(--text-primary)' }}>{run.runId}</div>
                <div suppressHydrationWarning className="mt-1 text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                  {run.events.length} logs{latestAt ? ` · ${formatRelative(latestAt)}` : ''}
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </section>
  )
}

function TimelineView({
  timeline,
  selectedRunId,
  onSelectRun,
}: {
  timeline: LabTimeline
  selectedRunId: string | null
  onSelectRun: (runId: string) => void
}) {
  return (
    <div className="space-y-5">
      {timeline.runs.map((run, index) => (
        <section
          key={run.runId ?? `ticket-${index}`}
          className="rounded-lg border"
          style={{
            borderColor: 'var(--surface-border)',
            background: 'var(--surface-base)',
          }}
        >
          <button
            type="button"
            disabled={!run.runId}
            aria-pressed={Boolean(run.runId && run.runId === selectedRunId)}
            onClick={() => run.runId && onSelectRun(run.runId)}
            className={cn(
              'premium-focus flex w-full flex-wrap items-center justify-between gap-3 border-b px-4 py-3 text-left',
              run.runId ? 'cursor-pointer hover-bg-warm' : 'cursor-default',
              run.runId === selectedRunId ? 'bg-gold-soft' : '',
            )}
            style={{ borderColor: 'var(--surface-border)' }}
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[10px] uppercase tracking-[0.14em]" style={{ color: 'var(--text-tertiary)' }}>
                  {run.runId ? 'Run activity' : 'Ticket activity'}
                </span>
                {run.isCurrent ? (
                  <span className="rounded-full border border-gold-soft bg-gold-soft px-2 py-0.5 text-[10px] uppercase tracking-[0.1em] text-gold">
                    Current run
                  </span>
                ) : null}
              </div>
              <div className="mt-1 truncate font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>
                {run.runId ?? 'Ticket-level events'}
              </div>
              {run.receiptId ? (
                <div className="mt-1 truncate font-mono text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                  Receipt {run.receiptId}
                </div>
              ) : null}
            </div>
            <div className="font-mono text-xs" style={{ color: 'var(--text-tertiary)' }}>
              {run.events.length} logs
            </div>
          </button>
          <div className="border-l px-4 py-2 sm:ml-6" style={{ borderColor: 'var(--surface-border)' }}>
            {run.events.map((event) => (
              <TimelineEvent key={`${event.source ?? 'event'}:${event.id}:${event.enteredAt}`} event={event} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

function TimelineEvent({ event }: { event: LabTimelineEvent }) {
  const metadata = event.metadata ? JSON.stringify(event.metadata, null, 2) : ''
  return (
    <div className="relative py-3 pl-3">
      <span
        className="absolute -left-[21px] top-5 h-2.5 w-2.5 rounded-full border"
        style={{ borderColor: 'var(--surface-border-strong)', background: 'var(--surface-base)' }}
      />
      <div className="grid gap-3 lg:grid-cols-[190px_minmax(0,1fr)]">
        <div className="font-mono text-[11px] leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>
          <div className="uppercase tracking-[0.12em]">{timestampKindLabel(event.timestampKind)}</div>
          <time className="mt-1 block" dateTime={event.enteredAt} style={{ color: 'var(--text-secondary)' }}>
            {formatDateTime(event.enteredAt)}
          </time>
          {event.durationSincePreviousMs !== undefined ? (
            <div className="mt-1" style={{ color: 'var(--text-secondary)' }}>
              +{formatDurationMs(event.durationSincePreviousMs)}
            </div>
          ) : null}
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Tag>{phaseLabel(event.phase)}</Tag>
            {event.status ? <Tag>{readableTag(event.status)}</Tag> : null}
            {event.source ? (
              <span className="font-mono text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                {event.source}
              </span>
            ) : null}
          </div>
          <div className="mt-2 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            {event.stage}
          </div>
          {event.summary ? (
            <p className="mt-1 text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              {event.summary}
            </p>
          ) : null}
          {event.timestampKind === 'projection_written' && event.lastActivityAt ? (
            <p className="mt-1 font-mono text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
              Last activity represented {formatDateTime(event.lastActivityAt)}
            </p>
          ) : null}
          {metadata ? (
            <details className="mt-2">
              <summary className="cursor-pointer text-[11px] font-medium" style={{ color: 'var(--text-tertiary)' }}>
                Raw event detail
              </summary>
              <pre
                className="mt-2 max-h-64 overflow-auto rounded-lg border p-3 text-[11px] leading-relaxed"
                style={{
                  borderColor: 'var(--surface-border)',
                  background: 'rgba(0, 0, 0, 0.22)',
                  color: 'var(--text-secondary)',
                }}
              >
                {metadata}
              </pre>
            </details>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function Stat({
  label,
  value,
  accent,
  loading = false,
}: {
  label: string
  value?: number
  accent?: 'gold'
  loading?: boolean
}) {
  return (
    <div
      className="rounded-xl border p-4"
      style={{
        borderColor: 'var(--surface-border)',
        background: 'var(--surface)',
      }}
    >
      <div className="text-[10px] uppercase tracking-[0.14em]" style={{ color: 'var(--text-tertiary)' }}>
        {label}
      </div>
      {loading ? (
        <Skeleton className="mt-3 h-6 w-12 bg-white/[0.07] motion-reduce:animate-none" />
      ) : (
        <div className={cn('mt-2 text-2xl font-medium leading-none tabular-nums', accent === 'gold' ? 'text-gold' : '')} style={accent ? undefined : { color: 'var(--text-primary)' }}>
          {value === undefined ? '—' : value.toLocaleString()}
        </div>
      )}
    </div>
  )
}

function Meta({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div
      className="min-w-0 rounded-lg border px-3 py-2"
      style={{
        borderColor: 'var(--surface-border)',
        background: 'var(--surface-elevated)',
      }}
    >
      <div className="text-[10px] uppercase tracking-[0.12em]" style={{ color: 'var(--text-tertiary)' }}>
        {label}
      </div>
      <div className="mt-1 truncate font-mono text-[11px]" title={title ?? value} style={{ color: 'var(--text-secondary)' }}>
        {value}
      </div>
    </div>
  )
}

function StatusPill({ label, band, compact = false }: { label: string; band: string; compact?: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border font-medium uppercase tracking-[0.12em]',
        compact ? 'px-1.5 py-0.5 text-[9px]' : 'px-2.5 py-1 text-[10px]',
        statusTone(label, band),
      )}
    >
      {readableTag(label || band || 'unknown')}
    </span>
  )
}

function Tag({ children }: { children: string }) {
  return (
    <span
      className="inline-flex max-w-full rounded-md border px-1.5 py-0.5 text-[10px]"
      style={{
        borderColor: 'var(--surface-border)',
        background: 'var(--surface-elevated)',
        color: 'var(--text-secondary)',
      }}
    >
      <span className="truncate">{children}</span>
    </span>
  )
}

function statusTone(label: string, band: string): string {
  const value = `${label} ${band}`.toLowerCase()
  if (value.includes('promoted') || value.includes('gain') || value.includes('scored')) {
    return 'border-gold-soft bg-gold-soft text-gold'
  }
  if (value.includes('running') || value.includes('queued') || value.includes('scoring')) {
    return 'border-amber-warm-soft bg-amber-warm-soft text-amber-warm'
  }
  if (value.includes('failed') || value.includes('cancelled')) {
    return 'border-burgundy-soft bg-burgundy-soft text-burgundy'
  }
  return 'border-white/10 text-white/60'
}

function healthStateForScoring(state: AdminScoringState): AdminHealthState {
  if (state === 'active' || state === 'idle') return 'healthy'
  if (state === 'paused' || state === 'stalled' || state === 'blocked') return 'degraded'
  if (state === 'unknown') return 'unknown'
  return 'degraded'
}

function stateLabel(state: AdminHealthState): string {
  switch (state) {
    case 'healthy':
      return 'Healthy'
    case 'degraded':
      return 'Degraded'
    case 'critical':
      return 'Critical'
    default:
      return 'Unknown'
  }
}

function statePillClass(state: AdminHealthState): string {
  switch (state) {
    case 'healthy':
      return 'border-gold-soft bg-gold-soft text-gold'
    case 'degraded':
      return 'border-amber-warm-soft bg-amber-warm-soft text-amber-warm'
    case 'critical':
      return 'border-burgundy-soft bg-burgundy-soft text-burgundy'
    default:
      return 'border-white/10 text-white/55'
  }
}

function stateTextClass(state: AdminHealthState): string {
  switch (state) {
    case 'healthy':
      return 'text-gold'
    case 'degraded':
      return 'text-amber-warm'
    case 'critical':
      return 'text-burgundy'
    default:
      return 'text-white/45'
  }
}

function stateDotClass(state: AdminHealthState): string {
  switch (state) {
    case 'healthy':
      return 'bg-[var(--accent-positive)]'
    case 'degraded':
      return 'bg-[var(--accent-pending)]'
    case 'critical':
      return 'bg-[var(--accent-negative)]'
    default:
      return 'bg-white/30'
  }
}

function signalIcon(id: string, state: AdminHealthState) {
  if (id === 'pcr0') return state === 'critical' ? ShieldX : ShieldCheck
  if (id === 'alerts') return state === 'critical' || state === 'degraded' ? AlertTriangle : Siren
  if (id === 'alert_delivery') return state === 'healthy' ? ShieldCheck : Siren
  if (id === 'benchmark') return Database
  if (id === 'freshness') return Clock3
  if (id === 'scoring') return Gauge
  return Activity
}

function compactHash(value: string): string {
  if (!value) return '—'
  if (value.length <= 18) return value
  return `${value.slice(0, 10)}…${value.slice(-6)}`
}

function timestampKindLabel(kind: LabTimelineTimestampKind | undefined): string {
  if (kind === 'projection_written') return 'Projection written'
  if (kind === 'last_activity_represented') return 'Last activity represented'
  return 'Entered stage'
}

function phaseLabel(phase: LabTimelinePhase): string {
  if (phase === 'auto_research') return 'Auto research'
  if (phase === 'public_projection') return 'Public projection'
  return readableTag(phase)
}

function formatDurationMs(value: number): string {
  const totalSeconds = Math.max(0, Math.round(value / 1000))
  if (totalSeconds < 60) return `${totalSeconds}s`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes < 60) return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  if (hours < 24) return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`
  const days = Math.floor(hours / 24)
  const remainingHours = hours % 24
  return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0)
}

function formatCompactUsd(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(Number.isFinite(Number(value)) ? Number(value) : 0)
}

function formatChartDate(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${value}T00:00:00Z`))
}

function formatChartTooltipDate(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${value}T00:00:00Z`))
}

function readableTag(value: string): string {
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function shortId(value: string): string {
  if (!value) return '—'
  if (value.length <= 12) return value
  return `${value.slice(0, 8)}…${value.slice(-4)}`
}

function mergeAdminResearchLabRefresh(
  current: AdminResearchLabPayload,
  refresh: AdminResearchLabRefreshPayload,
): AdminResearchLabPayload {
  const loopsByTicket = new Map(current.loops.map((loop) => [loop.ticketId, loop]))
  const isDefaultFirstPage = (
    current.loopPagination.page === 1 &&
    current.loopPagination.status === 'all' &&
    current.loopPagination.query === ''
  )
  if (isDefaultFirstPage) {
    for (const loop of refresh.recentLoops) loopsByTicket.set(loop.ticketId, loop)
  }
  for (const state of refresh.loopStates) {
    const existing = loopsByTicket.get(state.ticketId)
    if (existing) loopsByTicket.set(state.ticketId, { ...existing, ...state })
  }
  const retainedLoopCount = isDefaultFirstPage
    ? current.loopPagination.pageSize
    : current.loops.length
  const loops = Array.from(loopsByTicket.values())
    .sort((left, right) => Date.parse(right.lastActivityAt) - Date.parse(left.lastActivityAt))
    .slice(0, retainedLoopCount)

  return {
    loops,
    loopPagination: isDefaultFirstPage ? refresh.loopPagination : current.loopPagination,
    loopStatusOptions: isDefaultFirstPage ? refresh.loopStatusOptions : current.loopStatusOptions,
    ops: {
      ...current.ops,
      ...refresh.ops,
      benchmarkRuns: current.ops.benchmarkRuns,
      champions: current.ops.champions,
    },
    stats: refresh.stats,
    fetchedAt: refresh.fetchedAt,
  }
}

function refreshPayloadFromAdminResearchLabOverview(
  overview: AdminResearchLabPayload,
): AdminResearchLabRefreshPayload {
  return {
    recentLoops: overview.loops,
    loopStates: overview.loops,
    loopPagination: overview.loopPagination,
    loopStatusOptions: overview.loopStatusOptions,
    ops: overview.ops,
    stats: overview.stats,
    fetchedAt: overview.fetchedAt,
  }
}

function runSelectionKey(ticketId: string, runId: string | null): string {
  return `${ticketId}:${runId ?? 'current'}`
}

function writeRunSelectionUrl(ticketId: string, runId: string | null): void {
  const url = new URL(window.location.href)
  url.searchParams.set('ticketId', ticketId)
  if (runId) url.searchParams.set('runId', runId)
  else url.searchParams.delete('runId')
  const next = `${url.pathname}${url.search}${url.hash}`
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`
  if (next !== current) window.history.pushState(null, '', next)
}
