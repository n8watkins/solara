import { expect, test } from '@playwright/test'

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

  await page.goto('/?session_id=secret123')

  const banner = page.getByRole('region', { name: 'Help improve Solara' })
  await expect(banner).toBeVisible()
  // Non-blocking: nothing is focused or trapped and the page stays usable.
  await expect(page.getByRole('button', { name: 'Allow analytics' })).not.toBeFocused()
  await expect(page.getByRole('button', { name: /Get started/ })).toBeEnabled()
  await page.getByRole('button', { name: /Get started/ }).click()
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
  expect(hit.searchParams.get('dl')).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/)
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
