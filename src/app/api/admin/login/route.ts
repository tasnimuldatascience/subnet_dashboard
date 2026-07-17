import { NextRequest, NextResponse } from 'next/server'
import {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_MAX_AGE_SECONDS,
  createAdminSessionToken,
  isAdminAuthConfigured,
  safeAdminRedirectPath,
  verifyAdminCredentials,
} from '@/lib/admin-auth'
import { requestPublicUrl } from '@/lib/request-public-url'

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isAdminAuthConfigured()) {
    return new NextResponse(
      'Admin surface is misconfigured: ADMIN_USER and ADMIN_PASS env vars are not set on the server.',
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  const formData = await req.formData()
  const username = formData.get('username')
  const password = formData.get('password')
  const destination = safeAdminRedirectPath(formData.get('next'))

  if (
    typeof username !== 'string' ||
    typeof password !== 'string' ||
    !verifyAdminCredentials(username, password)
  ) {
    const loginUrl = requestPublicUrl(req, '/admin/login')
    loginUrl.searchParams.set('error', 'invalid')
    loginUrl.searchParams.set('next', destination)
    const response = NextResponse.redirect(loginUrl, 303)
    response.headers.set('Cache-Control', 'no-store')
    return response
  }

  const token = await createAdminSessionToken(username)
  if (!token) {
    return new NextResponse('Could not create an admin session.', {
      status: 500,
      headers: { 'Cache-Control': 'no-store' },
    })
  }

  const response = NextResponse.redirect(requestPublicUrl(req, destination), 303)
  response.headers.set('Cache-Control', 'no-store')
  response.cookies.set(ADMIN_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: ADMIN_SESSION_MAX_AGE_SECONDS,
  })
  return response
}
