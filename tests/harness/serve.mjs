#!/usr/bin/env node
// Builds the UI harness as a static export and serves it, for
// playwright.harness.config.ts. The harness runs against the same kind of static
// output that ships (not `next dev`), so there is no dev overlay or HMR in the
// screenshots.
//
// Usage: node tests/harness/serve.mjs <port>
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { join, resolve } from 'node:path'
import { createStaticHandler } from '../static-server.mts'

const port = Number(process.argv[2] || 45679)
const root = resolve('test-results/ui-harness/site')

// Hermetic public env: no Firebase, analytics, checkout or Google Calendar config,
// regardless of what a developer has in .env.local. Process env wins over .env files.
const env = {
  ...process.env,
  NEXT_PUBLIC_UI_HARNESS: '1',
  NEXT_PUBLIC_FIREBASE_API_KEY: '',
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: '',
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: '',
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: '',
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: '',
  NEXT_PUBLIC_FIREBASE_APP_ID: '',
  NEXT_PUBLIC_FIREBASE_VAPID_KEY: '',
  NEXT_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY: '',
  NEXT_PUBLIC_GA_MEASUREMENT_ID: '',
  NEXT_PUBLIC_FUNCTIONS_URL: '',
  NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID: '',
  NEXT_PUBLIC_SENTRY_DSN: '',
  NEXT_TELEMETRY_DISABLED: '1',
}

const build = spawnSync(
  process.execPath,
  [join('node_modules', 'next', 'dist', 'bin', 'next'), 'build'],
  {
    env,
    stdio: 'inherit',
  },
)
if (build.status !== 0) process.exit(build.status ?? 1)
if (!existsSync(join(root, 'harness', 'index.html'))) {
  console.error(`UI harness build did not produce ${join(root, 'harness', 'index.html')}`)
  process.exit(1)
}

createServer(createStaticHandler(root)).listen(port, '127.0.0.1', () => {
  console.log(`UI harness serving ${root} on http://127.0.0.1:${port}/harness/`)
})
