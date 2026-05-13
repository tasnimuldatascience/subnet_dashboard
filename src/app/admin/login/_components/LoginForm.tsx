'use client'

import { useState, useRef, useEffect, FormEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Shield, Lock, User as UserIcon, AlertTriangle, Loader2 } from 'lucide-react'

/**
 * Styled login form for the admin surface. Posts to
 * /api/admin/session, then router.push()es to the `next` param
 * (defaults to /admin). Designed to feel native to the dashboard:
 * dark canvas, warm gold accent, tabular numerals everywhere.
 *
 * The form is intentionally simple: two inputs, one submit. No
 * "remember me" toggle (the cookie's 12-hour TTL is the answer to
 * that question), no password reset link (there is no user store
 * to reset against), no signup affordance (single shared
 * credential).
 */
export function LoginForm() {
  const router = useRouter()
  const search = useSearchParams()
  const next = search.get('next') || '/admin'

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const userRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    userRef.current?.focus()
  }, [])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, next }),
        cache: 'no-store',
      })
      if (res.status === 401) {
        setError('Incorrect username or password.')
        setSubmitting(false)
        return
      }
      if (!res.ok) {
        const body = await res.text()
        setError(`Sign-in failed (${res.status}): ${body.slice(0, 120)}`)
        setSubmitting(false)
        return
      }
      const body = (await res.json()) as { next?: string }
      // Hard reload to the destination so the server components
      // re-render with the new cookie attached. router.push() alone
      // would not re-issue the initial /admin RSC fetch with the
      // cookie set in this response cycle.
      const target = body?.next || next
      window.location.assign(target)
    } catch (err) {
      setError(
        err instanceof Error
          ? `Network error: ${err.message}`
          : 'Network error',
      )
      setSubmitting(false)
    }
  }

  return (
    <div className="w-full max-w-sm">
      {/* Brand mark */}
      <div className="flex flex-col items-center gap-3 mb-8">
        <div
          className="flex h-11 w-11 items-center justify-center rounded-xl"
          style={{
            background: 'var(--brand-soft)',
            border: '1px solid rgba(201, 169, 110, 0.35)',
          }}
        >
          <Shield className="h-5 w-5 text-gold" />
        </div>
        <div className="text-center">
          <div
            className="text-[10px] uppercase tracking-[0.2em]"
            style={{ color: 'var(--text-tertiary)' }}
          >
            Leadpoet
          </div>
          <h1
            className="text-xl font-medium tracking-tight mt-1"
            style={{ color: 'var(--text-primary)' }}
          >
            Fulfillment Admin
          </h1>
        </div>
      </div>

      <form
        onSubmit={onSubmit}
        className="rounded-2xl border p-6 space-y-4"
        style={{
          borderColor: 'var(--surface-border)',
          background: 'var(--surface)',
        }}
      >
        <div>
          <label
            htmlFor="login-user"
            className="text-[10px] uppercase tracking-[0.14em] block mb-1.5"
            style={{ color: 'var(--text-tertiary)' }}
          >
            Username
          </label>
          <div className="relative">
            <UserIcon
              className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5"
              style={{ color: 'var(--text-tertiary)' }}
            />
            <input
              ref={userRef}
              id="login-user"
              type="text"
              autoComplete="username"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="premium-focus w-full rounded-lg border px-9 py-2.5 text-sm bg-transparent"
              style={{
                borderColor: 'var(--surface-border)',
                background: 'var(--surface-elevated)',
                color: 'var(--text-primary)',
              }}
            />
          </div>
        </div>

        <div>
          <label
            htmlFor="login-pass"
            className="text-[10px] uppercase tracking-[0.14em] block mb-1.5"
            style={{ color: 'var(--text-tertiary)' }}
          >
            Password
          </label>
          <div className="relative">
            <Lock
              className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5"
              style={{ color: 'var(--text-tertiary)' }}
            />
            <input
              id="login-pass"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="premium-focus w-full rounded-lg border px-9 py-2.5 text-sm bg-transparent"
              style={{
                borderColor: 'var(--surface-border)',
                background: 'var(--surface-elevated)',
                color: 'var(--text-primary)',
              }}
            />
          </div>
        </div>

        {error && (
          <div
            className="rounded-lg border p-3 flex items-start gap-2"
            style={{
              background: 'rgba(168, 116, 111, 0.10)',
              borderColor: 'rgba(168, 116, 111, 0.30)',
            }}
          >
            <AlertTriangle className="h-3.5 w-3.5 text-burgundy flex-shrink-0 mt-0.5" />
            <div className="text-xs text-burgundy">{error}</div>
          </div>
        )}

        <button
          type="submit"
          disabled={submitting || !username || !password}
          className="w-full inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2.5 text-sm font-medium transition-all border disabled:opacity-50 disabled:cursor-not-allowed"
          style={{
            borderColor: 'rgba(201, 169, 110, 0.45)',
            background: 'var(--brand-soft)',
            color: 'var(--brand)',
          }}
        >
          {submitting ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Signing in…
            </>
          ) : (
            <>Sign in</>
          )}
        </button>

        <p
          className="text-[11px] text-center pt-1"
          style={{ color: 'var(--text-tertiary)' }}
        >
          Internal only · session expires after 12 hours
        </p>
      </form>
    </div>
  )
}
