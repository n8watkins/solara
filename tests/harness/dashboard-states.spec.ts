import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { pauseClock, startClock } from './clock'
import { freezeScreen } from './freeze'
import { HARNESS_MARKER } from './fixtures'

// Dashboard states the default screenshot does not reach: a scrubbed hour with
// the UV scale open, the day picker dialog, the free plan's locked-days tab,
// the free plan's Plan ahead upsell, another day's hero, scheduled rows on the
// activity cards and the loading skeleton. Each state is asserted and
// screenshotted so restyles can be compared before and after.
const SHOT_DIR = join('test-results', 'ui-harness', 'screenshots')

async function open(
  page: Page,
  query: string,
  colorScheme: 'light' | 'dark',
  { hangForecast = false } = {},
) {
  const pageErrors: string[] = []
  page.on('pageerror', err => pageErrors.push(err.message))
  await page.route('**/*', route =>
    new URL(route.request().url()).hostname === '127.0.0.1'
      ? route.continue()
      : route.abort('blockedbyclient'),
  )
  // Registered last so it runs first: Open-Meteo never answers.
  if (hangForecast) await page.route(/^https:\/\/api\.open-meteo\.com\//, () => {})
  await startClock(page)
  await page.addInitScript(theme => {
    try {
      window.localStorage.setItem('solara_theme', theme)
    } catch {}
  }, colorScheme)
  await page.goto(`/harness/?screen=dashboard${query}`)
  await expect(page.getByTestId(HARNESS_MARKER)).toHaveAttribute('data-screen', 'dashboard')
  await page.evaluate(async () => {
    await document.fonts.ready
  })
  return pageErrors
}

async function shoot(target: Page | Locator, name: string, project: string) {
  mkdirSync(SHOT_DIR, { recursive: true })
  await target.screenshot({
    path: join(SHOT_DIR, `dashboard-${name}--${project}.png`),
    // A page is shot whole; an element taller than the viewport would be shot
    // under the sticky header.
    ...('goto' in target ? { fullPage: true } : {}),
    animations: 'disabled',
    caret: 'hide',
  })
}

function scheme(colorScheme: unknown): 'light' | 'dark' {
  return colorScheme === 'dark' ? 'dark' : 'light'
}

test('a scrubbed hour drives the readout, and the UV scale opens', async ({ page }, testInfo) => {
  const errors = await open(page, '', scheme(testInfo.project.use.colorScheme))
  const card = page.locator('.card').filter({ has: page.getByTestId('uv-readout') })
  await card.locator('button[data-hour="14"]').click()
  await expect(page.getByTestId('uv-readout')).toContainText('at 2pm')
  await expect(card.locator('button[data-hour="14"]')).toHaveAttribute('aria-pressed', 'true')
  const legend = card.getByRole('button', { name: /UV scale/ })
  await legend.click()
  await expect(legend).toHaveAttribute('aria-expanded', 'true')
  await expect(card).toContainText('Extreme (11+)')
  await pauseClock(page)
  await shoot(card, 'uv-focus', testInfo.project.name)
  expect(errors).toEqual([])
})

test('the day picker lists the days', async ({ page }, testInfo) => {
  const errors = await open(page, '', scheme(testInfo.project.use.colorScheme))
  await page.getByRole('button', { name: 'More days', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('Choose a day')
  await pauseClock(page)
  await shoot(dialog, 'day-picker', testInfo.project.name)

  await dialog.getByRole('button', { name: /Tomorrow/ }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByTestId('hero-slot')).toContainText('Lower-UV slot · Tomorrow')
  await expect(page.getByRole('button', { name: 'Tomorrow' })).toBeVisible()
  expect(errors).toEqual([])
})

test('on Free, the locked days sit behind a Pro tab', async ({ page }, testInfo) => {
  const errors = await open(page, '&tier=free', scheme(testInfo.project.use.colorScheme))
  await expect(page.getByRole('button', { name: 'More days', exact: true })).toHaveCount(0)
  const picker = page.getByTestId('day-picker')
  await expect(picker.getByRole('button', { name: 'Tomorrow' })).toBeVisible()
  await pauseClock(page)
  await shoot(picker, 'day-picker-free', testInfo.project.name)
  await page.getByRole('button', { name: 'See the next 10 days with Pro' }).click()
  await expect(page.getByRole('dialog', { name: 'Solara Pro' })).toBeVisible()
  expect(errors).toEqual([])
})

test('the free plan shows the Plan ahead upsell', async ({ page }, testInfo) => {
  const errors = await open(page, '&tier=free', scheme(testInfo.project.use.colorScheme))
  const plan = page.locator('.card').filter({ hasText: 'Best day this week' })
  await expect(plan.getByTestId('plan-ahead-row').first()).toBeVisible()
  await expect(plan.getByRole('button', { name: /Go Pro for 10-day planning/ })).toBeVisible()
  await pauseClock(page)
  await shoot(plan, 'plan-ahead-free', testInfo.project.name)
  expect(errors).toEqual([])
})

test('another day shows its own hero and cards', async ({ page }, testInfo) => {
  const errors = await open(page, '', scheme(testInfo.project.use.colorScheme))
  await page.getByRole('button', { name: 'Tomorrow' }).click()
  await expect(page.getByTestId('hero-slot')).toContainText('Lower-UV slot · Tomorrow')
  await expect(page.getByTestId('uv-readout')).toContainText('peak')
  // A whole-page shot: check the time-dependent pixels (see freeze.ts).
  await freezeScreen(page)
  await shoot(page, 'tomorrow', testInfo.project.name)
  expect(errors).toEqual([])
})

test('scheduled activities show on their cards', async ({ page }, testInfo) => {
  const errors = await open(page, '&scheduled=synced', scheme(testInfo.project.use.colorScheme))
  const row = page.getByTestId('scheduled-card-row').first()
  await expect(row).toBeVisible()
  const card = page.getByTestId('activity-card').filter({ has: row })
  await pauseClock(page)
  await shoot(card, 'scheduled-card', testInfo.project.name)
  expect(errors).toEqual([])
})

test('the skeleton holds the layout while the forecast loads', async ({ page }, testInfo) => {
  const errors = await open(page, '&data=live', scheme(testInfo.project.use.colorScheme), {
    hangForecast: true,
  })
  await expect(page.getByRole('status').filter({ hasText: 'Loading the forecast' })).toBeAttached()
  await expect(page.locator('main .animate-pulse')).toBeVisible()
  // A whole-page shot: check the time-dependent pixels (see freeze.ts).
  await freezeScreen(page)
  await shoot(page, 'skeleton', testInfo.project.name)
  expect(errors).toEqual([])
})
