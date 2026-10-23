import { expect, test, type Page } from '@playwright/test'
import { startClock } from './clock'
import { HARNESS_MARKER } from './fixtures'

// The header's account menu follows the WAI-ARIA menu button pattern with the
// keyboard alone: opening focuses an item, arrows wrap, Home and End jump,
// Escape returns focus to the button and Tab leaves the menu.

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name.endsWith('-dark'), 'behavior does not depend on the theme')
})

async function openDashboard(page: Page) {
  await page.route('**/*', route => {
    const url = new URL(route.request().url())
    return url.hostname === '127.0.0.1' || url.protocol === 'data:'
      ? route.continue()
      : route.abort('blockedbyclient')
  })
  await startClock(page)
  await page.goto('/harness/?screen=dashboard')
  await expect(page.getByTestId(HARNESS_MARKER)).toHaveAttribute('data-screen', 'dashboard')
}

test('account menu: keyboard menu button pattern', async ({ page }) => {
  await openDashboard(page)
  const button = page.getByRole('button', { name: 'Account menu' })
  const menu = page.getByRole('menu', { name: 'Account menu' })
  const settings = menu.getByRole('menuitem', { name: 'Settings' })
  const account = menu.getByRole('menuitem', { name: 'Account & billing' })
  const signOut = menu.getByRole('menuitem', { name: 'Sign out' })

  // Enter opens the menu on its first item; the items are not tab stops.
  await button.focus()
  await page.keyboard.press('Enter')
  await expect(button).toHaveAttribute('aria-expanded', 'true')
  await expect(settings).toBeFocused()
  for (const item of [settings, account, signOut]) {
    await expect(item).toHaveAttribute('tabindex', '-1')
  }

  // Arrows move and wrap; Home and End jump to the ends.
  await page.keyboard.press('ArrowDown')
  await expect(account).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(signOut).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(settings).toBeFocused()
  await page.keyboard.press('ArrowUp')
  await expect(signOut).toBeFocused()
  await page.keyboard.press('Home')
  await expect(settings).toBeFocused()
  await page.keyboard.press('End')
  await expect(signOut).toBeFocused()

  // Escape closes the menu and returns focus to the button.
  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()
  await expect(button).toHaveAttribute('aria-expanded', 'false')
  await expect(button).toBeFocused()

  // ArrowUp on the button opens the menu on its last item, ArrowDown on its first.
  await page.keyboard.press('ArrowUp')
  await expect(signOut).toBeFocused()
  await page.keyboard.press('Escape')
  await page.keyboard.press('ArrowDown')
  await expect(settings).toBeFocused()

  // Tab closes the menu and moves on as if from the button.
  await page.keyboard.press('Tab')
  await expect(menu).toBeHidden()
  await expect(button).not.toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(button).toBeFocused()

  // Space opens it too, and Enter on an item activates it.
  await page.keyboard.press('Space')
  await expect(settings).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(menu).toBeHidden()
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible()
})

test('account menu: a pointer click focuses the first item and outside clicks close it', async ({
  page,
}) => {
  await openDashboard(page)
  const button = page.getByRole('button', { name: 'Account menu' })
  const menu = page.getByRole('menu', { name: 'Account menu' })
  await button.click()
  await expect(menu.getByRole('menuitem', { name: 'Settings' })).toBeFocused()
  await page.mouse.click(5, 400)
  await expect(menu).toBeHidden()
})
