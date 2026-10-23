import { expect, test, type Page } from '@playwright/test'
import { HARNESS_DATE, startClock } from './clock'
import { HARNESS_MARKER } from './fixtures'

// PROD-2: "today" and "now" come from the forecast location's time zone. The
// fixture location is Los Angeles at 10:30 on HARNESS_DATE; a browser running in
// UTC or Tokyo (where it is already the next day) must show exactly the same.
const DEVICE_ZONES = ['UTC', 'Asia/Tokyo', 'America/Los_Angeles'] as const

async function open(page: Page, screen: 'dashboard' | 'calendar') {
  await page.route('**/*', route =>
    new URL(route.request().url()).hostname === '127.0.0.1'
      ? route.continue()
      : route.abort('blockedbyclient'),
  )
  await startClock(page)
  await page.goto(`/harness/?screen=${screen}`)
  await expect(page.getByTestId(HARNESS_MARKER)).toHaveAttribute('data-screen', screen)
}

for (const timezoneId of DEVICE_ZONES) {
  test.describe(`device in ${timezoneId}`, () => {
    test.use({ timezoneId })

    test('dashboard reads now from Los Angeles', async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== 'desktop-light', 'logic check, run once')
      await open(page, 'dashboard')
      const hero = page.getByTestId('hero-slot')
      await expect(hero).toBeVisible()
      // Hiking is the soonest activity left today: from 4pm, after the 10:30 "now".
      await expect(hero).toHaveAttribute('data-activity', 'hike')
      await expect(hero).toHaveAttribute('data-start', '16')
      await expect(page.getByTestId('uv-readout')).toContainText('now')
      await expect(page.getByTestId('uv-readout')).toContainText('°F')
      await expect(page.getByRole('button', { name: /current hour/ })).toHaveAttribute(
        'data-hour',
        '10',
      )
    })

    test('calendar marks Los Angeles today and now', async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== 'desktop-light', 'logic check, run once')
      await open(page, 'calendar')
      const today = page.locator(`[data-testid="calendar-day-column"][data-date="${HARNESS_DATE}"]`)
      await expect(today.getByTestId('calendar-now')).toHaveCount(1)
      await expect(page.getByTestId('calendar-now')).toHaveCount(1)
      await expect(page.getByTestId('calendar-day-header').first()).toContainText('Today')
      await expect(page.getByTestId('calendar-day-header').first()).toContainText('15')
    })
  })
}
