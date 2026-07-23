// Real-PostgreSQL fixture test for the two dashboard RPCs.
//
// Text assertions prove the migration's shape; THIS test proves execution: it
// boots a throwaway PostgreSQL, applies both migration files verbatim against
// stub schemas, and exercises:
//   - chain aggregation (winners across recycled cycles, score-desc, full fields)
//   - a CYCLIC successor chain terminating (UNION dedup) instead of looping
//   - the oversized-array bound (raw cardinality, duplicate-flood safe)
//   - rejection-histogram parity against a JS port of the former Node logic
//
// Skips (loudly) only when no PostgreSQL server binaries exist; the PR CI
// installs them so this always runs there.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { mkdtemp, rm, readdir } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

function findPgBin() {
  const candidates = []
  const envPath = (process.env.PATH || '').split(':')
  for (const dir of envPath) {
    if (dir && existsSync(join(dir, 'initdb'))) candidates.push(dir)
  }
  for (const root of ['/usr/lib/postgresql', '/opt/homebrew/opt']) {
    if (!existsSync(root)) continue
    for (const entry of readdirSync(root).sort().reverse()) {
      const bin = root === '/usr/lib/postgresql'
        ? join(root, entry, 'bin')
        : join(root, entry, 'bin')
      if (existsSync(join(bin, 'initdb'))) candidates.push(bin)
    }
  }
  for (const dir of candidates) {
    if (['initdb', 'pg_ctl', 'postgres', 'psql'].every((b) => existsSync(join(dir, b)))) {
      return dir
    }
  }
  return null
}

const pgBin = findPgBin()
if (!pgBin) {
  console.error('test-chain-rpcs-postgres: SKIPPED (no PostgreSQL server binaries found)')
  process.exit(0)
}

const freePort = await new Promise((resolvePort) => {
  const srv = createServer()
  srv.listen(0, '127.0.0.1', () => {
    const { port } = srv.address()
    srv.close(() => resolvePort(port))
  })
})

const dataDir = await mkdtemp(join(tmpdir(), 'dash-pg-'))
const sockDir = await mkdtemp('/tmp/dashpg')

function run(cmd, args, opts = {}) {
  const out = spawnSync(join(pgBin, cmd), args, { encoding: 'utf8', ...opts })
  return out
}
function psql(args, inputSql) {
  return run('psql', [
    '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-p', String(freePort),
    '-U', 'postgres', '-d', 'dash', '-qtA', ...args,
  ], inputSql ? { input: inputSql } : {})
}
function mustSql(sql, label) {
  const out = psql(['-c', sql])
  assert.equal(out.status, 0, `${label}: ${out.stderr}`)
  return out.stdout.trim()
}

