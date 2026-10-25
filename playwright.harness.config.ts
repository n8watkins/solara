import { defineConfig, type PlaywrightTestOptions } from '@playwright/test'
import { HARNESS_TIMEZONE } from './tests/harness/clock'

// Signed-in UI harness (npm run test:harness). Separate from playwright.config.ts
// because it serves a different build (a static export made with
// NEXT_PUBLIC_UI_HARNESS=1) and writes screenshots and an axe report instead of
// asserting on behavior. Output lands in test-results/ui-harness/ for CI upload.
const port = Number(process.env.UI_HARNESS_PORT || 45679)

const shared: Partial<PlaywrightTestOptions> = {
  locale: 'en-US',
  timezoneId: HARNESS_TIMEZONE,
  // Permission prompts and geolocation stay deterministic: never granted.
  permissions: [],
  // The harness build has no app-shell service worker (scripts/build-sw.mjs runs after
  // production builds only), and the screenshots must come from the page itself.
  serviceWorkers: 'block',
}

const desktop = {
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  isMobile: false,
  hasTouch: false,
}
const mobile = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
}

export default defineConfig({
  testDir: './tests/harness',
  outputDir: './test-results/ui-harness/artifacts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  globalTeardown: './tests/harness/axe-summary.ts',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    browserName: 'chromium',
    // Software, non-partial rasterization: GPU and tiled raster occasionally shift
    // anti-aliased edges by one color step between runs.
    launchOptions: {
      args: [
        '--disable-gpu',
        '--disable-partial-raster',
        '--disable-skia-runtime-opts',
        '--force-color-profile=srgb',
      ],
    },
    trace: 'retain-on-failure',
    ...shared,
  },
  projects: [
    { name: 'desktop-light', use: { ...desktop, colorScheme: 'light' } },
    { name: 'desktop-dark', use: { ...desktop, colorScheme: 'dark' } },
    { name: 'mobile-light', use: { ...mobile, colorScheme: 'light' } },
    { name: 'mobile-dark', use: { ...mobile, colorScheme: 'dark' } },
  ],
  webServer: {
    command: `node tests/harness/serve.mjs ${port}`,
    url: `http://127.0.0.1:${port}/harness/`,
    // Never reuse a server: a stale one would serve an old harness build.
    reuseExistingServer: false,
    timeout: 240_000,
    stdout: 'pipe',
  },
})
