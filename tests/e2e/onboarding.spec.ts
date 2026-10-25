import { expect, test, type Page } from '@playwright/test'

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
  await page.getByRole('button', { name: 'Back', exact: true }).click()
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

// A person who declines location access types a town and picks it from suggestions.
// The geocoder is faked and records what it is asked.
const PASADENAS = [
  {
    name: 'Pasadena',
    admin1: 'California',
    country: 'United States',
    latitude: 34.1478,
    longitude: -118.1445,
  },
  {
    name: 'Pasadena',
    admin1: 'Texas',
    country: 'United States',
    latitude: 29.6911,
    longitude: -95.2091,
  },
]

async function fakePlaceSearch(page: Page) {
  const searches: string[] = []
  await page.unroute('https://geocoding-api.open-meteo.com/**')
  await page.route('https://geocoding-api.open-meteo.com/**', async route => {
    const name = new URL(route.request().url()).searchParams.get('name') ?? ''
    searches.push(name)
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ results: name.toLowerCase().startsWith('pas') ? PASADENAS : [] }),
    })
  })
  return searches
}

test('suggests places while typing and picks one with the keyboard', async ({ page }) => {
  const searches = await fakePlaceSearch(page)
  const forecasts: URL[] = []
  page.on('request', request => {
    if (request.url().startsWith('https://api.open-meteo.com/'))
      forecasts.push(new URL(request.url()))
  })

  await page.goto('/app/')
  await page.getByRole('button', { name: 'Not now' }).click()
  const field = page.getByRole('combobox', { name: 'City or location' })
  await expect(field).toHaveAttribute('aria-expanded', 'false')
  await field.pressSequentially('Pasa', { delay: 40 })

  const list = page.getByRole('listbox', { name: 'Suggested places' })
  await expect(list.getByRole('option')).toHaveCount(2)
  await expect(
    list.getByRole('option', { name: 'Pasadena California, United States' }),
  ).toBeVisible()
  await expect(list.getByRole('option', { name: 'Pasadena Texas, United States' })).toBeVisible()
  await expect(field).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByRole('status').filter({ hasText: '2 suggestions' })).toBeAttached()
  // Typing is debounced: one search for the whole word, not one per letter.
  expect(searches).toEqual(['Pasa'])

  // Down, down, up, down: the highlight wraps and follows the arrows.
  await field.press('ArrowDown')
  await field.press('ArrowDown')
  await field.press('ArrowDown')
  await field.press('ArrowUp')
  const texas = list.getByRole('option', { name: 'Pasadena Texas, United States' })
  await expect(texas).toHaveAttribute('aria-selected', 'true')
  await expect(field).toHaveAttribute('aria-activedescendant', (await texas.getAttribute('id'))!)
  await expect(field).toBeFocused()

  await field.press('Enter')
  await expect(page.getByText('UV index right now in')).toBeVisible()
  await expect(page.getByText('Pasadena', { exact: true })).toBeVisible()
  // The chosen town's coordinates, rounded to 2 decimals, are what leaves the device.
  expect(forecasts.at(-1)?.searchParams.get('latitude')).toBe('29.69')
  expect(forecasts.at(-1)?.searchParams.get('longitude')).toBe('-95.21')
  // The pick came from the suggestions: no second search.
  expect(searches).toEqual(['Pasa'])
})

test('Escape closes the suggestions and a click picks one', async ({ page }) => {
  await fakePlaceSearch(page)
  await page.goto('/app/')
  await page.getByRole('button', { name: 'Not now' }).click()
  const field = page.getByRole('combobox', { name: 'City or location' })
  await field.fill('Pasadena')
  const list = page.getByRole('listbox', { name: 'Suggested places' })
  await expect(list.getByRole('option')).toHaveCount(2)

  await field.press('Escape')
  await expect(list).toBeHidden()
  await expect(field).toHaveAttribute('aria-expanded', 'false')
  await expect(field).toHaveValue('Pasadena')

  await field.press('ArrowDown')
  await expect(list).toBeVisible()
  await list.getByRole('option', { name: 'Pasadena California, United States' }).click()
  await expect(page.getByText('UV index right now in')).toBeVisible()
})

test('says when no place matches what was typed', async ({ page }) => {
  const searches = await fakePlaceSearch(page)
  await page.goto('/app/')
  await page.getByRole('button', { name: 'Not now' }).click()
  const field = page.getByRole('combobox', { name: 'City or location' })
  await field.fill('Zzyzx')

  await expect(page.getByText('No places match “Zzyzx”.')).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: 'No places match' })).toBeAttached()
  await expect(page.getByRole('option')).toHaveCount(0)
  await expect(field).toHaveAttribute('aria-expanded', 'false')

  // Enter has nothing to pick, so it says so; the answer comes from the cache.
  await field.press('Enter')
  await expect(page.locator('p[role="alert"]')).toHaveText(
    'City not found. Try a different spelling.',
  )
  expect(searches).toEqual(['Zzyzx'])
})
