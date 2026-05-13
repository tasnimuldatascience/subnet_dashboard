import type { Metadata } from 'next'
import Link from 'next/link'
import { Shield } from 'lucide-react'
import { LogoutButton } from './_components/LogoutButton'

export const metadata: Metadata = {
  title: 'Admin',
  robots: { index: false, follow: false },
}

/**
 * Admin shell. Renders a slim masthead with the brand mark, an
 * "Admin" affordance so operators always know they're on the
 * protected surface, a link back to the public dashboard, and a
 * logout button.
 *
 * The /admin/login route reuses this layout too. The masthead is
 * harmless on the login screen — same brand, no Logout button
 * shown because we only render it when an operator is signed in.
 *
 * We can't easily know "is signed in?" from a server component
 * cheaply without re-validating the cookie, so we let LogoutButton
 * suppress itself on the login route (it's a client component
 * that reads usePathname).
 */
export default function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen" style={{ background: 'var(--surface-base)' }}>
      <header
        className="sticky top-0 z-20 border-b backdrop-blur-md"
        style={{
          borderColor: 'var(--surface-border)',
          background: 'rgba(8, 8, 10, 0.78)',
        }}
      >
        <div className="mx-auto max-w-7xl px-6 py-4 flex items-center justify-between gap-6">
          <div className="flex items-center gap-3 min-w-0">
            <Link
              href="/admin"
              className="flex items-center gap-2.5 group min-w-0"
            >
              <div
                className="flex h-7 w-7 items-center justify-center rounded-md flex-shrink-0"
                style={{
                  background: 'var(--brand-soft)',
                  border: '1px solid rgba(201, 169, 110, 0.30)',
                }}
              >
                <Shield className="h-3.5 w-3.5 text-gold" />
              </div>
              <div className="flex flex-col leading-tight min-w-0">
                <span
                  className="text-[11px] uppercase tracking-[0.14em]"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  Leadpoet
                </span>
                <span
                  className="text-sm font-medium truncate"
                  style={{ color: 'var(--text-primary)' }}
                >
                  Fulfillment Admin
                </span>
              </div>
            </Link>
          </div>
          <div className="flex items-center gap-4">
            <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] bg-gold-soft border-gold-soft border text-gold">
              <span className="dot-gold inline-block h-1 w-1 rounded-full live-pulse" />
              Internal only
            </span>
            <Link
              href="/"
              className="text-xs transition-colors hover:text-gold"
              style={{ color: 'var(--text-secondary)' }}
            >
              Public dashboard →
            </Link>
            <LogoutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
    </div>
  )
}
