import type { SupabaseClient } from '@supabase/supabase-js'

import { getAdminSupabase } from './admin-supabase'
import {
  deliverResearchLabDiscordWebhook,
  sanitizeResearchLabProviderError,
  type ResearchLabDiscordAlertPayload,
} from './research-lab-alert-delivery'
import {
  analyzeResearchLabImprovement,
  RESEARCH_LAB_IMPROVEMENT_MODEL,
  RESEARCH_LAB_IMPROVEMENT_PROMPT_VERSION,
  RESEARCH_LAB_IMPROVEMENT_REASONING_EFFORT,
  type ResearchLabImprovementAnalysisDoc,
  type ResearchLabImprovementEvidence,
} from './research-lab-improvement-analysis'
import { getRuntimeSecretEnvironment } from './runtime-secret-environment'

const EVENT_MONITOR_ID = 'research-lab-events:v1'
const EVENT_MONITOR_LEASE_SECONDS = 180
const EVENT_MONITOR_OWNER = `${process.pid}:${crypto.randomUUID()}`
const ANALYSIS_STALE_AFTER_SECONDS = 30 * 60
const DELIVERY_BATCH_SIZE = 20
const MAX_SOURCE_EVENTS = 2_000
const DASHBOARD_URL_FALLBACK = 'https://subnet71.com/admin#improvement-analyses'

type EventType = 'daily_benchmark_completed' | 'improvement_analysis'
type EventDestination = 'bug_watch' | 'lab_chat'
type EventStatus = 'pending_analysis' | 'analyzing' | 'pending_delivery' | 'delivered'

type EventRow = {
  event_key: string
  event_type: EventType
  source_id: string
  destination: EventDestination
  status: EventStatus
  occurred_at: string
  payload_doc: Record<string, unknown>
  evidence_doc: Record<string, unknown>
  analysis_doc: Record<string, unknown>
  analysis_attempt_count: number
  delivery_attempt_count: number
  next_attempt_at: string
  last_attempt_at: string | null
  last_error: string | null
}

type EventMonitorState = {
  initialized_at: string | null
}

export type ResearchLabEventMonitorResult = Readonly<{
  acquired: boolean
  initialized: boolean
  discoveredCount: number
  deliveryCount: number
  deliveryFailureCount: number
  completedAt: string | null
}>

export type ResearchLabImprovementWorkerResult = Readonly<{
  claimed: boolean
  eventKey: string | null
  analyzed: boolean
  error: string | null
}>

export type ResearchLabEventMonitorDependencies = Readonly<{
  supabase?: SupabaseClient
  env?: Readonly<Record<string, string | undefined>>
  now?: () => Date
  owner?: string
}>

let activeEventRun: Promise<ResearchLabEventMonitorResult> | null = null
let activeAnalysisRun: Promise<ResearchLabImprovementWorkerResult> | null = null

export function runResearchLabEventMonitor(
  dependencies: ResearchLabEventMonitorDependencies = {},
): Promise<ResearchLabEventMonitorResult> {
  if (activeEventRun) return activeEventRun
  activeEventRun = executeEventMonitor(dependencies).finally(() => {
    activeEventRun = null
  })
  return activeEventRun
}

export function runResearchLabImprovementAnalysisWorker(
  dependencies: ResearchLabEventMonitorDependencies = {},
): Promise<ResearchLabImprovementWorkerResult> {
  if (activeAnalysisRun) return activeAnalysisRun
  activeAnalysisRun = executeImprovementWorker(dependencies).finally(() => {
    activeAnalysisRun = null
  })
  return activeAnalysisRun
}

