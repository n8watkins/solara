import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { connect, type AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createStaticHandler, firebaseSecurityHeaders } from './static-server.mjs'

// Layout: <dir>/site is served. Secrets sit next to it, including in a sibling
// whose name starts with the root's name (a naive prefix check would allow it).
const dir = mkdtempSync(join(tmpdir(), 'static-server-'))
const site = join(dir, 'site')
let server: Server
let port = 0

beforeAll(async () => {
  mkdirSync(join(site, 'about'), { recursive: true })
  mkdirSync(join(site, '_next', 'static'), { recursive: true })
  mkdirSync(join(dir, 'site-evil'))
  writeFileSync(join(site, 'index.html'), 'home page')
  writeFileSync(join(site, '404.html'), 'not found page')
  writeFileSync(join(site, 'about', 'index.html'), 'about page')
  writeFileSync(join(site, '_next', 'static', 'app.js'), 'self.app=1')
  writeFileSync(join(dir, 'secret.txt'), 'TOP SECRET')
  writeFileSync(join(dir, 'site-evil', 'secret.txt'), 'TOP SECRET')
  symlinkSync(join(dir, 'secret.txt'), join(site, 'link.txt'))
  symlinkSync(dir, join(site, 'parent'))
  server = createServer(createStaticHandler(site))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  port = (server.address() as AddressInfo).port
})

afterAll(async () => {
  await new Promise(resolve => server.close(resolve))
  rmSync(dir, { recursive: true, force: true })
})

/**
 * Sends the request target byte for byte over a raw socket, so no client
 * normalizes or re-encodes it first.
 */
function get(target: string): Promise<{ status: number; type: string; body: string }> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1', () => {
      socket.write(`GET ${target} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`)
    })
    let raw = ''
    socket.setEncoding('utf8')
    socket.on('data', chunk => (raw += chunk))
    socket.on('error', reject)
    socket.on('end', () => {
      const [head = '', ...rest] = raw.split('\r\n\r\n')
      const status = Number(/^HTTP\/1\.1 (\d{3})/.exec(head)?.[1])
      const type = /^content-type: (.*)$/im.exec(head)?.[1] ?? ''
      // Chunked bodies: these files are tiny, so one chunk between size lines.
      const body = rest.join('\r\n\r\n').replace(/^[0-9a-f]+\r\n|\r\n0\r\n\r\n$/gi, '')
      resolve({ status, type, body })
    })
  })
}

describe('static test server', () => {
  it.each([
    ['/', 'home page'],
    ['/index.html', 'home page'],
    ['/about', 'about page'],
    ['/about/', 'about page'],
    ['/about/?tab=1#top', 'about page'],
    ['/%61bout/', 'about page'],
    ['//about//', 'about page'],
  ])('serves %s', async (target, body) => {
    expect(await get(target)).toEqual({ status: 200, type: 'text/html; charset=utf-8', body })
  })

  it('serves assets with their content type', async () => {
    const response = await get('/_next/static/app.js?v=1')
    expect(response).toMatchObject({ status: 200, body: 'self.app=1' })
    expect(response.type).toBe('text/javascript; charset=utf-8')
  })

  it.each([
    // Plain and encoded traversal.
    '/../secret.txt',
    '/about/../../secret.txt',
    '/%2e%2e/secret.txt',
    '/%2E%2E/secret.txt',
    '/.%2e/secret.txt',
    '/about/%2e%2e/%2e%2e/secret.txt',
    // Traversal is never followed, even when it would stay inside the root.
    '/about/../index.html',
    '/about/%2e%2e/index.html',
    '/./index.html',
    // Encoded separators, which would form traversal only after decoding.
    '/..%2fsecret.txt',
    '/%2e%2e%2fsecret.txt',
    '/%2e%2e%2Fsite-evil%2Fsecret.txt',
    '/..%5csecret.txt',
    '/about%2f..%2f..%2fsecret.txt',
    // Double encoding decodes once, to a literal name that does not exist.
    '/%252e%252e/secret.txt',
    // A sibling directory that shares the root's name as a prefix.
    '/../site-evil/secret.txt',
    // Absolute paths: inside the root they name nothing; absolute-form is refused.
    `/${join(dir, 'secret.txt')}`,
    `/%2F${encodeURIComponent(join(dir, 'secret.txt').slice(1))}`,
    `http://127.0.0.1${join(dir, 'secret.txt')}`,
    '/etc/passwd',
    // Symlinks out of the root.
    '/link.txt',
    '/parent/secret.txt',
    // NUL bytes and malformed escapes are a 404, not a crash.
    '/index.html%00.txt',
    '/%E0%A4%A',
    '/%',
    '*',
  ])('refuses %s', async target => {
    const response = await get(target)
    expect(response.status).toBe(404)
    expect(response.body).toBe('not found page')
  })

  it('keeps serving after a refused request', async () => {
    await get('/%')
    expect((await get('/')).status).toBe(200)
  })
})

describe("firebase.json's headers (REVIEW7 M1)", () => {
  it('sends what production sends on every path, opener policy included', async () => {
    const headers = firebaseSecurityHeaders()
    expect(headers['Cross-Origin-Opener-Policy']).toBe('same-origin-allow-popups')
    expect(headers['Content-Security-Policy']).toContain("frame-ancestors 'none'")
    expect(headers['X-Frame-Options']).toBe('DENY')
    // Not over plain http, and tests never cache.
    expect(Object.keys(headers)).not.toContain('Strict-Transport-Security')
    expect(Object.keys(headers)).not.toContain('Cache-Control')

    const secured = createServer(createStaticHandler(site, { securityHeaders: true }))
    await new Promise<void>(resolve => secured.listen(0, '127.0.0.1', resolve))
    try {
      const origin = `http://127.0.0.1:${(secured.address() as AddressInfo).port}`
      for (const path of ['/about/', '/no-such-page/']) {
        const response = await fetch(`${origin}${path}`)
        await response.text()
        for (const [key, value] of Object.entries(headers)) {
          expect(response.headers.get(key), `${path} ${key}`).toBe(value)
        }
        expect(response.headers.get('Cache-Control')).toBe('no-store')
      }
    } finally {
      await new Promise(resolve => secured.close(resolve))
    }
    // Off by default (the UI harness).
    const plain = await fetch(`http://127.0.0.1:${port}/about/`)
    await plain.text()
    expect(plain.headers.get('Cross-Origin-Opener-Policy')).toBeNull()
  })
})
