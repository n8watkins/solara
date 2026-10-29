import { expect, test, type Page } from '@playwright/test'
import { HARNESS_DATE, HARNESS_NOW, startClock } from './clock'
import { HARNESS_MARKER } from './fixtures'

// The calendar's "today" offers the same actionable windows as the dashboard
// (packages/core/src/next-slot.ts planActivityDay): nothing that has already passed, and a
// window already under way starts now. Calendar links point at the right moment
// in the forecast location's zone.

async function openCalendar(page: Page, at?: string, query = '') {
  await page.route('**/*', route =>
    new URL(route.request().url()).hostname === '127.0.0.1'
      ? route.continue()
      : route.abort('blockedbyclient'),
  )
  if (at) await page.clock.install({ time: new Date(at).getTime() })
  else await startClock(page)
  await page.goto(`/harness/?screen=calendar${query}`)
  await expect(page.getByTestId(HARNESS_MARKER)).toHaveAttribute('data-screen', 'calendar')
  await expect(page.getByTestId('calendar-chip').first()).toBeVisible()
}

function todayColumn(page: Page) {
  return page.locator(`[data-testid="calendar-day-column"][data-date="${HARNESS_DATE}"]`)
}

async function chipSpans(page: Page) {
  return todayColumn(page)
    .getByTestId('calendar-chip')
    .evaluateAll(chips =>
      chips.map(chip => ({
        from: Number(chip.getAttribute('data-from')),
        to: Number(chip.getAttribute('data-to')),
      })),
    )
}

test('today shows no elapsed window and fades the past', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('desktop'), 'logic check, desktop only')
  await openCalendar(page)
  const spans = await chipSpans(page)
  expect(spans.length).toBeGreaterThan(0)
  // HARNESS_NOW is 10:30, so nothing on today may start earlier.
  for (const span of spans) expect(span.from).toBeGreaterThanOrEqual(10.5)
  // The 6am-9am run and the 6am-noon hike (too short once trimmed) are gone.
  await expect(todayColumn(page).getByRole('button', { name: /^Running, Today, 6am/ })).toHaveCount(
    0,
  )
  await expect(
    todayColumn(page).getByRole('button', { name: /^Hiking, Today, (6am|10:35am)/ }),
  ).toHaveCount(0)
  // Later days keep their morning windows.
  await expect(
    page.getByRole('button', { name: /^Running, Tomorrow, 6am – 9am/ }).first(),
  ).toBeVisible()

  // The faded past ends exactly at the now line.
  const past = await todayColumn(page).getByTestId('calendar-past').boundingBox()
  const now = await todayColumn(page).getByTestId('calendar-now').boundingBox()
  expect(past && now && Math.abs(past.y + past.height - (now.y + now.height / 2))).toBeLessThan(1.5)
})

test('a window under way starts now and links to the right moment', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('desktop'), 'logic check, desktop only')
  // 7:00 in Los Angeles: the 6am-9am run is under way (9am's clear-sky UV is over 4).
  const at = HARNESS_NOW.replace('T10:30', 'T07:00')
  await openCalendar(page, at)
  const chip = todayColumn(page).getByRole('button', { name: /^Running, Today, 7am – 9am/ })
  await expect(chip).toBeVisible()
  await expect(chip).toHaveAttribute('data-from', '7')
  // The visible start of a window under way is "now", which fits the narrowest chip.
  await expect(chip).toContainText('now')
  await chip.click()
  const link = page.getByRole('dialog', { name: /Running/ }).getByRole('link', {
    name: /Add to Google Calendar/,
  })
  // 07:00-09:00 PDT is 14:00-16:00 UTC.
  await expect(link).toHaveAttribute('href', /dates=20260615T140000Z\/20260615T160000Z&/)
})

test('labels of windows under way fit their chips', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('desktop'), 'logic check, desktop only')
  // The overcast fixture has windows that are under way at 10:30.
  await openCalendar(page, undefined, '&fixture=uv-gaps')
  const chips = todayColumn(page).getByTestId('calendar-chip')
  await expect(chips.filter({ hasText: 'now' }).first()).toBeVisible()
  const clipped = await todayColumn(page)
    .locator('[data-testid="calendar-chip"] span:not([data-sr-only])')
    .evaluateAll(spans =>
      spans.filter(span => span.scrollWidth > span.clientWidth + 0.5).map(span => span.textContent),
    )
  expect(clipped).toEqual([])
})