async function executeEventMonitor(
  dependencies: ResearchLabEventMonitorDependencies,
): Promise<ResearchLabEventMonitorResult> {
  const supabase = dependencies.supabase ?? getAdminSupabase()
  const env = dependencies.env ?? getRuntimeSecretEnvironment()
  const now = dependencies.now?.() ?? new Date()
  const nowIso = now.toISOString()
  // Stable ownership lets this worker renew its lease on every configured
  // interval instead of waiting for its own previous lease to expire.
  const owner = dependencies.owner ?? EVENT_MONITOR_OWNER
  const acquired = await claimEventMonitorLease(supabase, owner)
  if (!acquired) return emptyEventMonitorResult(false)

  let discoveredCount = 0
  let deliveryCount = 0
  let deliveryFailureCount = 0
  try {
    const state = await readEventMonitorState(supabase)
    if (!state?.initialized_at) {
      await updateEventMonitorState(supabase, {
        initialized_at: nowIso,
        last_completed_at: nowIso,
        last_error_at: null,
        last_error: null,
        last_discovered_count: 0,
        last_delivery_count: 0,
        heartbeat_doc: {
          activation_watermark: nowIso,
          historical_events_skipped: true,
        },
      })
      return {
        acquired: true,
        initialized: true,
        discoveredCount: 0,
        deliveryCount: 0,
        deliveryFailureCount: 0,
        completedAt: nowIso,
      }
    }

    const discovered = await discoverSourceEvents(supabase, state.initialized_at)
    discoveredCount = discovered.length
    if (discovered.length > 0) {
      const { error } = await supabase
        .from('ops_research_lab_event_notifications')
        .upsert(discovered, { onConflict: 'event_key', ignoreDuplicates: true })
      if (error) throw new Error(`Could not persist Research Lab events: ${error.message}`)
    }

    const delivery = await deliverDueEvents(supabase, env, nowIso)
    deliveryCount = delivery.attempted
    deliveryFailureCount = delivery.failed
    const completedAt = (dependencies.now?.() ?? new Date()).toISOString()
    await updateEventMonitorState(supabase, {
      last_completed_at: completedAt,
      last_error_at: null,
      last_error: null,
      last_discovered_count: discoveredCount,
      last_delivery_count: deliveryCount,
      heartbeat_doc: {
        delivery_failures: deliveryFailureCount,
        pending_analysis: await countEventStatus(supabase, 'pending_analysis'),
        pending_delivery: await countEventStatus(supabase, 'pending_delivery'),
      },
    })
    return {
      acquired: true,
      initialized: false,
      discoveredCount,
      deliveryCount,
      deliveryFailureCount,
      completedAt,
    }
  } catch (error) {
    const failedAt = (dependencies.now?.() ?? new Date()).toISOString()
    await updateEventMonitorState(supabase, {
      last_error_at: failedAt,
      last_error: sanitizeResearchLabProviderError(error),
      last_discovered_count: discoveredCount,
      last_delivery_count: deliveryCount,
      heartbeat_doc: { delivery_failures: deliveryFailureCount },
    }).catch(() => undefined)
    throw error
  }
}

async function executeImprovementWorker(
  dependencies: ResearchLabEventMonitorDependencies,
): Promise<ResearchLabImprovementWorkerResult> {
  const supabase = dependencies.supabase ?? getAdminSupabase()
  const env = dependencies.env ?? getRuntimeSecretEnvironment()
  const { data, error } = await supabase.rpc('claim_ops_research_lab_improvement_analysis', {
    p_stale_after_seconds: ANALYSIS_STALE_AFTER_SECONDS,
  })
  if (error) throw new Error(`Could not claim improvement analysis: ${error.message}`)
  const event = parseEventRow(Array.isArray(data) ? data[0] : data)
  if (!event) return { claimed: false, eventKey: null, analyzed: false, error: null }

  try {
    const evidence = await collectImprovementEvidence(supabase, event.source_id, env)
    const result = await analyzeResearchLabImprovement(evidence, env)
    const analyzedAt = (dependencies.now?.() ?? new Date()).toISOString()
    const { error: updateError } = await supabase
      .from('ops_research_lab_event_notifications')
      .update({
        status: 'pending_delivery',
        evidence_doc: evidence,
        analysis_doc: result.analysis,
        prompt_version: RESEARCH_LAB_IMPROVEMENT_PROMPT_VERSION,
        model: result.model,
        reasoning_effort: RESEARCH_LAB_IMPROVEMENT_REASONING_EFFORT,
        model_response_id: result.responseId,
        model_usage_doc: result.usage,
        next_attempt_at: analyzedAt,
        last_error: null,
        analyzed_at: analyzedAt,
        updated_at: analyzedAt,
      })
      .eq('event_key', event.event_key)
      .eq('status', 'analyzing')
    if (updateError) throw new Error(`Could not persist improvement analysis: ${updateError.message}`)
    return { claimed: true, eventKey: event.event_key, analyzed: true, error: null }
  } catch (error) {
    const detail = sanitizeResearchLabProviderError(error, [env.OPENROUTER_KEY ?? ''])
    const retryAt = new Date(Date.now() + retryDelayMs(event.analysis_attempt_count)).toISOString()
    await supabase
      .from('ops_research_lab_event_notifications')
      .update({
        status: 'pending_analysis',
        next_attempt_at: retryAt,
        last_error: detail,
        updated_at: new Date().toISOString(),
      })
      .eq('event_key', event.event_key)
    return { claimed: true, eventKey: event.event_key, analyzed: false, error: detail }
  }
}

async function claimEventMonitorLease(
  supabase: SupabaseClient,
  owner: string,
): Promise<boolean> {
  const { data, error } = await supabase.rpc('claim_ops_research_lab_event_monitor_lease', {
    p_monitor_id: EVENT_MONITOR_ID,
    p_owner: owner,
    p_lease_seconds: EVENT_MONITOR_LEASE_SECONDS,
  })
  if (error) throw new Error(`Could not claim Research Lab event monitor lease: ${error.message}`)
  return data === true
}

