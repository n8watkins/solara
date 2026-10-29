#!/usr/bin/env node
// Serves a static export through the Firebase Hosting emulator for the Playwright
// e2e suite (playwright.config.ts), so tests run against what ships: the `out/`
// export with the real firebase.json headers, rewrites and caching rules, not
// `next dev`.
//
// Usage: node tests/e2e/serve-export.mjs <port> [--redirect-site]
//
// With --redirect-site it serves firebase.json's second site instead: the old
// address that only redirects to the app (hosting-redirect/), with no build.
//
// By default it first runs `npm run build` with the caller's environment (the
// Playwright config passes a hermetic public env), which also runs the prebuild
// and postbuild checks. Set E2E_SITE_DIR to serve an existing export instead:
// CI uses that to test the exact production artifact it is about to deploy.
//
// firebase-tools comes from functions/node_modules (locked by
// functions/package-lock.json), so run `npm ci --prefix functions` first.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { join, relative, resolve } from 'node:path'

const HOST = '127.0.0.1'
const port = Number(process.argv[2])
const redirectSite = process.argv.slice(3).includes('--redirect-site')
if (!Number.isInteger(port) || port <= 0) {
  console.error('Usage: node tests/e2e/serve-export.mjs <port> [--redirect-site]')
  process.exit(2)
}

// firebase.json names each Hosting config by its deploy target (.firebaserc maps it to
// a site per project): `app`, and `redirect`, which only redirects the old address.
// Serve one config's headers, rewrites, redirects and caching rules.
const { target: _target, ...hosting } = JSON.parse(
  readFileSync('firebase.json', 'utf8'),
).hosting.find(config => config.target === (redirectSite ? 'redirect' : 'app'))
// Production Hosting matches `regex` redirects with RE2, and so does the emulator
// when the optional `re2` native module loaded. CI installs with --ignore-scripts, so
// the emulator falls back to JavaScript RegExp, which spells a named group `(?<name>`
// instead of RE2's `(?P<name>` (superstatic's documented fallback). Translate only that
// spelling, so the rest of the pattern is tested exactly as deployed.
if (redirectSite && !re2Loads()) {
  hosting.redirects = hosting.redirects.map(redirect =>
    redirect.regex ? { ...redirect, regex: redirect.regex.replaceAll('(?P<', '(?<') } : redirect,
  )
}

function re2Loads() {
  try {
    createRequire(resolve('functions/package.json'))('re2')
    return true
  } catch {
    return false
  }
}
const prebuilt = process.env.E2E_SITE_DIR
const siteDir = resolve(redirectSite ? hosting.public : prebuilt || 'out')

if (!prebuilt && !redirectSite) {
  const build = spawnSync('npm', ['run', 'build'], { stdio: 'inherit', env: process.env })
  if (build.status !== 0) process.exit(build.status ?? 1)
}
if (!existsSync(join(siteDir, 'index.html'))) {
  console.error(`serve-export: ${siteDir} has no index.html. Build the static export first.`)
  process.exit(1)
}

const firebaseBin = resolve('functions/node_modules/.bin/firebase')
if (!existsSync(firebaseBin)) {
  console.error('serve-export: firebase-tools is missing. Run `npm ci --prefix functions` first.')
  process.exit(1)
}

/** Asks the OS for a free TCP port on HOST. */
function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, HOST, () => {
      const address = server.address()
      server.close(() => resolvePort(typeof address === 'object' && address ? address.port : 0))
    })
  })
}

// The emulator hub and logging ports default to fixed numbers shared machine-wide,
// so pick free ones; only Hosting listens on the port Playwright chose.
const [hubPort, loggingPort] = [await freePort(), await freePort()]

/** Resolves true once `candidate` can be bound on HOST. */
function portIsFree(candidate) {
  return new Promise(resolveFree => {
    const server = createServer()
    server.once('error', () => resolveFree(false))
    server.listen(candidate, HOST, () => server.close(() => resolveFree(true)))
  })
}

// A pinned PLAYWRIGHT_PORT can still be held for a moment by the previous run's
// server while it shuts down. Wait for it instead of failing with EADDRINUSE.
const portDeadline = Date.now() + 30_000
while (!(await portIsFree(port))) {
  if (Date.now() > portDeadline) {
    console.error(`serve-export: port ${port} is still in use after 30 s.`)
    process.exit(1)
  }
  await new Promise(resolveDelay => setTimeout(resolveDelay, 250))
}
// The config lives in the gitignored .firebase/ directory: firebase-tools resolves
// `public` relative to the config file and serves nothing for a public directory
// outside an ancestor of the config.
const configDir = resolve('.firebase')
const configPath = join(configDir, `e2e-hosting-${port}.json`)
mkdirSync(configDir, { recursive: true })
writeFileSync(
  configPath,
  JSON.stringify({
    hosting: { ...hosting, public: relative(configDir, siteDir) },
    emulators: {
      hosting: { host: HOST, port },
      hub: { host: HOST, port: hubPort },
      logging: { host: HOST, port: loggingPort },
      ui: { enabled: false },
      singleProjectMode: true,
    },
  }),
)

// A demo- project id needs no credentials and never reaches a real project. The
// port suffix keeps concurrent runs from sharing one emulator hub locator file.
const child = spawn(
  firebaseBin,
  [
    'emulators:start',
    '--only',
    'hosting',
    '--project',
    `demo-solara-e2e-${port}`,
    '--config',
    configPath,
    // Per-request access logs drown out the test output.
    '--log-verbosity',
    'QUIET',
  ],
  { stdio: 'inherit', env: { ...process.env, NO_UPDATE_NOTIFIER: '1' } },
)

function cleanup() {
  rmSync(configPath, { force: true })
}
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal))
}
child.on('exit', (code, signal) => {
  cleanup()
  process.exit(code ?? (signal ? 1 : 0))
})
