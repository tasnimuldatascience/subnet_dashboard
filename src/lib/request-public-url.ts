type RequestPublicUrlContext = {
  headers: {
    get(name: string): string | null
  }
  nextUrl: {
    origin: string
  }
}

/**
 * Build an absolute same-site URL using the browser-facing proxy headers.
 * NextRequest.url can contain the internal localhost origin behind nginx.
 */
export function requestPublicUrl(
  request: RequestPublicUrlContext,
  path: string,
): URL {
  if (!path.startsWith('/') || path.startsWith('//')) {
    throw new Error('Public request URL path must be site-relative.')
  }

  const fallbackOrigin = validOrigin(request.nextUrl.origin) ?? 'http://localhost'
  const forwardedHost = firstHeaderValue(request.headers.get('x-forwarded-host'))
  const requestHost = firstHeaderValue(request.headers.get('host'))
  const host = forwardedHost ?? requestHost
  if (!host) return new URL(path, fallbackOrigin)

  const forwardedProto = firstHeaderValue(request.headers.get('x-forwarded-proto'))
  const fallbackProto = new URL(fallbackOrigin).protocol.slice(0, -1)
  const proto = forwardedProto === 'http' || forwardedProto === 'https'
    ? forwardedProto
    : fallbackProto
  const publicOrigin = validOrigin(`${proto}://${host}`) ?? fallbackOrigin

  return new URL(path, publicOrigin)
}

function firstHeaderValue(value: string | null): string | null {
  const first = value?.split(',')[0]?.trim()
  return first || null
}

function validOrigin(value: string): string | null {
  try {
    const url = new URL(value)
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    ) {
      return null
    }
    return url.origin
  } catch {
    return null
  }
}
