'use client'

import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'

export function AdminRefreshButton() {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  return (
    <button
      type="button"
      onClick={() => {
        window.dispatchEvent(new CustomEvent('leadpoet-admin-refresh'))
        startTransition(() => router.refresh())
      }}
      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] transition-colors hover:text-gold"
      style={{
        borderColor: 'var(--surface-border)',
        background: 'var(--surface)',
        color: 'var(--text-secondary)',
      }}
      title="Refresh admin data"
    >
      <RefreshCw className={cn('h-3 w-3', isPending ? 'animate-spin' : '')} />
      Refresh
    </button>
  )
}
