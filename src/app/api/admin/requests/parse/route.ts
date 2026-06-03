import { NextRequest, NextResponse } from 'next/server'
import {
  EMPLOYEE_COUNT_BUCKETS,
  VALID_INDUSTRIES,
  VALID_ROLE_TYPES,
  normalizeIndustries,
  sanitizeSubIndustries,
  type EmployeeBucket,
  type RoleType,
} from '@/lib/admin-icp-constants'
import {
  emptyDraft,
  normalizeIntentSignals,
  normalizeRequiredAttributes,
  type ParsedIcpDraft,
} from '@/lib/admin-icp-parser'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
const DEFAULT_MODEL = 'anthropic/claude-sonnet-4.6'

type MaybeDraft = Partial<Record<keyof ParsedIcpDraft, unknown>>

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function numberValue(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(1, Math.floor(value))
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed)) return Math.max(1, parsed)
  }
  return fallback
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean)
  }
  if (typeof value === 'string') {
    return value
      .split(/\r?\n|,/)
      .map((item) => item.trim())
      .filter(Boolean)
  }
  return []
}

function roleTypes(value: unknown): RoleType[] {
  const allowed = new Set<string>(VALID_ROLE_TYPES)
  return stringArray(value).filter((item): item is RoleType => allowed.has(item))
}

function employeeBuckets(value: unknown): EmployeeBucket[] {
  const allowed = new Set<string>(EMPLOYEE_COUNT_BUCKETS)
  return stringArray(value).filter((item): item is EmployeeBucket => allowed.has(item))
}

function booleanExpandTargetRoles(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number' && (value === 0 || value === 1)) return value === 1
  if (typeof value === 'string') {
    const s = value.trim().toLowerCase()
    if (s === 'false' || s === '0' || s === 'no' || s === 'off') return false
    if (s === 'true' || s === '1' || s === 'yes' || s === 'on') return true
    if (!s.length) return fallback
  }
  return fallback
}

function sanitizeDraft(input: MaybeDraft, rawText: string): ParsedIcpDraft {
  const fallback = emptyDraft()
  return {
    prompt: stringValue(input.prompt) || rawText.trim(),
    industry: normalizeIndustries(stringArray(input.industry)),
    sub_industry: sanitizeSubIndustries(stringArray(input.sub_industry)),
    company_country: stringArray(input.company_country ?? input.country),
    company_region: stringValue(input.company_region ?? input.geography),
    contact_country: stringArray(input.contact_country),
    contact_region: stringValue(input.contact_region),
    country: stringArray(input.company_country ?? input.country),
    geography: stringValue(input.company_region ?? input.geography),
    target_roles: stringArray(input.target_roles).slice(0, 20),
    target_role_types: roleTypes(input.target_role_types),
    target_seniority: stringValue(input.target_seniority),
    employee_count: employeeBuckets(input.employee_count),
    // ``normalizeIntentSignals`` accepts both legacy ``string[]`` and
    // structured shapes; stray legacy keys like ``is_scored`` drop out.
    intent_signals: normalizeIntentSignals(input.intent_signals).slice(0, 15),
    required_attributes: normalizeRequiredAttributes(input.required_attributes),
    product_service: stringValue(input.product_service),
    num_leads: numberValue(input.num_leads, fallback.num_leads),
    internal_label: stringValue(input.internal_label),
    company: stringValue(input.company),
    expand_target_roles: booleanExpandTargetRoles(
      input.expand_target_roles,
      fallback.expand_target_roles,
    ),
    excluded_companies: stringArray(input.excluded_companies).slice(0, 100),
  }
}

function extractJsonObject(content: string): unknown {
  const trimmed = content.trim()
  try {
    return JSON.parse(trimmed)
  } catch {
    // Some models still wrap JSON in markdown fences. Extract the largest
    // object-looking span and parse that.
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1])
    } catch {
      // Fall through to brace extraction.
    }
  }

  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start >= 0 && end > start) {
    return JSON.parse(trimmed.slice(start, end + 1))
  }
  throw new Error('Model did not return valid JSON.')
}

