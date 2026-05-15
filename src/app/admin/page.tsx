import { headers } from 'next/headers'
import Link from 'next/link'
import { AdminRequestList, ChainSummary } from './_components/AdminRequestList'
import {
  AdminModelCompetition,
  type AdminModelCompetitionPayload,
} from './_components/AdminModelCompetition'
import { cn } from '@/lib/utils'

export const dynamic = 'force-dynamic'

type AdminView = 'fulfillment' | 'model-competition'

async function fetchChains(): Promise<ChainSummary[]> {
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
  const body = await res.json()
  return body.chains ?? []
}

async function fetchModelCompetition(): Promise<AdminModelCompetitionPayload> {
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host')
  const proto = h.get('x-forwarded-proto') ?? 'https'
  const base = host ? `${proto}://${host}` : ''
  const auth = h.get('authorization')
  const res = await fetch(`${base}/api/admin/model-competition`, {
    cache: 'no-store',
    headers: auth ? { authorization: auth } : undefined,
  })
  if (!res.ok) {
    throw new Error(`API returned ${res.status}: ${await res.text()}`)
  }
  return (await res.json()) as AdminModelCompetitionPayload
}

function AdminViewTabs({ active }: { active: AdminView }) {
  const tabs: Array<{ key: AdminView; label: string; href: string }> = [
    { key: 'fulfillment', label: 'Fulfillment', href: '/admin' },
    {
      key: 'model-competition',
      label: 'Model competition',
      href: '/admin?view=model-competition',
    },
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
  return view === 'model-competition' ? 'model-competition' : 'fulfillment'
}

export default async function AdminLandingPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string | string[] }>
}) {
  const activeView = getAdminView((await searchParams).view)
  let chains: ChainSummary[] = []
  let modelPayload: AdminModelCompetitionPayload | null = null
  let error: string | null = null
  try {
    if (activeView === 'model-competition') {
      modelPayload = await fetchModelCompetition()
    } else {
      chains = await fetchChains()
    }
  } catch (e) {
    error =
      e instanceof Error
        ? e.message
        : activeView === 'model-competition'
          ? 'Unknown error loading model competition'
          : 'Unknown error loading requests'
  }

  return (
    <div className="space-y-6">
      <AdminViewTabs active={activeView} />
      {activeView === 'model-competition' ? (
        <AdminModelCompetition payload={modelPayload} error={error} />
      ) : (
        <AdminRequestList chains={chains} error={error} />
      )}
    </div>
  )
}
