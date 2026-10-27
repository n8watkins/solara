import { expect, test } from '@playwright/test'
import { captureScreen, preparePage } from './capture'
import { HARNESS_MARKER } from './fixtures'

// Family profiles (components/ProfileSwitcher.tsx), on phones as well as desktop: the
// Pro list with "Plan for a group" and the most sensitive person, and the Free offer,
// which says Pro is a waitlist while checkout is off (as in this build). Screenshots
// and axe reports go to test-results/ui-harness/ like the other harness specs.

test('profiles on Pro', async ({ page }, testInfo) => {
  const capture = await preparePage(page, testInfo)
  await page.goto('/harness/?screen=dashboard')
  await expect(page.getByTestId(HARNESS_MARKER)).toBeVisible()
  await page.getByRole('banner').getByRole('button', { name: 'Profile: Me' }).click()
  const panel = page.getByRole('dialog', { name: 'Profiles' })
  await expect(panel.getByRole('button', { name: 'Plan for a group' })).toHaveAttribute(
    'aria-pressed',
    'false',
  )
  await captureScreen(page, testInfo, capture, { name: 'profiles-pro', fullPage: false })

  await panel.getByRole('button', { name: 'Plan for a group' }).click()
  await expect(panel.getByRole('checkbox', { name: /Maya/ })).toHaveAttribute(
    'aria-checked',
    'true',
  )
  await expect(panel.getByRole('checkbox', { name: /Maya/ })).toContainText('Most sensitive')
  await expect(
    page.getByRole('banner').getByRole('button', { name: 'Profile: group of 2, planned for Maya' }),
  ).toBeVisible()
  await captureScreen(page, testInfo, capture, { name: 'profiles-group', fullPage: false })

  await page.keyboard.press('Escape')
  await expect(panel).toHaveCount(0)
  await expect(page.getByText('Now · Maya (most sensitive), no SPF')).toBeVisible()
})

test('profiles on Free', async ({ page }, testInfo) => {
  const capture = await preparePage(page, testInfo)
  await page.goto('/harness/?screen=dashboard&tier=free')
  await expect(page.getByTestId(HARNESS_MARKER)).toBeVisible()
  await page
    .getByRole('banner')
    .getByRole('button', { name: /^Profile:/ })
    .click()
  const panel = page.getByRole('dialog', { name: 'Profiles' })
  await expect(panel.getByText('Family profiles come with Pro')).toBeVisible()
  await expect(panel.getByText(/Pro is not on sale yet/)).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Plan for a group' })).toHaveCount(0)
  await captureScreen(page, testInfo, capture, { name: 'profiles-free', fullPage: false })
  await panel.getByRole('button', { name: 'Join the Pro waitlist' }).click()
  await expect(page.getByRole('dialog', { name: 'Solara Pro' })).toBeVisible()
})
