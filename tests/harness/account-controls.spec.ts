import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { captureScreen, preparePage } from './capture'
import { HARNESS_MARKER } from './fixtures'

// The account page's signed-in controls (ROADMAP item 33): download and deletion work
// without Cloud Functions, so the controls are live on the free plan, with plain words
// and an email way out instead of the old "after the Cloud Functions and App Check are
// configured" notice. Each state at 320, 390 and 1280 px, light and dark, with no
// sideways scroll and no axe violation.

// Optional copies at each width for review (ACCOUNT_SHOTS=<folder>).
const SHOTS = process.env.ACCOUNT_SHOTS
if (SHOTS) mkdirSync(SHOTS, { recursive: true })

const mobile = (t: TestInfo) => t.project.name.startsWith('mobile')
const widths = (t: TestInfo) => (mobile(t) ? [320, 390] : [1280])
const scheme = (t: TestInfo) => t.project.name.split('-')[1]

type Box = { x: number; y: number; width: number; height: number }

/** Checks the layout at each width, then goes back to the project's own size. */
async function atEachWidth(page: Page, t: TestInfo, name: string) {
  await page.evaluate(async () => {
    await document.fonts.ready
  })
  const original = page.viewportSize()!
  for (const width of widths(t)) {
    await page.setViewportSize({ width, height: original.height })
    if (SHOTS) {
      await page.screenshot({
        path: `${SHOTS}/${name}-${width}-${scheme(t)}.png`,
        fullPage: true,
        animations: 'disabled',
        caret: 'hide',
      })
    }
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow, `${name} at ${width} px scrolls sideways`).toBeLessThanOrEqual(0)
    // Every card's content stays inside the card.
    const deleteCard = page.getByRole('region', { name: 'Delete account' })
    const card = (await deleteCard.boundingBox()) as Box
    for (const control of await deleteCard.locator('input, button, p').all()) {
      const box = (await control.boundingBox()) as Box
      expect(box.x, `${name} at ${width} px`).toBeGreaterThanOrEqual(card.x)
      expect(box.x + box.width, `${name} at ${width} px`).toBeLessThanOrEqual(card.x + card.width)
    }
  }
  await page.setViewportSize(original)
}

async function open(page: Page, t: TestInfo, state: string) {
  const capture = await preparePage(page, t)
  await page.goto(`/harness/account/?state=${state}`)
  await expect(page.getByTestId(HARNESS_MARKER)).toBeVisible()
  await expect(page.getByRole('heading', { level: 1, name: 'Account controls' })).toBeVisible()
  return capture
}

/** Captures the screen and holds it to zero axe violations. */
async function captureClean(
  page: Page,
  t: TestInfo,
  capture: Awaited<ReturnType<typeof open>>,
  name: string,
) {
  await atEachWidth(page, t, name)
  await captureScreen(page, t, capture, { name, fullPage: true })
  const report = JSON.parse(
    readFileSync(
      join('test-results', 'ui-harness', 'axe', `${name}--${t.project.name}.json`),
      'utf8',
    ),
  ) as { violations: { id: string }[] }
  expect(report.violations.map(v => v.id)).toEqual([])
}

test('account-controls-ready', async ({ page }, t) => {
  const capture = await open(page, t, 'ready')
  await expect(page.getByText(/Cloud Functions|App Check/)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Download account data' })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Delete permanently' })).toBeDisabled()
  await expect(page.getByLabel('Type DELETE to confirm')).toHaveAccessibleDescription(
    'Google then asks you to sign in again, to confirm it is you.',
  )
  await expect(page.getByRole('link', { name: 'contact@n8builds.dev' })).toHaveAttribute(
    'href',
    'mailto:contact@n8builds.dev',
  )
  await captureClean(page, t, capture, 'account-controls-ready')
})

test('account-controls-confirmed', async ({ page }, t) => {
  const capture = await open(page, t, 'confirmed')
  await expect(page.getByRole('button', { name: 'Delete permanently' })).toBeEnabled()
  await captureClean(page, t, capture, 'account-controls-confirmed')
})

test('account-controls-deleting', async ({ page }, t) => {
  const capture = await open(page, t, 'deleting')
  await expect(page.getByRole('button', { name: 'Deleting...' })).toBeDisabled()
  await expect(page.getByRole('status')).toHaveText('Deleting your data. Keep this page open.')
  await captureClean(page, t, capture, 'account-controls-deleting')
})

test('account-controls-failed', async ({ page }, t) => {
  const capture = await open(page, t, 'failed')
  await expect(page.getByRole('status')).toContainText('deletion picks up where it stopped')
  await captureClean(page, t, capture, 'account-controls-failed')
})

test('account-controls-blocked', async ({ page }, t) => {
  const capture = await open(page, t, 'blocked')
  const section = page.getByRole('region', { name: 'Delete account' })
  await expect(section).toContainText('To delete it, email contact@n8builds.dev')
  await expect(section.getByRole('button')).toHaveCount(0)
  await captureClean(page, t, capture, 'account-controls-blocked')
})

test('account-controls-pro', async ({ page }, t) => {
  const capture = await open(page, t, 'pro')
  await expect(page.getByRole('button', { name: 'Manage subscription' })).toBeEnabled()
  await captureClean(page, t, capture, 'account-controls-pro')
})
