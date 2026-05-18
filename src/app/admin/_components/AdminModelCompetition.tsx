'use client'

import { useEffect, useMemo, useState } from 'react'
import { Check, Code2, Copy, Crown, Loader2, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatDateTime, shortHotkey, statusLabel } from '@/lib/admin-format'

export interface AdminModelCompetitionModel {
  id: string
  minerHotkey: string
  modelName: string
  status: string
  score: number | null
  createdAt: string | null
  evaluatedAt: string | null
  isChampion: boolean
  championAt: string | null
}

export interface AdminModelCompetitionPayload {
  models: AdminModelCompetitionModel[]
  benchmarkHistory?: BenchmarkHistoryEntry[]
  benchmarkError?: string | null
  stats: {
    totalModels: number
    withCode: number
    evaluated: number
    activeChampion: AdminModelCompetitionModel | null
  }
  fetchedAt: string
  startsAt?: string
  benchmarkStartsAt?: string
}

export interface BenchmarkHistoryEntry {
  setId: number
  date: string
  activeFrom: string | null
  activeUntil: string | null
  isActive: boolean
  icpSetHash: string | null
  industryDistribution: Record<string, number> | null
  icps: unknown[]
  icpCount: number
}

function formatScore(score: number | null): string {
  return typeof score === 'number' ? score.toFixed(2) : '—'
}

function statusTone(status: string): string {
  switch (status.toLowerCase()) {
    case 'evaluated':
      return 'border-gold-soft bg-gold-soft text-gold'
    case 'evaluating':
      return 'border-amber-warm-soft bg-amber-warm-soft text-amber-warm'
    case 'submitted':
      return 'border-cream-soft bg-cream-soft text-cream'
    case 'failed':
      return 'border-burgundy-soft bg-burgundy-soft text-burgundy'
    default:
      return 'border-white/10 text-white/60'
  }
}

function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false)

  return (
    <div
      className="overflow-hidden rounded-lg border"
      style={{
        borderColor: 'var(--surface-border)',
        background: 'var(--surface-base)',
      }}
    >
      <div
        className="flex justify-end border-b px-2 py-1.5"
        style={{ borderColor: 'var(--surface-border)' }}
      >
        <button
          type="button"
          onClick={() => {
            navigator.clipboard.writeText(code).then(() => {
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            })
          }}
          className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-[10px] transition-colors hover:text-gold"
          style={{ color: 'var(--text-secondary)' }}
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre
        className="max-h-[560px] overflow-auto p-4 text-[11px] leading-relaxed"
        style={{ color: 'var(--text-primary)' }}
      >
        <code>{code}</code>
      </pre>
    </div>
  )
}