async function readEventMonitorState(
  supabase: SupabaseClient,
): Promise<EventMonitorState | null> {
  const { data, error } = await supabase
    .from('ops_research_lab_event_monitor_state')
    .select('initialized_at')
    .eq('monitor_id', EVENT_MONITOR_ID)
    .maybeSingle()
  if (error) throw new Error(`Could not read Research Lab event monitor state: ${error.message}`)
  if (!data) return null
  return { initialized_at: isoOrNull((data as Record<string, unknown>).initialized_at) }
}

async function updateEventMonitorState(
  supabase: SupabaseClient,
  values: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase
    .from('ops_research_lab_event_monitor_state')
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq('monitor_id', EVENT_MONITOR_ID)
  if (error) throw new Error(`Could not update Research Lab event monitor state: ${error.message}`)
}

async function discoverSourceEvents(
  supabase: SupabaseClient,
  initializedAt: string,
): Promise<Record<string, unknown>[]> {
  const [promotionResult, benchmarkResult] = await Promise.all([
    supabase
      .from('research_lab_candidate_promotion_events')
      .select('promotion_event_id, candidate_id, source_score_bundle_id, private_model_version_id, improvement_points, threshold_points, event_type, promotion_status, created_at')
      .eq('event_type', 'champion_reward_created')
      .eq('promotion_status', 'reward_created')
      .gt('created_at', initializedAt)
      .order('created_at', { ascending: true })
      .limit(MAX_SOURCE_EVENTS),
    supabase
      .from('research_lab_private_model_benchmark_current')
      .select('benchmark_bundle_id, benchmark_date, private_model_artifact_hash, rolling_window_hash, aggregate_score, current_benchmark_status, current_event_type, current_status_at, created_at')
      .eq('current_benchmark_status', 'completed')
      .gt('current_status_at', initializedAt)
      .order('current_status_at', { ascending: true })
      .limit(MAX_SOURCE_EVENTS),
  ])
  if (promotionResult.error) {
    throw new Error(`Could not read promotion events: ${promotionResult.error.message}`)
  }
  if (benchmarkResult.error) {
    throw new Error(`Could not read completed benchmarks: ${benchmarkResult.error.message}`)
  }

  const rows: Record<string, unknown>[] = []
  for (const value of (promotionResult.data ?? []) as Array<Record<string, unknown>>) {
    const id = stringOrNull(value.promotion_event_id)
    const occurredAt = isoOrNull(value.created_at)
    if (!id || !occurredAt) continue
    rows.push({
      event_key: `improvement:${id}`,
      event_type: 'improvement_analysis',
      source_id: id,
      destination: 'lab_chat',
      status: 'pending_analysis',
      occurred_at: occurredAt,
      payload_doc: compactRecord(value),
      next_attempt_at: occurredAt,
    })
  }
  for (const value of (benchmarkResult.data ?? []) as Array<Record<string, unknown>>) {
    const id = stringOrNull(value.benchmark_bundle_id)
    const occurredAt = isoOrNull(value.current_status_at) ?? isoOrNull(value.created_at)
    if (!id || !occurredAt) continue
    rows.push({
      event_key: `daily-benchmark-completed:${id}`,
      event_type: 'daily_benchmark_completed',
      source_id: id,
      destination: 'lab_chat',
      status: 'pending_delivery',
      occurred_at: occurredAt,
      payload_doc: compactRecord(value),
      next_attempt_at: occurredAt,
    })
  }
  return rows.sort((left, right) => String(left.occurred_at).localeCompare(String(right.occurred_at)))
}

