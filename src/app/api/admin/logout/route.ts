import { NextRequest, NextResponse } from 'next/server'
import { ADMIN_SESSION_COOKIE } from '@/lib/admin-auth'
import { requestPublicUrl } from '@/lib/request-public-url'

export async function POST(req: NextRequest): Promise<NextResponse> {
  const response = NextResponse.redirect(requestPublicUrl(req, '/admin/login'), 303)
  response.headers.set('Cache-Control', 'no-store')
  response.cookies.delete(ADMIN_SESSION_COOKIE)
  return response
}
