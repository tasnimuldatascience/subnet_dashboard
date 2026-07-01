import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const outDir = await mkdtemp(join(tmpdir(), 'research-lab-timeline-'))

try {
  const tsc = spawnSync(process.execPath, [
    resolve('node_modules/typescript/bin/tsc'),
    resolve('src/lib/research-lab-timeline.ts'),
    '--target',
    'ES2022',
    '--module',
    'CommonJS',
    '--moduleResolution',
    'Node',
    '--outDir',
    outDir,
    '--strict',
    '--skipLibCheck',
  ], { stdio: 'inherit' })

  assert.equal(tsc.status, 0, 'timeline adapter should compile')

  const require = createRequire(import.meta.url)
  const { buildResearchLabLoopTimeline } = require(join(outDir, 'research-lab-timeline.js'))

  const timeline = buildResearchLabLoopTimeline({
    ticketId: 'ticket-1',
    currentRunId: 'run-b',
    currentReceiptId: 'receipt-b',
    currentLoop: {
      ticketId: 'ticket-1',
      runId: 'run-b',
      receiptId: 'receipt-b',
      minerHotkey: '5abc',
      statusLabel: 'Scoring',
      outcomeLabel: 'scoring',
      submittedAt: '2026-07-01T10:00:00.000Z',
      lastActivityAt: '2026-07-01T10:08:00.000Z',
    },
    sources: [
      {
        source: 'research_lab_auto_research_loop_events',
        phase: 'auto_research',
        rows: [
          {
            id: 'auto-2',
            ticket_id: 'ticket-1',
            run_id: 'run-b',
            event_type: 'patch_drafted',
            created_at: '2026-07-01T10:03:00.000Z',
            seq: 3,
          },
          {
            id: 'auto-1',
            ticket_id: 'ticket-1',
            run_id: 'run-b',
            event_type: 'loop_started',
            created_at: '2026-07-01T10:02:00.000Z',
            seq: 2,
          },
        ],
      },
      {
        source: 'research_loop_run_queue_events',
        phase: 'queue',
        rows: [
          {
            id: 'queue-1',
            ticket_id: 'ticket-1',
            run_id: 'run-b',
            status: 'started',
            created_at: '2026-07-01T10:01:00.000Z',
            seq: 1,
          },
        ],
      },
      {
        source: 'research_lab_public_loop_card_events',
        phase: 'public_projection',
        rows: [
          {
            id: 'projection-1',
            ticket_id: 'ticket-1',
            current_run_id: 'run-b',
            current_outcome_label: 'scoring',
            current_outcome_band: 'running',
            created_at: '2026-07-01T10:05:00.000Z',
            current_last_activity_at: '2026-07-01T10:04:00.000Z',
            event_doc: { projection_reason: 'candidate_queued' },
          },
        ],
      },
      {
        source: 'research_lab_auto_research_loop_events',
        phase: 'auto_research',
        rows: [
          {
            id: 'auto-old',
            ticket_id: 'ticket-1',
            run_id: 'run-a',
            event_type: 'loop_started',
            created_at: '2026-07-01T09:00:00.000Z',
          },
        ],
      },
    ],
  })

  assert.equal(timeline.ticketId, 'ticket-1')
  assert.equal(timeline.currentRunId, 'run-b')
  assert.equal(timeline.runs.length, 3, 'ticket-level events plus two runs should be separated')
  assert.equal(timeline.runs[0].runId, undefined, 'ticket-level events should be separate from run events')

  const currentRun = timeline.runs.find((run) => run.runId === 'run-b')
  assert.ok(currentRun, 'current run should be present')
  assert.equal(currentRun.isCurrent, true, 'current run should be marked')
  assert.deepEqual(
    currentRun.events.map((event) => event.stage),
    ['Started', 'Loop Started', 'Patch Drafted', 'Scoring'],
    'events should render in chronological order inside the selected run',
  )
  assert.equal(currentRun.events[1].durationSincePreviousMs, 60_000)

  const projectionEvent = currentRun.events.find((event) => event.id === 'projection-1')
  assert.ok(projectionEvent, 'public projection event should render')
  assert.equal(projectionEvent.enteredAt, '2026-07-01T10:05:00.000Z')
  assert.equal(projectionEvent.timestampKind, 'projection_written')
  assert.equal(projectionEvent.lastActivityAt, '2026-07-01T10:04:00.000Z')
  assert.equal(
    projectionEvent.metadata.last_activity_represented_at,
    '2026-07-01T10:04:00.000Z',
    'projection metadata should preserve represented activity time separately',
  )

  const fallbackTimeline = buildResearchLabLoopTimeline({
    ticketId: 'ticket-fallback',
    currentRunId: 'run-current',
    currentLoop: {
      ticketId: 'ticket-fallback',
      runId: 'run-current',
      statusLabel: 'Running',
      outcomeLabel: 'running',
      submittedAt: '2026-07-01T11:00:00.000Z',
      lastActivityAt: '2026-07-01T11:10:00.000Z',
    },
  })
  const fallbackProjection = fallbackTimeline.runs
    .flatMap((run) => run.events)
    .find((event) => event.phase === 'public_projection')
  assert.ok(fallbackProjection, 'current projection fallback should render when no event rows exist')
  assert.equal(fallbackProjection.timestampKind, 'last_activity_represented')
  assert.equal(
    fallbackProjection.enteredAt,
    '2026-07-01T11:10:00.000Z',
    'last activity fallback should not be treated as a stage-start timestamp',
  )

  const emptyTimeline = buildResearchLabLoopTimeline({ ticketId: 'ticket-empty' })
  assert.deepEqual(emptyTimeline.runs, [], 'empty timeline should preserve empty state for the UI')

  const componentSource = await readFile(resolve('src/components/dashboard/ResearchLab.tsx'), 'utf8')
  assert.match(componentSource, /<ActivityPanelRow key=\{loop\.cardId\} loop=\{loop\} onSelect=\{setSelectedLoop\}/)
  assert.match(componentSource, /role="button"/)
  assert.match(componentSource, /<LoopTimelineDialog/)
  assert.match(componentSource, /<TimelineStageList events=\{stageEvents\} \/>/)
  assert.match(componentSource, /High-level lifecycle stages with the first public timestamp recorded for each step\./)
  assert.match(componentSource, /<TimelineMeta label="Stages"/)
  assert.doesNotMatch(componentSource, /Raw details/)
  assert.doesNotMatch(componentSource, /timestampKindLabel\(event\.timestampKind\)/)

  const routeSource = await readFile(resolve('src/app/api/research-lab/route.ts'), 'utf8')
  assert.match(routeSource, /summarizePublicLoopTimeline/)
  for (const label of [
    'Submitted',
    'Paid / queued',
    'Run started',
    'Research / patch attempt',
    'Candidate generated',
    'Scoring',
    'Final result / promotion',
  ]) {
    assert.match(routeSource, new RegExp(`label: '${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`))
  }
  assert.match(routeSource, /isCurrentPublicLoopFinal/)

  console.log('research-lab-timeline: adapter and UI wiring fixtures passed')
} finally {
  await rm(outDir, { recursive: true, force: true })
}
