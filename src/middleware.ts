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

/**
 * Wrap every cookie-touching step in try/catch so a malformed cookie
 * left over from a previous deploy (or a Web Crypto edge case on a
 * specific browser) can never crash the middleware. A crash here
 * bypasses every route-segment error boundary and surfaces as the
 * framework's stock 500 page — which is exactly the failure mode
 * operators reported when an older session cookie outlived a code
 * push.
 *
 * On ANY error during session verification we treat the request as
 * "not signed in": clear the cookie, then redirect to login. The
 * cleared cookie prevents a re-crash on the next page load and lets
 * the operator log back in cleanly.
 */
async function safeVerify(
  token: string | undefined,
  secret: string,
): Promise<{ ok: boolean }> {
  if (!token) return { ok: false }
  try {
    const session = await verifySession(token, secret)
    return { ok: !!session }
  } catch {
    return { ok: false }
  }
}

function clearSessionCookie(res: NextResponse, isHttps: boolean): NextResponse {
  // Match the attributes the cookie was set with in
  // /api/admin/session so the browser actually drops it. Secure flag
  // follows the request protocol (true on production HTTPS, false on
  // localhost http) the same way the POST handler does.
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

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const isHttps = req.nextUrl.protocol === 'https:'
  try {
    const expectedUser = process.env.ADMIN_USER
    const expectedPass = process.env.ADMIN_PASS
    if (!expectedUser || !expectedPass) {
      return misconfigured()
    }

    const path = req.nextUrl.pathname

    // Operator escape hatch: visiting any admin path with ?logout=1
    // (most commonly /admin/login?logout=1) nukes the session cookie
    // before the page renders. This lets operators recover from a
    // bad/stale cookie without devtools.
    if (req.nextUrl.searchParams.get('logout') === '1') {
      const url = req.nextUrl.clone()
      url.pathname = '/admin/login'
      url.search = ''
      return clearSessionCookie(NextResponse.redirect(url), isHttps)
    }

    // Let the login form and the session endpoint through; everything
    // else under /admin or /api/admin needs a valid session cookie.
    if (EXEMPT_PATHS.has(path)) {
      return NextResponse.next()
    }

    const token = req.cookies.get(SESSION_COOKIE)?.value
    const { ok } = await safeVerify(token, expectedPass)
    if (ok) {
      return NextResponse.next()
    }

    // Page request: redirect to a styled login screen.
    // API request: return JSON 401 so client code can handle it.
    let res: NextResponse
    if (path.startsWith('/api/')) {
      res = jsonUnauthorized()
    } else {
      res = redirectToLogin(req)
    }
    // If there was a token present but it didn't verify, clear it.
    // Otherwise the next request would just fail-verify again.
    if (token) clearSessionCookie(res, isHttps)
    return res
  } catch {
    // Absolute last-resort: even our error handlers above threw.
    // Don't 500 — clear any session and bounce to login.
    const url = req.nextUrl.clone()
    url.pathname = '/admin/login'
    url.search = ''
    return clearSessionCookie(NextResponse.redirect(url), isHttps)
  }
}
