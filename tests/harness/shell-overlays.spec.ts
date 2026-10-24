import { expect, test, type Locator, type Page } from '@playwright/test'
import { captureScreen, preparePage } from './capture'
import { HARNESS_MARKER } from './fixtures'

// Screenshots of the header's popovers, which the default screens never open: the
// location panel and the account menu, at both widths and themes.

const SCREENS: { name: string; open: (page: Page) => Promise<Locator> }[] = [
  {
    name: 'location-popover',
    open: async page => {
      await page.getByRole('button', { name: /Los Angeles/ }).click()
      return page.getByRole('textbox', { name: 'Add a city' })
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
    const capture = await preparePage(page, testInfo)
    await page.goto('/harness/?screen=dashboard')
    await expect(page.getByTestId(HARNESS_MARKER)).toHaveAttribute('data-screen', 'dashboard')
    await expect(await screen.open(page)).toBeVisible()
    await captureScreen(page, testInfo, capture, { name: screen.name, fullPage: false })
  })
}
