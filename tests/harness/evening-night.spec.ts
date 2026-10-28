import { expect, test } from '@playwright/test'
import { captureScreen, preparePage } from './capture'
import { HARNESS_MARKER } from './fixtures'
import { NOW_MS } from './live-forecast'

// The dashboard in the evening and at night from the fixture data (REVIEW5 L7): the
// fixture's live reading follows the clock (fixtures.ts buildRawForecast), so these
// screens show that time's UV instead of the morning's "7.0 High now".

const HOUR = 3_600_000
const SCREENS = [
  // 7:30pm: the sun is low, UV under 1, every window of the day has passed.
  { name: 'dashboard-evening', tier: 'guest', at: NOW_MS + 9 * HOUR, readout: /^0\.4/ },
  { name: 'dashboard-evening-pro', tier: 'paid', at: NOW_MS + 9 * HOUR, readout: /^0\.4/ },
  // Midnight: before sunrise, when UV returns.
  { name: 'dashboard-night', tier: 'guest', at: NOW_MS + 13.5 * HOUR, readout: /Before sunrise/ },
]

for (const screen of SCREENS) {
  test(`${screen.name}: the hero reads the clock's UV`, async ({ page }, testInfo) => {
    const capture = await preparePage(page, testInfo, undefined, { at: screen.at })
    await page.goto(`/harness/?screen=dashboard&tier=${screen.tier}`)
    await expect(page.getByTestId(HARNESS_MARKER)).toBeVisible()
    const readout = page.getByTestId('uv-readout')
    await expect(readout).toContainText(screen.readout)
    await expect(readout).not.toContainText('7.0')
    // The sunscreen timer arrives once the page is idle; wait so its space is not empty.
    await expect(page.getByRole('heading', { name: 'Sunscreen timer' })).toBeVisible()
    await captureScreen(page, testInfo, capture, { name: screen.name, fullPage: true })
  })
}
