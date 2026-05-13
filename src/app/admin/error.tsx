'use client'

import { useEffect } from 'react'
import { AlertTriangle, RotateCcw } from 'lucide-react'

/**
 * Error boundary for the entire /admin route segment.
 *
 * Next.js will call this when an unhandled exception bubbles up
 * through any server component or client component beneath /admin.
 * Without this file Next would render its built-in 500 page (the
 * one with just "500 Internal server error" centered on a blank
 * page), which is jarring on a styled surface.
 *
 * The error message is also logged to the browser console and to
 * the server logs (via the implicit framework wiring) so the
 * operator has something to grep for in Vercel logs.
 */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Console-side log so the operator can grab the stack from
    // devtools without needing to dig through server logs.
    console.error('[admin] route error boundary:', error)
  }, [error])

  return (
    <div
      className="min-h-screen flex items-center justify-center px-6 py-12"
      style={{ background: 'var(--surface-base)' }}
    >
      <div className="w-full max-w-lg">
        <div
          className="rounded-2xl border p-6 sm:p-7"
          style={{
            borderColor: 'rgba(168, 116, 111, 0.30)',
            background: 'rgba(168, 116, 111, 0.10)',
          }}
        >
          <div className="flex items-start gap-3 mb-4">
            <AlertTriangle className="h-5 w-5 text-burgundy flex-shrink-0 mt-0.5" />
            <div>
              <h1 className="text-base font-medium text-burgundy">
                Something went wrong on the admin surface
              </h1>
              <p
                className="text-xs mt-1"
                style={{ color: 'var(--text-secondary)' }}
              >
                The page caught an unexpected error during render. This is
                usually a misconfigured environment variable (
                <code className="font-mono">ADMIN_USER</code>,{' '}
                <code className="font-mono">ADMIN_PASS</code>,{' '}
                <code className="font-mono">SUPABASE_SECRET_KEY</code>) or a
                transient database issue.
              </p>
            </div>
          </div>
          <div
            className="rounded-lg border p-3 font-mono text-[11px] leading-relaxed"
            style={{
              borderColor: 'var(--surface-border)',
              background: 'var(--surface-elevated)',
              color: 'var(--text-secondary)',
            }}
          >
            {error.message || 'No error message available.'}
            {error.digest && (
              <div
                className="mt-2 pt-2 border-t"
                style={{
                  borderColor: 'var(--surface-border)',
                  color: 'var(--text-tertiary)',
                }}
              >
                digest: {error.digest}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 mt-5">
            <button
              type="button"
              onClick={reset}
              className="inline-flex items-center gap-1.5 rounded-md px-3.5 py-2 text-xs font-medium border transition-colors"
              style={{
                borderColor: 'rgba(201, 169, 110, 0.45)',
                background: 'var(--brand-soft)',
                color: 'var(--brand)',
              }}
            >
              <RotateCcw className="h-3 w-3" />
              Try again
            </button>
            <a
              href="/admin/login"
              className="inline-flex items-center gap-1.5 rounded-md px-3.5 py-2 text-xs transition-colors"
              style={{ color: 'var(--text-secondary)' }}
            >
              Go to sign-in
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
