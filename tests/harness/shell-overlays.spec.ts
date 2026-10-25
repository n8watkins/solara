import { expect, test, type Locator, type Page } from '@playwright/test'
import { captureScreen, preparePage } from './capture'
import { HARNESS_MARKER } from './fixtures'

// Screenshots of the header's popovers, which the default screens never open: the
// location panel and the account menu, at both widths and themes.

// The place search answers from this stand-in for Open-Meteo's geocoder.
const PLACES = {
  results: [
    {
      name: 'Pasadena',
      admin1: 'California',
      country: 'United States',
      latitude: 34.1478,
      longitude: -118.1445,
    },
    {
      name: 'Pasco',
      admin1: 'Washington',
      country: 'United States',
      latitude: 46.24,
      longitude: -119.1,
    },
  ],
}

const SCREENS: { name: string; open: (page: Page) => Promise<Locator> }[] = [
  {
    name: 'location-popover',
    open: async page => {
      await page.getByRole('button', { name: /Los Angeles/ }).click()
      return page.getByRole('combobox', { name: 'Add a city' })
    },
  },
  {
    name: 'location-popover-suggestions',
    open: async page => {
      await page.getByRole('button', { name: /Los Angeles/ }).click()
      const field = page.getByRole('combobox', { name: 'Add a city' })
      await field.fill('Pas')
      await expect(page.getByRole('option')).toHaveCount(2)
      await field.press('ArrowDown')
      return page.getByRole('option', {
        name: 'Pasadena California, United States',
        selected: true,
      })
    },
  },
  {
    name: 'account-menu',
    open: async page => {
      await page.getByRole('button', { name: 'Account menu' }).click()
      return page.getByRole('menu', { name: 'Account menu' })
    },
  },
]

for (const screen of SCREENS) {
  test(screen.name, async ({ page }, testInfo) => {
    const capture = await preparePage(page, testInfo, (route, url) =>
      url.origin === 'https://geocoding-api.open-meteo.com'
        ? route.fulfill({ contentType: 'application/json', body: JSON.stringify(PLACES) })
        : false,
    )
    await page.goto('/harness/?screen=dashboard')
    await expect(page.getByTestId(HARNESS_MARKER)).toHaveAttribute('data-screen', 'dashboard')
    await expect(await screen.open(page)).toBeVisible()
    await captureScreen(page, testInfo, capture, { name: screen.name, fullPage: false })
  })
}
