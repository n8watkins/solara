import { mkdirSync } from 'node:fs'
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test'
import { captureScreen, preparePage } from './capture'
import { HARNESS_MARKER } from './fixtures'

// The free pushes once alerts are on (ROADMAP item 39; ?alerts=on stands in for
// NEXT_PUBLIC_ALERTS_ENABLED, ?reminders= for the account's devices):
// - the sunscreen timer of a signed-in account says its reminder also comes with Solara
//   closed, or how to get that (turn alerts on for this device);
// - a Free account's Alerts tab has the daily UV push and the reminders, with Pro's alerts
//   offered below.
// Each at 320 and 390 px (mobile projects) and 1280 px (desktop), light and dark: no
// sideways scroll, and a clean axe run. REMIND_SHOTS=<folder> saves a copy of each.

const SHOTS = process.env.REMIND_SHOTS
if (SHOTS) mkdirSync(SHOTS, { recursive: true })

const mobile = (t: TestInfo) => t.project.name.startsWith('mobile')
const widths = (t: TestInfo) => (mobile(t) ? [320, 390] : [1280])
const scheme = (t: TestInfo) => t.project.name.split('-')[1]

async function atEachWidth(page: Page, t: TestInfo, name: string, shot: Locator) {
  await page.evaluate(async () => {
    await document.fonts.ready
  })
  for (const width of widths(t)) {
    await page.setViewportSize({ width, height: mobile(t) ? 844 : 900 })
    await shot.scrollIntoViewIfNeeded()
    if (SHOTS) {
      await shot.screenshot({
        path: `${SHOTS}/${name}-${width}-${scheme(t)}.png`,
        animations: 'disabled',
        caret: 'hide',
      })
    }
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow, `${name} at ${width} px scrolls sideways`).toBeLessThanOrEqual(0)
  }
}

const timer = (page: Page) =>
  page.getByRole('region', { name: /Sunscreen timer|Reapply sunscreen|Time to reapply/ })

for (const reminders of ['devices', 'none'] as const) {
  test(`sunscreen timer, signed in, ${reminders === 'devices' ? 'with' : 'without'} a device`, async ({
    page,
  }, t) => {
    const capture = await preparePage(page, t)
    await page.goto(`/harness/?screen=dashboard&tier=free&alerts=on&reminders=${reminders}`)
    await expect(page.getByTestId(HARNESS_MARKER)).toBeVisible()
    await timer(page).getByRole('button', { name: 'Start' }).click()
    await expect(timer(page)).toContainText(
      reminders === 'devices'
        ? 'It also comes to your devices with alerts on, even with Solara closed.'
        : 'To get it with Solara closed, turn on alerts for this device.',
    )
    const name = `reapply-push-${reminders}`
    await atEachWidth(page, t, name, timer(page))
    await captureScreen(page, t, capture, { name, fullPage: false })
  })
}

test('alerts tab of a Free account once alerts are on', async ({ page }, t) => {
  const capture = await preparePage(page, t)
  await page.goto('/harness/?screen=settings&tab=alerts&tier=free&alerts=on')
  const settings = page.getByRole('dialog', { name: 'Settings' })
  const card = settings
    .getByRole('heading', { name: 'Daily UV and sunscreen reminders' })
    .locator('..')
    .locator('..')
  await expect(card).toBeVisible()
  await expect(settings.getByRole('combobox', { name: 'Daily UV', exact: true })).toHaveValue('on')
  await expect(settings.getByRole('combobox', { name: 'Daily UV at' })).toHaveValue('7')
  await expect(settings.getByRole('heading', { name: 'Morning and UV alerts' })).toBeVisible()
  await atEachWidth(page, t, 'settings-alerts-free', settings)
  // Turned off, the hour goes; quiet hours stay for the timer's reminder copy.
  await settings.getByRole('combobox', { name: 'Daily UV', exact: true }).selectOption('off')
  await expect(settings.getByRole('combobox', { name: 'Daily UV at' })).toHaveCount(0)
  await settings.getByRole('combobox', { name: 'Daily UV', exact: true }).selectOption('on')
  await captureScreen(page, t, capture, { name: 'settings-alerts-free', fullPage: false })
})