function buildPrompt(rawText: string): string {
  return `You are extracting a structured Leadpoet fulfillment ICP from pasted operator notes.

Return ONLY valid JSON. No markdown. No commentary.

Schema:
{
  "prompt": string,
  "industry": string[],
  "sub_industry": string[],
  "company_country": string[],
  "company_region": string,
  "contact_country": string[],
  "contact_region": string,
  "target_roles": string[],
  "target_role_types": string[],
  "target_seniority": string,
  "employee_count": string[],
  "intent_signals": string[],
  "required_attributes": {"company": string[], "contact": string[]},
  "product_service": string,
  "num_leads": number,
  "internal_label": string,
  "company": string,
  "excluded_companies": string[]
}

Rules:
- Preserve the operator's meaning. Do not invent a client company, internal label, or product if absent; leave as "".
- "prompt" should be a polished miner-visible ICP summary and must NOT include private admin-only commentary.
- "company" is the client company name, not a prospect company.
- "internal_label" is an operator label; infer only if explicitly present.
- "industry" MUST use ONLY these gateway-valid values. Never output "Technology"; use parallel valid categories like "Information Technology", "Software", "Data and Analytics", "Internet Services", and "Platforms" when appropriate. For PropTech / real estate data products, include broad parallel valid categories such as "Real Estate", "Software", "Data and Analytics", and "Information Technology" instead of inventing "PropTech" or "Technology":
${VALID_INDUSTRIES.map((v) => `  - ${v}`).join('\n')}
- "sub_industry" is stricter than industry. Only include values if they are exact gateway taxonomy labels from the operator notes and you are confident. If unsure, return [] rather than guessing. Never output "PropTech", "Real Estate Technology", "Property Data", or "Technology" as sub_industry.
- "target_roles" should be 5-15 specific titles when possible.
- "target_role_types" must use ONLY these values:
${VALID_ROLE_TYPES.map((v) => `  - ${v}`).join('\n')}
- "target_seniority" should usually be "" unless the target is a single uniform seniority.
- "employee_count" must use ONLY these canonical buckets:
${EMPLOYEE_COUNT_BUCKETS.map((v) => `  - ${v}`).join('\n')}
- Use "company_country" for company HQ countries, e.g. "United States", "France". Empty array means any company country.
- Use "company_region" for company HQ region/state/city requirements.
- Use "contact_country" for the person/contact countries. Empty array means any contact country.
- Use "contact_region" for person/contact region/state/city requirements.
- Do NOT put company HQ, company region, contact region, country, geography, employee count, company size, or headcount rules into required_attributes. Use the dedicated fields above.
- "intent_signals" must be a list of plain strings — each one a concrete observable event miners can verify from web content. Avoid vague signals like "has budget" or "high intent". Do NOT infer required-vs-optional; the operator will toggle "Required" per signal in the admin UI after reviewing your draft.
- "required_attributes" is optional fail-closed criteria. This is the ONLY place for must-have criteria / required attributes / required criteria / hard requirements that are not already covered by role, role type, industry, company_country, company_region, contact_country, contact_region, employee_count, or intent_signals.
- Use required_attributes.company for company-level gates, use required_attributes.contact for person-level gates.
- Each attribute MUST be written as a clear, descriptive explanation that defines exactly what the criterion means in plain language. A validator who has never seen the original request should be able to read the attribute and understand precisely what qualifies. Do NOT use shorthand labels. Instead, write a full description:
  - WRONG: "Is a family office"
  - RIGHT: "The company operates as a family office — a private firm that manages investments and wealth for a single high-net-worth family or a small group of families, rather than serving external clients as a fund or advisory firm."
  - WRONG: "Has SOC 2 certification"
  - RIGHT: "The company holds a current SOC 2 Type I or Type II certification for security, availability, and confidentiality controls."
  - WRONG: "Is a W-2 employee"
  - RIGHT: "The contact is a full-time employee of the company with a permanent role, not a contractor, consultant, freelancer, or agency partner."
  - WRONG: "Uses Salesforce"
  - RIGHT: "The company uses Salesforce as its primary CRM platform."
- Each attribute must describe ONE concrete, verifiable criterion. Do NOT combine multiple criteria with "OR" into a single attribute — split them into separate attributes instead.
- Every attribute must be objectively verifiable from publicly available information. Do NOT use speculative language like "could plausibly transition into", "may be exploring", "has potential to adopt", or "is in a sector adjacent to". If the operator says a company is "exploring X", require observable evidence of active exploration (e.g., public announcements, partnerships, pilot programs, job postings) — not mere sector adjacency.
- Only include attributes explicitly stated by the operator; otherwise return {"company":[],"contact":[]}.
- "product_service" describes what the client sells, not just the buyer pain.
- "num_leads" defaults to 10 if unspecified.
- "excluded_companies" is optional; include only explicitly named excluded prospect companies.

Operator notes:
${rawText}`
}

export async function POST(request: NextRequest) {
  const apiKey = process.env.OPENROUTER_KEY
  if (!apiKey) {
    return NextResponse.json(
      { error: 'OPENROUTER_KEY is not configured on the server.' },
      { status: 503 },
    )
  }

  let rawText = ''
  try {
    const body = await request.json()
    rawText = typeof body.text === 'string' ? body.text.trim() : ''
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  if (!rawText) {
    return NextResponse.json({ error: 'text is required.' }, { status: 400 })
  }

  const model = process.env.OPENROUTER_MODEL || DEFAULT_MODEL

  try {
    const response = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3002',
        'X-Title': 'Leadpoet Admin ICP Parser',
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              'You are a precise data extraction system for B2B ICPs. You only return valid JSON matching the requested schema.',
          },
          { role: 'user', content: buildPrompt(rawText) },
        ],
      }),
      cache: 'no-store',
    })

    const payload = await response.json()
    if (!response.ok) {
      return NextResponse.json(
        {
          error: 'OpenRouter request failed.',
          status: response.status,
          details: payload,
        },
        { status: response.status },
      )
    }

    const content = payload?.choices?.[0]?.message?.content
    if (typeof content !== 'string') {
      return NextResponse.json(
        { error: 'OpenRouter returned no message content.', details: payload },
        { status: 502 },
      )
    }

    const parsed = extractJsonObject(content) as MaybeDraft
    const draft = sanitizeDraft(parsed, rawText)

    return NextResponse.json(
      {
        success: true,
        model,
        draft,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Failed to parse ICP with OpenRouter.',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 502 },
    )
  }
}
