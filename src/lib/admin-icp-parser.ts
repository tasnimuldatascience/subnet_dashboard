/**
 * Heuristic parser for free-form ICP text. Produces a best-effort draft
 * of a FulfillmentICP payload that the operator can then edit in the
 * admin form. Intentionally non-exhaustive: when in doubt we leave a
 * field empty rather than guess wrong, since wrong values cause the
 * gateway's Pydantic validators to 422 and waste a round trip.
 *
 * Scope:
 *  - Detect country mentions against a known country list + common aliases.
 *  - Detect role types against VALID_ROLE_TYPES + common aliases.
 *  - Detect employee count ranges and snap to canonical buckets.
 *  - Pull explicit "num leads = N" / "X leads" counts.
 *  - Pull industry / sub-industry mentions against COMMON_INDUSTRIES.
 *  - Carry the full source text through as `prompt` for context.
 *  - Treat lines starting with `-`, `•`, or `*` as candidate
 *    intent_signals when the section header mentions intent / signals
 *    / triggers / events / buying.
 *  - Surface explicit "company:" / "client:" mentions as `company`.
 *
 * Anything not recognized is left blank. The operator reviews + fills.
 */

import {
  EMPLOYEE_COUNT_BUCKETS,
  COMMON_COUNTRIES,
  COMMON_INDUSTRIES,
  normalizeIndustries,
  sanitizeSubIndustries,
  type RoleType,
  type EmployeeBucket,
} from './admin-icp-constants'
import type { IntentSignalSpec, RequiredAttributes } from './admin-supabase'

/**
 * Coerce any value the dashboard might receive from the gateway,
 * Supabase, the AI-parse route, or operator-typed local state into
 * the canonical ``IntentSignalSpec[]`` shape.
 *
 * Accepts:
 *  - ``string[]``: legacy admin drafts and historical ``icp_details``
 *    rows in Supabase. Each entry coerces to
 *    ``{text, required:false}`` (matching the gateway default).
 *  - Mixed array of ``string`` and ``IntentSignalSpec``: tolerated so
 *    in-progress UI state can be partially upgraded.
 *  - ``IntentSignalSpec[]``: passed through.
 *  - ``null`` / ``undefined`` / empty: returns ``[]``.
 *
 * Always returns a clean, defaulted array — never throws.
 */
function coerceRecencyCap(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.trunc(n)
}

const VALID_EVIDENCE_TYPES = new Set([
  'HIRING',
  'FUNDING',
  'SOCIAL_POSTING',
  'CASE_STUDY',
  'OTHER',
])

function coerceEvidenceType(
  value: unknown,
): IntentSignalSpec['evidence_type'] {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') return null
  const v = value.trim().toUpperCase()
  if (!v) return null
  if (!VALID_EVIDENCE_TYPES.has(v)) return null
  return v as IntentSignalSpec['evidence_type']
}

export function normalizeIntentSignals(
  value: unknown,
): IntentSignalSpec[] {
  if (!value) return []
  if (!Array.isArray(value)) return []
  const out: IntentSignalSpec[] = []
  for (const entry of value) {
    if (typeof entry === 'string') {
      const t = entry.trim()
      if (!t) continue
      out.push({
        text: t,
        required: false,
        recency_cap_days: null,
        evidence_type: null,
      })
      continue
    }
    if (entry && typeof entry === 'object') {
      const obj = entry as Record<string, unknown>
      const rawText = typeof obj.text === 'string'
        ? obj.text
        : typeof obj.signal === 'string'
          ? (obj.signal as string)
          : ''
      const t = rawText.trim()
      if (!t) continue
      out.push({
        text: t,
        required: typeof obj.required === 'boolean' ? obj.required : false,
        recency_cap_days: coerceRecencyCap(obj.recency_cap_days),
        evidence_type: coerceEvidenceType(obj.evidence_type),
      })
    }
  }
  return out
}

export function normalizeRequiredAttributes(value: unknown): RequiredAttributes {
  const empty: RequiredAttributes = { company: [], contact: [] }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return empty

  const obj = value as Record<string, unknown>
  return {
    company: filterRequiredAttributeList(stringListValue(obj.company)),
    contact: filterRequiredAttributeList(stringListValue(obj.contact)),
  }
}

