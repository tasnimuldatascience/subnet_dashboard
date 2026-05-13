import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { AdminRequestDetail, RequestDetailPayload } from './_components/AdminRequestDetail'
import { getRequestDetail } from '@/lib/admin-data'

export const dynamic = 'force-dynamic'

export default async function AdminRequestDetailPage({
  params,
}: {
  params: Promise<{ request_id: string }>
}) {
  const { request_id } = await params

  let payload: RequestDetailPayload | null = null
  let error: string | null = null
  // Call the Supabase data layer directly. See note in /admin/page.tsx.
  try {
    payload = (await getRequestDetail(request_id)) as RequestDetailPayload | null
  } catch (e) {
    error = e instanceof Error ? e.message : 'Unknown error'
    console.error(
      `[admin] /admin/requests/${request_id} page failed to load detail:`,
      e,
    )
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