async function deliverDueEvents(
  supabase: SupabaseClient,
  env: Readonly<Record<string, string | undefined>>,
  nowIso: string,
): Promise<{ attempted: number; failed: number }> {
  const { data, error } = await supabase
    .from('ops_research_lab_event_notifications')
    .select('*')
    .eq('status', 'pending_delivery')
    .lte('next_attempt_at', nowIso)
    .order('occurred_at', { ascending: true })
    .limit(DELIVERY_BATCH_SIZE)
  if (error) throw new Error(`Could not read due Research Lab events: ${error.message}`)

  let attempted = 0
  let failed = 0
  for (const raw of data ?? []) {
    const event = parseEventRow(raw)
    if (!event) continue
    attempted += 1
    const webhookUrl = event.destination === 'bug_watch'
      ? env.RESEARCH_LAB_ALERT_DISCORD_WEBHOOK_URL?.trim()
      : env.RESEARCH_LAB_IMPROVEMENT_DISCORD_WEBHOOK_URL?.trim()
    const attempt = event.delivery_attempt_count + 1
    const attemptedAt = new Date().toISOString()

    if (!webhookUrl) {
      failed += 1
      await markDeliveryFailed(
        supabase,
        event,
        attempt,
        attemptedAt,
        `${event.destination === 'bug_watch' ? 'Bug Watch' : 'Lab Chat'} Discord webhook is not configured.`,
      )
      continue
    }

    const payload = event.event_type === 'daily_benchmark_completed'
      ? buildDailyBenchmarkCompletedDiscordPayload(event, env)
      : buildImprovementDiscordPayload(event, env)
    const result = await deliverResearchLabDiscordWebhook({
      webhookUrl,
      payload,
      timeoutMs: parseDeliveryTimeout(env.RESEARCH_LAB_ALERT_TIMEOUT_MS),
    })
    if (result.status === 'sent') {
      const { error: updateError } = await supabase
        .from('ops_research_lab_event_notifications')
        .update({
          status: 'delivered',
          delivery_attempt_count: attempt,
          last_attempt_at: attemptedAt,
          last_error: null,
          delivered_at: attemptedAt,
          updated_at: attemptedAt,
        })
        .eq('event_key', event.event_key)
      if (updateError) throw new Error(`Could not complete event delivery: ${updateError.message}`)
    } else {
      failed += 1
      await markDeliveryFailed(
        supabase,
        event,
        attempt,
        attemptedAt,
        result.error ?? `Discord returned ${result.httpStatus ?? 'an unknown status'}.`,
      )
    }
  }
  return { attempted, failed }
}

async function markDeliveryFailed(
  supabase: SupabaseClient,
  event: EventRow,
  attempt: number,
  attemptedAt: string,
  detail: string,
): Promise<void> {
  const { error } = await supabase
    .from('ops_research_lab_event_notifications')
    .update({
      delivery_attempt_count: attempt,
      last_attempt_at: attemptedAt,
      next_attempt_at: new Date(Date.now() + retryDelayMs(attempt)).toISOString(),
      last_error: sanitizeResearchLabProviderError(detail),
      updated_at: attemptedAt,
    })
    .eq('event_key', event.event_key)
    .eq('status', 'pending_delivery')
  if (error) throw new Error(`Could not record event delivery failure: ${error.message}`)
}

