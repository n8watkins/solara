import { expect, test, type Page } from '@playwright/test'
import { startClock } from '../harness/clock'
import { buildRawForecast } from '../harness/fixtures'

// The sunscreen reapply timer as a guest (free, no account, no push): start it when
// heading out, get the reminder after 2 hours (80 minutes while swimming or
// sweating), keep it across a reload, and a system notification while the page is
// in the background where the browser allows one.

test.use({ timezoneId: 'America/Los_Angeles' })

test.beforeEach(async ({ page }) => {
  await page.route('https://api.open-meteo.com/**', route =>
    route.fulfill({ json: buildRawForecast() }),
  )
  // 10:30 in Los Angeles on the fixture day.
  await startClock(page)
  await page.addInitScript(() => {
    if (localStorage.getItem('solara_guest')) return
    const prefs = {
      location: {
        lat: 34.05,
        lon: -118.24,
        city: 'Los Angeles',
        region: 'California',
        timezone: 'America/Los_Angeles',
      },
      skinType: 'fair',
      activities: [],
      onboardingComplete: true,
    }
    localStorage.setItem('solara_guest', JSON.stringify({ prefs, since: '2026-06-15' }))
  })
})

function timer(page: Page) {
  return page.getByRole('region', { name: /Sunscreen timer|Reapply sunscreen|Time to reapply/ })
}

test('reminds a guest to reapply, every 2 hours or 80 minutes in the water', async ({ page }) => {
  await page.goto('/app/')
  await expect(timer(page)).toContainText('Heading out? Get a reminder to reapply every 2 hours.')
  await timer(page).getByRole('button', { name: 'Start' }).click()

  await expect(timer(page)).toContainText('Reapply sunscreen at 12:30pm')
  await expect(timer(page)).toContainText('In 2 h. Every 2 hours.')

  // Kept on this device across a reload.
  await page.reload()
  await expect(timer(page)).toContainText('Reapply sunscreen at 12:30pm')

  await page.clock.fastForward('02:00:30')
  const alert = page.getByRole('alert').filter({ hasText: 'Time to reapply sunscreen' })
  await expect(alert).toBeVisible()
  await expect(alert).toContainText('Last put on at 10:30am.')

  await timer(page).getByRole('button', { name: 'I reapplied' }).click()
  await expect(timer(page)).toContainText('Reapply sunscreen at 2:30pm')

  const water = timer(page).getByRole('button', { name: 'Swimming or sweating' })
  await water.click()
  await expect(water).toHaveAttribute('aria-pressed', 'true')
  await expect(timer(page)).toContainText('Reapply sunscreen at 1:50pm')
  await expect(timer(page)).toContainText('Every 80 minutes while swimming or sweating.')

  await timer(page).getByRole('button', { name: 'Stop' }).click()
  await expect(timer(page)).toContainText('Heading out?')
  await page.reload()
  await expect(timer(page)).toContainText('Heading out?')
})

test('shows a system notification when the reminder falls due in the background', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const shown: { title: string; body?: string; tag?: string }[] = []
    ;(window as unknown as { shown: typeof shown }).shown = shown
    class FakeNotification {
      static permission: NotificationPermission = 'default'
      static async requestPermission() {
        FakeNotification.permission = 'granted'
        return FakeNotification.permission
      }
      constructor(title: string, options?: NotificationOptions) {
        shown.push({ title, body: options?.body, tag: options?.tag })
      }
    }
    Object.defineProperty(window, 'Notification', { value: FakeNotification })
    // The person has left the tab: the page is in the background.
    Object.defineProperty(document, 'visibilityState', { get: () => 'hidden' })
  })
  await page.goto('/app/')
  await timer(page).getByRole('button', { name: 'Start' }).click()
  await expect(timer(page)).toContainText(
    'You get a notification while Solara stays open in a tab.',
  )

  await page.clock.fastForward('01:59:00')
  expect(await page.evaluate(() => (window as unknown as { shown: unknown[] }).shown)).toEqual([])
  await page.clock.fastForward('00:01:30')
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { shown: unknown[] }).shown))
    .toEqual([
      {
        title: 'Time to reapply sunscreen',
        body: 'It has been 2 hours since you put it on.',
        tag: 'solara-reapply',
      },
    ])

  // Once per reminder, even after a reload.
  await page.reload()
  await expect(
    page.getByRole('alert').filter({ hasText: 'Time to reapply sunscreen' }),
  ).toBeVisible()
  expect(await page.evaluate(() => (window as unknown as { shown: unknown[] }).shown)).toEqual([])
})
