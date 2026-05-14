/**
 * Robust JSON parser for OpenRouter Deep Research responses.
 *
 * Real-world LLM output diverges from spec in predictable ways:
 *   - Markdown code fences wrap the JSON ("```json\n{...}\n```")
 *   - Preamble text precedes the JSON ("Here is my analysis:\n{...}")
 *   - Enum values arrive mis-cased ("STRONG" / "client ready")
 *   - Spec keys arrive with drift ("recommended_decision" instead of
 *     "recommended_delivery_decision")
 *
 * The parser normalizes all of those back to canonical values, and
 * returns ``null`` for hard failures (refusal, malformed JSON, empty
 * object) so the worker treats it as a retryable error.
 */

import type {
  DeepResearchAnalysisPayload,
  DeepResearchFinalStatus,
  DeepResearchLead,
  DeepResearchSummary,
} from '@/lib/admin-supabase'

const ICP_FIT_VALUES = new Set(['Strong', 'Borderline', 'Poor'])
const INTENT_FIT_VALUES = new Set(['Strong', 'Borderline', 'Poor'])
const CONFIDENCE_VALUES = new Set(['High', 'Medium', 'Low'])
const FINAL_STATUS_VALUES = new Set<DeepResearchFinalStatus>([
  'Client Ready',
  'Needs Edit',
  'Needs Re-Research',
  'Remove',
])

// Greedy match of a JSON object spanning multiple lines. Used as a
// fallback when the response includes preamble text or trailing notes.
const JSON_OBJECT_RE = /\{[\s\S]*\}/

function stripMarkdownFences(text: string): string {
  let cleaned = text.trim()
  if (!cleaned.startsWith('```')) return cleaned
  const nl = cleaned.indexOf('\n')
  if (nl !== -1) cleaned = cleaned.slice(nl + 1)
  if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3)
  return cleaned.trim()
}

function normalizeEnum<T extends string>(
  value: unknown,
  allowed: Set<T>,
): T | null {
  if (value === null || value === undefined) return null
  const text = String(value).trim()
  if (!text) return null

  // Direct case-insensitive match
  for (const label of allowed) {
    if (text.toLowerCase() === label.toLowerCase()) return label
  }
  // Strip non-alpha and compare ("STRONG" -> "strong" -> match "Strong")
  const cleaned = text.toLowerCase().replace(/[^a-z]/g, '')
  for (const label of allowed) {
    const labelCleaned = label.toLowerCase().replace(/[^a-z]/g, '')
    if (cleaned === labelCleaned) return label
  }
  // First-token match ("strong fit" -> first token "strong" -> "Strong")
  const tokens = text.split(/\s+/)
  if (tokens.length > 0) {
    const first = tokens[0].replace(/[.,:;]+$/, '').toLowerCase()
    for (const label of allowed) {
      if (first === label.toLowerCase()) return label
    }
  }
  return null
}

function coerceInt(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? Math.trunc(n) : 0
}

function normalizeString(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

function normalizeStringList(value: unknown): string[] {
  if (value === null || value === undefined) return []
  if (typeof value === 'string') {
    const t = value.trim()
    return t ? [t] : []
  }
  if (Array.isArray(value)) {
    return value
      .map((v) => (v === null || v === undefined ? '' : String(v).trim()))
      .filter((s) => s.length > 0)
  }
  const s = String(value).trim()
  return s ? [s] : []
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Extract a structured analysis from an LLM response.
 *
 * Returns ``null`` (caller treats as retryable failure) when:
 *   - Response is empty
 *   - No valid JSON object can be extracted
 *   - The JSON has neither ``summary`` nor ``leads`` keys
 *
 * Otherwise returns a normalized payload with all enum values mapped
 * to their canonical labels and missing strings replaced by ``""``.
 */
export function parseAnalysisResponse(
  content: string,
): Omit<DeepResearchAnalysisPayload, 'model' | 'raw_response' | 'icp_snapshot' | 'generated_at'> | null {
  if (!content) return null

  const stripped = stripMarkdownFences(content)
  let obj: unknown = null
  try {
    obj = JSON.parse(stripped)
  } catch {
    const match = stripped.match(JSON_OBJECT_RE)
    if (!match) {
      console.warn(
        '[deep_research] response contained no JSON object',
        content.slice(0, 300),
      )
      return null
    }
    try {
      obj = JSON.parse(match[0])
    } catch {
      console.warn(
        '[deep_research] regex-extracted JSON still failed to parse',
        match[0].slice(0, 300),
      )
      return null
    }
  }

  if (!isRecord(obj)) {
    console.warn('[deep_research] top-level JSON was not an object')
    return null
  }

  const summaryIn = isRecord(obj.summary) ? obj.summary : {}
  const leadsIn = Array.isArray(obj.leads) ? obj.leads : []

  // Both empty means refusal disguised as JSON — treat as parse failure
  // so the caller retries instead of persisting an empty analysis.
  if (
    Object.keys(summaryIn).length === 0 &&
    leadsIn.length === 0
  ) {
    console.warn(
      '[deep_research] JSON had neither summary nor leads keys',
    )
    return null
  }

  const summary: DeepResearchSummary = {
    total_reviewed: coerceInt(summaryIn.total_reviewed),
    client_ready: coerceInt(summaryIn.client_ready),
    needs_edit: coerceInt(summaryIn.needs_edit),
    needs_re_research: coerceInt(
      summaryIn.needs_re_research ?? summaryIn.needs_reresearch,
    ),
    remove: coerceInt(summaryIn.remove),
    top_issues: normalizeStringList(summaryIn.top_issues),
    recommended_delivery_decision: normalizeString(
      summaryIn.recommended_delivery_decision ??
        summaryIn.recommended_decision ??
        summaryIn.delivery_decision,
    ),
  }

  const leads: DeepResearchLead[] = []
  for (const raw of leadsIn) {
    if (!isRecord(raw)) continue
    const lead: DeepResearchLead = {
      company: normalizeString(raw.company),
      contact: normalizeString(raw.contact) || null,
      icp_fit: normalizeEnum(raw.icp_fit, ICP_FIT_VALUES) as
        | 'Strong'
        | 'Borderline'
        | 'Poor'
        | null,
      intent_fit: normalizeEnum(raw.intent_fit, INTENT_FIT_VALUES) as
        | 'Strong'
        | 'Borderline'
        | 'Poor'
        | null,
      data_confidence: normalizeEnum(
        raw.data_confidence,
        CONFIDENCE_VALUES,
      ) as 'High' | 'Medium' | 'Low' | null,
      final_status: normalizeEnum(
        raw.final_status,
        FINAL_STATUS_VALUES,
      ),
      reasoning: normalizeString(raw.reasoning),
      data_issues_found: normalizeString(
        raw.data_issues_found ?? raw.data_issues,
      ),
      recommended_fix: normalizeString(raw.recommended_fix),
    }
    // Drop entries with no identifying info — usually means the LLM
    // invented a half-empty row. At minimum we need company OR contact.
    if (!lead.company && !lead.contact) continue
    leads.push(lead)
  }

  return { summary, leads }
}
