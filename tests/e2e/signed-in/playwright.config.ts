import { defineConfig, devices } from '@playwright/test'
import { HARNESS_TIMEZONE } from '../../harness/clock'

// Signed-in e2e suite (npm run test:e2e:signed-in). Run it through run.mjs, which
// builds the emulator export, starts the Auth, Firestore and Functions emulators on
// free ports and runs Playwright inside `firebase emulators:exec`.
//
// Specs are named *.e2e.ts so the signed-out suite (playwright.config.ts, which
// collects *.spec.ts under tests/e2e) never picks them up.
const port = Number(process.env.SIGNED_IN_PORT)
if (!port) {
  throw new Error(
    'SIGNED_IN_PORT is not set. Run the signed-in suite with npm run test:e2e:signed-in.',
  )
}

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.e2e.ts',
  outputDir: '../../../test-results/signed-in/artifacts',
  globalSetup: './warm-up.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // Flakes must surface, not be retried away.
  retries: 0,
  workers: process.env.CI ? 2 : 4,
  reporter: process.env.CI
    ? [
        ['github'],
        ['list'],
        ['html', { open: 'never', outputFolder: '../../../playwright-report/signed-in' }],
      ]
    : 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: `http://127.0.0.1:${port}`,
    locale: 'en-US',
    // The frozen clock (tests/harness/clock.ts) is 10:30 in this zone.
    timezoneId: HARNESS_TIMEZONE,
    permissions: [],
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node tests/e2e/signed-in/server.mjs',
    // run.mjs starts Playwright from the repository root.
    cwd: process.cwd(),
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 30_000,
    stdout: 'pipe',
  },
})
