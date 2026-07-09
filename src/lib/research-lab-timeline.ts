export type ResearchLabTimelinePhase =
  | 'ticket'
  | 'queue'
  | 'auto_research'
  | 'candidate'
  | 'scoring'
  | 'promotion'
  | 'public_projection'

export type ResearchLabTimelineTimestampKind =
  | 'entered_stage'
  | 'projection_written'
  | 'last_activity_represented'

export type ResearchLabTimelineEvent = {
  id: string
  phase: ResearchLabTimelinePhase
  stage: string
  status?: string
  enteredAt: string
  seq?: number
  source?: string
  summary?: string
  metadata?: Record<string, unknown>
  timestampKind?: ResearchLabTimelineTimestampKind
  lastActivityAt?: string
  runId?: string
  receiptId?: string
  durationSincePreviousMs?: number
}

export type ResearchLabTimelineRun = {
  runId?: string
  receiptId?: string
  isCurrent?: boolean
  events: ResearchLabTimelineEvent[]
}

// Public-safe per-candidate diagnostics shown in the loop timeline dialog.
// Never carries the patch, per-ICP detail, company data, or any external-
// service name/HTTP code — only the outcome a miner can act on.
export type ResearchLabCandidateFunnel = {
  sourced: number
  fit_pass: number
  verified: number
  intent_valid: number
  scored: number
}

// Per-ICP delta breakdown for a scored candidate ("which ICPs moved").
// Privacy contract (mirrors the benchmark visibility split): full per-ICP
// detail ONLY for public-visibility ICPs; sealed-pool ICPs are aggregated to
// movement counts and never itemized. An ICP whose visibility is unknown is
// treated as sealed (fail-closed). Infra/provider-excluded ICPs sit outside
// helped/hurt/flat so provider weather never reads as patch quality.
export type ResearchLabIcpDeltaRow = {
  icp: string
  candidateScore: number
  baseScore: number
  delta: number
  movement: 'helped' | 'hurt' | 'flat' | 'infra'
}

export type ResearchLabIcpDeltaBreakdown = {
  flatBand: number
  publicIcps: ResearchLabIcpDeltaRow[]
  sealed: { helped: number; hurt: number; flat: number; infraExcluded: number }
}

export type ResearchLabCandidateDiagnostic = {
  candidate: string
  status: string
  gate: 'passed' | 'rejected' | ''
  candidateScore: number
  delta: number
  icpCount: number
  externalFailures: number
  funnel?: ResearchLabCandidateFunnel
  icpDeltas?: ResearchLabIcpDeltaBreakdown
}

export type ResearchLabLoopTimeline = {
  ticketId: string
  currentRunId?: string
  runs: ResearchLabTimelineRun[]
  sourceNotes?: string[]
  candidateDiagnostics?: ResearchLabCandidateDiagnostic[]
}

export type ResearchLabTimelineRawRow = Record<string, unknown>

export type ResearchLabTimelineSourceInput = {
  source: string
  phase: ResearchLabTimelinePhase
  rows: ResearchLabTimelineRawRow[]
}

export type ResearchLabTimelineCurrentLoopInput = {
  cardId?: string | null
  ticketId: string
  runId?: string | null
  receiptId?: string | null
  minerHotkey?: string | null
  outcomeLabel?: string | null
  outcomeBand?: string | null
  statusLabel?: string | null
  submittedAt?: string | null
  lastActivityAt?: string | null
  eventDoc?: Record<string, unknown> | null
}

export type ResearchLabTimelineBuildInput = {
  ticketId: string
  currentRunId?: string | null
  currentReceiptId?: string | null
  currentLoop?: ResearchLabTimelineCurrentLoopInput | null
  sources?: ResearchLabTimelineSourceInput[]
  sourceNotes?: string[]
}

const PUBLIC_PROJECTION_SOURCES = new Set([
  'research_lab_public_loop_card_events',
  'research_lab_public_loop_card_current',
])

const SOURCE_PRIORITY: Record<ResearchLabTimelinePhase, number> = {
  ticket: 0,
  queue: 1,
  auto_research: 2,
  candidate: 3,
  scoring: 4,
  promotion: 5,
  public_projection: 6,
}

