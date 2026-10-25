import { expect, openDashboard, RUNNING, test, uvStrip } from './fixtures'
import type { Page } from '@playwright/test'

// A signed-in account opening the installed app offline: the app-shell service worker
// (scripts/sw/shell.ts) serves the page, the dashboard shows from this browser's copy
// of the account with its cached forecast, read-only, and Auth and the saved plan load
// once the browser is back online (lib/use-account.ts). The suite blocks service
// workers elsewhere (playwright.config.ts); this spec needs one.
test.use({ serviceWorkers: 'allow' })

/** Whether the app's content is inert (shown, but not accepting input). */
function appInert(page: Page) {
  return page.evaluate(() => {
    const busy = document.querySelector<HTMLElement>('[aria-busy="true"]')
    return !!busy?.inert
  })
}

test('a signed-in account opens offline, read-only, and goes live once online', async ({
  page,
  context,
  emulators,
}) => {
  const alice = await emulators.createAccount('Alice Stone')
  await emulators.seedPrefs(alice, { activities: [RUNNING] })
  await openDashboard(page, alice)
  await expect(page.getByRole('button', { name: 'Edit Running' })).toBeVisible()
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null)

  await context.setOffline(true)
  await page.reload()
  await expect(uvStrip(page)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Edit Running' })).toBeVisible()
  const notice = page.getByRole('status').filter({ hasText: "You're offline" })
  await expect(notice).toHaveText(
    /^You're offline\. Showing the forecast updated at .+\. You can make changes once you're back online\.$/,
  )
  expect(await appInert(page)).toBe(true)
  // It stays that way: nothing gives up on the account while offline (Firestore, for
  // one, reports an unreachable backend after 10 seconds).
  await page.clock.fastForward('00:30')
  // Proving an absence: give anything that would replace the dashboard a moment.
  await page.waitForTimeout(1000)
  await expect(page.getByRole('heading', { name: 'Your account could not load' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Edit Running' })).toBeVisible()
  await expect(notice).toBeVisible()

  await context.setOffline(false)
  await expect(notice).toHaveCount(0)
  await expect.poll(() => appInert(page)).toBe(false)
  await expect(page.getByRole('button', { name: 'Account menu' })).toHaveAttribute(
    'title',
    'Alice Stone',
  )
})
