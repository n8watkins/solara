// Frozen clock for the UI harness.
//
// The harness pins "now" to a single instant in the fixture location's time zone so
// every screen (sun path, UV strip, recommendations, calendar "now" line) renders
// the same pixels on every run and on every machine. The browser context must also
// run in HARNESS_TIMEZONE (see playwright.harness.config.ts) because the app reads
// local hours straight from `new Date()`.
//
// This module is imported by the harness page bundle as well as by Playwright specs,
// so it must stay free of runtime Playwright imports (type-only imports are erased).
import type { Page } from '@playwright/test'

/** Fixture location's IANA zone; the browser context runs in it. */
export const HARNESS_TIMEZONE = 'America/Los_Angeles'

/** Fixture "today" as YYYY-MM-DD in HARNESS_TIMEZONE (a Monday in June, high UV). */
export const HARNESS_DATE = '2026-06-15'

/** The frozen instant: 10:30 local time on HARNESS_DATE (PDT, UTC-7). */
export const HARNESS_NOW = `${HARNESS_DATE}T10:30:00-07:00`

/**
 * Start the page clock at `at` (default HARNESS_NOW) before any app code runs. Call before
 * `page.goto`.
 *
 * `install` replaces Date, timers and requestAnimationFrame with a fake clock that
 * starts at HARNESS_NOW and then runs in step with real time. It cannot start out
 * paused: Next.js needs timers to boot the client bundle. Once the screen has
 * rendered, call `freezeScreen` (freeze.ts) or `pauseClock` so intervals (for example
 * the tip carousel) stop.
 */
export async function startClock(page: Page, at = HARNESS_NOW_MS): Promise<void> {
  await page.clock.install({ time: at })
}

/** HARNESS_NOW in epoch milliseconds. */
export const HARNESS_NOW_MS = new Date(HARNESS_NOW).getTime()

/**
 * Pause the fake clock where it is and return how far it ran past `startedAt`
 * (the time startClock installed).
 * Screenshot specs pause through `freezeScreen` (freeze.ts), which checks that the
 * pixels that depend on time still show the frozen state.
 */
export async function pauseClock(page: Page, startedAt = HARNESS_NOW_MS): Promise<number> {
  // pauseAt only moves forward, and the clock keeps running during this round trip,
  // so aim a little ahead of the reading.
  const target = (await page.evaluate(() => Date.now())) + PAUSE_LEAD_MS
  await page.clock.pauseAt(target)
  return target - startedAt
}

const PAUSE_LEAD_MS = 500