export function buildResearchLabLoopTimeline(input: ResearchLabTimelineBuildInput): ResearchLabLoopTimeline {
  const events: ResearchLabTimelineEvent[] = []
  const sourceNotes = [...(input.sourceNotes ?? [])]
  const currentRunId = stringOr(input.currentRunId)
  const currentReceiptId = stringOr(input.currentReceiptId)
  const sources = input.sources ?? []
  const hasProjectionEvents = sources.some(
    (source) => source.phase === 'public_projection' && source.rows.length > 0,
  )

  if (input.currentLoop) {
    const submittedAt = isoStringOr(input.currentLoop.submittedAt)
    if (submittedAt) {
      events.push({
        id: `ticket:${input.ticketId}:submitted`,
        phase: 'ticket',
        stage: 'Ticket submitted',
        status: 'submitted',
        enteredAt: submittedAt,
        source: 'research_lab_public_loop_card_current',
        summary: 'Loop ticket was submitted to the Research Lab.',
        timestampKind: 'entered_stage',
        metadata: compactMetadata({
          card_id: input.currentLoop.cardId,
          ticket_id: input.ticketId,
          miner_hotkey: input.currentLoop.minerHotkey,
        }),
      })
    }

    const lastActivityAt = isoStringOr(input.currentLoop.lastActivityAt)
    if (lastActivityAt && !hasProjectionEvents) {
      const stage = stringOr(input.currentLoop.statusLabel) ??
        stringOr(input.currentLoop.outcomeLabel) ??
        'Current projection'
      events.push({
        id: `public_projection:${input.ticketId}:current`,
        phase: 'public_projection',
        stage,
        status: stringOr(input.currentLoop.outcomeLabel),
        enteredAt: lastActivityAt,
        source: 'research_lab_public_loop_card_current',
        summary: 'Current public projection from the latest represented activity.',
        timestampKind: 'last_activity_represented',
        lastActivityAt,
        runId: currentRunId,
        receiptId: currentReceiptId,
        metadata: compactMetadata({
          ticket_id: input.ticketId,
          run_id: currentRunId,
          receipt_id: currentReceiptId,
          outcome_label: input.currentLoop.outcomeLabel,
          outcome_band: input.currentLoop.outcomeBand,
          last_activity_represented_at: lastActivityAt,
          event_doc: sanitizeMetadataValue(input.currentLoop.eventDoc),
        }),
      })
    }
  }

  for (const source of sources) {
    source.rows.forEach((row, index) => {
      const event = normalizeTimelineEventRow({
        row,
        index,
        source: source.source,
        phase: source.phase,
        ticketId: input.ticketId,
        currentRunId,
        currentReceiptId,
      })
      if (event) events.push(event)
    })
  }

  const uniqueEvents = dedupeEvents(events)
  const sortedEvents = uniqueEvents.sort(compareTimelineEvents)
  const runs = groupEventsByRun(sortedEvents, currentRunId)

  return {
    ticketId: input.ticketId,
    currentRunId,
    runs,
    sourceNotes: sourceNotes.length > 0 ? sourceNotes : undefined,
  }
}

