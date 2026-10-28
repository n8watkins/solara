import { expect, test, type Page } from '@playwright/test'
import { captureScreen, preparePage } from './capture'
import { HARNESS_MARKER } from './fixtures'

// Cloud-aware forecasts with a confidence that decays after day 3 (ROADMAP item
// 12.5). The fixture's fourth day (Thu Jun 18) is 92% overcast: UV 4.1 with its
// clouds, 6.3 under a clear sky.

const OVERCAST = '2026-06-18'

async function openCalendar(page: Page) {
  await page.goto('/harness/?screen=calendar')
  await expect(page.getByTestId(HARNESS_MARKER)).toHaveAttribute('data-screen', 'calendar')
  await expect(page.getByTestId('calendar-chip').first()).toBeVisible()
}

const header = (page: Page, date: string) =>
  page.locator(`[data-testid="calendar-day-header"][data-date="${date}"]`)

test.describe('logic checks', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-light', 'logic check, run once')
  })

  test('the week view gives each day its peak, clouds and confidence', async ({ page }, info) => {
    await preparePage(page, info)
    await openCalendar(page)
    const headers = page.getByTestId('calendar-day-header')
    await expect(headers.nth(0).getByTestId('calendar-day-uv')).toHaveText('UV 10.3')
    await expect(headers.nth(0).getByTestId('calendar-day-confidence')).toHaveCount(0)
    await expect(headers.nth(2).getByTestId('calendar-day-confidence')).toHaveCount(0)
    const overcast = header(page, OVERCAST)
    await expect(overcast.getByTestId('calendar-day-uv')).toHaveText(/^UV 4\.1\s*· clear 6\.3$/)
    await expect(overcast.getByTestId('calendar-day-uv')).toHaveAttribute(
      'title',
      'Clouds may cut UV to 4.1 from a clear-sky 6.3',
    )
    await expect(overcast.getByTestId('calendar-day-confidence')).toHaveText('Fair confidence')
    await expect(headers.nth(6).getByTestId('calendar-day-confidence')).toHaveText('Low confidence')
  })

  test("a window's sheet says how sure the day is", async ({ page }, info) => {
    await preparePage(page, info)
    await openCalendar(page)
    await page
      .locator(`[data-testid="calendar-day-column"][data-date="${OVERCAST}"]`)
      .getByTestId('calendar-chip')
      .first()
      .click()
    const notes = page.getByTestId('calendar-sheet-notes')
    await expect(notes).toContainText('Clouds may cut UV to 4.1 from a clear-sky 6.3.')
    await expect(notes).toContainText('Fair confidence: UV and the best times can still change.')
  })

  test('the dashboard tells a later day its confidence and clouds', async ({ page }, info) => {
    await preparePage(page, info)
    await page.goto('/harness/?screen=dashboard')
    await expect(page.getByTestId(HARNESS_MARKER)).toBeVisible()
    // Today is nearly clear and close: nothing to add.
    await expect(page.getByTestId('uv-forecast-notes')).toHaveCount(0)
    await page.getByRole('button', { name: 'More days', exact: true }).click()
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /Jun 18/ })
      .click()
    // The briefing above says what the clouds take off, so the UV card says it no more.
    await expect(page.getByTestId('daily-briefing')).toContainText(
      'UV peaks at 4.1 (Moderate) around 1pm, or 6.3 if the sky clears',
    )
    const notes = page.getByTestId('uv-forecast-notes')
    await expect(notes).not.toContainText('Clouds may cut UV')
    await expect(notes).toContainText('Fair confidence')
  })
})

test('calendar-confidence', async ({ page }, info) => {
  const capture = await preparePage(page, info)
  await openCalendar(page)
  // On phones the grid shows two days at a time: bring the overcast day into view.
  await header(page, OVERCAST).scrollIntoViewIfNeeded()
  await captureScreen(page, info, capture, { name: 'calendar-confidence', fullPage: false })
})

test('dashboard-later-day', async ({ page }, info) => {
  const capture = await preparePage(page, info)
  await page.goto('/harness/?screen=dashboard')
  await expect(page.getByTestId(HARNESS_MARKER)).toBeVisible()
  await page.getByRole('button', { name: 'More days', exact: true }).click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /Jun 18/ })
    .click()
  await expect(page.getByTestId('uv-forecast-notes')).toBeVisible()
  await captureScreen(page, info, capture, { name: 'dashboard-later-day', fullPage: false })
})
