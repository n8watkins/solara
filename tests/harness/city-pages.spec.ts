import { expect, test } from '@playwright/test'
import { captureScreen, preparePage } from './capture'

// Screens and axe results for the city pages (app/uv/), at 390 px and 1440 px in both
// themes: a city with a long protection season and one with a low winter, and the index.

const SCREENS = [
  { name: 'city-los-angeles', path: '/uv/los-angeles/', heading: 'UV index in Los Angeles' },
  { name: 'city-london', path: '/uv/london/', heading: 'UV index in London' },
  { name: 'city-index', path: '/uv/', heading: 'UV by city' },
]

for (const screen of SCREENS) {
  test(screen.name, async ({ page }, testInfo) => {
    const capture = await preparePage(page, testInfo)
    await page.goto(screen.path)
    await expect(page.getByRole('heading', { level: 1, name: screen.heading })).toBeVisible()
    await captureScreen(page, testInfo, capture, { name: screen.name, fullPage: true })
  })
}