let started = false
try {
  assert.equal(run('initdb', ['-D', dataDir, '-U', 'postgres', '--auth=trust']).status, 0, 'initdb failed')
  const startOut = run('pg_ctl', [
    '-D', dataDir, '-w', '-t', '30', '-l', join(dataDir, 'log'), '-o',
    `-p ${freePort} -c listen_addresses=127.0.0.1 -c unix_socket_directories=${sockDir}`,
    'start',
  ])
  assert.equal(startOut.status, 0, `pg_ctl start failed: ${startOut.stderr}`)
  started = true
  assert.equal(
    run('psql', ['-h', '127.0.0.1', '-p', String(freePort), '-U', 'postgres', '-d', 'postgres', '-c', 'CREATE DATABASE dash']).status,
    0, 'createdb failed',
  )

  // --- Supabase-compat roles + stub schemas (the columns the RPCs touch) ---
  mustSql(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN;
    CREATE TABLE public.fulfillment_requests (
      request_id UUID PRIMARY KEY,
      successor_request_id UUID,
      num_leads INTEGER,
      status TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE public.fulfillment_score_consensus (
      consensus_id UUID DEFAULT gen_random_uuid(),
      request_id UUID, miner_hotkey TEXT, lead_id TEXT,
      consensus_final_score DOUBLE PRECISION, consensus_rep_score DOUBLE PRECISION,
      any_fabricated BOOLEAN DEFAULT false, is_winner BOOLEAN DEFAULT false,
      is_chain_held BOOLEAN DEFAULT false, reward_pct DOUBLE PRECISION,
      computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      consensus_email_verified BOOLEAN DEFAULT false,
      consensus_person_verified BOOLEAN DEFAULT false,
      consensus_company_verified BOOLEAN DEFAULT false
    );
    CREATE TABLE public.fulfillment_scores (
      request_id UUID, lead_id TEXT, failure_reason TEXT, failure_detail TEXT,
      scored_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `, 'stub schema')

  // --- apply both migrations verbatim ---
  const migDir = resolve('supabase/migrations')
  const migs = (await readdir(migDir)).filter((f) =>
    f.endsWith('_batch_chain_summaries.sql') || f.endsWith('_rejection_reason_histogram.sql')
    || f.endsWith('_fulfillment_graph_summary.sql'))
  assert.equal(migs.length, 3, 'all three RPC migrations present')
  for (const f of migs.sort()) {
    const out = psql(['-f', join(migDir, f)])
    assert.equal(out.status, 0, `migration ${f} failed: ${out.stderr}`)
  }

  // --- fixtures ---
  // Root A with predecessor B (B.successor -> A): chain(A) = {A, B}.
  const A = 'aaaaaaaa-0000-4000-8000-000000000001'
  const B = 'bbbbbbbb-0000-4000-8000-000000000002'
  // Cycle: C <-> D must terminate.
  const C = 'cccccccc-0000-4000-8000-000000000003'
  const D = 'dddddddd-0000-4000-8000-000000000004'
  mustSql(`
    INSERT INTO public.fulfillment_requests VALUES
      ('${A}', NULL,   20, 'open',     now()),
      ('${B}', '${A}', 40, 'recycled', now() - interval '1 day'),
      ('${C}', '${D}', 10, 'open',     now()),
      ('${D}', '${C}',  5, 'recycled', now());
    INSERT INTO public.fulfillment_score_consensus
      (request_id, miner_hotkey, lead_id, consensus_final_score, is_winner, is_chain_held, reward_pct) VALUES
      ('${A}', 'hkA', 'L-a1', 9.0, true,  true,  1.0),
      ('${B}', 'hkB', 'L-b1', 8.0, true,  true,  0.5),  -- winner from the EARLIER cycle
      ('${A}', 'hkA', 'L-a2', 3.0, false, false, NULL),
      ('${C}', 'hkC', 'L-c1', 7.0, true,  false, 0.2);
  `, 'fixtures')

  // --- chain aggregation + full winner fields ---
  const winners = JSON.parse(mustSql(
    `SELECT winners::text FROM public.get_chain_summaries(ARRAY['${A}']::uuid[])`,
    'summaries for A'))
  assert.equal(winners.length, 2, 'winners aggregated across the recycled chain')
  assert.deepEqual(winners.map((w) => w.lead_id), ['L-a1', 'L-b1'], 'score-desc order')
  for (const w of winners) {
    for (const k of ['consensus_id', 'miner_hotkey', 'reward_pct', 'is_winner', 'computed_at']) {
      assert.ok(k in w, `winner rows carry ${k}`)
    }
  }
  const rootLeads = mustSql(
    `SELECT root_num_leads FROM public.get_chain_summaries(ARRAY['${A}']::uuid[])`, 'root leads')
  assert.equal(rootLeads, '40', 'root_num_leads is MAX across the chain')
  const held = mustSql(
    `SELECT held_count FROM public.get_chain_summaries(ARRAY['${A}']::uuid[])`, 'held')
  assert.equal(held, '2', 'held_count across the chain')

  // --- CYCLE terminates and covers both members once ---
  const cyc = mustSql(
    `SELECT held_count, root_num_leads FROM public.get_chain_summaries(ARRAY['${C}']::uuid[])`,
    'cyclic chain must terminate')
  assert.equal(cyc.split('|')[1], '10', 'cycle: MAX(num_leads) over {C,D}')

  // --- oversized raw array rejected (even when all-duplicates) ---
  const flood = Array.from({ length: 101 }, () => `'${A}'`).join(',')
  const overs = psql(['-c', `SELECT count(*) FROM public.get_chain_summaries(ARRAY[${flood}]::uuid[])`])
  assert.notEqual(overs.status, 0, '101-element array (all dups) must be rejected')
  assert.match(overs.stderr, /at most 100 request ids/)
  const oversHist = psql(['-c', `SELECT count(*) FROM public.get_rejection_reason_histogram(ARRAY[${flood}]::uuid[])`])
  assert.notEqual(oversHist.status, 0, 'histogram rejects the flood too')
  // 100 with duplicates is fine.
  const dupOk = Array.from({ length: 100 }, () => `'${A}'`).join(',')
  mustSql(`SELECT count(*) FROM public.get_chain_summaries(ARRAY[${dupOk}]::uuid[])`, '100 dups accepted')

  // --- histogram parity vs a JS port of the former Node logic ---
  mustSql(`
    INSERT INTO public.fulfillment_scores (request_id, lead_id, failure_reason, failure_detail, scored_at) VALUES
      ('${A}', 'L-a2', NULL, 'weak intent evidence', now() - interval '2 min'),
      -- Older explicit reason does NOT override: the former Node dedup keeps the
      -- FIRST (newest) row carrying any reason content; only a no-reason row is
      -- replaced by a later reasoned one. Newest row above wins -> intent detail.
      ('${A}', 'L-a2', 'role_mismatch', NULL,        now() - interval '5 min'),
      ('${A}', 'L-a3', NULL, NULL,                   now()),
      ('${C}', 'L-c2', '  ', 'wrong Location ',      now());
    INSERT INTO public.fulfillment_score_consensus
      (request_id, miner_hotkey, lead_id, consensus_final_score, is_winner) VALUES
      ('${A}', 'hkA', 'L-a3', 2.0, false),
      ('${C}', 'hkC', 'L-c2', 1.0, false);
  `, 'histogram fixtures')

  function jsReason(fr, fd) {
    const r = (fr ?? '').trim()
    if (r) return r
    const d = (fd ?? '').toLowerCase()
    if (d.includes('intent')) return 'insufficient_intent'
    if (d.includes('geography') || d.includes('location')) return 'geography_mismatch'
    if (d.includes('role')) return 'role_mismatch'
    if (d.includes('industry')) return 'industry_mismatch'
    if (d.includes('country')) return 'country_mismatch'
    if (d.includes('email')) return 'truelist_inline_verification'
    return 'not_selected'
  }
  // Former Node pipeline: chain winners override is_winner; one score row per
  // (rid,lead) — newest wins unless it lacks reason content and a later-seen
  // (older) row has some. Non-winners for [A, C]: L-a2 (newest row's intent
  // detail wins), L-a3 (no score row -> not_selected), L-c2 (blank reason,
  // detail 'Location' -> geography_mismatch).
  const expected = { insufficient_intent: 1, not_selected: 1, geography_mismatch: 1 }
  const histRows = mustSql(
    `SELECT reason || '=' || count FROM public.get_rejection_reason_histogram(ARRAY['${A}','${C}']::uuid[]) ORDER BY reason`,
    'histogram')
  const got = {}
  for (const line of histRows.split('\n').filter(Boolean)) {
    const [reason, count] = line.split('=')
    got[reason] = Number(count)
  }
  assert.deepEqual(got, expected, `histogram parity (js port): got ${JSON.stringify(got)}`)
  // Sanity: the JS port itself categorizes the fixtures the same way.
  assert.equal(jsReason('role_mismatch', null), 'role_mismatch')
  assert.equal(jsReason('  ', 'wrong Location '), 'geography_mismatch')
  assert.equal(jsReason(null, null), 'not_selected')

  // --- graph summary: base aggregates with chain-winner override PLUS the
  // supplemental chain-canonical winners (recycled-chain wins attributed to the
  // first visible request) -- dropping those undercounts wins.
  const gs = mustSql(
    `SELECT miner_hotkey || '=' || lead_count || ':' || win_count
       FROM public.get_fulfillment_graph_summary(ARRAY['${A}']::uuid[]) ORDER BY miner_hotkey`,
    'graph summary for A')
  // Base rows of A: hkA leads L-a1(chain win) L-a2 L-a3 -> 3:1.
  // Supplemental: chain winner L-b1 lives under cycle B (not among A's base
  // rows) -> attributed to A as (hkB, 1 lead, 1 win) like the former merge.
  const gsLines = gs.split('\n').filter(Boolean)
  assert.deepEqual(gsLines, ['hkA=3:1', 'hkB=1:1'], `graph summary groups: ${JSON.stringify(gsLines)}`)
  // Oversized flood rejected before unnest.
  const gsOver = psql(['-c', `SELECT count(*) FROM public.get_fulfillment_graph_summary(ARRAY[${flood}]::uuid[])`])
  assert.notEqual(gsOver.status, 0, 'graph summary rejects a 101-dup flood')

  console.log('test-chain-rpcs-postgres: OK')
} finally {
  if (started) run('pg_ctl', ['-D', dataDir, '-w', '-t', '20', 'stop'])
  await rm(dataDir, { recursive: true, force: true })
  await rm(sockDir, { recursive: true, force: true })
}
