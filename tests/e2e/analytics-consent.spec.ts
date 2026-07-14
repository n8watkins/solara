import { expect, test } from '@playwright/test'

test('loads analytics only after consent and lets the user revoke it', async ({ page }) => {
  const analyticsRequests: string[] = []
  await page.route('https://www.googletagmanager.com/**', async route => {
    analyticsRequests.push(route.request().url())
    await route.fulfill({ contentType: 'application/javascript', body: '' })
  })

  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'Help improve Solara' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Allow analytics' })).toBeFocused()
  await expect(page.locator('script[src*="googletagmanager.com"]')).toHaveCount(0)
  expect(analyticsRequests).toHaveLength(0)

  await page.getByRole('button', { name: 'Allow analytics' }).first().click()

  await expect(page.locator('script[src*="googletagmanager.com"]')).toHaveCount(1)
  await expect.poll(() => analyticsRequests.length).toBe(1)

  await page.goto('/privacy/')
  await expect(page.getByRole('status')).toHaveText('Allowed')

  await page.getByRole('button', { name: 'Do not allow' }).click()
  await page.waitForLoadState('domcontentloaded')

  await expect(page.getByRole('status')).toHaveText('Not allowed')
  await expect(page.getByRole('heading', { name: 'Help improve Solara' })).toHaveCount(0)
  await expect(page.locator('script[src*="googletagmanager.com"]')).toHaveCount(0)
})