async function collectImprovementEvidence(
  supabase: SupabaseClient,
  promotionEventId: string,
  env: Readonly<Record<string, string | undefined>>,
): Promise<ResearchLabImprovementEvidence> {
  const { data: promotionData, error: promotionError } = await supabase
    .from('research_lab_candidate_promotion_events')
    .select('promotion_event_id, candidate_id, source_score_bundle_id, private_model_version_id, improvement_points, threshold_points, event_type, promotion_status, event_doc, created_at')
    .eq('promotion_event_id', promotionEventId)
    .single()
  if (promotionError || !promotionData) {
    throw new Error(`Could not read promotion evidence: ${promotionError?.message ?? 'missing row'}`)
  }
  const promotion = promotionData as Record<string, unknown>
  const candidateId = requiredString(promotion.candidate_id, 'promotion candidate_id')
  const scoreBundleId = requiredString(promotion.source_score_bundle_id, 'promotion score bundle')

  const [candidateResult, scoreResult, runResult, providerResult, windowResult, versionResult] = await Promise.all([
    supabase
      .from('research_lab_candidate_artifacts')
      .select('candidate_id, miner_hotkey, run_id, ticket_id, candidate_source_diff_hash, candidate_patch_manifest, hypothesis_doc, candidate_build_doc, redacted_public_summary, created_at')
      .eq('candidate_id', candidateId)
      .single(),
    supabase
      .from('research_evaluation_score_bundle_current')
      .select('score_bundle_id, run_id, ticket_id, miner_hotkey, icp_set_hash, scoring_version, evaluator_version, score_bundle_hash, score_bundle_doc, current_event_status, current_status_at, created_at')
      .eq('score_bundle_id', scoreBundleId)
      .single(),
    supabase
      .from('research_lab_scoring_run_current')
      .select('scoring_run_id, scoring_id, run_type, run_attempt, source_run_id, ticket_id, candidate_id, expected_icp_count, scheduler_type, worker_ref, current_run_status, current_status_at, current_retryable, current_failure_category, current_telemetry_degraded, started_at, last_heartbeat_at, finished_at, observed_runtime_seconds, created_at')
      .eq('candidate_id', candidateId)
      .order('created_at', { ascending: false })
      .limit(20),
    supabase
      .from('research_lab_provider_cost_events')
      .select('provider, endpoint, status_code, cap_state, icp_ref, created_at')
      .eq('candidate_id', candidateId)
      .order('created_at', { ascending: false })
      .limit(500),
    supabase
      .from('research_lab_rolling_icp_windows')
      .select('rolling_window_hash, window_doc, created_at')
      .order('created_at', { ascending: false })
      .limit(30),
    supabase
      .from('research_lab_private_model_version_current')
      .select('private_model_version_id, git_commit_sha, branch, build_id, current_version_status, activated_at, version_doc')
      .eq('private_model_version_id', stringOrNull(promotion.private_model_version_id) ?? '')
      .maybeSingle(),
  ])

  if (candidateResult.error || !candidateResult.data) {
    throw new Error(`Could not read candidate source evidence: ${candidateResult.error?.message ?? 'missing row'}`)
  }
  if (scoreResult.error || !scoreResult.data) {
    throw new Error(`Could not read scoring evidence: ${scoreResult.error?.message ?? 'missing row'}`)
  }
  const candidate = candidateResult.data as Record<string, unknown>
  const score = scoreResult.data as Record<string, unknown>
  const scoreDoc = recordOrEmpty(score.score_bundle_doc)
  const aggregates = recordOrEmpty(scoreDoc.aggregates)
  const privateGate = recordOrEmpty(scoreDoc.private_holdout_gate)
  const scoringHealth = recordOrEmpty(scoreDoc.scoring_health)
  const icpMetadata = buildIcpMetadata(windowResult.error ? [] : windowResult.data ?? [])
  const perIcp = arrayOfRecords(aggregates.per_icp_results ?? scoreDoc.per_icp_results)
    .map((row) => compactIcpResult(row, icpMetadata))
  const helped = perIcp
    .filter((row) => numberOrNull(row.deltaVsBase) !== null && Number(row.deltaVsBase) > 0)
    .sort((left, right) => Number(right.deltaVsBase) - Number(left.deltaVsBase))
    .slice(0, 12)
  const regressions = perIcp
    .filter((row) => numberOrNull(row.deltaVsBase) !== null && Number(row.deltaVsBase) < 0)
    .sort((left, right) => Number(left.deltaVsBase) - Number(right.deltaVsBase))
    .slice(0, 8)

  const patchManifest = recordOrEmpty(candidate.candidate_patch_manifest)
  const patchDoc = recordOrEmpty(patchManifest.patch_doc)
  const hypothesis = recordOrEmpty(candidate.hypothesis_doc)
  const buildDoc = recordOrEmpty(candidate.candidate_build_doc)
  const providerRows = providerResult.error ? [] : (providerResult.data ?? []) as Array<Record<string, unknown>>
  const runRows = runResult.error ? [] : (runResult.data ?? []) as Array<Record<string, unknown>>

  return Object.freeze({
    promotion: Object.freeze({
      promotionEventId,
      candidateId,
      scoreBundleId,
      minerHotkey: shortIdentifier(stringOrNull(candidate.miner_hotkey) ?? stringOrNull(score.miner_hotkey)),
      improvementPoints: numberOrNull(promotion.improvement_points),
      thresholdPoints: numberOrNull(promotion.threshold_points),
      promotedAt: isoOrNull(promotion.created_at),
    }),
    sourceChange: Object.freeze({
      repository: env.SOURCING_MODEL_REPOSITORY_URL?.trim() || 'tasnimuldatascience/Sourcing_model',
      direction: stringOrNull(patchDoc.lane),
      publicSummary: stringOrNull(candidate.redacted_public_summary),
      targetFiles: stringArray(patchDoc.target_files),
      changedFiles: stringArray(buildDoc.changed_files),
      expectedImprovement: stringOrNull(patchDoc.expected_improvement),
      mechanism: stringOrNull(hypothesis.mechanism),
      failureMode: stringOrNull(hypothesis.failure_mode),
      candidateSourceDiffHash: stringOrNull(candidate.candidate_source_diff_hash),
      sourceValidation: compactRecord(recordOrEmpty(buildDoc.build_validation)),
      promotedVersion: compactRecord(versionResult.error ? {} : versionResult.data ?? {}),
    }),
    scoring: Object.freeze({
      scoreBundleId,
      scoringVersion: stringOrNull(score.scoring_version),
      evaluatorVersion: stringOrNull(score.evaluator_version),
      bundleStatus: stringOrNull(score.current_event_status),
      candidateScore: numberOrNull(aggregates.candidate_score) ?? numberOrNull(privateGate.candidate_total_score),
      baselineScore: numberOrNull(privateGate.baseline_aggregate_score),
      deltaVsDailyBaseline: numberOrNull(privateGate.candidate_delta_vs_daily_baseline),
      holdoutDecision: stringOrNull(privateGate.decision),
      publicIcpCount: numberOrNull(privateGate.public_icp_count),
      privateIcpCount: numberOrNull(privateGate.private_holdout_icp_count),
      scoringHealth: compactScoringHealth(scoringHealth),
      regressions,
    }),
    helpedIcpCandidates: Object.freeze(helped),
    runtimeTelemetry: Object.freeze({
      source: 'Supabase records persisted by loop/scoring hosts',
      scoringRuns: runRows.map(compactScoringRun),
      providerRequests: summarizeProviderRows(providerRows),
    }),
    provenance: Object.freeze({
      collectedAt: new Date().toISOString(),
      promptVersion: RESEARCH_LAB_IMPROVEMENT_PROMPT_VERSION,
      model: RESEARCH_LAB_IMPROVEMENT_MODEL,
      reasoningEffort: RESEARCH_LAB_IMPROVEMENT_REASONING_EFFORT,
      sources: [
        'research_lab_candidate_promotion_events',
        'research_lab_candidate_artifacts',
        'research_evaluation_score_bundle_current',
        'research_lab_scoring_run_current',
        'research_lab_provider_cost_events',
        'research_lab_rolling_icp_windows',
        'research_lab_private_model_version_current',
      ],
      sshPolicy: 'No SSH credential is exposed to the dashboard; host-emitted durable telemetry is used.',
    }),
  })
}

