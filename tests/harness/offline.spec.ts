import { expect, test } from '@playwright/test'
import { captureScreen, preparePage } from './capture'
import { HARNESS_MARKER } from './fixtures'

// The offline notice (components/ForecastNotice.tsx) as the installed app shows it
// when it opens without a network: with the last forecast and when it was updated,
// and without one. The browser reports itself offline from the first script on, so
// the page itself still loads from the harness server. Screenshots and axe reports go
// to test-results/ui-harness/ like the other harness specs; tests/e2e/offline.spec.ts
// covers the service worker that makes this possible.
const OFFLINE = "Object.defineProperty(Navigator.prototype, 'onLine', { get: () => false })"

const SCREENS = [
  {
    name: 'offline-guest',
    query: 'tier=guest',
    text: "You're offline. Showing the forecast updated at 9:15am.",
  },
  {
    name: 'offline-signed-in',
    query: 'tier=paid',
    text: "You're offline. Showing the forecast updated at 9:15am.",
  },
  {
    name: 'offline-no-forecast',
    query: 'tier=guest&data=live',
    text: "You're offline. The forecast will load when you're back online.",
  },
]

for (const screen of SCREENS) {
  test(screen.name, async ({ page }, testInfo) => {
    const capture = await preparePage(page, testInfo)
    await page.addInitScript(OFFLINE)
    await page.goto(`/harness/?screen=dashboard&${screen.query}`)
    await expect(page.getByTestId(HARNESS_MARKER)).toBeVisible()
    const notice = page.getByRole('status').filter({ hasText: "You're offline" })
    await expect(notice).toHaveText(screen.text)
    await captureScreen(page, testInfo, capture, { name: screen.name, fullPage: false })
  })
}
