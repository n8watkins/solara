import { execFileSync } from 'node:child_process'
import { defineConfig, devices } from '@playwright/test'

// The e2e suite runs against the static export served by the Firebase Hosting
// emulator (tests/e2e/serve-export.mjs), so it exercises the real firebase.json
// headers and rewrites. By default the server builds `out/` with the hermetic
// public env below; set E2E_SITE_DIR to test an existing export instead.

/** Asks the OS for a free port. Synchronous because the config must be. */
function freePort(): number {
  const script =
    "const s=require('node:net').createServer();" +
    "s.listen(0,'127.0.0.1',()=>{process.stdout.write(String(s.address().port));s.close()})"
  return Number(execFileSync(process.execPath, ['-e', script], { encoding: 'utf8' }))
}

// A random port unless PLAYWRIGHT_PORT pins one. Exported to the environment so
// worker processes, which load this config again, agree on the same port.
const port = Number(process.env.PLAYWRIGHT_PORT) || freePort()
process.env.PLAYWRIGHT_PORT = String(port)
// The old address's redirect-only site (firebase.json's second site), for
// tests/e2e/hosting-redirect.spec.ts.
const redirectPort = Number(process.env.PLAYWRIGHT_REDIRECT_PORT) || freePort()
process.env.PLAYWRIGHT_REDIRECT_PORT = String(redirectPort)

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    // The app registers the app-shell service worker, which would answer the page's
    // own files from its cache; only tests/e2e/offline.spec.ts lets it run.
    serviceWorkers: 'block',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 7'] },
    },
    // The Outlook sign-in popup meets Solara's Cross-Origin-Opener-Policy, which each
    // engine applies in its own way (REVIEW7 M1), so it also runs in Firefox and WebKit.
    {
      name: 'firefox',
      testMatch: 'microsoft-sign-in.spec.ts',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      testMatch: 'microsoft-sign-in.spec.ts',
      use: { ...devices['Desktop Safari'] },
    },
  ],
  webServer: [
    {
      command: `node tests/e2e/serve-export.mjs ${port}`,
      url: `http://127.0.0.1:${port}`,
      // Never reuse a server: a stale one would serve an old build.
      reuseExistingServer: false,
      // The default build runs first (about a minute on a cold CI runner).
      timeout: 240_000,
      // SIGTERM lets the emulator shut down cleanly and remove its temporary config.
      gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
      stdout: 'pipe',
      // Hermetic public env for the default build: no Firebase project, so the app
      // stays signed out, and a fake GA id so the consent flow renders. The process
      // env wins over .env files, so a developer's .env.local cannot leak in.
      env: {
        NEXT_PUBLIC_FIREBASE_API_KEY: '',
        NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: '',
        NEXT_PUBLIC_FIREBASE_PROJECT_ID: '',
        NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: '',
        NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: '',
        NEXT_PUBLIC_FIREBASE_APP_ID: '',
        NEXT_PUBLIC_FIREBASE_VAPID_KEY: '',
        NEXT_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY: '',
        NEXT_PUBLIC_FUNCTIONS_URL: '',
        NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID: '',
        NEXT_PUBLIC_MICROSOFT_CLIENT_ID: '',
        NEXT_PUBLIC_GA_MEASUREMENT_ID: 'G-TEST123',
        NEXT_PUBLIC_SENTRY_DSN: '',
        NEXT_TELEMETRY_DISABLED: '1',
      },
    },
    {
      command: `node tests/e2e/serve-export.mjs ${redirectPort} --redirect-site`,
      // Every path answers with a redirect, so wait for the port rather than a URL.
      port: redirectPort,
      reuseExistingServer: false,
      timeout: 60_000,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
      stdout: 'pipe',
    },
  ],
})
