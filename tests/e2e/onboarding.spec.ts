import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.route('https://geocoding-api.open-meteo.com/**', async route => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        results: [{
          name: 'Pasadena',
          admin1: 'California',
          country: 'United States',
          latitude: 34.1478,
          longitude: -118.1445,
        }],
      }),
    })
  })

  await page.route('https://api.open-meteo.com/**', async route => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ current: { uv_index: 3.2 } }),
    })
  })
})

test('renders the welcome screen without credentials', async ({ page }) => {
  await page.goto('/')

  await expect(page).toHaveTitle(/Solara/)
  await expect(page.getByRole('heading', { name: 'Know when to go outside' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Get started/ })).toBeVisible()
  await expect(page.locator('[data-nextjs-dialog]')).toHaveCount(0)
})

test('completes setup through the sign-in boundary', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /Get started/ }).click()

  await expect(page.getByRole('heading', { name: 'Where are you?' })).toBeVisible()
  await page.getByPlaceholder('Type a city, e.g. Los Angeles').fill('Pasadena')
  await page.getByRole('button', { name: 'Go' }).click()

  await expect(page.getByText('UV index right now in')).toBeVisible()
  await expect(page.getByText('Pasadena', { exact: true })).toBeVisible()
  await expect(page.getByText('3.2', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: /Continue/ }).click()

  await expect(page.getByRole('heading', { name: 'Your skin type' })).toBeVisible()
  await page.getByRole('button', { name: /Olive/ }).click()
  await page.getByRole('button', { name: /Continue/ }).click()

  await expect(page.getByRole('heading', { name: 'Sign in to finish' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toHaveCount(0)
  await expect(page.locator('[data-nextjs-dialog]')).toHaveCount(0)
})
