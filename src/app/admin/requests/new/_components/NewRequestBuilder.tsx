'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import {
  AlertCircle,
  CheckCircle2,
  Clipboard,
  Loader2,
  Send,
  Sparkles,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  EMPLOYEE_COUNT_BUCKETS,
  VALID_ROLE_TYPES,
  type EmployeeBucket,
  type RoleType,
} from '@/lib/admin-icp-constants'
import {
  emptyDraft,
  parseFreeFormIcp,
  normalizeIntentSignals,
  type ParsedIcpDraft,
} from '@/lib/admin-icp-parser'
import type { IntentSignalSpec } from '@/lib/admin-supabase'

type SubmitState =
  | { status: 'idle' }
  | { status: 'submitting' }
  | { status: 'success'; response: unknown }
  | { status: 'error'; message: string; details?: unknown }

type ParseState =
  | { status: 'idle' }
  | { status: 'parsing-ai' }
  | { status: 'success'; model?: string }
  | { status: 'error'; message: string; details?: unknown }

function splitMulti(value: string): string[] {
  return value
    .split(/\r?\n|,/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function splitLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function joinMulti(values: string[]): string {
  return values.join('\n')
}

function adminApiUrl(path: string): string {
  // If the operator opened /admin via http://user:pass@localhost:3002,
  // relative fetch URLs inherit that credentialed base URL and browsers
  // reject the request ("Request cannot be constructed from a URL that
  // includes credentials"). window.location.origin strips userinfo while
  // preserving protocol/host/port.
  return new URL(path, window.location.origin).toString()
}

function normalizeDraft(draft: ParsedIcpDraft): ParsedIcpDraft {
  return {
    ...draft,
    prompt: draft.prompt.trim(),
    product_service: draft.product_service.trim(),
    internal_label: draft.internal_label.trim(),
    company: draft.company.trim(),
    geography: draft.geography.trim(),
    target_seniority: draft.target_seniority.trim(),
    industry: draft.industry.map((s) => s.trim()).filter(Boolean),
    sub_industry: draft.sub_industry.map((s) => s.trim()).filter(Boolean),
    target_roles: draft.target_roles.map((s) => s.trim()).filter(Boolean),
    country: draft.country.map((s) => s.trim()).filter(Boolean),
    // Intent signals are structured objects (text + optional required).
    // empty after trim so a stray blank row doesn't reach the gateway.
    intent_signals: draft.intent_signals
      .map((spec) => ({ ...spec, text: spec.text.trim() }))
      .filter((spec) => spec.text.length > 0),
    excluded_companies: draft.excluded_companies.map((s) => s.trim()).filter(Boolean),
    num_leads: Math.max(1, Math.floor(Number(draft.num_leads) || 10)),
  }
}

function validateDraft(draft: ParsedIcpDraft): string[] {
  const errors: string[] = []
  if (!draft.prompt.trim()) errors.push('Prompt is required.')
  if (!draft.product_service.trim()) errors.push('Product / service is required.')
  if (!draft.internal_label.trim()) errors.push('Internal label is required.')
  if (!draft.company.trim()) errors.push('Client company is required.')
  if (!Number.isInteger(draft.num_leads) || draft.num_leads <= 0) {
    errors.push('Number of leads must be a positive integer.')
  }
  return errors
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function companyNameCandidates(company: string): string[] {
  const cleaned = company.trim().replace(/\s+/g, ' ')
  if (!cleaned) return []

  const suffixStripped = cleaned
    .replace(
      /\b(inc\.?|incorporated|llc|l\.l\.c\.|ltd\.?|limited|corp\.?|corporation|co\.?|company|gmbh|s\.?a\.?|s\.?r\.?l\.?)$/i,
      '',
    )
    .trim()

  return [cleaned, suffixStripped]
    .map((name) => name.trim())
    .filter((name, index, arr) => name.length >= 3 && arr.indexOf(name) === index)
}

function containsCompanyName(value: string, candidates: string[]): boolean {
  return candidates.some((candidate) => {
    const escaped = escapeRegExp(candidate)
    // Use soft boundaries so "Acme" matches "Acme," or "Acme's", but
    // does not match inside a longer token.
    return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, 'iu').test(value)
  })
}

function companyMentionWarnings(draft: ParsedIcpDraft): string[] {
  const candidates = companyNameCandidates(draft.company)
  if (candidates.length === 0) return []

  const fields: Array<{ label: string; values: string[] }> = [
    { label: 'Prompt', values: [draft.prompt] },
    { label: 'Product / service', values: [draft.product_service] },
    { label: 'Industries', values: draft.industry },
    { label: 'Sub-industries', values: draft.sub_industry },
    { label: 'Countries', values: draft.country },
    { label: 'Geography', values: [draft.geography] },
    { label: 'Target roles', values: draft.target_roles },
    { label: 'Target seniority', values: [draft.target_seniority] },
    {
      label: 'Intent signals',
      // intent_signals is now an array of structured specs; the
      // company-name leak check only operates on the user-visible text.
      values: draft.intent_signals.map((s) => s.text),
    },
    { label: 'Excluded companies', values: draft.excluded_companies },
  ]

  return fields
    .filter(({ values }) => values.some((value) => containsCompanyName(value, candidates)))
    .map(({ label }) => label)
}

function FieldLabel({
  children,
  hint,
  required = false,
}: {
  children: React.ReactNode
  hint?: string
  required?: boolean
}) {
  return (
    <label className="block">
      <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] font-semibold text-slate-400">
        {children}
        {required && <span className="text-gold">*</span>}
      </span>
      {hint && <span className="mt-1 block text-[11px] text-slate-500 leading-relaxed">{hint}</span>}
    </label>
  )
}

function TextInput({
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  value: string | number
  onChange: (value: string) => void
  placeholder?: string
  type?: string
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="premium-focus mt-2 w-full rounded-lg border border-slate-800/70 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600"
    />
  )
}

function TextArea({
  value,
  onChange,
  placeholder,
  minRows = 3,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  minRows?: number
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={minRows}
      className="premium-focus mt-2 w-full resize-y rounded-lg border border-slate-800/70 bg-slate-950/60 px-3 py-2 text-sm leading-relaxed text-slate-100 placeholder:text-slate-600"
    />
  )
}

function ArrayField({
  label,
  value,
  onChange,
  placeholder,
  hint,
  required,
  splitMode = 'comma-or-newline',
  rows = 3,
  resetKey,
}: {
  label: string
  value: string[]
  onChange: (value: string[]) => void
  placeholder?: string
  hint?: string
  required?: boolean
  splitMode?: 'comma-or-newline' | 'newline'
  rows?: number
  resetKey?: number
}) {
  const [rawValue, setRawValue] = useState(() => joinMulti(value))
  const lastLocalParsedKey = useRef<string | null>(null)
  const lastResetKey = useRef(resetKey)

  const parsedKey = (items: string[]) => items.join('\u0000')

  useEffect(() => {
    const nextKey = parsedKey(value)
    if (lastResetKey.current !== resetKey) {
      lastResetKey.current = resetKey
      lastLocalParsedKey.current = nextKey
      setRawValue(joinMulti(value))
      return
    }
    if (lastLocalParsedKey.current === nextKey) return
    setRawValue(joinMulti(value))
  }, [value, resetKey])

  const parseItems = splitMode === 'newline' ? splitLines : splitMulti
  const displayValues = parseItems(rawValue)

  return (
    <div>
      <FieldLabel hint={hint} required={required}>
        {label}
      </FieldLabel>
      <TextArea
        value={rawValue}
        onChange={(next) => {
          setRawValue(next)
          const parsed = parseItems(next)
          lastLocalParsedKey.current = parsedKey(parsed)
          onChange(parsed)
        }}
        placeholder={placeholder}
        minRows={rows}
      />
      {displayValues.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {displayValues.map((item) => (
            <span
              key={item}
              className="rounded-full border border-slate-800/80 bg-slate-900/50 px-2 py-0.5 text-[10px] text-slate-300"
            >
              {item}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function MultiCheckboxField<T extends string>({
  label,
  values,
  selected,
  onChange,
  hint,
  required,
}: {
  label: string
  values: readonly T[]
  selected: T[]
  onChange: (value: T[]) => void
  hint?: string
  required?: boolean
}) {
  const selectedSet = new Set(selected)
  return (
    <div>
      <FieldLabel hint={hint} required={required}>
        {label}
      </FieldLabel>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {values.map((item) => {
          const active = selectedSet.has(item)
          return (
            <button
              key={item}
              type="button"
              onClick={() => {
                if (active) {
                  onChange(selected.filter((x) => x !== item))
                } else {
                  onChange([...selected, item])
                }
              }}
              className={cn(
                'rounded-full border px-2.5 py-1 text-[11px] transition-colors',
                active
                  ? 'border-gold-strong bg-gold-soft text-gold'
                  : 'border-slate-800/80 bg-slate-950/50 text-slate-400 hover:border-slate-700 hover:text-slate-200',
              )}
            >
              {item}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// =================================================================
// IntentSignalEditor — per-row editor for buyer-side intent signals.
//
// Each row exposes:
//   - The signal phrase (single-line text input).
//   - "Required" toggle  → lead must satisfy this verified signal or
//     fail scoring (missing_required_intent_signal).
//
// Defaults to required=false — same as legacy plain-string signals.
// =================================================================
function IntentSignalEditor({
  value,
  onChange,
  hint,
}: {
  value: IntentSignalSpec[]
  onChange: (next: IntentSignalSpec[]) => void
  hint?: string
}) {
  function updateRow(idx: number, patch: Partial<IntentSignalSpec>) {
    onChange(value.map((spec, i) => (i === idx ? { ...spec, ...patch } : spec)))
  }
  function removeRow(idx: number) {
    onChange(value.filter((_, i) => i !== idx))
  }
  function addRow() {
    onChange([...value, { text: '', required: false }])
  }

  return (
    <div>
      <FieldLabel hint={hint}>Intent signals</FieldLabel>
      <div className="mt-2 space-y-2">
        {value.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-800/80 bg-slate-950/40 px-3 py-2 text-[11px] text-slate-500">
            No intent signals yet. Add at least one observable buying event
            you want miners to verify.
          </p>
        ) : (
          value.map((spec, idx) => (
            <div
              key={idx}
              className="rounded-lg border border-slate-800/70 bg-slate-950/40 p-2"
            >
              <div className="flex items-start gap-2">
                <input
                  type="text"
                  value={spec.text}
                  onChange={(e) => updateRow(idx, { text: e.target.value })}
                  placeholder="e.g. Recently hired a CFO"
                  className="premium-focus flex-1 rounded-md border border-slate-800/70 bg-slate-950/60 px-2.5 py-1.5 text-sm text-slate-100 placeholder:text-slate-600"
                />
                <button
                  type="button"
                  onClick={() => removeRow(idx)}
                  aria-label="Remove signal"
                  title="Remove signal"
                  className="rounded-md border border-slate-800/70 px-2 py-1 text-[11px] text-slate-400 hover:border-burgundy-soft hover:text-burgundy"
                >
                  ×
                </button>
              </div>
              <div className="mt-2 flex flex-wrap gap-3 pl-0.5">
                <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-300">
                  <input
                    type="checkbox"
                    checked={spec.required}
                    onChange={(e) =>
                      updateRow(idx, { required: e.target.checked })
                    }
                    className="h-3.5 w-3.5 accent-gold"
                  />
                  Required
                  <span
                    className="text-[10px] text-slate-500"
                    title="Lead must produce verified evidence for this signal or it fails."
                  >
                    (must pass)
                  </span>
                </label>
                {spec.required ? (
                  <span className="rounded-full border border-gold-soft bg-gold-soft px-2 py-0.5 text-[10px] uppercase tracking-wider text-gold">
                    Mandatory
                  </span>
                ) : null}
              </div>
            </div>
          ))
        )}
      </div>
      <button
        type="button"
        onClick={addRow}
        className="mt-2 rounded-md border border-slate-800/80 bg-slate-950/40 px-3 py-1.5 text-[11px] text-slate-300 hover:border-gold-soft hover:text-gold"
      >
        + Add signal
      </button>
    </div>
  )
}

export function NewRequestBuilder() {
  const [rawIcp, setRawIcp] = useState('')
  const [draft, setDraft] = useState<ParsedIcpDraft>(() => emptyDraft())
  const [submitState, setSubmitState] = useState<SubmitState>({ status: 'idle' })
  const [parseState, setParseState] = useState<ParseState>({ status: 'idle' })
  const [resetKey, setResetKey] = useState(0)

  const normalized = useMemo(() => normalizeDraft(draft), [draft])
  const validationErrors = useMemo(() => validateDraft(normalized), [normalized])
  const privacyWarnings = useMemo(() => companyMentionWarnings(normalized), [normalized])
  const canSubmit = validationErrors.length === 0 && submitState.status !== 'submitting'

  function update<K extends keyof ParsedIcpDraft>(key: K, value: ParsedIcpDraft[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }))
  }

  function clearForm() {
    setRawIcp('')
    setDraft(emptyDraft())
    setParseState({ status: 'idle' })
    setSubmitState({ status: 'idle' })
    setResetKey((key) => key + 1)
  }

  function parsePaste() {
    const parsed = parseFreeFormIcp(rawIcp)
    setDraft(parsed)
    setParseState({ status: 'idle' })
    setSubmitState({ status: 'idle' })
  }

  async function parseWithAi() {
    const text = rawIcp.trim()
    if (!text) return

    setParseState({ status: 'parsing-ai' })
    setSubmitState({ status: 'idle' })
    try {
      const res = await fetch(adminApiUrl('/api/admin/requests/parse'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      const body = await res.json()
      if (!res.ok || !body.success || !body.draft) {
        setParseState({
          status: 'error',
          message: body.error || `AI parse failed with status ${res.status}`,
          details: body.details ?? body,
        })
        return
      }
      // The AI parse route may still return `intent_signals` as a
      // plain ``string[]`` for backward compatibility (the gateway
      // accepts both shapes). Normalize defensively so the form's
      // per-row editor always sees canonical ``IntentSignalSpec[]``
      // ({text, required}) with ``normalizeIntentSignals`` dropping
      // any legacy stray keys.
      const rawDraft = body.draft as ParsedIcpDraft & {
        intent_signals?: unknown
      }
      const coercedDraft: ParsedIcpDraft = {
        ...rawDraft,
        intent_signals: normalizeIntentSignals(rawDraft.intent_signals),
      }
      setDraft(coercedDraft)
      setParseState({ status: 'success', model: body.model })
    } catch (error) {
      setParseState({
        status: 'error',
        message: 'Could not parse ICP with AI.',
        details: error instanceof Error ? error.message : String(error),
      })
    }
  }

  async function submit() {
    const payload = normalizeDraft(draft)
    const errors = validateDraft(payload)
    if (errors.length > 0) {
      setSubmitState({ status: 'error', message: 'Fix the highlighted fields before submitting.', details: errors })
      return
    }

    setSubmitState({ status: 'submitting' })
    try {
      const res = await fetch(adminApiUrl('/api/admin/requests/new'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = await res.json()
      if (!res.ok || !body.success) {
        setSubmitState({
          status: 'error',
          message: body.error || `Request failed with status ${res.status}`,
          details: body.details ?? body,
        })
        return
      }
      setRawIcp('')
      setDraft(emptyDraft())
      setParseState({ status: 'idle' })
      setResetKey((key) => key + 1)
      setSubmitState({ status: 'success', response: body.gateway })
    } catch (error) {
      setSubmitState({
        status: 'error',
        message: 'Could not submit fulfillment request.',
        details: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Link href="/admin" className="text-xs text-slate-500 transition-colors hover:text-gold">
            Back to requests
          </Link>
          <h1 className="mt-2 text-2xl font-medium tracking-tight text-slate-100">New fulfillment request</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            Paste an ICP, generate a structured draft, review every field, then submit to the
            fulfillment gateway. Client company and internal label stay operator-only.
          </p>
        </div>
        <div className="rounded-lg border border-slate-800/70 bg-slate-950/50 px-3 py-2 text-[11px] text-slate-500">
          Gateway submit is proxied server-side with <span className="font-mono text-slate-300">SUPABASE_SECRET_KEY</span>.
        </div>
      </div>

      <section className="rounded-xl border border-slate-800/70 bg-slate-950/40 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-100">Paste ICP</h2>
            <p className="mt-1 text-xs text-slate-500">
              Include client, product, target buyers, industries, geography, employee count, and intent signals.
            </p>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={clearForm}
              disabled={parseState.status === 'parsing-ai' || submitState.status === 'submitting'}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-800/70 bg-slate-950/60 px-3 py-2 text-xs font-medium text-slate-400 transition-colors hover:border-slate-700 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Clear form
            </button>
            <button
              type="button"
              onClick={parsePaste}
              disabled={!rawIcp.trim() || parseState.status === 'parsing-ai'}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-800/70 bg-slate-950/60 px-3 py-2 text-xs font-medium text-slate-300 transition-colors hover:border-slate-700 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Quick parse
            </button>
            <button
              type="button"
              onClick={parseWithAi}
              disabled={!rawIcp.trim() || parseState.status === 'parsing-ai'}
              className="inline-flex items-center gap-1.5 rounded-md border border-gold-soft bg-gold-soft px-3 py-2 text-xs font-medium text-gold transition-colors hover:bg-gold-tint disabled:cursor-not-allowed disabled:opacity-40"
            >
              {parseState.status === 'parsing-ai' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              Parse with AI
            </button>
          </div>
        </div>
        <TextArea
          value={rawIcp}
          onChange={setRawIcp}
          minRows={8}
          placeholder={`Example:\nClient: Acme\nInternal label: 5 Acme CTOs\nProduct: AI workflow automation platform\nTarget: CTOs and VP Engineering at 201-500 employee SaaS companies in the United States\nIntent signals:\n- Hiring AI platform engineers\n- Recently announced automation initiative\n- Migrating legacy workflow tooling\nNeed 10 leads`}
        />
        {parseState.status === 'success' && (
          <div className="mt-3 rounded-lg border border-gold-soft bg-gold-soft px-3 py-2 text-xs text-gold">
            AI parsed the ICP{parseState.model ? ` using ${parseState.model}` : ''}. Review every field before submitting.
          </div>
        )}
        {parseState.status === 'error' && (
          <div className="mt-3 rounded-lg border border-burgundy-soft bg-burgundy-soft px-3 py-2 text-xs text-burgundy">
            <div className="font-medium">{parseState.message}</div>
            {parseState.details !== undefined && (
              <pre className="mt-2 max-h-48 overflow-auto rounded bg-slate-950/50 p-2 text-[11px] text-slate-200">
                {JSON.stringify(parseState.details, null, 2)}
              </pre>
            )}
          </div>
        )}
      </section>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4 rounded-xl border border-slate-800/70 bg-slate-950/40 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-100">Review and edit</h2>
              <p className="mt-1 text-xs text-slate-500">
                The parser is a draft helper. Check taxonomy-sensitive fields before submitting.
              </p>
            </div>
            <Clipboard className="h-4 w-4 text-slate-600" />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <FieldLabel required>Client company</FieldLabel>
              <TextInput value={draft.company} onChange={(v) => update('company', v)} placeholder="Client company" />
            </div>
            <div>
              <FieldLabel required>Internal label</FieldLabel>
              <TextInput value={draft.internal_label} onChange={(v) => update('internal_label', v)} placeholder="5 Client / ICP" />
            </div>
            <div>
              <FieldLabel required>Number of leads</FieldLabel>
              <TextInput
                type="number"
                value={draft.num_leads}
                onChange={(v) => update('num_leads', Number(v))}
                placeholder="10"
              />
            </div>
            <div>
              <FieldLabel>Target seniority</FieldLabel>
              <TextInput value={draft.target_seniority} onChange={(v) => update('target_seniority', v)} placeholder="Leave blank unless uniform" />
            </div>
          </div>

          <div>
            <FieldLabel required hint="Miner-visible context. Company name is scrubbed by the gateway before persistence.">
              Prompt
            </FieldLabel>
            <TextArea value={draft.prompt} onChange={(v) => update('prompt', v)} minRows={5} />
          </div>

          <div>
            <FieldLabel required>Product / service</FieldLabel>
            <TextArea
              value={draft.product_service}
              onChange={(v) => update('product_service', v)}
              minRows={3}
              placeholder="What the client sells"
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <ArrayField
              label="Industries"
              value={draft.industry}
              onChange={(v) => update('industry', v)}
              placeholder="Software"
              hint="Gateway validates these against its live taxonomy."
              resetKey={resetKey}
            />
            <ArrayField
              label="Sub-industries"
              value={draft.sub_industry}
              onChange={(v) => update('sub_industry', v)}
              placeholder="SaaS"
              hint="Must belong to one of the listed industries."
              resetKey={resetKey}
            />
            <ArrayField
              label="Countries"
              value={draft.country}
              onChange={(v) => update('country', v)}
              placeholder="United States"
              resetKey={resetKey}
            />
            <div>
              <FieldLabel>Geography</FieldLabel>
              <TextInput value={draft.geography} onChange={(v) => update('geography', v)} placeholder="Region / state / city if needed" />
            </div>
          </div>

          <ArrayField
            label="Target roles"
            value={draft.target_roles}
            onChange={(v) => update('target_roles', v)}
            placeholder="CTO&#10;VP Engineering&#10;Head of Engineering"
            hint="Seed with 5-15 specific titles. Gateway expands variants."
            rows={4}
            resetKey={resetKey}
          />

          <MultiCheckboxField<RoleType>
            label="Role types"
            values={VALID_ROLE_TYPES}
            selected={draft.target_role_types}
            onChange={(v) => update('target_role_types', v)}
            hint="Must use gateway-valid role types."
          />

          <MultiCheckboxField<EmployeeBucket>
            label="Employee count"
            values={EMPLOYEE_COUNT_BUCKETS}
            selected={draft.employee_count}
            onChange={(v) => update('employee_count', v)}
          />

          <IntentSignalEditor
            value={draft.intent_signals}
            onChange={(v) => update('intent_signals', v)}
            hint="Use concrete observable events miners can verify in page content. Toggle 'Required' to force the lead to satisfy this verified signal (or scoring fails)."
          />

          <ArrayField
            label="Excluded companies"
            value={draft.excluded_companies}
            onChange={(v) => update('excluded_companies', v)}
            placeholder="Optional; one company per line"
            hint="If empty, gateway auto-populates prior delivered companies for the same client."
            resetKey={resetKey}
          />
        </div>

        <aside className="space-y-4">
          <section className="rounded-xl border border-slate-800/70 bg-slate-950/40 p-4">
            <h2 className="text-sm font-semibold text-slate-100">Submit checklist</h2>
            <div className="mt-3 space-y-2">
              {validationErrors.length === 0 ? (
                <div className="flex items-start gap-2 rounded-lg border border-gold-soft bg-gold-soft px-3 py-2 text-xs text-gold">
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  Draft has all required fields.
                </div>
              ) : (
                validationErrors.map((err) => (
                  <div key={err} className="flex items-start gap-2 rounded-lg border border-burgundy-soft bg-burgundy-soft px-3 py-2 text-xs text-burgundy">
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    {err}
                  </div>
                ))
              )}
              {privacyWarnings.length > 0 && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-warm-soft bg-amber-warm-soft px-3 py-2 text-xs text-amber-warm">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <div>
                    <div className="font-medium">Client company name appears outside private fields.</div>
                    <div className="mt-1 text-[11px] leading-relaxed text-slate-300">
                      Check: {privacyWarnings.join(', ')}. The gateway scrubs the exact company string,
                      but review these fields before submitting.
                    </div>
                  </div>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={submit}
              disabled={!canSubmit}
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-gold-strong bg-gold-soft px-4 py-2.5 text-sm font-medium text-gold transition-colors hover:bg-gold-tint disabled:cursor-not-allowed disabled:opacity-40"
            >
              {submitState.status === 'submitting' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              Submit request
            </button>
          </section>

          {submitState.status === 'success' && (
            <section className="rounded-xl border border-gold-soft bg-gold-soft p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-gold">
                <CheckCircle2 className="h-4 w-4" />
                Request submitted
              </div>
              <pre className="mt-3 max-h-64 overflow-auto rounded-lg bg-slate-950/60 p-3 text-[11px] text-slate-200">
                {JSON.stringify(submitState.response, null, 2)}
              </pre>
              <Link href="/admin" className="mt-3 inline-flex text-xs font-medium text-gold hover:text-gold-bright">
                Back to request list
              </Link>
            </section>
          )}

          {submitState.status === 'error' && (
            <section className="rounded-xl border border-burgundy-soft bg-burgundy-soft p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-burgundy">
                <AlertCircle className="h-4 w-4" />
                {submitState.message}
              </div>
              {submitState.details !== undefined && (
                <pre className="mt-3 max-h-64 overflow-auto rounded-lg bg-slate-950/60 p-3 text-[11px] text-slate-200">
                  {JSON.stringify(submitState.details, null, 2)}
                </pre>
              )}
            </section>
          )}

          <details className="rounded-xl border border-slate-800/70 bg-slate-950/40 p-4">
            <summary className="cursor-pointer text-sm font-semibold text-slate-100">Payload preview</summary>
            <pre className="mt-3 max-h-[520px] overflow-auto rounded-lg bg-slate-950/60 p-3 text-[11px] text-slate-300">
              {JSON.stringify(normalized, null, 2)}
            </pre>
          </details>
        </aside>
      </section>
    </div>
  )
}
