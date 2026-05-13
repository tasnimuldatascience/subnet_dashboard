import { NextRequest, NextResponse } from 'next/server'
import { SESSION_COOKIE, verifySession } from './lib/admin-session'

/**
 * Session gate for the admin surface.
 *
 * Two paths through here:
 *   - /admin/**          → page requests. Missing/expired session
 *                          redirects to /admin/login?next=<requested>.
 *                          The browser keeps the URL bar pointed at
 *                          /admin/login so users see a styled form,
 *                          not the system credential prompt.
 *   - /api/admin/**      → JSON endpoints. Missing/expired session
 *                          returns a 401 with a JSON body so the
 *                          client can react cleanly. Server-component
 *                          fetches forward the cookie, so the page
 *                          path is the only entry point that ever
 *                          needs the redirect.
 *
 * Two routes are exempted from the gate:
 *   - /admin/login         (the form itself)
 *   - /api/admin/session   (POST to log in, DELETE to log out)
 *
 * If ADMIN_PASS isn't set the surface returns 503 with a clear
 * error so misconfig never silently lets a request through.
 */

export const config = {
  matcher: ['/admin/:path*', '/api/admin/:path*'],
}

const EXEMPT_PATHS = new Set<string>(['/admin/login', '/api/admin/session'])

function jsonUnauthorized(): NextResponse {
  return NextResponse.json(
    { error: 'unauthorized' },
    { status: 401, headers: { 'Cache-Control': 'no-store' } },
  )
}

function misconfigured(): NextResponse {
  return new NextResponse(
    'Admin surface is misconfigured: ADMIN_USER and ADMIN_PASS env vars are not set on the server.',
    { status: 503, headers: { 'Cache-Control': 'no-store' } },
  )
}

function redirectToLogin(req: NextRequest): NextResponse {
  // Bounce the user back to where they were trying to go after login.
  // The login form re-attaches this as ?next on submit.
  const url = req.nextUrl.clone()
  url.pathname = '/admin/login'
  url.search = ''
  const requested =
    req.nextUrl.pathname + (req.nextUrl.search ? req.nextUrl.search : '')
  // Only round-trip benign in-app paths so we don't accept open
  // redirects via the next param. Login form re-validates this too.
  if (requested.startsWith('/admin') && !requested.startsWith('/admin/login')) {
    url.searchParams.set('next', requested)
  }
  const res = NextResponse.redirect(url)
  res.headers.set('Cache-Control', 'no-store')
  return res
}

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const expectedUser = process.env.ADMIN_USER
  const expectedPass = process.env.ADMIN_PASS
  if (!expectedUser || !expectedPass) {
    return misconfigured()
  }

  const path = req.nextUrl.pathname
  // Let the login form and the session endpoint through; everything
  // else under /admin or /api/admin needs a valid session cookie.
  if (EXEMPT_PATHS.has(path)) {
    return NextResponse.next()
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value
  const session = await verifySession(token, expectedPass)
  if (session) {
    return NextResponse.next()
  }

  // Page request: redirect to a styled login screen.
  // API request: return JSON 401 so client code can handle it.
  if (path.startsWith('/api/')) {
    return jsonUnauthorized()
  }
  return redirectToLogin(req)
}
