import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DEFAULT_GATEWAY_URL = 'http://52.91.135.79:8000'

type FulfillmentPayload = {
  prompt?: unknown
  industry?: unknown
  sub_industry?: unknown
  target_roles?: unknown
  target_role_types?: unknown
  target_seniority?: unknown
  employee_count?: unknown
  country?: unknown
  geography?: unknown
  intent_signals?: unknown
  required_attributes?: unknown
  product_service?: unknown
  num_leads?: unknown
  internal_label?: unknown
  company?: unknown
  excluded_companies?: unknown
  expand_target_roles?: unknown
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

/**
 * intent_signals is allowed to be either:
 *  - a legacy ``string[]`` (still accepted by the gateway validator
 *    which coerces each entry to default flags), OR
 *  - an array of ``{text: string, required?: boolean}``
 *    objects produced by the new admin UI.
 *
 * Mixed arrays are allowed for forward-compat as the operator
 * incrementally upgrades a draft. The gateway's Pydantic validator
 * is the source of truth on field constraints; we only sanity-check
 * the outer shape here so an obvious malformed payload doesn't waste
 * a round trip.
 */
function isIntentSignalsArray(value: unknown): boolean {
  if (!Array.isArray(value)) return false
  return value.every((item) => {
    if (typeof item === 'string') return true
    if (item && typeof item === 'object') {
      const obj = item as Record<string, unknown>
      return typeof obj.text === 'string' || typeof obj.signal === 'string'
    }
    return false
  })
}

function isRequiredAttributes(value: unknown): boolean {
  if (value === undefined) return true
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const obj = value as Record<string, unknown>
  const allowed = new Set(['company', 'contact'])
  if (Object.keys(obj).some((key) => !allowed.has(key))) return false
  return (
    (obj.company === undefined || isStringArray(obj.company)) &&
    (obj.contact === undefined || isStringArray(obj.contact))
  )
}

function validatePayload(body: FulfillmentPayload): string[] {
  const errors: string[] = []

  const requiredStrings: Array<keyof FulfillmentPayload> = [
    'prompt',
    'product_service',
    'internal_label',
    'company',
  ]
  for (const key of requiredStrings) {
    if (!isNonEmptyString(body[key])) errors.push(`${key} is required`)
  }

  const optionalArrays: Array<keyof FulfillmentPayload> = [
    'industry',
    'sub_industry',
    'target_roles',
    'target_role_types',
    'employee_count',
    'country',
  ]
  for (const key of optionalArrays) {
    if (body[key] !== undefined && !isStringArray(body[key])) {
      errors.push(`${key} must be a list`)
    }
  }

  if (
    body.intent_signals !== undefined &&
    !isIntentSignalsArray(body.intent_signals)
  ) {
    errors.push(
      'intent_signals must be a list of strings, or of objects with a "text" field (optionally "required").',
    )
  }

  if (!isRequiredAttributes(body.required_attributes)) {
    errors.push(
      'required_attributes must be an object with optional "company" and "contact" string lists.',
    )
  }

  if (!Number.isInteger(body.num_leads) || Number(body.num_leads) <= 0) {
    errors.push('num_leads must be a positive integer')
  }

  if (body.excluded_companies !== undefined && !isStringArray(body.excluded_companies)) {
    errors.push('excluded_companies must be a list')
  }

  if (body.expand_target_roles !== undefined && typeof body.expand_target_roles !== 'boolean') {
    errors.push('expand_target_roles must be a boolean')
  }

  return errors
}

export async function POST(request: NextRequest) {
  const serviceRoleKey = process.env.SUPABASE_SECRET_KEY
  if (!serviceRoleKey) {
    return NextResponse.json(
      { error: 'SUPABASE_SECRET_KEY is not configured on the server.' },
      { status: 503 },
    )
  }

  let body: FulfillmentPayload
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const validationErrors = validatePayload(body)
  if (validationErrors.length > 0) {
    return NextResponse.json({ error: 'Invalid request payload.', details: validationErrors }, { status: 400 })
  }

  const gatewayBase = (process.env.FULFILLMENT_GATEWAY_URL ?? DEFAULT_GATEWAY_URL).replace(/\/+$/, '')
  const gatewayUrl = `${gatewayBase}/fulfillment/request`

  try {
    const gatewayRes = await fetch(gatewayUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify(body),
      cache: 'no-store',
    })

    const text = await gatewayRes.text()
    let payload: unknown = text
    try {
      payload = JSON.parse(text)
    } catch {
      // Keep raw response text when gateway returns non-JSON.
    }

    if (!gatewayRes.ok) {
      return NextResponse.json(
        {
          error: 'Gateway rejected the fulfillment request.',
          status: gatewayRes.status,
          details: payload,
        },
        { status: gatewayRes.status },
      )
    }

    return NextResponse.json(
      {
        success: true,
        gateway: payload,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Failed to reach fulfillment gateway.',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 502 },
    )
  }
}
