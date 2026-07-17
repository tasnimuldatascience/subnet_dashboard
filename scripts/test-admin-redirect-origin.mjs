import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const outDir = await mkdtemp(join(tmpdir(), 'admin-redirect-origin-'))

try {
  const tsc = spawnSync(process.execPath, [
    resolve('node_modules/typescript/bin/tsc'),
    resolve('src/lib/request-public-url.ts'),
    '--target',
    'ES2022',
    '--module',
    'CommonJS',
    '--moduleResolution',
    'Node',
    '--outDir',
    outDir,
    '--strict',
    '--skipLibCheck',
  ], { stdio: 'inherit' })

  assert.equal(tsc.status, 0, 'public request URL helper should compile')

  const require = createRequire(import.meta.url)
  const { requestPublicUrl } = require(join(outDir, 'request-public-url.js'))

  const request = (headers, origin = 'http://localhost:3000') => ({
    headers: {
      get(name) {
        return headers[name] ?? null
      },
    },
    nextUrl: { origin },
  })

  assert.equal(
    requestPublicUrl(request({
      'x-forwarded-host': 'subnet71.com',
      'x-forwarded-proto': 'https',
      host: 'localhost:3000',
    }), '/admin?ticketId=ticket-1').href,
    'https://subnet71.com/admin?ticketId=ticket-1',
    'proxy headers should replace the internal localhost origin',
  )
  assert.equal(
    requestPublicUrl(request({
      'x-forwarded-host': 'subnet71.com, localhost:3000',
      'x-forwarded-proto': 'https, http',
    }), '/admin').href,
    'https://subnet71.com/admin',
    'the browser-facing first forwarded value should win',
  )
  assert.equal(
    requestPublicUrl(request({ host: '127.0.0.1:3100' }, 'http://127.0.0.1:3100'), '/admin').href,
    'http://127.0.0.1:3100/admin',
    'direct local requests should retain their local origin',
  )
  assert.equal(
    requestPublicUrl(request({
      'x-forwarded-host': 'bad.example/path',
      'x-forwarded-proto': 'https',
    }, 'https://subnet71.com'), '/admin').href,
    'https://subnet71.com/admin',
    'invalid forwarded origins should fall back to NextRequest.nextUrl',
  )
  assert.throws(() => requestPublicUrl(request({}), 'https://evil.example/admin'))
  assert.throws(() => requestPublicUrl(request({}), '//evil.example/admin'))

  const loginRoute = await readFile(resolve('src/app/api/admin/login/route.ts'), 'utf8')
  const logoutRoute = await readFile(resolve('src/app/api/admin/logout/route.ts'), 'utf8')
  const middleware = await readFile(resolve('src/middleware.ts'), 'utf8')
  for (const source of [loginRoute, logoutRoute, middleware]) {
    assert.match(source, /requestPublicUrl\(req,/)
    assert.doesNotMatch(source, /new URL\([^\n]*req\.url/)
  }

  console.log('admin-redirect-origin: forwarded public host and safe fallback checks passed')
} finally {
  await rm(outDir, { recursive: true, force: true })
}
