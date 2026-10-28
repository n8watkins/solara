#!/usr/bin/env node
// Runs the signed-in e2e suite (npm run test:e2e:signed-in) against the Firebase
// Local Emulator Suite: Auth, Firestore (with the real firestore.rules) and the real
// Functions source.
//
// 1. Picks a free port for the test server and for every emulator, so runs never
//    collide with each other or with other emulators on the machine.
// 2. Builds the Functions and an emulator build of the static export
//    (NEXT_PUBLIC_FIREBASE_EMULATORS=1) into test-results/signed-in/site, never
//    into out/.
// 3. Starts the emulators with `firebase emulators:exec` and runs Playwright inside
//    it (tests/e2e/signed-in/playwright.config.ts).
//
// Usage: node tests/e2e/signed-in/run.mjs [playwright test args...]
// Set PLAYWRIGHT_PORT to pin the test server's port. Needs Java 21 for the
// Firestore emulator and `npm ci --prefix functions` for firebase-tools.
import { spawn, spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { createServer } from 'node:net'
import { join, resolve } from 'node:path'
import { startFakeOpenMeteo } from './fake-open-meteo.mjs'
import { startFakeStripe } from './fake-stripe.mjs'

const HOST = '127.0.0.1'
// A demo- project needs no credentials, and the emulators never let it reach a
// real Firebase project.
const PROJECT = 'demo-solara-signed-in'
const SITE_DIR = resolve('test-results/signed-in/site')
// Records which test-server origin a build targets (it is baked into the bundle).
const SITE_INFO = resolve('test-results/signed-in/site.json')

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

/** Distinct free ports other than `exclude`, so no two services share a port. */
async function freePorts(count, exclude) {
  const ports = new Set()
  while (ports.size < count) {
    const candidate = await freePort()
    if (candidate !== exclude) ports.add(candidate)
  }
  return [...ports]
}

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { stdio: 'inherit', env })
  if (result.status !== 0) {
    console.error(`signed-in: ${command} ${args.join(' ')} failed`)
    process.exit(result.status ?? 1)
  }
}

const firebaseBin = resolve('functions/node_modules/.bin/firebase')
if (!existsSync(firebaseBin)) {
  console.error('signed-in: firebase-tools is missing. Run `npm ci --prefix functions` first.')
  process.exit(1)
}

const pinned = Number(process.env.PLAYWRIGHT_PORT)

// Outgoing connections take their local port from the kernel's ephemeral range, and
// such a socket (open, or for a minute in TIME_WAIT afterwards) keeps the test server
// from listening on that port. A pinned port inside the range can therefore be taken
// by any busy process on the machine, and the run then fails to start.
const EPHEMERAL_RANGE = '/proc/sys/net/ipv4/ip_local_port_range'
if (pinned && existsSync(EPHEMERAL_RANGE)) {
  const [low, high] = readFileSync(EPHEMERAL_RANGE, 'utf8').trim().split(/\s+/).map(Number)
  if (pinned >= low && pinned <= high) {
    console.warn(
      `signed-in: PLAYWRIGHT_PORT ${pinned} is inside this machine's ephemeral port range ` +
        `(${low}-${high}), so an outgoing connection can hold it and the run may fail to ` +
        'start. Pin a port outside that range.',
    )
  }
}
const [
  picked,
  authPort,
  firestorePort,
  firestoreWsPort,
  functionsPort,
  eventarcPort,
  tasksPort,
  hubPort,
  loggingPort,
  stripePort,
  openMeteoPort,
] = await freePorts(11, pinned)
const port = pinned || picked
const origin = `http://${HOST}:${port}`

// --- Build ---------------------------------------------------------------------------

// The Functions emulator loads the compiled Functions (functions/lib, with
// @solara/core in functions/core), the same build `firebase deploy` uploads.
run('npm', ['run', 'build', '--prefix', 'functions'])

// SIGNED_IN_SKIP_BUILD=1 reuses the previous build while iterating locally on
// tests; it must have been built for the same port.
const reuse = process.env.SIGNED_IN_SKIP_BUILD === '1'
if (reuse) {
  const info = existsSync(SITE_INFO) ? JSON.parse(readFileSync(SITE_INFO, 'utf8')) : null
  if (info?.origin !== origin) {
    console.error(
      `signed-in: no previous build for ${origin}; run once without SIGNED_IN_SKIP_BUILD.`,
    )
    process.exit(1)
  }
} else {
  buildSite()
}

