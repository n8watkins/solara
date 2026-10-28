import { expect, test } from '@playwright/test'
import { startClock } from '../harness/clock'
import { buildRawForecast } from '../harness/fixtures'

test('loads analytics only after consent and lets the user revoke it', async ({
  page,
  context,
}) => {
  const libraryRequests: string[] = []
  const collectRequests: string[] = []
  await page.route('https://www.googletagmanager.com/**', async route => {
    libraryRequests.push(route.request().url())
    // A stand-in for gtag.js: drain the queue the page built and send one hit
    // with the page_location it was configured with.
    await route.fulfill({
      contentType: 'application/javascript',
      body: `(function () {
        var cfg = window.dataLayer.map(function (a) { return Array.prototype.slice.call(a) })
          .filter(function (a) { return a[0] === 'config' })[0];
        document.cookie = '_ga=GA1.1.test; path=/';
        document.cookie = '_ga_TEST123=GS1.1.test; path=/';
        fetch('https://www.google-analytics.com/g/collect?dl=' + encodeURIComponent(cfg[2].page_location) +
          '&signals=' + cfg[2].allow_google_signals);
      })();`,
    })
  })
  await page.route('https://www.google-analytics.com/**', async route => {
    collectRequests.push(route.request().url())
    await route.fulfill({ status: 204, body: '' })
  })

  // The landing page is static and asks nothing; the app shows the banner.
  await page.goto('/app/?session_id=secret123')

  const banner = page.getByRole('region', { name: 'Help improve Solara' })
  await expect(banner).toBeVisible()
  // Non-blocking: nothing is focused or trapped and the page stays usable.
  await expect(page.getByRole('button', { name: 'Allow analytics' })).not.toBeFocused()
  await expect(page.getByLabel('City or location')).toBeEditable()
  await page.getByLabel('City or location').fill('Pasadena')
  await expect(page.getByRole('heading', { name: 'Where are you?' })).toBeVisible()
  await expect(page.locator('script[src*="googletagmanager.com"]')).toHaveCount(0)
  expect(libraryRequests).toHaveLength(0)

  // Equal weight: both choices use the same button style.
  const allow = page.getByRole('button', { name: 'Allow analytics' })
  const decline = page.getByRole('button', { name: 'Not now' })
  await expect(allow).toHaveClass('btn')
  await expect(decline).toHaveClass('btn')

  await allow.click()

  await expect(page.locator('script[src*="googletagmanager.com"]')).toHaveCount(1)
  await expect.poll(() => collectRequests.length).toBe(1)
  const hit = new URL(collectRequests[0]!)
  expect(hit.searchParams.get('dl')).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/app\/$/)
  expect(hit.searchParams.get('signals')).toBe('false')
  await expect
    .poll(async () => (await context.cookies()).map(c => c.name).sort())
    .toEqual(['_ga', '_ga_TEST123'])

  await page.goto('/privacy/')
  await expect(page.getByRole('status')).toHaveText('Allowed')

  await page.getByRole('button', { name: 'Do not allow' }).click()
  await page.waitForLoadState('domcontentloaded')

  await expect(page.getByRole('status')).toHaveText('Not allowed')
  await expect(page.getByRole('heading', { name: 'Help improve Solara' })).toHaveCount(0)
  await expect(page.locator('script[src*="googletagmanager.com"]')).toHaveCount(0)
  await expect.poll(async () => (await context.cookies()).map(c => c.name)).toEqual([])
})

test.describe('on the dashboard', () => {
  test.use({ timezoneId: 'America/Los_Angeles' })

  test('the banner sits in the page flow and covers nothing, at every width', async ({ page }) => {
    // REVIEW4: the floating card covered the sunscreen timer's Start button at 1280 px.
    await page.route('https://api.open-meteo.com/**', route =>
      route.fulfill({ json: buildRawForecast() }),
    )
    await startClock(page)
    await page.addInitScript(() => {
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
    for (const width of [320, 390, 768, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 800 })
      await page.goto('/app/')
      const banner = page.getByRole('region', { name: 'Help improve Solara' })
      await expect(banner).toBeVisible()
      expect(await banner.evaluate(el => getComputedStyle(el).position)).toBe('static')
      // It is laid out before the page, so nothing after it moves when it appears.
      const box = (await banner.boundingBox())!
      expect(box.y).toBe(0)
      const start = page.getByRole('button', { name: 'Start', exact: true })
      await start.scrollIntoViewIfNeeded()
      // The button is the topmost element at its own center: nothing lies over it.
      expect(
        await start.evaluate(el => {
          const r = el.getBoundingClientRect()
          const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
          return !!top && el.contains(top)
        }),
        `Start is uncovered at ${width} px`,
      ).toBe(true)
      // No horizontal overflow from the banner on a narrow phone.
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      )
      // REVIEW5: on a phone it took 160 px, a fifth of the first screen. It now stays about
      // two rows tall, with both choices side by side and the same size.
      const allow = banner.getByRole('button', { name: 'Allow analytics' })
      const decline = banner.getByRole('button', { name: 'Not now' })
      const [a, d] = [(await allow.boundingBox())!, (await decline.boundingBox())!]
      expect(a.y).toBe(d.y)
      expect(a.height).toBeGreaterThanOrEqual(36)
      if (width <= 640) {
        // One sentence line and the buttons; at 320 px the sentence takes two lines.
        expect(box.height, `banner height at ${width} px`).toBeLessThanOrEqual(
          width >= 360 ? 90 : 110,
        )
        expect(Math.abs(a.width - d.width)).toBeLessThanOrEqual(1)
        await expect(banner.getByRole('link', { name: 'Privacy details' })).toBeVisible()
        await expect(banner.getByText('Optional analytics, off unless you allow it.')).toBeVisible()
      }
    }
    await page.getByRole('button', { name: 'Not now' }).click()
    await expect(page.getByRole('region', { name: 'Help improve Solara' })).toHaveCount(0)
  })
})