function isDedicatedIcpFieldRequirement(value: string): boolean {
  const lower = value.toLowerCase()
  return (
    /\b(company\s+)?(hq|headquarters)\b/.test(lower) ||
    /\b(company\s+)?(size|employee\s+count|employees|headcount|head\s*count|staff|fte)\b/.test(lower) ||
    /\b(company|contact)?\s*(country|region|geography|territory|location|state|city)\b/.test(lower)
  )
}

function filterRequiredAttributeList(values: string[]): string[] {
  return values.filter((value) => !isDedicatedIcpFieldRequirement(value))
}

export interface ParsedIcpDraft {
  prompt: string
  industry: string[]
  sub_industry: string[]
  company_country: string[]
  company_region: string
  contact_country: string[]
  contact_region: string
  /** Legacy company-side aliases kept while older code paths transition. */
  country: string[]
  geography: string
  target_roles: string[]
  target_role_types: RoleType[]
  target_seniority: string
  employee_count: EmployeeBucket[]
  // Structured buyer-side intent signals. Legacy text-only payloads
  // from the heuristic parser / AI parse / Supabase get normalized
  // into this shape via ``normalizeIntentSignals``.
  intent_signals: IntentSignalSpec[]
  required_attributes: RequiredAttributes
  product_service: string
  num_leads: number
  internal_label: string
  company: string
  /** When false, gateway stores target_roles verbatim (no LLM expansion). */
  expand_target_roles: boolean
  excluded_companies: string[]
}

export function emptyDraft(): ParsedIcpDraft {
  return {
    prompt: '',
    industry: [],
    sub_industry: [],
    company_country: [],
    company_region: '',
    contact_country: [],
    contact_region: '',
    country: [],
    geography: '',
    target_roles: [],
    target_role_types: [],
    target_seniority: '',
    employee_count: [],
    intent_signals: [],
    required_attributes: { company: [], contact: [] },
    product_service: '',
    num_leads: 10,
    internal_label: '',
    company: '',
    expand_target_roles: true,
    excluded_companies: [],
  }
}

// =================================================================
// Helpers
// =================================================================