function buildSite() {
  // Hermetic public env: a demo Firebase project wired to the emulators, nothing else.
  // The process env wins over .env files, so a developer's .env.local cannot leak in.
  const buildEnv = {
    ...process.env,
    NEXT_PUBLIC_FIREBASE_EMULATORS: '1',
    NEXT_PUBLIC_FIREBASE_API_KEY: 'demo-api-key',
    // Required by popup sign-in; in emulator builds the helper pages come from the
    // Auth emulator instead, so this host is never contacted.
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: `${PROJECT}.firebaseapp.com`,
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: PROJECT,
    NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: '',
    NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: '',
    NEXT_PUBLIC_FIREBASE_APP_ID: '',
    NEXT_PUBLIC_FIREBASE_VAPID_KEY: '',
    NEXT_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY: '',
    NEXT_PUBLIC_FUNCTIONS_URL: `${origin}/${PROJECT}/us-central1`,
    // Pro checkout is on, against the fake Stripe below.
    NEXT_PUBLIC_BILLING_ENABLED: '1',
    // A placeholder client: the suite answers Google Identity Services and the
    // Calendar API itself (fake-google-calendar.ts), so scheduling can be tested.
    NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID: 'solara-e2e.apps.googleusercontent.com',
    NEXT_PUBLIC_GA_MEASUREMENT_ID: '',
    NEXT_PUBLIC_SENTRY_DSN: '',
    NEXT_PUBLIC_UI_HARNESS: '',
    NEXT_TELEMETRY_DISABLED: '1',
  }

  // `next build` directly, not `npm run build`: the production postbuild refuses the
  // emulator flag (scripts/check-no-emulators.mjs). The export is moved out of out/
  // right away, so out/ never keeps an emulator build.
  run(process.execPath, [join('node_modules', 'next', 'dist', 'bin', 'next'), 'build'], buildEnv)
  rmSync(SITE_DIR, { recursive: true, force: true })
  mkdirSync(resolve(SITE_DIR, '..'), { recursive: true })
  renameSync(resolve('out'), SITE_DIR)
  run('node', ['scripts/check-no-emulators.mjs', SITE_DIR, '--expect-emulators'], buildEnv)
  // As in production: the landing page ships without the framework scripts.
  run('node', ['scripts/static-pages.mjs', SITE_DIR], buildEnv)
  // The emulator flag in buildEnv also lets the policy frame the Auth emulator's
  // sign-in helper, which this suite serves on the page's own origin (lib/csp.mts).
  run('node', ['scripts/csp.mjs', SITE_DIR], buildEnv)
  run('node', ['scripts/build-sw.mjs', SITE_DIR], buildEnv)

  writeFileSync(SITE_INFO, JSON.stringify({ origin }))
}

// --- Emulators -----------------------------------------------------------------------

// firebase-tools only accepts rules and Functions source inside the directory that
// holds the config, so the run gets its own project directory in the gitignored
// .firebase/ folder, linking to the real rules and Functions source.
const projectDir = resolve('.firebase', `signed-in-${port}`)
const configPath = join(projectDir, 'firebase.json')
rmSync(projectDir, { recursive: true, force: true })
mkdirSync(projectDir, { recursive: true })
symlinkSync(resolve('firestore.rules'), join(projectDir, 'firestore.rules'))
symlinkSync(resolve('functions'), join(projectDir, 'functions'), 'dir')
writeFileSync(
  configPath,
  JSON.stringify(
    {
      firestore: { rules: 'firestore.rules' },
      functions: { source: 'functions' },
      emulators: {
        auth: { host: HOST, port: authPort },
        firestore: { host: HOST, port: firestorePort, websocketPort: firestoreWsPort },
        functions: { host: HOST, port: functionsPort },
        // Started alongside Functions; their default ports are shared machine-wide.
        eventarc: { host: HOST, port: eventarcPort },
        tasks: { host: HOST, port: tasksPort },
        hub: { host: HOST, port: hubPort },
        logging: { host: HOST, port: loggingPort },
        ui: { enabled: false },
        singleProjectMode: true,
      },
    },
    null,
    2,
  ),
)