export function buildDailyBenchmarkCompletedDiscordPayload(
  event: Pick<EventRow, 'event_key' | 'occurred_at' | 'payload_doc'>,
  env: Readonly<Record<string, string | undefined>> = process.env,
): ResearchLabDiscordAlertPayload {
  const doc = event.payload_doc
  const dashboardUrl = getDashboardUrl(env)
  const score = numberOrNull(doc.aggregate_score)
  return Object.freeze({
    username: env.RESEARCH_LAB_IMPROVEMENT_DISCORD_USERNAME?.trim() || 'Leadpoet Lab Watch',
    allowed_mentions: Object.freeze({ parse: Object.freeze([]) }),
    embeds: Object.freeze([Object.freeze({
      title: 'Daily benchmark finished',
      description: `The daily private-model benchmark completed${stringOrNull(doc.benchmark_date) ? ` for ${stringOrNull(doc.benchmark_date)}` : ''}.`,
      url: dashboardUrl,
      color: 0x16a34a,
      fields: Object.freeze([
        Object.freeze({ name: 'Aggregate score', value: score === null ? 'Not reported' : score.toFixed(3), inline: true }),
        Object.freeze({ name: 'Status', value: stringOrNull(doc.current_benchmark_status) ?? 'completed', inline: true }),
        Object.freeze({ name: 'Benchmark bundle', value: codeValue(stringOrNull(doc.benchmark_bundle_id)), inline: false }),
        Object.freeze({ name: 'Dashboard', value: `[Open Research Lab admin](${dashboardUrl})`, inline: false }),
      ]),
      footer: Object.freeze({ text: truncate(`Event: ${event.event_key}`, 2_048) }),
      timestamp: event.occurred_at,
    })]),
  })
}

export function buildImprovementDiscordPayload(
  event: Pick<EventRow, 'event_key' | 'occurred_at' | 'payload_doc' | 'analysis_doc'>,
  env: Readonly<Record<string, string | undefined>> = process.env,
): ResearchLabDiscordAlertPayload {
  const analysis = parseStoredAnalysis(event.analysis_doc)
  const dashboardUrl = getDashboardUrl(env)
  const points = numberOrNull(event.payload_doc.improvement_points)
  const helped = analysis.helpedIcps.length > 0
    ? analysis.helpedIcps.slice(0, 6).map((icp) => {
        const delta = icp.deltaVsBase === null ? '' : ` (${signed(icp.deltaVsBase)})`
        return `• ${icp.icpLabel}${delta}: ${icp.whyItHelped}`
      }).join('\n')
    : 'No specific helped ICP was supported by the supplied evidence.'
  return Object.freeze({
    username: env.RESEARCH_LAB_IMPROVEMENT_DISCORD_USERNAME?.trim() || 'Leadpoet Lab Watch',
    allowed_mentions: Object.freeze({ parse: Object.freeze([]) }),
    embeds: Object.freeze([Object.freeze({
      title: `Model improvement analyzed${points === null ? '' : ` · ${signed(points)} points`}`,
      description: truncate(analysis.summary, 4_096),
      url: dashboardUrl,
      color: verdictColor(analysis.genuineImprovement),
      fields: Object.freeze([
        Object.freeze({ name: 'Miner direction', value: truncate(analysis.minerDirection, 1_024), inline: false }),
        Object.freeze({ name: 'Improvement made', value: truncate(analysis.improvementMade, 1_024), inline: false }),
        Object.freeze({ name: 'Helped ICPs', value: truncate(helped, 1_024), inline: false }),
        Object.freeze({ name: `Assessment · ${analysis.genuineImprovement.replace('_', ' ')}`, value: truncate(analysis.genuineAssessment, 1_024), inline: false }),
        Object.freeze({ name: 'Dashboard', value: `[Open stored analysis](${dashboardUrl})`, inline: false }),
      ]),
      footer: Object.freeze({ text: truncate(`Sol xhigh · ${event.event_key}`, 2_048) }),
      timestamp: event.occurred_at,
    })]),
  })
}

