import { NextRequest, NextResponse } from 'next/server'

/**
 * HTTP Basic Auth gate for the admin surface.
 *
 * Why HTTP Basic and not a login page:
 *   - One shared username + password for a two-person operator team.
 *   - No profile storage, no Google OAuth, no session table.
 *   - Browser handles the credential prompt and caches credentials
 *     for the duration of the tab. Zero UI to build or maintain.
 *
 * Threat model:
 *   - This protects PII (lead emails, contact names, intent details)
 *     from drive-by access by anyone who guesses the /admin URL.
 *   - It is NOT a defense against a server compromise. If the
 *     environment variables leak, the password leaks. Pick a 24+
 *     character random password (see .env.example) and rotate it
 *     if the env ever leaks.
 *
 * Configure via env vars on the deploy target:
 *   ADMIN_USER         (e.g. "leadpoet")
 *   ADMIN_PASS         (24+ char random string)
 *
 * If either env var is missing, the admin surface returns 503 with
 * a clear error instead of silently allowing access.
 *
 * Runtime: this runs in the Edge runtime (Next's default for
 * middleware) so we cannot use node:crypto or Buffer. Constant-time
 * comparison is implemented manually below using a XOR-OR pattern.
 */

// matcher: only intercept admin routes. The public dashboard at "/"
// stays auth-free as before.
export const config = {
  matcher: ['/admin/:path*', '/api/admin/:path*'],
}

function unauthorized(): NextResponse {
  // The realm string is shown by the browser in the credential prompt.
  // Keep it terse + branded so operators know they're hitting the right
  // surface.
  return new NextResponse('Authentication required', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Leadpoet Admin", charset="UTF-8"',
      'Cache-Control': 'no-store',
    },
  })
}

function misconfigured(): NextResponse {
  return new NextResponse(
    'Admin surface is misconfigured: ADMIN_USER and ADMIN_PASS env vars are not set on the server.',
    { status: 503, headers: { 'Cache-Control': 'no-store' } },
  )
}

/**
 * Constant-time string comparison.
 *
 * Pure-JS implementation that works on both the Edge runtime and
 * Node. We XOR every byte and OR the result into an accumulator,
 * iterating over a fixed length (max of both inputs) so the loop
 * count itself does not leak the expected secret's length.
 *
 * The final result is true only if every byte matched AND the
 * lengths matched.
 */
function safeEquals(a: string, b: string): boolean {
  const encoder = new TextEncoder()
  const aBytes = encoder.encode(a)
  const bBytes = encoder.encode(b)
  const len = Math.max(aBytes.length, bBytes.length, 1)
  let diff = aBytes.length ^ bBytes.length
  for (let i = 0; i < len; i++) {
    const x = i < aBytes.length ? aBytes[i] : 0
    const y = i < bBytes.length ? bBytes[i] : 0
    diff |= x ^ y
  }
  return diff === 0
}

/**
 * Edge-compatible base64 decode that produces a UTF-8 string.
 *
 * atob() returns a "binary string" where each char's code point is
 * the original byte. We re-decode that as UTF-8 to recover the
 * original "user:pass" payload, which may contain unicode chars.
 */
function decodeBase64(b64: string): string | null {
  try {
    const binary = atob(b64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return new TextDecoder().decode(bytes)
  } catch {
    return null
  }
}

export function middleware(req: NextRequest): NextResponse {
  const expectedUser = process.env.ADMIN_USER
  const expectedPass = process.env.ADMIN_PASS
  if (!expectedUser || !expectedPass) {
    return misconfigured()
  }

  const authHeader = req.headers.get('authorization') ?? ''
  if (!authHeader.toLowerCase().startsWith('basic ')) {
    return unauthorized()
  }

  const decoded = decodeBase64(authHeader.slice(6).trim())
  if (decoded === null) {
    return unauthorized()
  }
  // "user:pass". Split on the FIRST colon only so passwords containing
  // colons aren't truncated.
  const colonAt = decoded.indexOf(':')
  if (colonAt < 0) {
    return unauthorized()
  }
  const user = decoded.slice(0, colonAt)
  const pass = decoded.slice(colonAt + 1)

  if (!safeEquals(user, expectedUser) || !safeEquals(pass, expectedPass)) {
    return unauthorized()
  }

  return NextResponse.next()
}
