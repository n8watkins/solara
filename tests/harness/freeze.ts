// Freezes a harness screen for its screenshot and proves the time-dependent pixels
// still show the frozen state.
//
// The fake clock runs in step with real time until it is paused (see clock.ts), so
// how far it ran depends on how busy the machine is. A wall-clock budget would fail
// on a slow machine even when nothing on screen changed, and pass while something
// did. Instead this checks the two things that time can change on the signed-in
// screens: the minute every clock reading shows, and the tip carousel, whose 6.5 s
// interval is the first recurring timer that changes pixels.
import { expect, type Page } from '@playwright/test'
import { pauseClock } from './clock'

/** The fake clock starts at 10:30:00, so every reading shows 10:30 for one minute. */
const SAME_MINUTE_MS = 60_000

export async function freezeScreen(page: Page): Promise<void> {
  const elapsed = await pauseClock(page)
  expect(elapsed, 'the fake clock left 10:30 before the screen was frozen').toBeLessThan(
    SAME_MINUTE_MS,
  )
  // The carousel marks its visible tip with aria-current; it must not have advanced.
  const tips = page.getByRole('button', { name: /^Show tip \d+$/ })
  if ((await tips.count()) > 0) {
    await expect(
      page.getByRole('button', { name: 'Show tip 1', exact: true }),
      'the tip carousel advanced before the screen was frozen',
    ).toHaveAttribute('aria-current', 'true')
  }
}