// The Functions read their Stripe key from Secret Manager, which a demo project cannot
// reach; the emulator takes secrets from functions/.secret.local instead (gitignored).
// The placeholder key only ever reaches the local fake Stripe below.
const WEBHOOK_SECRET = 'whsec_signed_in_emulator'
const OPEN_METEO_KEY = 'e2e-open-meteo-key'
const secretsPath = resolve('functions/.secret.local')
const ownsSecrets = !existsSync(secretsPath)
if (!ownsSecrets) {
  console.warn(
    'signed-in: using the existing functions/.secret.local; billing and forecast tests ' +
      `need its STRIPE_WEBHOOK_SECRET to be ${WEBHOOK_SECRET} and its OPEN_METEO_API_KEY ` +
      `to be ${OPEN_METEO_KEY}.`,
  )
}
if (ownsSecrets) {
  writeFileSync(
    secretsPath,
    [
      'STRIPE_SECRET_KEY=sk_test_signed_in_emulator',
      `STRIPE_WEBHOOK_SECRET=${WEBHOOK_SECRET}`,
      `OPEN_METEO_API_KEY=${OPEN_METEO_KEY}`,
      '',
    ].join('\n'),
  )
}

// Stripe: the Functions emulator talks to a local fake (fake-stripe.mjs), which delivers
// signed webhook events back to the stripeWebhook Function. The demo project's own
// params file switches billing on with two fake prices and points the return URLs at
// the test server. It is named for the demo project, so it never touches a real one.
const { server: fakeStripe } = await startFakeStripe({
  port: stripePort,
  webhookUrl: `http://${HOST}:${functionsPort}/${PROJECT}/us-central1/stripeWebhook`,
  webhookSecret: WEBHOOK_SECRET,
})
// The forecast proxy is on in the Functions (the browser build keeps calling Open-Meteo,
// which the fixtures answer) and calls a local stand-in for the commercial API.
const fakeOpenMeteo = await startFakeOpenMeteo({ port: openMeteoPort, apiKey: OPEN_METEO_KEY })
const paramsPath = resolve(`functions/.env.${PROJECT}`)
writeFileSync(
  paramsPath,
  [
    `APP_URL=${origin}`,
    'STRIPE_PRICE_ID=price_e2e_monthly',
    'STRIPE_YEARLY_PRICE_ID=price_e2e_yearly',
    'BILLING_ENABLED=true',
    'FORECAST_PROXY_ENABLED=true',
    '',
  ].join('\n'),
)

const playwrightCli = resolve('node_modules/@playwright/test/cli.js')
const testArgs = process.argv.slice(2).map(arg => `'${arg.replace(/'/g, `'\\''`)}'`)
const testCommand = [
  `'${process.execPath}'`,
  `'${playwrightCli}'`,
  'test',
  '-c',
  'tests/e2e/signed-in/playwright.config.ts',
  ...testArgs,
].join(' ')

const child = spawn(
  firebaseBin,
  [
    'emulators:exec',
    '--only',
    'auth,firestore,functions',
    '--project',
    PROJECT,
    '--config',
    configPath,
    testCommand,
  ],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      NO_UPDATE_NOTIFIER: '1',
      // Accepts the emulator build's local App Check tokens inside the Functions
      // emulator only; see the file for why this cannot reach production.
      NODE_OPTIONS: [
        process.env.NODE_OPTIONS,
        `--require=${resolve('tests/e2e/signed-in/emulator-app-check.js')}`,
      ]
        .filter(Boolean)
        .join(' '),
      SIGNED_IN_PORT: String(port),
      SIGNED_IN_SITE_DIR: SITE_DIR,
      SIGNED_IN_PROJECT: PROJECT,
      SIGNED_IN_AUTH_PORT: String(authPort),
      SIGNED_IN_FIRESTORE_PORT: String(firestorePort),
      SIGNED_IN_FUNCTIONS_PORT: String(functionsPort),
      // Read by the Functions emulator only (functions/src/billing/config.ts) and by the
      // tests, which act as the customer on Stripe's pages.
      STRIPE_API_BASE: `http://${HOST}:${stripePort}`,
      OPEN_METEO_API_BASE: `http://${HOST}:${openMeteoPort}/v1/forecast`,
    },
  },
)

function cleanup() {
  rmSync(projectDir, { recursive: true, force: true })
  rmSync(paramsPath, { force: true })
  if (ownsSecrets) rmSync(secretsPath, { force: true })
  fakeStripe.close()
  fakeOpenMeteo.close()
}
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal))
}
child.on('exit', (code, signal) => {
  cleanup()
  process.exit(code ?? (signal ? 1 : 0))
})
