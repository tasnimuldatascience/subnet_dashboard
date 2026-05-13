import { headers } from 'next/headers'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { AdminRequestDetail, RequestDetailPayload } from './_components/AdminRequestDetail'

export const dynamic = 'force-dynamic'

async function fetchDetail(requestId: string): Promise<RequestDetailPayload | null> {
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host')
  const proto = h.get('x-forwarded-proto') ?? 'https'
  const base = host ? `${proto}://${host}` : ''
  const cookie = h.get('cookie')
  const res = await fetch(`${base}/api/admin/requests/${requestId}`, {
    cache: 'no-store',
    headers: cookie ? { cookie } : undefined,
  })
  if (res.status === 404) return null
  if (!res.ok) {
    throw new Error(`API returned ${res.status}: ${await res.text()}`)
  }
  return (await res.json()) as RequestDetailPayload
}

export default async function AdminRequestDetailPage({
  params,
}: {
  params: Promise<{ request_id: string }>
}) {
  const { request_id } = await params

  let payload: RequestDetailPayload | null = null
  let error: string | null = null
  try {
    payload = await fetchDetail(request_id)
  } catch (e) {
    error = e instanceof Error ? e.message : 'Unknown error'
  }
  if (!payload && !error) {
    notFound()
  }

  return (
    <div className="space-y-6">
      <Link
        href="/admin"
        className="inline-flex items-center gap-1.5 text-xs transition-colors"
        style={{ color: 'var(--text-secondary)' }}
      >
        <ChevronLeft className="h-3.5 w-3.5" />
        All requests
      </Link>
      {error ? (
        <div
          className="rounded-xl border p-6"
          style={{
            background: 'rgba(168, 116, 111, 0.10)',
            borderColor: 'rgba(168, 116, 111, 0.30)',
          }}
        >
          <div className="text-sm font-medium text-burgundy mb-1">
            Could not load this request
          </div>
          <div
            className="text-xs font-mono"
            style={{ color: 'var(--text-secondary)' }}
          >
            {error}
          </div>
        </div>
      ) : payload ? (
        <AdminRequestDetail requestId={request_id} payload={payload} />
      ) : null}
    </div>
  )
}
