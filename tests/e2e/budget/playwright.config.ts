import { execFileSync } from 'node:child_process'
import { defineConfig, devices } from '@playwright/test'
import { PRODUCTION_LIKE_ENV } from './production-env'

// First-load budgets (npm run test:e2e:budget): the JavaScript a guest downloads before
// the dashboard shows, measured on a production build with a public configuration shaped
// like production's (production-env.ts), served by the Hosting emulator like the
// signed-out suite. The signed-out suite's hermetic build has no Firebase project, which
// leaves out code production ships, so it cannot hold the budgets (REVIEW10 QA M1).
//
// Specs are named *.budget.ts so the signed-out suite (playwright.config.ts, which
// collects *.spec.ts under tests/e2e) never picks them up. The build writes out/, like
// the other suites, so run them one after the other.

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
  testMatch: '**/*.budget.ts',
  outputDir: '../../../test-results/budget/artifacts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // A budget is a measurement: a retry would only hide a real overrun.
  retries: 0,
  // One page at a time, so nothing competes with the page being measured.
  workers: 1,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
    // As in playwright.config.ts: the app-shell service worker stays out of the way.
    serviceWorkers: 'block',
  },
  webServer: {
    command: `node tests/e2e/serve-export.mjs ${port}`,
    cwd: process.cwd(),
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 240_000,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
    stdout: 'pipe',
    // The process env wins over .env files, so a developer's .env.local cannot leak in.
    env: PRODUCTION_LIKE_ENV,
  },
})
