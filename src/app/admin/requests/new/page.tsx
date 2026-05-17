import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { NewRequestBuilder } from './_components/NewRequestBuilder'
import { asList } from '@/lib/admin-format'
import {
  EMPLOYEE_COUNT_BUCKETS,
  VALID_ROLE_TYPES,
  type EmployeeBucket,
  type RoleType,
} from '@/lib/admin-icp-constants'
import {
  emptyDraft,
  normalizeIntentSignals,
  normalizeRequiredAttributes,
  type ParsedIcpDraft,
} from '@/lib/admin-icp-parser'
import type { IcpDetails } from '@/lib/admin-supabase'

export const metadata: Metadata = {
  title: 'New request · Admin',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

type RequestSnapshot = {
  internal_label: string | null
  company: string | null
  num_leads: number
  icp_details: IcpDetails | null
  required_attributes?: IcpDetails['required_attributes'] | null
}

type ReusePayload = {
  chain: {
    root: RequestSnapshot
    leaf: RequestSnapshot
  }
  icp: IcpDetails | null
  target_num_leads: number
}

const UUID_RE = /^[0-9a-f-]{36}$/i

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? '' : value ?? ''
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function roleTypes(value: unknown): RoleType[] {
  const allowed = new Set<string>(VALID_ROLE_TYPES)
  return stringArray(value).filter((item): item is RoleType => allowed.has(item))
}

function employeeBuckets(value: unknown): EmployeeBucket[] {
  const allowed = new Set<string>(EMPLOYEE_COUNT_BUCKETS)
  return asList(value as string | string[] | null | undefined).filter(
    (item): item is EmployeeBucket => allowed.has(item),
  )
}

function buildDraftFromRequest(payload: ReusePayload): ParsedIcpDraft | null {
  const source = payload.chain.leaf ?? payload.chain.root
  const icp = payload.icp ?? source.icp_details ?? payload.chain.root.icp_details
  if (!icp) return null
  const requiredAttributes =
    icp.required_attributes ??
    source.required_attributes ??
    payload.chain.root.required_attributes

  return {
    ...emptyDraft(),
    prompt: icp.prompt ?? '',
    industry: asList(icp.industry),
    sub_industry: asList(icp.sub_industry),
    country: asList(icp.country),
    geography: icp.geography ?? '',
    target_roles: stringArray(icp.target_roles),
    target_role_types: roleTypes(icp.target_role_types),
    target_seniority: icp.target_seniority ?? '',
    employee_count: employeeBuckets(icp.employee_count),
    intent_signals: normalizeIntentSignals(icp.intent_signals),
    required_attributes: normalizeRequiredAttributes(requiredAttributes),
    product_service: icp.product_service ?? '',
    num_leads: payload.target_num_leads ?? icp.num_leads ?? source.num_leads ?? 10,
    internal_label: source.internal_label ?? payload.chain.root.internal_label ?? '',
    company: source.company ?? payload.chain.root.company ?? '',
    // Leave exclusions blank so the gateway refreshes prior-delivered
    // companies for this client at submit time.
    excluded_companies: [],
  }
}

async function fetchReusableDraft(requestId: string): Promise<{
  draft: ParsedIcpDraft | null
  label: string | null
  error: string | null
}> {
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host')
  const proto = h.get('x-forwarded-proto') ?? 'https'
  const base = host ? `${proto}://${host}` : ''
  const auth = h.get('authorization')

  const res = await fetch(`${base}/api/admin/requests/${requestId}`, {
    cache: 'no-store',
    headers: auth ? { authorization: auth } : undefined,
  })
  if (!res.ok) {
    return {
      draft: null,
      label: null,
      error: `Could not load source request ${requestId}: ${res.status}`,
    }
  }

  const payload = (await res.json()) as ReusePayload
  const draft = buildDraftFromRequest(payload)
  if (!draft) {
    return {
      draft: null,
      label: null,
      error: `Source request ${requestId} has no reusable ICP details.`,
    }
  }

  return {
    draft,
    label: payload.chain.leaf.internal_label ?? payload.chain.root.internal_label,
    error: null,
  }
}

export default async function NewRequestPage({
  searchParams,
}: {
  searchParams: Promise<{ reuse?: string | string[] }>
}) {
  const reuseRequestId = firstParam((await searchParams).reuse)
  let initialDraft: ParsedIcpDraft | null = null
  let reuseLabel: string | null = null
  let reuseError: string | null = null

  if (reuseRequestId) {
    if (!UUID_RE.test(reuseRequestId)) {
      reuseError = 'Invalid source request id in reuse link.'
    } else {
      const reusable = await fetchReusableDraft(reuseRequestId)
      initialDraft = reusable.draft
      reuseLabel = reusable.label
      reuseError = reusable.error
    }
  }

  return (
    <NewRequestBuilder
      initialDraft={initialDraft ?? undefined}
      reuseSource={
        reuseRequestId
          ? { requestId: reuseRequestId, label: reuseLabel }
          : undefined
      }
      reuseError={reuseError ?? undefined}
    />
  )
}
