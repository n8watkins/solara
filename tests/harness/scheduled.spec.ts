import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { HARNESS_DATE, pauseClock, startClock } from './clock'
import { HARNESS_MARKER } from './fixtures'

// Scheduled activities (Google Calendar events Solara created), rendered from the
// in-memory fixture in scheduled-fixtures.tsx: how they look next to suggested
// lower-UV windows, and the details sheet's actions. Screenshots at every width and
// theme land next to the main harness screens.

const SHOT_DIR = join('test-results', 'ui-harness', 'screenshots')

async function open(page: Page, query: string, colorScheme: 'light' | 'dark') {
  await page.route('**/*', route =>
    new URL(route.request().url()).hostname === '127.0.0.1'
      ? route.continue()
      : route.abort('blockedbyclient'),
  )
  await startClock(page)
  await page.addInitScript(theme => {
    try {
      window.localStorage.setItem('solara_theme', theme)
    } catch {}
  }, colorScheme)
  await page.goto(`/harness/?${query}`)
  await expect(page.getByTestId(HARNESS_MARKER)).toBeVisible()
  await page.evaluate(async () => {
    await document.fonts.ready
  })
}

async function shot(page: Page, name: string, project: string, fullPage = true) {
  await pauseClock(page)
  mkdirSync(SHOT_DIR, { recursive: true })
  await page.screenshot({
    path: join(SHOT_DIR, `${name}--${project}.png`),
    fullPage,
    animations: 'disabled',
    caret: 'hide',
  })
}

const scheme = (name: string) => (name.endsWith('dark') ? 'dark' : 'light')

test('calendar: scheduled items read differently from suggested windows', async ({
  page,
}, testInfo) => {
  await open(page, 'screen=calendar&scheduled=synced', scheme(testInfo.project.name))
  const today = page.locator(`[data-testid="calendar-day-column"][data-date="${HARNESS_DATE}"]`)
  const block = today.getByRole('button', { name: 'Scheduled: Running, Today, 6pm – 6:45pm' })
  await expect(block).toBeVisible()
  // The window that holds it recedes to a tint; other windows stay solid.
  await expect(
    today.getByRole('button', { name: 'Running, Today, 6pm – 8pm, peak UV 3.1' }),
  ).toHaveAttribute('data-soft', 'true')
  await expect(today.locator('[data-testid="calendar-chip"][data-soft]')).toHaveCount(1)

  // The list names each upcoming item.
  const list = page.getByRole('region', { name: 'Scheduled' })
  await expect(list.getByTestId('scheduled-row')).toHaveCount(2)
  await expect(list.getByText('In sync with Google Calendar')).toBeVisible()

  // Block labels fit inside the block.
  const clipped = await page.evaluate(() =>
    [
      ...document.querySelectorAll<HTMLElement>(
        '[data-testid="calendar-scheduled"] span:not([data-sr-only])',
      ),
    ]
      .filter(el => el.scrollWidth > el.clientWidth + 0.5)
      .map(el => el.textContent),
  )
  expect(clipped).toEqual([])
  await shot(page, 'scheduled-calendar', testInfo.project.name)

  await block.click()
  const sheet = page.getByRole('dialog', { name: 'Running' })
  await expect(sheet.getByText('Today · 6pm – 6:45pm')).toBeVisible()
  await shot(page, 'scheduled-sheet', testInfo.project.name, false)

  await sheet.getByRole('button', { name: 'Change time' }).click()
  await expect(sheet.getByRole('combobox', { name: /New start time/ })).toBeVisible()
  await shot(page, 'scheduled-change-time', testInfo.project.name, false)
})

test('calendar: saved items show a reconnect hint without a Google token', async ({
  page,
}, testInfo) => {
  await open(page, 'screen=calendar&scheduled=reconnect', scheme(testInfo.project.name))
  const list = page.getByRole('region', { name: 'Scheduled' })
  await expect(list.getByRole('button', { name: 'Reconnect to sync' })).toBeVisible()
  await expect(list.getByTestId('scheduled-row')).toHaveCount(2)
  await page.getByRole('region', { name: 'Scheduled' }).scrollIntoViewIfNeeded()
  await shot(page, 'scheduled-reconnect', testInfo.project.name, false)
})

