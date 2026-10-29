import { expect, test, type Page } from '@playwright/test'
import { startClock } from '../harness/clock'
import { buildRawForecast } from '../harness/fixtures'

// The eighth review's guest findings on the real export (REVIEW8 QA M3, L1, L3, L5): a
// guest changes skin type, theme and units after setup; Escape closes the header's
// location panel; setup's burn times match the UV it shows; and a forecast service that
// does not answer is named as such, with an empty state that retries.

const PLACE = {
  name: 'Los Angeles',
  admin1: 'California',
  country: 'United States',
  latitude: 34.05,
  longitude: -118.24,
  timezone: 'America/Los_Angeles',
}

/** A guest who finished setup earlier (fair skin, no activities). */
const GUEST = JSON.stringify({
  prefs: {
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
  },
  since: '2026-06-15',
})

async function mockOpenMeteo(page: Page, { forecast = true, places = true } = {}) {
  await page.route('https://geocoding-api.open-meteo.com/**', route =>
    places ? route.fulfill({ json: { results: [PLACE] } }) : route.fulfill({ status: 503 }),
  )
  await page.route('https://api.open-meteo.com/**', route =>
    forecast ? route.fulfill({ json: buildRawForecast() }) : route.fulfill({ status: 503 }),
  )
}

async function openAsGuest(page: Page) {
  await page.addInitScript(guest => {
    if (!localStorage.getItem('solara_guest')) localStorage.setItem('solara_guest', guest)
    localStorage.setItem('solara.analytics-consent.v1', 'declined')
  }, GUEST)
  await page.goto('/app/')
}

test.beforeEach(async ({ page }) => {
  await startClock(page)
})

test('a guest changes skin type, theme and units after setup', async ({ page }) => {
  await mockOpenMeteo(page)
  await openAsGuest(page)
  const burn = page.getByTestId('burn-metric')
  await expect(burn).toContainText('fair skin, no SPF')
  const before = await burn.getByTestId('metric-value').innerText()

  // "Edit" beside the skin type opens Settings on the Sun profile.
  await burn.getByRole('button', { name: 'Edit skin type' }).click()
  const settings = page.getByRole('dialog', { name: 'Settings' })
  await expect(settings.getByRole('tab', { name: 'Sun profile' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await settings.getByLabel('Skin type').selectOption('very-fair')
  await settings.getByRole('button', { name: 'Save settings' }).click()
  await expect(settings).toHaveCount(0)
  await expect(burn).toContainText('very-fair skin, no SPF')
  expect(Number.parseInt(await burn.getByTestId('metric-value').innerText())).toBeLessThan(
    Number.parseInt(before),
  )

  // The header's Settings button reaches theme and units too.
  await page.getByRole('banner').getByRole('button', { name: 'Settings' }).click()
  await settings.getByRole('tab', { name: 'Display' }).click()
  await settings.getByRole('radio', { name: 'Dark' }).check()
  await settings.getByLabel('Temperature').selectOption('celsius')
  await settings.getByRole('button', { name: 'Save settings' }).click()
  await expect(page.locator('html')).toHaveClass(/\bdark\b/)
  await expect(page.getByTestId('uv-readout')).toContainText('°C')

  // All of it is kept in the guest plan on this device.
  await page.reload()
  await expect(page.getByTestId('burn-metric')).toContainText('very-fair skin')
  await expect(page.getByTestId('uv-readout')).toContainText('°C')
})

test('Escape closes the location panel and returns focus to the place button', async ({ page }) => {
  await mockOpenMeteo(page)
  await openAsGuest(page)
  const trigger = page.getByRole('banner').getByRole('button', { name: 'Los Angeles' })
  await trigger.click()
  await expect(trigger).toHaveAttribute('aria-expanded', 'true')
  const search = page.getByRole('combobox', { name: 'Add a city' })
  await expect(search).toBeFocused()

  // With suggestions open, the first Escape closes only them.
  await search.fill('Los')
  await expect(page.getByRole('option', { name: /Los Angeles/ })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('option')).toHaveCount(0)
  await expect(search).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(search).toHaveCount(0)
  await expect(trigger).toBeFocused()
  await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  // Nothing covers the dashboard any more.
  await page.getByRole('button', { name: 'See the next 10 days with Pro' }).click()
  await expect(page.getByRole('dialog', { name: 'Solara Pro' })).toBeVisible()
})

test("setup's burn times are for the UV it has just shown", async ({ page }) => {
  await mockOpenMeteo(page)
  await page.goto('/app/')
  await page.getByRole('button', { name: 'Not now' }).click()
  await page.getByLabel('City or location').fill('Los Angeles')
  await page.getByRole('button', { name: 'Go' }).click()
  await expect(page.getByText('UV index right now in')).toBeVisible()
  const uv = await page.getByText(/^\d+\.\d$/).innerText()
  await page.getByRole('button', { name: /Continue/ }).click()

  await expect(page.getByTestId('skin-burn-note')).toHaveText(
    `Times are rough minutes to a burn without sunscreen at UV ${uv}, the UV right now.`,
  )
  // Fair skin: 15 minutes at UV 10, so 150 / UV, as the dashboard's burn card says.
  const minutes = Math.round(150 / Number(uv))
  await expect(page.getByRole('button', { name: /^Fair/ })).toContainText(`~${minutes} min`)
  await page.getByRole('button', { name: /Continue/ }).click()
  await page.getByRole('button', { name: /See today's plan/ }).click()
  await expect(page.getByTestId('burn-metric').getByTestId('metric-value')).toHaveText(
    `${minutes}m`,
  )
})

test('a forecast service that does not answer is named, with a retrying empty state', async ({
  page,
}) => {
  await mockOpenMeteo(page, { forecast: false })
  await openAsGuest(page)
  const empty = page.getByTestId('forecast-unavailable')
  await expect(empty).toContainText('No forecast yet')
  await expect(empty.getByRole('alert')).toHaveText(
    "The forecast service isn't answering right now. Solara will try again in a minute.",
  )
  await expect(page.getByText(/connection/i)).toHaveCount(0)

  // Once it answers, "Try again now" brings the dashboard.
  await page.unroute('https://api.open-meteo.com/**')
  await page.route('https://api.open-meteo.com/**', route =>
    route.fulfill({ json: buildRawForecast() }),
  )
  await empty.getByRole('button', { name: 'Try again now' }).click()
  await expect(page.getByRole('group', { name: 'UV forecast by hour' })).toBeVisible()
  await expect(empty).toHaveCount(0)
})

test('place search that does not answer does not blame the connection', async ({ page }) => {
  await mockOpenMeteo(page, { places: false })
  await page.goto('/app/')
  await page.getByRole('button', { name: 'Not now' }).click()
  await page.getByLabel('City or location').fill('Los Angeles')
  await page.getByRole('button', { name: 'Go' }).click()
  await expect(page.getByText("Place search isn't answering right now.")).toBeVisible()
  await expect(page.getByText(/connection/i)).toHaveCount(0)
})
