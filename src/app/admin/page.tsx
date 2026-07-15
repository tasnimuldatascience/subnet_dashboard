import { headers } from 'next/headers'
import Link from 'next/link'
import {
  AdminRequestList,
  type AdminRequestsPayload,
} from './_components/AdminRequestList'
import {
  AdminSubmittedLeads,
  type AdminSubmittedLeadsPayload,
} from './_components/AdminSubmittedLeads'
import {
  AdminResearchLab,
  type AdminResearchLabPayload,
} from './_components/AdminResearchLab'
import { AdminResearchLabEconomics } from './_components/AdminResearchLabEconomics'
import type { ResearchLabEconomicsPayload } from '@/lib/research-lab-economics'
import { cn } from '@/lib/utils'

export const dynamic = 'force-dynamic'

type AdminView = 'lab' | 'economics' | 'fulfillment'
type FulfillmentTab = 'requests' | 'submitted-leads'

async function fetchChains(): Promise<AdminRequestsPayload> {
  // Build the absolute URL so this works on Vercel, on EC2 behind
  // nginx, or in dev. Next 15 makes headers() async, so we await it.
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host')
  const proto = h.get('x-forwarded-proto') ?? 'https'
  const base = host ? `${proto}://${host}` : ''
  // Forward the operator's Authorization header so the API call
  // re-passes the basic-auth gate. Without this, the server-side
  // fetch would hit /api/admin and bounce off middleware with 401.
  const auth = h.get('authorization')
  const res = await fetch(`${base}/api/admin/requests`, {
    cache: 'no-store',
    headers: auth ? { authorization: auth } : undefined,
  })
  if (!res.ok) {
    throw new Error(`API returned ${res.status}: ${await res.text()}`)
  }
  return (await res.json()) as AdminRequestsPayload
}

async function fetchSubmittedLeads(): Promise<AdminSubmittedLeadsPayload> {
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host')
  const proto = h.get('x-forwarded-proto') ?? 'https'
  const base = host ? `${proto}://${host}` : ''
  const auth = h.get('authorization')
  const end = new Date()
  const start = new Date(end)
  start.setUTCDate(end.getUTCDate() - 6)
  const params = new URLSearchParams({
    from: start.toISOString().slice(0, 10),
    to: end.toISOString().slice(0, 10),
  })
  const res = await fetch(`${base}/api/admin/fulfillment-submissions?${params.toString()}`, {
    cache: 'no-store',
    headers: auth ? { authorization: auth } : undefined,
  })
  if (!res.ok) {
    throw new Error(`API returned ${res.status}: ${await res.text()}`)
  }
  return (await res.json()) as AdminSubmittedLeadsPayload
}

async function fetchResearchLabEconomics(): Promise<ResearchLabEconomicsPayload> {
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host')
  const proto = h.get('x-forwarded-proto') ?? 'https'
  const base = host ? `${proto}://${host}` : ''
  const auth = h.get('authorization')
  const res = await fetch(`${base}/api/admin/research-lab/economics`, {
    cache: 'no-store',
    headers: auth ? { authorization: auth } : undefined,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || `Economics API returned ${res.status}`)
  }
  return (await res.json()) as ResearchLabEconomicsPayload
}

function AdminViewTabs({ active }: { active: AdminView }) {
  const tabs: Array<{ key: AdminView; label: string; href: string }> = [
    { key: 'lab', label: 'Lab activity', href: '/admin' },
    { key: 'economics', label: 'Economics & Rewards', href: '/admin?view=economics' },
    { key: 'fulfillment', label: 'Fulfillment', href: '/admin?view=fulfillment' },
  ]

  return (
    <div
      className="flex items-center gap-1 rounded-xl border p-1"
      style={{
        borderColor: 'var(--surface-border)',
        background: 'var(--surface)',
      }}
    >
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          className={cn(
            'rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
            active === tab.key
              ? 'bg-gold-soft text-gold'
              : 'hover-bg-warm text-white/55',
          )}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  )
}

function getAdminView(value: string | string[] | undefined): AdminView {
  const view = Array.isArray(value) ? value[0] : value
  if (view === 'economics') return 'economics'
  if (view === 'fulfillment') return 'fulfillment'
  return 'lab'
}

function getFulfillmentTab(value: string | string[] | undefined): FulfillmentTab {
  const tab = Array.isArray(value) ? value[0] : value
  return tab === 'submitted-leads' ? 'submitted-leads' : 'requests'
}

function FulfillmentTabs({ active }: { active: FulfillmentTab }) {
  const tabs: Array<{ key: FulfillmentTab; label: string; href: string }> = [
    { key: 'requests', label: 'Requests', href: '/admin?view=fulfillment' },
    {
      key: 'submitted-leads',
      label: 'Submitted leads',
      href: '/admin?view=fulfillment&tab=submitted-leads',
    },
  ]

  return (
    <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all whitespace-nowrap border',
            active === tab.key
              ? 'bg-gold-tint border-gold-strong text-gold'
              : 'border-white/[0.06] hover-bg-warm text-white/55',
          )}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  )
}

export default async function AdminLandingPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string | string[]; tab?: string | string[] }>
}) {
  const params = await searchParams
  const activeView = getAdminView(params.view)
  const fulfillmentTab = getFulfillmentTab(params.tab)
  let requestsPayload: AdminRequestsPayload | null = null
  const labPayload: AdminResearchLabPayload | null = null
  let economicsPayload: ResearchLabEconomicsPayload | null = null
  let submittedLeadsPayload: AdminSubmittedLeadsPayload | null = null
  let error: string | null = null
  try {
    // The Lab view renders its shell immediately and loads the operational
    // snapshot client-side. Other, smaller admin views keep server fetching.
    if (activeView === 'economics') {
      economicsPayload = await fetchResearchLabEconomics()
    } else if (activeView === 'fulfillment' && fulfillmentTab === 'submitted-leads') {
      submittedLeadsPayload = await fetchSubmittedLeads()
    } else if (activeView === 'fulfillment') {
      requestsPayload = await fetchChains()
    }
  } catch (e) {
    error =
      e instanceof Error
        ? e.message
        : activeView === 'lab'
          ? 'Unknown error loading Lab activity'
          : activeView === 'economics'
            ? 'Unknown error loading Research Lab economics'
          : 'Unknown error loading requests'
  }

  return (
    <div className="space-y-6">
      <AdminViewTabs active={activeView} />
      {activeView === 'lab' ? (
        <AdminResearchLab payload={labPayload} error={error} />
      ) : activeView === 'economics' ? (
        <AdminResearchLabEconomics payload={economicsPayload} error={error} />
      ) : fulfillmentTab === 'submitted-leads' ? (
        <>
          <FulfillmentTabs active={fulfillmentTab} />
          <AdminSubmittedLeads payload={submittedLeadsPayload} error={error} />
        </>
      ) : (
        <>
          <FulfillmentTabs active={fulfillmentTab} />
          <AdminRequestList payload={requestsPayload} error={error} />
        </>
      )}
    </div>
  )
}
