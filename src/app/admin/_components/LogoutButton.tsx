'use client'

import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { LogOut, Loader2 } from 'lucide-react'

/**
 * Hides itself on the /admin/login route since there's nothing to
 * log out of. On every other admin path it sends DELETE
 * /api/admin/session to clear the cookie, then hard-navigates to
 * the login form. We hard-navigate (not router.push) so any cached
 * RSC payloads from the authenticated session can't be served to
 * the now-logged-out browser.
 */
export function LogoutButton() {
  const pathname = usePathname()
  const [busy, setBusy] = useState(false)
  if (pathname === '/admin/login') return null

  async function onClick() {
    setBusy(true)
    try {
      await fetch('/api/admin/session', {
        method: 'DELETE',
        cache: 'no-store',
      })
    } catch {
      // Best-effort: if the request fails the cookie won't clear
      // server-side, but the hard-nav below will land them on
      // /admin/login where middleware sees no valid session.
    } finally {
      window.location.assign('/admin/login')
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="inline-flex items-center gap-1.5 text-xs transition-colors hover:text-gold disabled:opacity-50"
      style={{ color: 'var(--text-secondary)' }}
      title="Sign out"
    >
      {busy ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <LogOut className="h-3 w-3" />
      )}
      <span className="hidden sm:inline">Sign out</span>
    </button>
  )
}