function normalizeTimelineEventRow({
  row,
  index,
  source,
  phase,
  ticketId,
  currentRunId,
  currentReceiptId,
}: {
  row: ResearchLabTimelineRawRow
  index: number
  source: string
  phase: ResearchLabTimelinePhase
  ticketId: string
  currentRunId?: string
  currentReceiptId?: string
}): ResearchLabTimelineEvent | null {
  const doc = objectOr(row.event_doc) ??
    objectOr(row.current_event_doc) ??
    objectOr(row.payload) ??
    objectOr(row.doc) ??
    objectOr(row.metadata) ??
    {}
  const projection = phase === 'public_projection' || PUBLIC_PROJECTION_SOURCES.has(source)
  const projectionWrittenAt = isoStringOr(row.created_at)
  const lastActivityAt =
    isoStringOr(row.last_activity_at) ??
    isoStringOr(row.current_last_activity_at) ??
    isoStringOr(doc.last_activity_at) ??
    isoStringOr(doc.current_last_activity_at)
  const enteredAt =
    projection
      ? projectionWrittenAt ?? lastActivityAt
      : projectionWrittenAt ??
        isoStringOr(row.ts) ??
        isoStringOr(row.event_at) ??
        isoStringOr(row.updated_at) ??
        lastActivityAt

  if (!enteredAt) return null

  const timestampKind: ResearchLabTimelineTimestampKind = projection
    ? projectionWrittenAt
      ? 'projection_written'
      : 'last_activity_represented'
    : projectionWrittenAt || isoStringOr(row.ts) || isoStringOr(row.event_at)
      ? 'entered_stage'
      : 'last_activity_represented'
  const runId =
    stringOr(row.run_id) ??
    stringOr(row.current_run_id) ??
    stringOr(doc.run_id) ??
    stringOr(doc.current_run_id) ??
    (phase === 'ticket' ? undefined : currentRunId)
  const receiptId =
    stringOr(row.receipt_id) ??
    stringOr(row.current_receipt_id) ??
    stringOr(doc.receipt_id) ??
    stringOr(doc.current_receipt_id) ??
    (runId === currentRunId ? currentReceiptId : undefined)
  const seq = numberOr(
    row.seq ??
      row.sequence ??
      row.event_seq ??
      row.ordinal ??
      row.tee_sequence ??
      doc.seq ??
      doc.sequence,
  )
  const stageRaw =
    stringOr(row.stage) ??
    stringOr(row.event_type) ??
    stringOr(row.event_name) ??
    stringOr(row.event) ??
    stringOr(row.status) ??
    stringOr(row.current_status) ??
    stringOr(row.current_outcome_label) ??
    stringOr(row.outcome_label) ??
    stringOr(doc.stage) ??
    stringOr(doc.event_type) ??
    stringOr(doc.event_name) ??
    stringOr(doc.status) ??
    stringOr(doc.current_status) ??
    stringOr(doc.current_outcome_label) ??
    defaultStageForPhase(phase)
  const status =
    stringOr(row.status) ??
    stringOr(row.event_status) ??
    stringOr(row.current_status) ??
    stringOr(row.queue_status) ??
    stringOr(row.candidate_status) ??
    stringOr(row.receipt_status) ??
    stringOr(row.public_status) ??
    stringOr(row.result_state) ??
    stringOr(doc.status) ??
    stringOr(doc.event_status) ??
    stringOr(doc.queue_status) ??
    stringOr(doc.candidate_status) ??
    stringOr(doc.receipt_status) ??
    stringOr(doc.public_status) ??
    stringOr(doc.result_state)
  const id =
    stringOr(row.id) ??
    stringOr(row.event_id) ??
    stringOr(row.card_event_id) ??
    stringOr(row.ticket_event_id) ??
    stringOr(row.queue_event_id) ??
    stringOr(row.candidate_event_id) ??
    `${source}:${runId ?? 'ticket'}:${enteredAt}:${seq ?? index}`

  return {
    id,
    phase,
    stage: readableLabel(stageRaw),
    status,
    enteredAt,
    seq,
    source,
    summary: summaryForRow(row, doc),
    metadata: metadataForRow(row, doc, {
      source,
      ticket_id: stringOr(row.ticket_id) ?? stringOr(doc.ticket_id) ?? ticketId,
      run_id: runId,
      receipt_id: receiptId,
      projection_written_at: projectionWrittenAt,
      last_activity_represented_at: lastActivityAt,
    }),
    timestampKind,
    lastActivityAt,
    runId,
    receiptId,
  }
}

function groupEventsByRun(
  events: ResearchLabTimelineEvent[],
  currentRunId: string | undefined,
): ResearchLabTimelineRun[] {
  const groups = new Map<string, ResearchLabTimelineRun>()
  for (const event of events) {
    const key = event.runId ? `run:${event.runId}` : 'ticket'
    const group = groups.get(key) ?? {
      runId: event.runId,
      receiptId: event.receiptId,
      isCurrent: Boolean(event.runId && event.runId === currentRunId),
      events: [],
    }
    if (!group.receiptId && event.receiptId) group.receiptId = event.receiptId
    group.events.push(event)
    groups.set(key, group)
  }

  const runs = Array.from(groups.values())
  for (const run of runs) {
    run.events.sort(compareTimelineEvents)
    for (let i = 1; i < run.events.length; i += 1) {
      const previous = new Date(run.events[i - 1].enteredAt).getTime()
      const current = new Date(run.events[i].enteredAt).getTime()
      if (Number.isFinite(previous) && Number.isFinite(current) && current >= previous) {
        run.events[i].durationSincePreviousMs = current - previous
      }
    }
  }

  return runs.sort((a, b) => {
    if (!a.runId && b.runId) return -1
    if (a.runId && !b.runId) return 1
    if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1
    const aTime = timeValue(a.events[0]?.enteredAt)
    const bTime = timeValue(b.events[0]?.enteredAt)
    return aTime - bTime
  })
}

