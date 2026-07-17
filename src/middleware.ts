import { NextRequest, NextResponse } from 'next/server'
import {
  ADMIN_SESSION_COOKIE,
  isAdminAuthConfigured,
  safeAdminRedirectPath,
  verifyAdminSessionToken,
} from '@/lib/admin-auth'
import { requestPublicUrl } from '@/lib/request-public-url'

/**
 * Signed-cookie authentication gate for the admin surface.
 *
 * Operators sign in through /admin/login using the shared ADMIN_USER and
 * ADMIN_PASS credentials. A signed, HttpOnly cookie keeps the standalone
 * home-screen experience authenticated across launches while still protecting
 * every /admin page and /api/admin endpoint.
 */

export const config = {
  matcher: ['/admin/:path*', '/api/admin/:path*'],
}

const PUBLIC_ADMIN_PATHS = new Set([
  '/admin/login',
  '/api/admin/login',
])

function misconfigured(): NextResponse {
  return new NextResponse(
    'Admin surface is misconfigured: ADMIN_USER and ADMIN_PASS env vars are not set on the server.',
    { status: 503, headers: { 'Cache-Control': 'no-store' } },
  )
}

function clearInvalidSession(response: NextResponse, hadSessionCookie: boolean): NextResponse {
  if (hadSessionCookie) response.cookies.delete(ADMIN_SESSION_COOKIE)
  return response
}

export async function middleware(req: NextRequest): Promise<NextResponse> {
  if (!isAdminAuthConfigured()) return misconfigured()

  const pathname = req.nextUrl.pathname
  const token = req.cookies.get(ADMIN_SESSION_COOKIE)?.value
  const authenticated = await verifyAdminSessionToken(token)

  if (pathname === '/admin/login' && authenticated) {
    const destination = safeAdminRedirectPath(req.nextUrl.searchParams.get('next'))
    return NextResponse.redirect(requestPublicUrl(req, destination))
  }

  if (PUBLIC_ADMIN_PATHS.has(pathname)) {
    return clearInvalidSession(NextResponse.next(), Boolean(token) && !authenticated)
  }

  if (authenticated) return NextResponse.next()

  if (pathname.startsWith('/api/admin/')) {
    return clearInvalidSession(
      NextResponse.json(
        { error: 'Authentication required' },
        { status: 401, headers: { 'Cache-Control': 'no-store' } },
      ),
      Boolean(token),
    )
  }

  const loginUrl = requestPublicUrl(req, '/admin/login')
  loginUrl.searchParams.set('next', `${pathname}${req.nextUrl.search}`)
  return clearInvalidSession(NextResponse.redirect(loginUrl), Boolean(token))
}
