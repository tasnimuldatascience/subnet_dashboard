/**
 * Signed-cookie session for the /admin surface.
 *
 * Why not JWT, why not iron-session, why not next-auth:
 *   - Single shared username/password, two operators. We do not
 *     need OAuth, refresh tokens, multi-tenant claims, or anything
 *     resembling a user table.
 *   - All we need is "this browser tab proved knowledge of the
 *     admin password recently, give it a session it can present
 *     back". A signed expiry-stamped cookie does exactly that in
 *     ~80 LOC with zero new dependencies.
 *
 * Wire format:
 *   cookie value = "<expiresMs>.<hmacBase64Url>"
 *
 * The HMAC is computed over the literal expiresMs string using a
 * key derived from `ADMIN_PASS`. Deriving the key from the password
 * has two nice properties:
 *   1. Rotating ADMIN_PASS automatically invalidates every live
 *      session. No separate "session secret" env var to keep in
 *      sync.
 *   2. The session secret is never weaker than the password itself.
 *
 * Cookie attributes (set in the API route):
 *   - httpOnly  : JS in the browser cannot read or steal it
 *   - sameSite=lax : sent on top-level navigations, not on
 *                    cross-site POSTs (CSRF defense for the
 *                    accidental case)
 *   - secure (in production): only sent over HTTPS
 *   - path=/admin (and /api/admin via separate cookie? no — a
 *     single path=/ cookie scoped to the admin matcher is fine
 *     because middleware only reads it on admin paths)
 *
 * Implemented on Web Crypto so it runs in the Edge runtime where
 * middleware lives. Both `signSession` and `verifySession` are
 * async because Web Crypto APIs are.
 */

export const SESSION_COOKIE = 'leadpoet_admin_session'

// 12-hour TTL. Long enough to span an operator's working session,
// short enough that a stolen cookie isn't a long-lived foothold.
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000

interface SessionPayload {
  expiresAt: number
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

function toBase64Url(bytes: ArrayBuffer): string {
  let s = ''
  const view = new Uint8Array(bytes)
  for (let i = 0; i < view.length; i++) s += String.fromCharCode(view[i])
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(s: string): Uint8Array {
  // atob doesn't grok url-safe base64; restore it first.
  const pad = '='.repeat((4 - (s.length % 4)) % 4)
  const b64 = (s + pad).replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/**
 * Mint a new session token good for SESSION_TTL_MS milliseconds.
 */
export async function signSession(secret: string): Promise<string> {
  const expiresAt = Date.now() + SESSION_TTL_MS
  const payload = String(expiresAt)
  const key = await hmacKey(secret)
  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(payload),
  )
  return `${payload}.${toBase64Url(sig)}`
}

/**
 * Verify a session token.
 *
 * Returns the decoded payload if and only if:
 *   - The cookie has the expected "<expires>.<sig>" shape
 *   - The HMAC matches (constant-time via crypto.subtle.verify)
 *   - The expiry is in the future
 *
 * Returns null on any other outcome. Callers should NOT branch on
 * which check failed; treat all failures identically.
 */
export async function verifySession(
  token: string | undefined | null,
  secret: string,
): Promise<SessionPayload | null> {
  if (!token) return null
  const dot = token.indexOf('.')
  if (dot < 1 || dot === token.length - 1) return null
  const payload = token.slice(0, dot)
  const sigB64 = token.slice(dot + 1)
  let sig: Uint8Array
  try {
    sig = fromBase64Url(sigB64)
  } catch {
    return null
  }
  const expiresAt = Number(payload)
  if (!Number.isFinite(expiresAt)) return null

  const key = await hmacKey(secret)
  // Copy the signature bytes into a fresh ArrayBuffer so the
  // BufferSource we hand to subtle.verify is unambiguously an
  // ArrayBuffer (not a SharedArrayBuffer, which TS would otherwise
  // have to consider via Uint8Array.buffer's union type).
  const sigBuf = new ArrayBuffer(sig.byteLength)
  new Uint8Array(sigBuf).set(sig)
  const ok = await crypto.subtle.verify(
    'HMAC',
    key,
    sigBuf,
    new TextEncoder().encode(payload),
  )
  if (!ok) return null
  if (expiresAt <= Date.now()) return null
  return { expiresAt }
}