/** Trim, collapse whitespace, drop common bullet prefixes. */
function clean(line: string): string {
  return line
    .replace(/^[\s\-*•·]+/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Split a comma-or-semicolon list, preserving items with single spaces. */
function splitList(value: string): string[] {
  return value
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function splitAttributeList(value: string): string[] {
  return value
    .split(/\r?\n|;/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function stringListValue(value: unknown): string[] {
  if (Array.isArray(value)) {
    return dedupeKeepCase(
      value
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter(Boolean),
    )
  }
  if (typeof value === 'string') return dedupeKeepCase(splitAttributeList(value))
  return []
}

function dedupeKeepCase<T extends string>(arr: T[]): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const v of arr) {
    const k = v.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(v)
  }
  return out
}

// =================================================================
// Country detection
// =================================================================

const COUNTRY_ALIASES: Record<string, string> = {
  us: 'United States',
  usa: 'United States',
  'u.s.': 'United States',
  'u.s.a.': 'United States',
  america: 'United States',
  uk: 'United Kingdom',
  britain: 'United Kingdom',
  'great britain': 'United Kingdom',
  england: 'United Kingdom',
  netherlands: 'Netherlands',
  holland: 'Netherlands',
  korea: 'South Korea',
}

function detectCountries(text: string): string[] {
  const lower = text.toLowerCase()
  const found: string[] = []

  for (const country of COMMON_COUNTRIES) {
    // Word-boundary match against the canonical name. Wrap parentheses
    // so multi-word names match even when punctuation surrounds them.
    const re = new RegExp(`\\b${country.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
    if (re.test(text)) found.push(country)
  }

  for (const [alias, canonical] of Object.entries(COUNTRY_ALIASES)) {
    const re = new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
    if (re.test(lower)) found.push(canonical)
  }

  // South America shorthand expansion — common in Leadpoet ICPs.
  if (/\bsouth\s+america(n)?\b/i.test(text)) {
    found.push(
      'Brazil',
      'Argentina',
      'Chile',
      'Colombia',
      'Peru',
      'Uruguay',
      'Paraguay',
      'Ecuador',
      'Bolivia',
      'Venezuela',
      'Guyana',
      'Suriname',
    )
  }

  return dedupeKeepCase(found)
}

// =================================================================
// Role type detection
// =================================================================

/** Quick keyword → role_type map. Order matters: more specific first. */
const ROLE_TYPE_KEYWORDS: Array<{ pattern: RegExp; type: RoleType }> = [
  { pattern: /\b(ceo|cto|cfo|cmo|coo|cio|chief\s+\w+\s+officer|founder|co-?founder)\b/i, type: 'C-Level Executive' },
  { pattern: /\bvp\s+of\s+\w+|\bvice\s+president\b|\bvp\b/i, type: 'VP' },
  { pattern: /\bdirector\s+of\s+\w+|\bdirector\b|\bhead\s+of\s+\w+/i, type: 'Director' },
  { pattern: /\bmanager\b/i, type: 'Manager' },
  { pattern: /\b(sales\s+\w*|sdr|account\s+executive|ae)\b/i, type: 'Sales' },
  { pattern: /\b(marketing|cmo|growth|demand\s+gen)\b/i, type: 'Marketing' },
  { pattern: /\b(engineering|engineer|developer|software)\b/i, type: 'Engineering' },
  { pattern: /\bproduct\s+\w*|\bpm\b/i, type: 'Product' },
  { pattern: /\b(operations|ops|coo)\b/i, type: 'Operations' },
  { pattern: /\b(finance|cfo|controller|treasurer)\b/i, type: 'Finance' },
  { pattern: /\b(hr|people\s+ops|talent|recruiting)\b/i, type: 'HR' },
  { pattern: /\b(legal|counsel)\b/i, type: 'Legal' },
  { pattern: /\b(it\s+\w*|cio|systems)\b/i, type: 'IT' },
  { pattern: /\b(design|ux|ui)\b/i, type: 'Design' },
  { pattern: /\b(supply\s+chain|procurement|logistics)\b/i, type: 'Supply Chain' },
  { pattern: /\b(consulting|consultant|partner)\b/i, type: 'Consulting' },
  { pattern: /\b(business\s+development|bd|biz\s+dev)\b/i, type: 'Business Development' },
  { pattern: /\b(customer\s+success|cs)\b/i, type: 'Customer Success' },
  { pattern: /\b(data|analytics|data\s+science)\b/i, type: 'Data & Analytics' },
  { pattern: /\b(research|r&d)\b/i, type: 'Research' },
]

function detectRoleTypes(text: string): RoleType[] {
  const found: RoleType[] = []
  for (const { pattern, type } of ROLE_TYPE_KEYWORDS) {
    if (pattern.test(text) && !found.includes(type)) {
      found.push(type)
    }
  }
  return found
}

// =================================================================
// Specific role title extraction
// =================================================================

/**
 * Extract specific role titles to seed `target_roles`. Looks for common
 * patterns: "VP of X", "Director of X", "Head of X", "X Manager", "Chief X
 * Officer", and single-token C-level abbreviations. Up to 12 seeds — the
 * gateway's role expander grows the list to ~25 variants.
 */
function detectRoles(text: string): string[] {
  const found = new Set<string>()
  const patterns = [
    /\b(?:VP|Vice President)\s+of\s+([A-Z][\w& ]{2,40})/g,
    /\b(?:Director|Head)\s+of\s+([A-Z][\w& ]{2,40})/g,
    /\bChief\s+([A-Z][\w& ]{2,30})\s+Officer\b/g,
    /\b([A-Z][\w&]+)\s+Manager\b/g,
  ]
  for (const pat of patterns) {
    let m
    while ((m = pat.exec(text)) !== null) {
      const phrase = m[0].trim().replace(/\s+/g, ' ')
      if (phrase.length <= 60) found.add(phrase)
      if (found.size >= 12) break
    }
  }
  // Single-token C-level abbreviations.
  const abbrev = text.match(/\b(CEO|CTO|CFO|CMO|COO|CIO|CRO|CPO)\b/g) || []
  for (const a of abbrev) found.add(a.toUpperCase())

  // Founder / Co-founder.
  if (/\bfounder|co-?founder\b/i.test(text)) found.add('Founder')

  return Array.from(found).slice(0, 15)
}

// =================================================================
// Employee count detection
// =================================================================

/** Map an arbitrary head-count range like "50-200" to overlapping buckets. */
function bucketsForRange(low: number, high: number): EmployeeBucket[] {
  const buckets: Array<{ name: EmployeeBucket; lo: number; hi: number }> = [
    { name: '0-1', lo: 0, hi: 1 },
    { name: '2-10', lo: 2, hi: 10 },
    { name: '11-50', lo: 11, hi: 50 },
    { name: '51-200', lo: 51, hi: 200 },
    { name: '201-500', lo: 201, hi: 500 },
    { name: '501-1,000', lo: 501, hi: 1000 },
    { name: '1,001-5,000', lo: 1001, hi: 5000 },
    { name: '5,001-10,000', lo: 5001, hi: 10000 },
    { name: '10,001+', lo: 10001, hi: Number.POSITIVE_INFINITY },
  ]
  return buckets.filter((b) => b.hi >= low && b.lo <= high).map((b) => b.name)
}

function detectEmployeeBuckets(text: string): EmployeeBucket[] {
  const found = new Set<EmployeeBucket>()

  // Direct mentions of canonical buckets.
  for (const b of EMPLOYEE_COUNT_BUCKETS) {
    if (text.includes(b)) found.add(b)
  }

  // Numeric range like "50-200 employees" or "10 to 50 employees".
  const rangeRe = /(\d{1,3}(?:,?\d{3})*)\s*(?:[-–—to]+)\s*(\d{1,3}(?:,?\d{3})*)\s*(?:employees|people|headcount|staff|fte|head\s*count)?/gi
  let m
  while ((m = rangeRe.exec(text)) !== null) {
    const lo = parseInt(m[1].replace(/,/g, ''), 10)
    const hi = parseInt(m[2].replace(/,/g, ''), 10)
    if (Number.isFinite(lo) && Number.isFinite(hi)) {
      for (const b of bucketsForRange(lo, hi)) found.add(b)
    }
  }

  // Single thresholds: "10+", "under 50", "smb", "mid-market".
  if (/\bsmb\b|\bsmall\s+business(?:es)?\b/i.test(text)) {
    bucketsForRange(11, 200).forEach((b) => found.add(b))
  }
  if (/\bmid[- ]market\b/i.test(text)) {
    bucketsForRange(201, 1000).forEach((b) => found.add(b))
  }
  if (/\benterprise\b/i.test(text)) {
    bucketsForRange(1001, 100000).forEach((b) => found.add(b))
  }

  // Order according to the canonical list.
  return EMPLOYEE_COUNT_BUCKETS.filter((b) => found.has(b))
}

// =================================================================
// Lead count
// =================================================================

function detectNumLeads(text: string): number | null {
  // Patterns like "10 leads", "num leads: 25", "25 contacts".
  const patterns = [
    /\b(?:num[_\s]?leads?|number\s+of\s+leads?|leads?\s+target|target\s+(?:leads?|count)|quota)\s*[:=]?\s*(\d{1,4})\b/i,
    /\b(\d{1,4})\s*(?:leads?|contacts?|prospects?|companies)\b/i,
  ]
  for (const re of patterns) {
    const m = text.match(re)
    if (m) {
      const n = parseInt(m[1], 10)
      if (Number.isFinite(n) && n > 0 && n <= 1000) return n
    }
  }
  return null
}

// =================================================================
// Industry / sub-industry detection (best-effort)
// =================================================================

function detectIndustries(text: string): string[] {
  const found: string[] = []
  for (const ind of COMMON_INDUSTRIES) {
    const re = new RegExp(`\\b${ind.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
    if (re.test(text)) found.push(ind)
  }
  return dedupeKeepCase(found)
}

// =================================================================
// Field extraction by labelled lines
// =================================================================

/**
 * Look for "Label: value" lines (and a few common variants like
 * "Company - Foo", "Internal label = Bar"). Returns the captured value
 * for the first match, or null.
 */
function fieldByLabel(text: string, labels: string[]): string | null {
  const lines = text.split(/\r?\n/)
  for (const line of lines) {
    const cleaned = clean(line)
    for (const label of labels) {
      const re = new RegExp(`^${label}\\s*[:=\\-–]\\s*(.+)$`, 'i')
      const m = cleaned.match(re)
      if (m) {
        const value = m[1].trim()
        if (value.length > 0) return value
      }
    }
  }
  return null
}

// =================================================================
// Intent signals
// =================================================================

/**
 * Pulls bullet-style lines that follow an "Intent" / "Signals" /
 * "Triggers" / "Buying" header. Falls back to scanning the whole text
 * for hire / job-posting / funding-round style phrases.
 */
function detectIntentSignals(text: string): IntentSignalSpec[] {
  const lines = text.split(/\r?\n/)
  const signals: string[] = []

  let inSignalSection = false
  for (const raw of lines) {
    const stripped = raw.trim()
    if (
      /^(intent[_\s-]?signals?|signals|triggers|buying[_\s-]?signals|events)\s*[:=]?\s*$/i.test(
        stripped,
      )
    ) {
      inSignalSection = true
      continue
    }
    if (inSignalSection) {
      // End of section: blank line or another labelled section.
      if (stripped.length === 0) {
        inSignalSection = false
        continue
      }
      if (/^(\w[\w\s/&-]+)\s*:/.test(stripped) && !/^[-*•·]/.test(raw)) {
        inSignalSection = false
        continue
      }
      const cleaned = clean(stripped)
      if (cleaned.length > 0 && cleaned.length < 200) signals.push(cleaned)
    }
  }

  // Fallback: pull observable-event sentences if no labelled section found.
  if (signals.length === 0) {
    const eventPatterns = [
      /\bhired\s+a?\s+\w+/i,
      /\bjob\s+posting\b/i,
      /\bopened\s+\d+\s+roles?/i,
      /\braised\s+\$?\d/i,
      /\b(?:series\s+[a-z]|seed|pre-seed)\s+round/i,
      /\bannounced\s+\w+/i,
      /\bacquired\b/i,
      /\bipo\b/i,
      /\bnew\s+(?:office|product|launch)\b/i,
    ]
    const sentences = text.split(/(?<=[.!?])\s+/)
    for (const s of sentences) {
      for (const pat of eventPatterns) {
        if (pat.test(s) && s.length < 240) {
          signals.push(s.trim())
          break
        }
      }
      if (signals.length >= 6) break
    }
  }

  // The heuristic parser has no way to infer ``required`` from
  // free-form text, so every entry defaults to optional. Operators
  // toggle these per signal in the new request UI before submitting.
  return normalizeIntentSignals(dedupeKeepCase(signals).slice(0, 10))
}

// =================================================================
// Required attributes
// =================================================================

function collectSectionItems(text: string, headerPattern: RegExp): string[] {
  const lines = text.split(/\r?\n/)
  const items: string[] = []
  let inSection = false

  for (const raw of lines) {
    const stripped = raw.trim()
    if (headerPattern.test(stripped)) {
      inSection = true
      const inline = stripped.replace(headerPattern, '').replace(/^[:=\-–]\s*/, '').trim()
      if (inline) items.push(...splitAttributeList(inline))
      continue
    }
    if (!inSection) continue
    if (stripped.length === 0) {
      inSection = false
      continue
    }
    if (/^(\w[\w\s/&-]+)\s*:/.test(stripped) && !/^[-*•·]/.test(raw)) {
      inSection = false
      continue
    }
    const cleaned = clean(stripped)
    if (cleaned.length > 0 && cleaned.length < 220) items.push(cleaned)
  }

  return dedupeKeepCase(items)
}

function detectRequiredAttributes(text: string): RequiredAttributes {
  const company = [
    fieldByLabel(text, [
      'required company attributes',
      'company required attributes',
      'company attributes',
      'company criteria',
      'required company criteria',
      'company requirements',
      'must-have company criteria',
      'must have company criteria',
      'hard company requirements',
      'required_attributes.company',
    ]),
    ...collectSectionItems(
      text,
      /^(required\s+)?company\s+(attributes?|criteria|requirements?)\s*[:=]?/i,
    ),
  ].flatMap((value) => (value ? splitAttributeList(value) : []))

  const contact = [
    fieldByLabel(text, [
      'required contact attributes',
      'contact required attributes',
      'contact attributes',
      'contact criteria',
      'required contact criteria',
      'contact requirements',
      'must-have contact criteria',
      'must have contact criteria',
      'hard contact requirements',
      'required_attributes.contact',
    ]),
    ...collectSectionItems(
      text,
      /^(required\s+)?contact\s+(attributes?|criteria|requirements?)\s*[:=]?/i,
    ),
  ].flatMap((value) => (value ? splitAttributeList(value) : []))

  return normalizeRequiredAttributes({ company, contact })
}

// =================================================================
// Top-level parser
// =================================================================

export function parseFreeFormIcp(rawText: string): ParsedIcpDraft {
  const text = rawText.trim()
  if (!text) return emptyDraft()

  const draft = emptyDraft()
  draft.prompt = text

  // Field-by-label first, then heuristic detectors fill in the gaps.
  const company = fieldByLabel(text, ['company', 'client', 'client company', 'customer'])
  if (company) draft.company = company

  const internal = fieldByLabel(text, [
    'internal label',
    'internal_label',
    'label',
    'operator label',
  ])
  if (internal) draft.internal_label = internal

  const product = fieldByLabel(text, [
    'product',
    'product/service',
    'product or service',
    'product_service',
    'what we sell',
    'what they sell',
    'product description',
  ])
  if (product) draft.product_service = product

  const seniority = fieldByLabel(text, [
    'seniority',
    'target seniority',
    'target_seniority',
  ])
  if (seniority) draft.target_seniority = seniority

  const companyRegion = fieldByLabel(text, [
    'company region',
    'company geography',
    'company geo',
    'company territory',
    'company location',
    'company hq',
    'company hq region',
    'hq region',
    'hq geography',
    'geography',
    'geo',
    'region',
    'territory',
  ])
  if (companyRegion) {
    draft.company_region = companyRegion
    draft.geography = companyRegion
  }

  const contactRegion = fieldByLabel(text, [
    'contact region',
    'contact geography',
    'contact geo',
    'contact territory',
    'contact location',
    'person region',
    'person geography',
    'lead region',
    'lead geography',
  ])
  if (contactRegion) draft.contact_region = contactRegion

  const companyCountries = fieldByLabel(text, [
    'company countries',
    'company country',
    'company_country',
    'hq countries',
    'hq country',
  ])
  if (companyCountries) {
    draft.company_country = splitList(companyCountries)
    draft.country = draft.company_country
  }

  const contactCountries = fieldByLabel(text, [
    'contact countries',
    'contact country',
    'contact_country',
    'person countries',
    'person country',
    'lead countries',
    'lead country',
  ])
  if (contactCountries) {
    draft.contact_country = splitList(contactCountries)
  }

  const explicitRoles = fieldByLabel(text, ['target roles', 'target_roles', 'roles', 'titles'])
  if (explicitRoles) {
    draft.target_roles = splitList(explicitRoles).slice(0, 15)
  }

  const explicitIndustry = fieldByLabel(text, ['industry', 'industries'])
  if (explicitIndustry) {
    draft.industry = normalizeIndustries(splitList(explicitIndustry))
  }

  const explicitSubIndustry = fieldByLabel(text, [
    'sub-industry',
    'sub industry',
    'sub_industry',
    'sub-industries',
    'sub industries',
  ])
  if (explicitSubIndustry) {
    draft.sub_industry = sanitizeSubIndustries(splitList(explicitSubIndustry))
  }

  const excludes = fieldByLabel(text, [
    'exclude',
    'excluded',
    'exclude companies',
    'excluded companies',
    'excluded_companies',
  ])
  if (excludes) {
    draft.excluded_companies = splitList(excludes).slice(0, 50)
  }

  // Heuristic fallbacks for fields not explicitly labelled.
  if (draft.company_country.length === 0) {
    draft.company_country = detectCountries(text)
  }
  if (draft.country.length === 0) draft.country = draft.company_country
  if (draft.industry.length === 0) draft.industry = normalizeIndustries(detectIndustries(text))
  if (draft.target_role_types.length === 0) {
    draft.target_role_types = detectRoleTypes(text)
  }
  if (draft.target_roles.length === 0) {
    draft.target_roles = detectRoles(text)
  }
  if (draft.employee_count.length === 0) {
    draft.employee_count = detectEmployeeBuckets(text)
  }
  if (draft.intent_signals.length === 0) {
    draft.intent_signals = detectIntentSignals(text)
  }
  draft.required_attributes = detectRequiredAttributes(text)

  const numLeads = detectNumLeads(text)
  if (numLeads !== null) draft.num_leads = numLeads

  return draft
}