function buildIcpMetadata(rows: readonly Record<string, unknown>[]): Map<string, string> {
  const metadata = new Map<string, string>()
  for (const row of rows) {
    const doc = recordOrEmpty(row.window_doc)
    for (const set of arrayOfRecords(doc.sets)) {
      for (const icp of arrayOfRecords(set.selected_icps)) {
        const ref = stringOrNull(icp.icp_ref)
        if (!ref || metadata.has(ref)) continue
        const label = [stringOrNull(icp.industry), stringOrNull(icp.sub_industry)]
          .filter(Boolean)
          .join(' · ')
        metadata.set(ref, label || ref)
      }
    }
  }
  return metadata
}

function compactIcpResult(
  row: Record<string, unknown>,
  metadata: Map<string, string>,
): Record<string, unknown> {
  const ref = stringOrNull(row.icp_ref) ?? 'unknown ICP'
  return {
    icpRef: ref,
    icpLabel: metadata.get(ref) ?? ref,
    deltaVsBase: numberOrNull(row.delta_vs_base),
    candidateScore: numberOrNull(row.candidate_per_icp_score),
    baselineScore: numberOrNull(row.base_per_icp_score),
    status: stringOrNull(row.status),
    providerExcluded: row.provider_excluded === true,
    hardFailure: row.hard_failure === true,
    failureReason: stringOrNull(row.failure_reason),
    evidenceTypes: compactRecord(recordOrEmpty(row.evidence_types)),
    funnel: compactRecord(recordOrEmpty(row.funnel)),
  }
}

function compactScoringRun(row: Record<string, unknown>): Record<string, unknown> {
  return {
    scoringRunId: stringOrNull(row.scoring_run_id),
    runType: stringOrNull(row.run_type),
    attempt: numberOrNull(row.run_attempt),
    status: stringOrNull(row.current_run_status),
    retryable: row.current_retryable === true,
    failureCategory: stringOrNull(row.current_failure_category),
    telemetryDegraded: row.current_telemetry_degraded === true,
    startedAt: isoOrNull(row.started_at),
    lastHeartbeatAt: isoOrNull(row.last_heartbeat_at),
    finishedAt: isoOrNull(row.finished_at),
    runtimeSeconds: numberOrNull(row.observed_runtime_seconds),
  }
}

function compactScoringHealth(row: Record<string, unknown>): Record<string, unknown> {
  const keys = [
    'health_status',
    'icp_count',
    'timeout_rate',
    'provider_error_rate',
    'invalid_output_rate',
    'candidate_zero_company_rate',
    'provider_excluded_icp_rate',
    'candidate_runtime_success_rate',
    'reference_runtime_success_rate',
    'failure_class_counts',
  ]
  return Object.fromEntries(keys.map((key) => [key, row[key]]).filter(([, value]) => value !== undefined))
}

function summarizeProviderRows(rows: readonly Record<string, unknown>[]): Record<string, unknown> {
  const statuses = new Map<string, number>()
  let errors = 0
  for (const row of rows) {
    const provider = stringOrNull(row.provider) ?? 'unknown'
    const status = numberOrNull(row.status_code)
    const key = `${provider}:${status ?? 'unknown'}`
    statuses.set(key, (statuses.get(key) ?? 0) + 1)
    if (status !== null && status >= 400) errors += 1
  }
  return {
    eventCount: rows.length,
    errorCount: errors,
    byProviderAndStatus: Object.fromEntries(statuses),
  }
}