function compareTimelineEvents(a: ResearchLabTimelineEvent, b: ResearchLabTimelineEvent): number {
  const timeDelta = timeValue(a.enteredAt) - timeValue(b.enteredAt)
  if (timeDelta !== 0) return timeDelta
  const seqDelta = (a.seq ?? Number.MAX_SAFE_INTEGER) - (b.seq ?? Number.MAX_SAFE_INTEGER)
  if (seqDelta !== 0) return seqDelta
  return SOURCE_PRIORITY[a.phase] - SOURCE_PRIORITY[b.phase]
}

function dedupeEvents(events: ResearchLabTimelineEvent[]): ResearchLabTimelineEvent[] {
  const seen = new Set<string>()
  const out: ResearchLabTimelineEvent[] = []
  for (const event of events) {
    const key = `${event.source ?? ''}:${event.id}:${event.enteredAt}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(event)
  }
  return out
}

function metadataForRow(
  row: ResearchLabTimelineRawRow,
  doc: Record<string, unknown>,
  extra: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const metadata = compactMetadata(extra)
  const keys = [
    'id',
    'event_id',
    'ticket_id',
    'run_id',
    'receipt_id',
    'candidate_id',
    'score_bundle_id',
    'model_version_id',
    'status',
    'event_status',
    'event_type',
    'event_name',
    'reason',
    'current_reason',
    'candidate_reason',
    'projection_reason',
    'queue_status',
    'receipt_status',
    'candidate_status',
    'public_status',
    'payment_state',
    'execution_state',
    'candidate_state',
    'result_state',
    'outcome_label',
    'outcome_band',
    'current_outcome_label',
    'current_outcome_band',
    'created_at',
    'updated_at',
    'last_activity_at',
    'current_last_activity_at',
  ]
  for (const key of keys) {
    const rowValue = sanitizeMetadataValue(row[key])
    if (rowValue !== undefined) metadata[key] = rowValue
    const docValue = sanitizeMetadataValue(doc[key])
    if (docValue !== undefined && metadata[`doc_${key}`] === undefined) {
      metadata[`doc_${key}`] = docValue
    }
  }
  return Object.keys(metadata).length > 0 ? metadata : undefined
}

function compactMetadata(input: Record<string, unknown>): Record<string, unknown> {
  const metadata: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    const clean = sanitizeMetadataValue(value)
    if (clean !== undefined) metadata[key] = clean
  }
  return metadata
}

function sanitizeMetadataValue(value: unknown): unknown {
  if (value == null) return undefined
  if (typeof value === 'string') return value.length > 700 ? `${value.slice(0, 700)}...` : value
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) {
    const clean = value
      .slice(0, 12)
      .map(sanitizeMetadataValue)
      .filter((item) => item !== undefined)
    return clean.length > 0 ? clean : undefined
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    const clean: Record<string, unknown> = {}
    for (const [key, nested] of Object.entries(record).slice(0, 20)) {
      const nestedClean = sanitizeMetadataValue(nested)
      if (nestedClean !== undefined) clean[key] = nestedClean
    }
    return Object.keys(clean).length > 0 ? clean : undefined
  }
  return undefined
}

function summaryForRow(row: ResearchLabTimelineRawRow, doc: Record<string, unknown>): string | undefined {
  return stringOr(row.summary) ??
    stringOr(row.message) ??
    stringOr(row.status_detail) ??
    stringOr(row.reason) ??
    stringOr(row.current_reason) ??
    stringOr(doc.summary) ??
    stringOr(doc.message) ??
    stringOr(doc.status_detail) ??
    stringOr(doc.projection_reason) ??
    stringOr(doc.reason) ??
    stringOr(doc.current_reason) ??
    stringOr(doc.candidate_reason)
}

function defaultStageForPhase(phase: ResearchLabTimelinePhase): string {
  switch (phase) {
    case 'ticket':
      return 'Ticket event'
    case 'queue':
      return 'Queue event'
    case 'auto_research':
      return 'Auto-research event'
    case 'candidate':
      return 'Candidate event'
    case 'scoring':
      return 'Scoring event'
    case 'promotion':
      return 'Promotion event'
    case 'public_projection':
      return 'Public projection'
  }
}

function readableLabel(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function objectOr(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function stringOr(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function isoStringOr(value: unknown): string | undefined {
  const text = stringOr(value)
  if (!text) return undefined
  const time = new Date(text).getTime()
  return Number.isFinite(time) ? text : undefined
}

function numberOr(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : undefined
}

function timeValue(value: string | undefined): number {
  const time = new Date(value ?? '').getTime()
  return Number.isFinite(time) ? time : 0
}
