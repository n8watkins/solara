import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.route('https://geocoding-api.open-meteo.com/**', async route => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        results: [
          {
            name: 'Pasadena',
            admin1: 'California',
            country: 'United States',
            latitude: 34.1478,
            longitude: -118.1445,
          },
        ],
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

test('starts setup in the app without credentials', async ({ page }) => {
  await page.goto('/app/')

  await expect(page).toHaveTitle(/Solara/)
  await expect(page.getByRole('heading', { name: 'Where are you?' })).toBeVisible()
  await expect(page.locator('[data-nextjs-dialog]')).toHaveCount(0)
})

test('completes setup up to the start choice', async ({ page }) => {
  await page.goto('/app/')
  await page.getByRole('button', { name: 'Not now' }).click()

  await expect(page.getByRole('heading', { name: 'Where are you?' })).toBeVisible()
  await expect(page.getByRole('progressbar', { name: 'Setup progress' })).toHaveAttribute(
    'aria-valuetext',
    'Step 1 of 3',
  )
  await page.getByLabel('City or location').fill('Pasadena')
  await page.getByRole('button', { name: 'Go' }).click()

  await expect(page.getByText('UV index right now in')).toBeVisible()
  await expect(page.getByText('Pasadena', { exact: true })).toBeVisible()
  await expect(page.getByText('3.2', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: /Continue/ }).click()

  await expect(page.getByRole('heading', { name: 'Your skin type' })).toBeVisible()
  await page.getByRole('button', { name: /Olive/ }).click()
  await expect(page.getByRole('button', { name: /Olive/ })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: /Continue/ }).click()

  await expect(page.getByRole('heading', { name: "You're all set" })).toBeVisible()
  await expect(page.getByRole('progressbar', { name: 'Setup progress' })).toHaveAttribute(
    'aria-valuetext',
    'Step 3 of 3',
  )
  // Without a Firebase project there is no sign-in, only the guest start.
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /See today's plan/ })).toBeVisible()

  // Back on every step after the first.
  await page.getByRole('button', { name: '← Back' }).click()
  await expect(page.getByRole('heading', { name: 'Your skin type' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Olive/ })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('[data-nextjs-dialog]')).toHaveCount(0)
})

test('announces location errors and exposes utility landmarks', async ({ page }) => {
  await page.unroute('https://geocoding-api.open-meteo.com/**')
  await page.route('https://geocoding-api.open-meteo.com/**', async route => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ results: [] }) })
  })

  await page.goto('/app/')
  await page.getByRole('button', { name: 'Not now' }).click()
  await page.getByLabel('City or location').fill('Not a real city')
  await page.getByRole('button', { name: 'Go' }).click()
  await expect(page.locator('p[role="alert"]')).toHaveText(
    'City not found. Try a different spelling.',
  )

  await page.goto('/account/')
  await expect(page.getByRole('main')).toBeVisible()

  await page.goto('/privacy/')
  await expect(page.getByRole('main')).toBeVisible()
})

test('says why "Use my location" failed', async ({ page }) => {
  // Playwright grants no permissions, so the browser denies geolocation.
  await page.goto('/app/')
  await page.getByRole('button', { name: 'Not now' }).click()
  await page.getByRole('button', { name: /Use my location/ }).click()
  await expect(page.locator('p[role="alert"]')).toHaveText(
    'Location access is turned off for this site. Allow it in your browser, or type a city.',
  )
})