test('dashboard: the activity card shows what is scheduled', async ({ page }, testInfo) => {
  await open(page, 'screen=dashboard&scheduled=synced', scheme(testInfo.project.name))
  const card = page.locator('[data-testid="activity-card"][data-activity="run"]')
  const row = card.getByTestId('scheduled-card-row')
  await expect(row.getByText('✓ Scheduled')).toBeVisible()
  await expect(row.getByText('6pm–6:45pm', { exact: true })).toBeVisible()
  await expect(
    row.getByRole('link', {
      name: 'Open scheduled Running, 6pm–6:45pm, in Google Calendar',
    }),
  ).toHaveAttribute('href', 'https://www.google.com/calendar/event?eid=harnessrun1')
  await expect(
    row.getByRole('link', {
      name: 'Open scheduled Running, 6pm–6:45pm, in Google Calendar',
    }),
  ).toHaveAttribute('rel', 'noopener noreferrer')
  // The recommended 6pm slot is already on the calendar: the Scheduled row replaces it.
  await expect(card.getByTestId('recommended-slot')).toHaveCount(0)
  await expect(card.getByRole('button', { name: /Add to Google Calendar/ })).toHaveCount(0)
  // A full-page shot from the top, so the sticky header sits where it does on load.
  await shot(page, 'scheduled-dashboard', testInfo.project.name)
})

test('add, change time and remove from the calendar', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-light', 'behavior check, run once')
  await open(page, 'screen=calendar&scheduled=synced', 'light')
  const today = page.locator(`[data-testid="calendar-day-column"][data-date="${HARNESS_DATE}"]`)

  // Add: the hiking window becomes Scheduled at its recommended start.
  await today.getByRole('button', { name: /^Hiking, Today, 4pm – 8pm/ }).click()
  await page
    .getByRole('dialog', { name: 'Hiking' })
    .getByRole('button', { name: /Add to Google Calendar/ })
    .click()
  await expect(today.getByRole('button', { name: /^Scheduled: Hiking, Today, 4pm/ })).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: 'Scheduled Hiking' })).toBeVisible()

  // Change time: only starts inside the day's lower-UV windows are offered.
  await today.getByRole('button', { name: 'Scheduled: Running, Today, 6pm – 6:45pm' }).click()
  const sheet = page.getByRole('dialog', { name: 'Running' })
  await sheet.getByRole('button', { name: 'Change time' }).click()
  const select = sheet.getByRole('combobox', { name: /New start time/ })
  const options = await select.locator('option').allTextContents()
  expect(options[0]).toBe('6pm – 6:45pm')
  expect(options.at(-1)).toBe('7:15pm – 8pm')
  await select.selectOption({ label: '7pm – 7:45pm' })
  await sheet.getByRole('button', { name: 'Save time' }).click()
  await expect(sheet.getByText('Today · 7pm – 7:45pm')).toBeVisible()
  await expect(
    today.getByRole('button', { name: 'Scheduled: Running, Today, 7pm – 7:45pm' }),
  ).toBeVisible()

  // Remove asks first, then the block and its list row go away.
  await sheet.getByRole('button', { name: 'Remove from calendar' }).click()
  await sheet.getByRole('button', { name: 'Keep it' }).click()
  await sheet.getByRole('button', { name: 'Remove from calendar' }).click()
  await sheet.getByRole('button', { name: 'Remove', exact: true }).click()
  await expect(sheet).toBeHidden()
  await expect(today.getByRole('button', { name: /^Scheduled: Running/ })).toHaveCount(0)
  await expect(page.getByTestId('scheduled-row')).toHaveCount(2)
})

test('scheduled screens have no accessibility violations', async ({ page }, testInfo) => {
  await open(page, 'screen=calendar&scheduled=reconnect', scheme(testInfo.project.name))
  await expect(page.getByRole('region', { name: 'Scheduled' })).toBeVisible()
  const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']
  const ids = async () =>
    (await new AxeBuilder({ page }).withTags(tags).analyze()).violations.map(
      v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(', ')}`,
    )
  expect(await ids()).toEqual([])
  await page.getByRole('button', { name: /^Scheduled: Running, Today, 6pm/ }).click()
  await page
    .getByRole('dialog', { name: 'Running' })
    .getByRole('button', { name: 'Change time' })
    .click()
  expect(await ids()).toEqual([])
})
