import { expect, test } from '@playwright/test'
import { HARNESS_DATE, startClock } from './clock'
import { HARNESS_MARKER } from './fixtures'

// Calendar controls whose state lives in components/calendar/ hooks
// (useWindowSheet): a chip toggles its sheet, and switching the view or the activity
// filter closes it. Behavior only, so it runs once.

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-light', 'behavior check, run once')
  await startClock(page)
  await page.goto('/harness/?screen=calendar')
  await expect(page.getByTestId(HARNESS_MARKER)).toHaveAttribute('data-screen', 'calendar')
  await expect(page.getByTestId('calendar-chip').first()).toBeVisible()
})

test('a chip toggles its sheet and keeps focus on the chip', async ({ page }) => {
  const today = page.locator(`[data-testid="calendar-day-column"][data-date="${HARNESS_DATE}"]`)
  const chip = today.getByRole('button', { name: /^Running, Today/ }).first()
  await chip.click()
  await expect(chip).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByTestId('calendar-sheet')).toBeFocused()

  await chip.click()
  await expect(page.getByTestId('calendar-sheet')).toBeHidden()
  await expect(chip).toHaveAttribute('aria-expanded', 'false')
  await expect(chip).toBeFocused()
})

test('switching the view or the filter closes the sheet', async ({ page }) => {
  const sheet = page.getByTestId('calendar-sheet')
  await page.getByTestId('calendar-chip').first().click()
  await expect(sheet).toBeVisible()
  await page.getByRole('button', { name: 'Evening' }).click()
  await expect(page.getByRole('button', { name: 'Evening' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(sheet).toBeHidden()

  await page.getByTestId('calendar-chip').first().click()
  await expect(sheet).toBeVisible()
  await page.getByRole('combobox', { name: /^Show/ }).selectOption('hike')
  await expect(sheet).toBeHidden()
  // Only the hiking lane is left.
  for (const name of await page
    .getByTestId('calendar-chip')
    .evaluateAll(chips => chips.map(c => c.textContent ?? '')))
    expect(name).toContain('Hiking')
})