export function AdminModelCompetition({
  payload,
  error,
}: {
  payload: AdminModelCompetitionPayload | null
  error: string | null
}) {
  const [activeTab, setActiveTab] = useState<'models' | 'benchmarks'>('models')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(
    payload?.models[0]?.id ?? null,
  )
  const [activeFile, setActiveFile] = useState<string | null>(null)
  const [codeByModel, setCodeByModel] = useState<Record<string, Record<string, string> | null>>({})
  const [scoreBreakdownByModel, setScoreBreakdownByModel] = useState<Record<string, unknown | null>>({})
  const [loadingCodeId, setLoadingCodeId] = useState<string | null>(null)
  const [codeError, setCodeError] = useState<string | null>(null)

  const models = useMemo(() => payload?.models ?? [], [payload?.models])
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return models
    return models.filter((model) =>
      [
        model.modelName,
        model.minerHotkey,
        model.id,
        model.status,
      ].some((value) => value.toLowerCase().includes(q)),
    )
  }, [models, query])

  const selected =
    models.find((model) => model.id === selectedId) ?? filtered[0] ?? null
  const codeFiles = selected ? codeByModel[selected.id] : null
  const fileNames = codeFiles ? Object.keys(codeFiles) : []
  const currentFile =
    activeFile && fileNames.includes(activeFile) ? activeFile : fileNames[0] ?? null
  const loadingSelectedCode = Boolean(selected && loadingCodeId === selected.id)
  const benchmarkHistory = payload?.benchmarkHistory ?? []
  const [selectedSetId, setSelectedSetId] = useState<number | null>(
    benchmarkHistory[0]?.setId ?? null,
  )
  const selectedBenchmark =
    benchmarkHistory.find((entry) => entry.setId === selectedSetId) ??
    benchmarkHistory[0] ??
    null

  useEffect(() => {
    if (!selected) return
    if (Object.prototype.hasOwnProperty.call(codeByModel, selected.id)) return

    let cancelled = false
    setLoadingCodeId(selected.id)
    setCodeError(null)

    fetch(`/api/admin/model-competition/${encodeURIComponent(selected.id)}/code`, {
      cache: 'no-store',
    })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}))
        if (!res.ok) {
          throw new Error(body.error || `Code request failed with ${res.status}`)
        }
        if (!cancelled) {
          setCodeByModel((prev) => ({
            ...prev,
            [selected.id]: body.codeContent ?? null,
          }))
          setScoreBreakdownByModel((prev) => ({
            ...prev,
            [selected.id]: body.scoreBreakdown ?? null,
          }))
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setCodeError(e instanceof Error ? e.message : 'Could not load model code')
          setCodeByModel((prev) => ({ ...prev, [selected.id]: null }))
          setScoreBreakdownByModel((prev) => ({ ...prev, [selected.id]: null }))
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingCodeId(null)
      })

    return () => {
      cancelled = true
    }
  }, [selected, codeByModel])

  return (
    <div className="space-y-6">
      <section>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1
              className="text-2xl font-medium tracking-tight"
              style={{ color: 'var(--text-primary)' }}
            >
              Model Competition
            </h1>
            <p
              className="mt-1 max-w-2xl text-sm"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Admin-only direct Supabase view of qualification models from May 14, 2026 onward. Code is visible immediately, including submissions still inside the public 24-hour lock.
            </p>
          </div>
          {payload?.fetchedAt && (
            <div
              className="rounded-lg border px-3 py-2 text-[11px]"
              style={{
                borderColor: 'var(--surface-border)',
                background: 'var(--surface)',
                color: 'var(--text-tertiary)',
              }}
            >
              Fetched {formatDateTime(payload.fetchedAt)}
            </div>
          )}
        </div>
      </section>

      {error ? (
        <div className="rounded-xl border border-burgundy-soft bg-burgundy-soft p-4 text-sm text-burgundy">
          {error}
        </div>
      ) : null}

      <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
        {[
          { key: 'models' as const, label: 'Models submitted', count: models.length },
          { key: 'benchmarks' as const, label: 'Benchmark history', count: benchmarkHistory.length },
        ].map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-all whitespace-nowrap',
              activeTab === tab.key
                ? 'bg-gold-tint border-gold-strong text-gold'
                : 'border-white/[0.06] hover-bg-warm text-white/55',
            )}
          >
            {tab.label}
            <span className="tabular-nums text-[10px] opacity-70">{tab.count}</span>
          </button>
        ))}
      </div>

      {activeTab === 'models' ? (
        <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Models" value={payload?.stats.totalModels ?? 0} />
        <Stat label="With Code" value={payload?.stats.withCode ?? 0} />
        <Stat label="Evaluated" value={payload?.stats.evaluated ?? 0} />
        <Stat
          label="Champion"
          value={payload?.stats.activeChampion ? 1 : 0}
          accent={payload?.stats.activeChampion ? 'gold' : undefined}
        />
      </div>

      <section className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative max-w-md flex-1">
            <Search
              className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2"
              style={{ color: 'var(--text-tertiary)' }}
            />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search model, hotkey, status..."
              className="premium-focus w-full rounded-lg border px-9 py-2 text-sm placeholder:text-white/30 bg-transparent"
              style={{
                borderColor: 'var(--surface-border)',
                background: 'var(--surface)',
                color: 'var(--text-primary)',
              }}
            />
          </div>
          <div
            className="text-[11px]"
            style={{ color: 'var(--text-tertiary)' }}
          >
            Showing {filtered.length.toLocaleString()} of {models.length.toLocaleString()} models
          </div>
        </div>

        {filtered.length === 0 ? (
          <div
            className="rounded-xl border p-12 text-center text-sm"
            style={{
              borderColor: 'var(--surface-border)',
              background: 'var(--surface)',
              color: 'var(--text-secondary)',
            }}
          >
            No models match the current search.
          </div>
        ) : (
          <div className="space-y-px">
            {filtered.map((model) => {
              const isSelected = selected?.id === model.id
              return (
                <div
                  key={model.id}
                  className="card-lift rounded-xl border px-5 py-4 transition-colors"
                  style={{
                    borderColor: 'var(--surface-border)',
                    background: 'var(--surface)',
                  }}
                >
                <button
                  type="button"
                  onClick={() => {
                    setSelectedId(model.id)
                    setActiveFile(null)
                  }}
                  className="block w-full text-left"
                >
                  <div className="flex flex-wrap items-center gap-5 sm:flex-nowrap">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3
                          className="truncate font-medium"
                          style={{ color: 'var(--text-primary)' }}
                        >
                          {model.modelName}
                        </h3>
                        {model.isChampion && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-gold-soft bg-gold-soft px-2 py-0.5 text-[10px] uppercase tracking-[0.10em] text-gold">
                            <Crown className="h-3 w-3" />
                            Champion
                          </span>
                        )}
                      </div>
                      <div
                        className="mt-1 flex flex-wrap items-center gap-3 text-xs"
                        style={{ color: 'var(--text-secondary)' }}
                      >
                        <span className="font-mono">{shortHotkey(model.minerHotkey)}</span>
                        {model.createdAt && <span>Submitted {formatDateTime(model.createdAt)}</span>}
                        {model.evaluatedAt && <span>Evaluated {formatDateTime(model.evaluatedAt)}</span>}
                      </div>
                    </div>

                    <div className="min-w-[120px] text-right">
                      <div
                        className="text-[10px] uppercase tracking-[0.14em]"
                        style={{ color: 'var(--text-tertiary)' }}
                      >
                        Score
                      </div>
                      <div className="text-xl font-medium tabular-nums text-gold">
                        {formatScore(model.score)}
                      </div>
                    </div>

                    <span
                      className={cn(
                        'inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.14em]',
                        statusTone(model.status),
                      )}
                    >
                      {statusLabel(model.status)}
                    </span>

                    <span
                      className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px]"
                      style={{
                        borderColor: 'var(--surface-border)',
                        background: 'var(--surface-elevated)',
                        color: 'var(--text-secondary)',
                      }}
                    >
                      <Code2 className="h-3 w-3" />
                      {isSelected ? 'Code open' : 'View code'}
                    </span>
                  </div>
                </button>

                {isSelected && (
                  <div
                    className="mt-4 space-y-4 border-t pt-4"
                    style={{ borderColor: 'var(--surface-border)' }}
                  >
                    <div className="grid gap-3 sm:grid-cols-3">
                      <Meta label="Model ID" value={model.id} />
                      <Meta label="Miner hotkey" value={model.minerHotkey || '—'} />
                      <Meta label="Champion at" value={formatDateTime(model.championAt)} />
                    </div>

                    {scoreBreakdownByModel[model.id] ? (
                      <details
                        className="rounded-lg border p-3"
                        style={{
                          borderColor: 'var(--surface-border)',
                          background: 'var(--surface-elevated)',
                        }}
                      >
                        <summary
                          className="cursor-pointer text-xs font-medium"
                          style={{ color: 'var(--text-secondary)' }}
                        >
                          Score breakdown
                        </summary>
                        <pre
                          className="mt-3 max-h-64 overflow-auto rounded p-3 text-[11px]"
                          style={{
                            background: 'var(--surface-base)',
                            color: 'var(--text-secondary)',
                          }}
                        >
                          {JSON.stringify(scoreBreakdownByModel[model.id], null, 2)}
                        </pre>
                      </details>
                    ) : null}

                    <div>
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <div
                          className="text-sm font-medium"
                          style={{ color: 'var(--text-primary)' }}
                        >
                          Model code
                        </div>
                        <div
                          className="text-[11px]"
                          style={{ color: 'var(--text-tertiary)' }}
                        >
                          Admin direct access, no public 24h delay
                        </div>
                      </div>

                      {loadingSelectedCode ? (
                        <div
                          className="rounded-lg border p-8 text-center text-sm"
                          style={{
                            borderColor: 'var(--surface-border)',
                            color: 'var(--text-tertiary)',
                          }}
                        >
                          <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin text-gold" />
                          Loading code directly from Supabase...
                        </div>
                      ) : codeError ? (
                        <div className="rounded-lg border border-burgundy-soft bg-burgundy-soft p-8 text-center text-sm text-burgundy">
                          {codeError}
                        </div>
                      ) : !codeFiles || !currentFile ? (
                        <div
                          className="rounded-lg border p-8 text-center text-sm"
                          style={{
                            borderColor: 'var(--surface-border)',
                            color: 'var(--text-secondary)',
                          }}
                        >
                          No code content stored for this model.
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <div className="flex flex-wrap gap-1.5">
                            {fileNames.map((filename) => (
                              <button
                                key={filename}
                                type="button"
                                onClick={() => setActiveFile(filename)}
                                className={cn(
                                  'rounded-md border px-2.5 py-1.5 text-[11px] font-mono transition-colors',
                                  filename === currentFile
                                    ? 'border-gold-soft bg-gold-soft text-gold'
                                    : 'border-white/[0.06] hover-bg-warm text-white/55',
                                )}
                              >
                                {filename}
                              </button>
                            ))}
                          </div>
                          <CodeBlock code={codeFiles[currentFile]} />
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
              )
            })}
          </div>
        )}
      </section>
        </>
      ) : (
        <BenchmarkHistory
          entries={benchmarkHistory}
          selected={selectedBenchmark}
          selectedSetId={selectedSetId}
          onSelect={setSelectedSetId}
          error={payload?.benchmarkError ?? null}
        />
      )}
    </div>
  )
}

