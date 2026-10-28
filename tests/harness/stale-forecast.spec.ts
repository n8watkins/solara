import { expect, test, type Page } from '@playwright/test'
import { captureScreen } from './capture'
import { NOW_MS, prepareLiveDashboard, type Raw } from './live-forecast'

// The forecast proxy's last good copy (functions/src/forecast/endpoints.ts): while the
// upstream budget or the caller's share is spent, it answers with an earlier forecast
// marked `stale: true` and `fetchedAt`. The dashboard says how old it is in a calm
// note (components/ForecastNotice.tsx), in the place's own clock. The harness build
// has no proxy, so the specs answer the app's forecast request with the proxy's shape;
// the app reads every provider's answer through the same parser (@solara/core).
//
// Screenshots: 390 px (mobile projects) and 1280 px (desktop projects), light and dark.

/** 9:40am in Los Angeles on the harness day, 50 minutes before the frozen now. */
const SERVED_AT = new Date(NOW_MS - 50 * 60_000).toISOString()
const served = (raw: Raw) => ({ ...raw, stale: true, fetchedAt: SERVED_AT })

const STALE_TEXT = 'Showing the forecast updated at 9:40am. A newer one will load by itself.'
const OFFLINE = "Object.defineProperty(Navigator.prototype, 'onLine', { get: () => false })"

const notices = (page: Page) => page.getByRole('status').filter({ hasText: 'Showing the forecast' })

async function desktopAt1280(page: Page) {
  const size = page.viewportSize()
  if (size && size.width > 1280) await page.setViewportSize({ width: 1280, height: size.height })
}

for (const tier of ['guest', 'paid']) {
  test(`stale-forecast-${tier}`, async ({ page }, testInfo) => {
    await desktopAt1280(page)
    const capture = await prepareLiveDashboard(page, testInfo, { tier, edit: served })
    await expect(notices(page)).toHaveText(STALE_TEXT)
    await captureScreen(page, testInfo, capture, { name: `stale-forecast-${tier}`, fullPage: false })
  })
}

test('a current forecast shows no note', async ({ page }, testInfo) => {
  await prepareLiveDashboard(page, testInfo, { tier: 'guest' })
  await expect(page.getByText('Showing the forecast')).toHaveCount(0)
})

test('offline, only the offline note shows, with the earlier forecast time', async ({
  page,
}, testInfo) => {
  // The page loads online so the stale copy arrives, then the browser goes offline.
  await prepareLiveDashboard(page, testInfo, { tier: 'guest', edit: served })
  await expect(notices(page)).toHaveText(STALE_TEXT)
  await page.context().setOffline(true)
  await expect(notices(page)).toHaveText(
    "You're offline. Showing the forecast updated at 9:40am.",
  )
  await expect(notices(page)).toHaveCount(1)
})

test('a reload shows the stale copy from the browser cache with the same note', async ({
  page,
}, testInfo) => {
  await prepareLiveDashboard(page, testInfo, { tier: 'guest', edit: served })
  await expect(notices(page)).toHaveText(STALE_TEXT)
  // Offline from the first script on: the forecast comes only from lib/cache.ts.
  await page.addInitScript(OFFLINE)
  await page.reload()
  await expect(page.getByRole('group', { name: 'UV forecast by hour' })).toBeVisible()
  await expect(notices(page)).toHaveText(
    "You're offline. Showing the forecast updated at 9:40am.",
  )
})
