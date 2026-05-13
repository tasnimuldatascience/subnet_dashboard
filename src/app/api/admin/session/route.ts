/**
 * Session endpoint for the /admin surface.
 *
 *   POST   /api/admin/session   body: { username, password }
 *          → 200 { ok: true, next } and Set-Cookie on success
 *          → 401 { error: 'invalid_credentials' } on failure
 *
 *   DELETE /api/admin/session
 *          → 200 with an expired Set-Cookie so the browser drops it
 *
 * Auth check uses constant-time equality so a partial password
 * cannot be probed via response timing. The session cookie is
 * httpOnly, SameSite=Lax, and Secure in production.
 *
 * The middleware exempts this route specifically, so the login
 * form can call it before a session exists.
 */

import { NextRequest, NextResponse } from 'next/server'
import { SESSION_COOKIE, SESSION_TTL_MS, signSession } from '@/lib/admin-session'

export const runtime = 'edge'
export const dynamic = 'force-dynamic'

function safeEquals(a: string, b: string): boolean {
  const enc = new TextEncoder()
  const aBytes = enc.encode(a)
  const bBytes = enc.encode(b)
  const len = Math.max(aBytes.length, bBytes.length, 1)
  let diff = aBytes.length ^ bBytes.length
  for (let i = 0; i < len; i++) {
    const x = i < aBytes.length ? aBytes[i] : 0
    const y = i < bBytes.length ? bBytes[i] : 0
    diff |= x ^ y
  }
  return diff === 0
}

function isSafeNext(next: unknown): next is string {
  // Only accept in-app /admin/... paths. Prevents using the
  // post-login redirect as an open-redirect vector.
  return (
    typeof next === 'string' &&
    next.startsWith('/admin') &&
    !next.startsWith('//') &&
    !next.startsWith('/admin/login')
  )
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const expectedUser = process.env.ADMIN_USER
  const expectedPass = process.env.ADMIN_PASS
  if (!expectedUser || !expectedPass) {
    return NextResponse.json({ error: 'misconfigured' }, { status: 503 })
  }

  let body: { username?: unknown; password?: unknown; next?: unknown } = {}
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  }
  const username = typeof body.username === 'string' ? body.username : ''
  const password = typeof body.password === 'string' ? body.password : ''

  // Always run BOTH compares so timing doesn't distinguish
  // wrong-user from wrong-password.
  const userOk = safeEquals(username, expectedUser)
  const passOk = safeEquals(password, expectedPass)
  if (!(userOk && passOk)) {
    return NextResponse.json(
      { error: 'invalid_credentials' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  const token = await signSession(expectedPass)
  const isHttps = req.nextUrl.protocol === 'https:'
  const nextPath = isSafeNext(body.next) ? (body.next as string) : '/admin'

  const res = NextResponse.json(
    { ok: true, next: nextPath },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  )
  res.cookies.set({
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: 'lax',
    secure: isHttps,
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  })
  return res
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const isHttps = req.nextUrl.protocol === 'https:'
  const res = NextResponse.json(
    { ok: true },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  )
  res.cookies.set({
    name: SESSION_COOKIE,
    value: '',
    httpOnly: true,
    sameSite: 'lax',
    secure: isHttps,
    path: '/',
    maxAge: 0,
  })
  return res
}