function parseStoredAnalysis(value: Record<string, unknown>): ResearchLabImprovementAnalysisDoc {
  const helpedIcps = Array.isArray(value.helpedIcps)
    ? value.helpedIcps.map((item) => {
        const row = recordOrEmpty(item)
        return {
          icpRef: stringOrNull(row.icpRef) ?? 'unknown',
          icpLabel: stringOrNull(row.icpLabel) ?? stringOrNull(row.icpRef) ?? 'Unknown ICP',
          deltaVsBase: numberOrNull(row.deltaVsBase),
          whyItHelped: stringOrNull(row.whyItHelped) ?? 'No explanation supplied.',
        }
      })
    : []
  const verdict = String(value.genuineImprovement)
  return {
    summary: stringOrNull(value.summary) ?? 'Improvement analysis completed.',
    minerDirection: stringOrNull(value.minerDirection) ?? 'Not determined',
    improvementMade: stringOrNull(value.improvementMade) ?? 'Not determined',
    helpedIcps,
    genuineImprovement: ['genuine', 'likely', 'uncertain', 'not_genuine'].includes(verdict)
      ? verdict as ResearchLabImprovementAnalysisDoc['genuineImprovement']
      : 'uncertain',
    genuineAssessment: stringOrNull(value.genuineAssessment) ?? 'The evidence was inconclusive.',
    caveats: stringArray(value.caveats),
  }
}

function parseEventRow(value: unknown): EventRow | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  const eventType = row.event_type
  const destination = row.destination
  const status = row.status
  const eventKey = stringOrNull(row.event_key)
  const sourceId = stringOrNull(row.source_id)
  const occurredAt = isoOrNull(row.occurred_at)
  if (
    !eventKey || !sourceId || !occurredAt ||
    !['daily_benchmark_completed', 'improvement_analysis'].includes(String(eventType)) ||
    !['bug_watch', 'lab_chat'].includes(String(destination)) ||
    !['pending_analysis', 'analyzing', 'pending_delivery', 'delivered'].includes(String(status))
  ) return null
  return {
    event_key: eventKey,
    event_type: eventType as EventType,
    source_id: sourceId,
    destination: destination as EventDestination,
    status: status as EventStatus,
    occurred_at: occurredAt,
    payload_doc: recordOrEmpty(row.payload_doc),
    evidence_doc: recordOrEmpty(row.evidence_doc),
    analysis_doc: recordOrEmpty(row.analysis_doc),
    analysis_attempt_count: Math.max(0, Math.trunc(numberOrNull(row.analysis_attempt_count) ?? 0)),
    delivery_attempt_count: Math.max(0, Math.trunc(numberOrNull(row.delivery_attempt_count) ?? 0)),
    next_attempt_at: isoOrNull(row.next_attempt_at) ?? occurredAt,
    last_attempt_at: isoOrNull(row.last_attempt_at),
    last_error: stringOrNull(row.last_error),
  }
}

async function countEventStatus(supabase: SupabaseClient, status: EventStatus): Promise<number> {
  const { count, error } = await supabase
    .from('ops_research_lab_event_notifications')
    .select('*', { count: 'exact', head: true })
    .eq('status', status)
  if (error) return 0
  return count ?? 0
}

function getDashboardUrl(env: Readonly<Record<string, string | undefined>>): string {
  const base = env.RESEARCH_LAB_ALERT_DASHBOARD_URL?.trim() || DASHBOARD_URL_FALLBACK
  return base.includes('#') ? base : `${base}#improvement-analyses`
}

function parseDeliveryTimeout(value: string | undefined): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 10_000
  return Math.min(60_000, Math.max(250, Math.trunc(parsed)))
}

function retryDelayMs(attempt: number): number {
  return Math.min(60 * 60_000, 30_000 * (2 ** Math.max(0, Math.min(attempt - 1, 7))))
}

function verdictColor(verdict: ResearchLabImprovementAnalysisDoc['genuineImprovement']): number {
  if (verdict === 'genuine') return 0x16a34a
  if (verdict === 'likely') return 0x65a30d
  if (verdict === 'not_genuine') return 0xdc2626
  return 0xf59e0b
}

function signed(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(3)}`
}

function codeValue(value: string | null): string {
  return value ? `\`${truncate(value, 1000)}\`` : 'Not reported'
}

function shortIdentifier(value: string | null): string | null {
  if (!value || value.length <= 16) return value
  return `${value.slice(0, 8)}…${value.slice(-6)}`
}

function compactRecord(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined))
}

function recordOrEmpty(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {}
}

function arrayOfRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item)))
    : []
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(stringOrNull).filter((item): item is string => item !== null).slice(0, 50)
    : []
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function requiredString(value: unknown, label: string): string {
  const parsed = stringOrNull(value)
  if (!parsed) throw new Error(`${label} is missing.`)
  return parsed
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function isoOrNull(value: unknown): string | null {
  const parsed = stringOrNull(value)
  if (!parsed) return null
  const date = new Date(parsed)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1))}…`
}

function emptyEventMonitorResult(acquired: boolean): ResearchLabEventMonitorResult {
  return {
    acquired,
    initialized: false,
    discoveredCount: 0,
    deliveryCount: 0,
    deliveryFailureCount: 0,
    completedAt: null,
  }
}
