// Freezes a harness screen for its screenshot and proves the time-dependent pixels
// still show the frozen state.
//
// The fake clock runs in step with real time until it is paused (see clock.ts), so
// how far it ran depends on how busy the machine is. A wall-clock budget would fail
// on a slow machine even when nothing on screen changed, and pass while something
// did. Instead this checks what time can change on the signed-in screens: the
// minute every clock reading shows.
import { expect, type Page } from '@playwright/test'
import { pauseClock } from './clock'

/** The fake clock starts on a whole minute, so every reading shows it for one minute. */
const SAME_MINUTE_MS = 60_000

/** `startedAt` is the time the spec started the clock at (default HARNESS_NOW). */
export async function freezeScreen(page: Page, startedAt?: number): Promise<void> {
  const elapsed = await pauseClock(page, startedAt)
  expect(elapsed, 'the fake clock left its first minute before the screen was frozen').toBeLessThan(
    SAME_MINUTE_MS,
  )
}
