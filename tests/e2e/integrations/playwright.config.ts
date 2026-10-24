import { execFileSync } from 'node:child_process'
import { defineConfig, devices } from '@playwright/test'
import { FAKE } from './fake-config'

// Third-party integrations suite (npm run test:e2e:integrations): a production build
// (`npm run build`, with the real postbuild checks and CSP) that has fake public
// values for every switch-on integration, so tests can see what turning each one on
// does: Sentry error reporting (NEXT_PUBLIC_SENTRY_DSN) and App Check with reCAPTCHA v3
// (NEXT_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY). Every request that would leave the
// machine is answered by a fake or blocked (fixtures.ts).
//
// Specs are named *.e2e.ts so the signed-out suite (playwright.config.ts, which
// collects *.spec.ts under tests/e2e) never picks them up. The build writes out/,
// like the signed-out suite, so run the two one after the other.

/** Asks the OS for a free port. Synchronous because the config must be. */
function freePort(): number {
  const script =
    "const s=require('node:net').createServer();" +
    "s.listen(0,'127.0.0.1',()=>{process.stdout.write(String(s.address().port));s.close()})"
  return Number(execFileSync(process.execPath, ['-e', script], { encoding: 'utf8' }))
}

const port = Number(process.env.PLAYWRIGHT_PORT) || freePort()
process.env.PLAYWRIGHT_PORT = String(port)

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.e2e.ts',
  outputDir: '../../../test-results/integrations/artifacts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // Flakes must surface, not be retried away.
  retries: 0,
  workers: process.env.CI ? 2 : 4,
  reporter: process.env.CI
    ? [
        ['github'],
        ['list'],
        ['html', { open: 'never', outputFolder: '../../../playwright-report/integrations' }],
      ]
    : 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: `http://127.0.0.1:${port}`,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `node tests/e2e/serve-export.mjs ${port}`,
    cwd: process.cwd(),
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 240_000,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
    stdout: 'pipe',
    // Hermetic public env; the process env wins over .env files.
    env: {
      NEXT_PUBLIC_FIREBASE_API_KEY: FAKE.apiKey,
      NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: `${FAKE.projectId}.firebaseapp.com`,
      NEXT_PUBLIC_FIREBASE_PROJECT_ID: FAKE.projectId,
      NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: '',
      NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: '',
      NEXT_PUBLIC_FIREBASE_APP_ID: FAKE.appId,
      NEXT_PUBLIC_FIREBASE_VAPID_KEY: '',
      NEXT_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY: FAKE.siteKey,
      NEXT_PUBLIC_FIREBASE_APP_CHECK_PROVIDER: '',
      NEXT_PUBLIC_FIREBASE_APP_CHECK_DEBUG_TOKEN: '',
      NEXT_PUBLIC_FIREBASE_EMULATORS: '',
      NEXT_PUBLIC_FUNCTIONS_URL: '',
      NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID: '',
      NEXT_PUBLIC_GA_MEASUREMENT_ID: '',
      NEXT_PUBLIC_SENTRY_DSN: FAKE.dsn,
      NEXT_PUBLIC_SENTRY_RELEASE: FAKE.release,
      NEXT_PUBLIC_UI_HARNESS: '',
      BROWSER_SOURCE_MAPS: '',
      NEXT_TELEMETRY_DISABLED: '1',
    },
  },
})
