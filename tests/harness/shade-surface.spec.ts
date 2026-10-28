import { expect, test } from '@playwright/test'
import { captureScreen, preparePage } from './capture'
import { HARNESS_MARKER } from './fixtures'

// Shade and surface per activity (components/ActivityExposureSection.tsx): the Edit
// activity section, and the activity card's "Setting" line once saved. Screenshots and
// axe reports go to test-results/ui-harness/ like the other harness specs.

test('shade and surface for an activity', async ({ page }, testInfo) => {
  const capture = await preparePage(page, testInfo)
  await page.goto('/harness/?screen=dashboard&activities=run')
  await expect(page.getByTestId(HARNESS_MARKER)).toBeVisible()
  await page.locator('[data-activity="run"]').getByRole('button', { name: 'Edit Running' }).click()
  const edit = page.getByRole('dialog', { name: 'Edit activity' })
  const section = edit.getByRole('heading', { name: 'Shade and surface' })
  await section.scrollIntoViewIfNeeded()
  await expect(edit.getByText('100%')).toBeVisible()

  await edit
    .getByRole('group', { name: 'Surface around you' })
    .getByRole('button', { name: 'Sand' })
    .click()
  await edit
    .getByRole('group', { name: 'Typical shade' })
    .getByRole('button', { name: 'Some shade' })
    .click()
  // 0.75 of the sky's UV plus 0.15 reflected from the sand.
  await expect(edit.getByText('90%')).toBeVisible()
  await section.scrollIntoViewIfNeeded()
  await captureScreen(page, testInfo, capture, { name: 'activity-shade-surface', fullPage: false })

  await edit.getByRole('button', { name: 'Save activity' }).click()
  await expect(edit).toHaveCount(0)
  const card = page.getByTestId('activity-card').and(page.locator('[data-activity="run"]'))
  await expect(card.getByText('Sand, some shade · 90% of forecast UV')).toBeVisible()
  await card.scrollIntoViewIfNeeded()
  await captureScreen(page, testInfo, capture, { name: 'activity-card-setting', fullPage: false })
})