function icpField(icp: unknown, key: string): unknown {
  return icp && typeof icp === 'object' ? (icp as Record<string, unknown>)[key] : undefined
}

function icpText(value: unknown): string {
  if (Array.isArray(value)) return value.map((item) => icpText(item)).filter(Boolean).join(', ')
  if (value && typeof value === 'object') return JSON.stringify(value)
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return ''
}

function BenchmarkHistory({
  entries,
  selected,
  selectedSetId,
  onSelect,
  error,
}: {
  entries: BenchmarkHistoryEntry[]
  selected: BenchmarkHistoryEntry | null
  selectedSetId: number | null
  onSelect: (setId: number) => void
  error: string | null
}) {
  if (error) {
    return (
      <div className="rounded-xl border border-burgundy-soft bg-burgundy-soft p-4 text-sm text-burgundy">
        {error}
      </div>
    )
  }

  if (entries.length === 0) {
    return (
      <div
        className="rounded-xl border p-12 text-center text-sm"
        style={{
          borderColor: 'var(--surface-border)',
          background: 'var(--surface)',
          color: 'var(--text-secondary)',
        }}
      >
        No benchmark ICP sets found from May 13 onward.
      </div>
    )
  }

  return (
    <section className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
      <div
        className="rounded-xl border"
        style={{ borderColor: 'var(--surface-border)', background: 'var(--surface)' }}
      >
        <header className="border-b px-4 py-3" style={{ borderColor: 'var(--surface-border)' }}>
          <h2 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            Benchmark days
          </h2>
          <p className="mt-1 text-xs" style={{ color: 'var(--text-tertiary)' }}>
            Daily ICP prompt sets used to benchmark model submissions.
          </p>
        </header>
        <div className="max-h-[720px] overflow-auto">
          {entries.map((entry) => {
            const active = entry.setId === selectedSetId
            return (
              <button
                key={entry.setId}
                type="button"
                onClick={() => onSelect(entry.setId)}
                className={cn(
                  'block w-full border-b px-4 py-3 text-left transition-colors hover-bg-warm',
                  active ? 'bg-gold-soft/20' : '',
                )}
                style={{ borderColor: 'var(--surface-border)' }}
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                      {entry.date}
                    </div>
                    <div className="mt-1 font-mono text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                      set {entry.setId}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-medium tabular-nums text-gold">
                      {entry.icpCount}
                    </div>
                    <div className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                      prompts
                    </div>
                  </div>
                </div>
                <div className="mt-2 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                  {entry.isActive ? 'Active now' : 'Historical'} · {entry.activeFrom ? formatDateTime(entry.activeFrom) : '—'}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      <div
        className="rounded-xl border"
        style={{ borderColor: 'var(--surface-border)', background: 'var(--surface)' }}
      >
        <header className="border-b px-4 py-3" style={{ borderColor: 'var(--surface-border)' }}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                {selected?.date ?? 'Benchmark'} prompts
              </h2>
              <p className="mt-1 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                {selected?.activeFrom ? `Active ${formatDateTime(selected.activeFrom)} to ${formatDateTime(selected.activeUntil)}` : 'Select a day to inspect prompts.'}
              </p>
            </div>
            {selected?.icpSetHash && (
              <div className="font-mono text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                hash {selected.icpSetHash.slice(0, 16)}...
              </div>
            )}
          </div>
        </header>

        <div className="max-h-[720px] overflow-auto p-4">
          <div className="space-y-3">
            {(selected?.icps ?? []).map((icp, idx) => {
              const prompt = icpText(icpField(icp, 'prompt') ?? icpField(icp, 'buyer_description'))
              return (
                <article
                  key={`${selected?.setId}-${idx}`}
                  className="rounded-lg border p-4"
                  style={{
                    borderColor: 'var(--surface-border)',
                    background: 'var(--surface-elevated)',
                  }}
                >
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                    <div className="font-mono text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                      #{idx + 1} · {icpText(icpField(icp, 'icp_id')) || `icp_${idx + 1}`}
                    </div>
                    <div className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                      {icpText(icpField(icp, 'industry'))}
                      {icpField(icp, 'sub_industry') ? ` / ${icpText(icpField(icp, 'sub_industry'))}` : ''}
                    </div>
                  </div>
                  <p className="text-sm leading-relaxed" style={{ color: 'var(--text-primary)' }}>
                    {prompt || 'No prompt text stored.'}
                  </p>
                  <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                    <Meta label="Target roles" value={icpText(icpField(icp, 'target_roles')) || '—'} />
                    <Meta label="Role types" value={icpText(icpField(icp, 'target_role_types')) || '—'} />
                    <Meta label="Countries" value={icpText(icpField(icp, 'country')) || '—'} />
                    <Meta label="Employee count" value={icpText(icpField(icp, 'employee_count')) || '—'} />
                    <Meta label="Intent signals" value={icpText(icpField(icp, 'intent_signals')) || '—'} />
                    <Meta label="Product/service" value={icpText(icpField(icp, 'product_service')) || '—'} />
                  </div>
                </article>
              )
            })}
          </div>
        </div>
      </div>
    </section>
  )
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string
  value: number
  accent?: 'gold'
}) {
  return (
    <div
      className="rounded-xl border px-4 py-3.5"
      style={{
        borderColor: 'var(--surface-border)',
        background: 'var(--surface)',
      }}
    >
      <div
        className="mb-1.5 text-[10px] uppercase tracking-[0.14em]"
        style={{ color: 'var(--text-tertiary)' }}
      >
        {label}
      </div>
      <div
        className={cn(
          'text-2xl font-medium leading-none tabular-nums',
          accent === 'gold' ? 'text-gold' : '',
        )}
        style={accent === 'gold' ? undefined : { color: 'var(--text-primary)' }}
      >
        {value.toLocaleString()}
      </div>
    </div>
  )
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="rounded-lg border px-3 py-2"
      style={{
        borderColor: 'var(--surface-border)',
        background: 'var(--surface-elevated)',
      }}
    >
      <div
        className="text-[10px] uppercase tracking-[0.12em]"
        style={{ color: 'var(--text-tertiary)' }}
      >
        {label}
      </div>
      <div className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
        {value || '—'}
      </div>
    </div>
  )
}
