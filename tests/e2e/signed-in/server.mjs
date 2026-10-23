#!/usr/bin/env node
// Test server for the signed-in e2e suite (tests/e2e/signed-in/playwright.config.ts).
//
// Serves the emulator build of the static export and forwards the Firebase emulator
// APIs on the same origin. The app connects its Auth and Firestore SDKs to
// `location.origin` (connectEmulators in lib/firebase.ts) and calls Functions at
// `<origin>/<project>/us-central1`, so every request the app makes stays within the
// export's real Content-Security-Policy ('self') instead of needing extra hosts.
//
// Usage: node tests/e2e/signed-in/server.mjs
// Reads SIGNED_IN_PORT, SIGNED_IN_SITE_DIR, SIGNED_IN_PROJECT and the emulator ports
// that run.mjs exports (SIGNED_IN_AUTH_PORT, SIGNED_IN_FIRESTORE_PORT,
// SIGNED_IN_FUNCTIONS_PORT).
import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer, request } from 'node:http'
import { createServer as createTcpServer } from 'node:net'
import { extname, join, normalize, resolve, sep } from 'node:path'

const HOST = '127.0.0.1'

function requiredEnv(name) {
  const value = process.env[name]
  if (!value) {
    console.error(
      `signed-in server: ${name} is not set. Run the suite with npm run test:e2e:signed-in.`,
    )
    process.exit(2)
  }
  return value
}

const port = Number(requiredEnv('SIGNED_IN_PORT'))
const root = resolve(requiredEnv('SIGNED_IN_SITE_DIR'))
const project = requiredEnv('SIGNED_IN_PROJECT')
const authPort = Number(requiredEnv('SIGNED_IN_AUTH_PORT'))
const firestorePort = Number(requiredEnv('SIGNED_IN_FIRESTORE_PORT'))
const functionsPort = Number(requiredEnv('SIGNED_IN_FUNCTIONS_PORT'))

if (!existsSync(join(root, 'index.html'))) {
  console.error(`signed-in server: ${root} has no index.html. Build the emulator site first.`)
  process.exit(1)
}

/** Path prefixes the emulators answer, and where each goes. */
const ROUTES = [
  // Auth: REST APIs, token refresh, and the sign-in popup and iframe helpers.
  { prefix: '/identitytoolkit.googleapis.com/', port: authPort },
  { prefix: '/securetoken.googleapis.com/', port: authPort },
  { prefix: '/emulator/', port: authPort },
  // Firestore: the Web SDK's WebChannel and REST endpoints.
  { prefix: '/google.firestore.v1.Firestore/', port: firestorePort },
  { prefix: '/v1/projects/', port: firestorePort },
  // Functions: NEXT_PUBLIC_FUNCTIONS_URL is <origin>/<project>/us-central1.
  { prefix: `/${project}/`, port: functionsPort, functions: true },
]

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

/** The export file for a URL path, with the trailing-slash routing Firebase Hosting uses. */
function resolveFile(urlPath) {
  let decoded
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0] ?? '/')
  } catch {
    return null
  }
  const target = normalize(join(root, decoded))
  if (target !== root && !target.startsWith(root + sep)) return null
  if (existsSync(target) && statSync(target).isFile()) return target
  const index = join(target, 'index.html')
  if (existsSync(index)) return index
  return null
}

function serveStatic(req, res) {
  const file = resolveFile(req.url || '/')
  if (!file) {
    const notFound = join(root, '404.html')
    res.writeHead(404, { 'Content-Type': TYPES['.html'], 'Cache-Control': 'no-store' })
    if (existsSync(notFound)) createReadStream(notFound).pipe(res)
    else res.end('Not found')
    return
  }
  res.writeHead(200, {
    'Content-Type': TYPES[extname(file)] || 'application/octet-stream',
    'Cache-Control': 'no-store',
  })
  createReadStream(file).pipe(res)
}

function forward(req, res, route) {
  const headers = { ...req.headers, host: `${HOST}:${route.port}` }
  // The browser sees one origin, so these calls are same-origin and need no CORS.
  // The Functions only allow their production origin (APP_URL), so drop the Origin
  // header that same-origin POST and DELETE requests carry, as a same-origin
  // reverse proxy would.
  if (route.functions) delete headers.origin
  const upstream = request(
    // A fresh connection per request: a pooled keep-alive socket the emulator has
    // already closed would fail the request with ECONNRESET.
    { host: HOST, port: route.port, method: req.method, path: req.url, headers, agent: false },
    upstreamRes => {
      res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers)
      // Firestore streams responses (WebChannel); pipe without buffering.
      upstreamRes.pipe(res)
    },
  )
  // The browser drops long-poll requests on reload or navigation; drop ours too.
  res.on('close', () => {
    if (!res.writableFinished) upstream.destroy()
  })
  upstream.on('error', error => {
    if (res.destroyed) return
    console.error(`signed-in server: ${req.method} ${req.url} failed: ${error.message}`)
    if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end(`Emulator unavailable: ${error.message}`)
  })
  req.pipe(upstream)
}

/** Resolves true once `candidate` can be bound on HOST. */
function portIsFree(candidate) {
  return new Promise(resolveFree => {
    const probe = createTcpServer()
    probe.once('error', () => resolveFree(false))
    probe.listen(candidate, HOST, () => probe.close(() => resolveFree(true)))
  })
}

// A pinned PLAYWRIGHT_PORT can still be held for a moment by the previous run's
// server while it shuts down. Wait for it instead of failing with EADDRINUSE.
const portDeadline = Date.now() + 30_000
while (!(await portIsFree(port))) {
  if (Date.now() > portDeadline) {
    console.error(`signed-in server: port ${port} is still in use after 30 s.`)
    process.exit(1)
  }
  await new Promise(resolveDelay => setTimeout(resolveDelay, 250))
}

createServer((req, res) => {
  const route = ROUTES.find(r => (req.url || '/').startsWith(r.prefix))
  if (route) forward(req, res, route)
  else serveStatic(req, res)
}).listen(port, HOST, () => {
  console.log(`signed-in server: ${root} on http://${HOST}:${port}`)
})
