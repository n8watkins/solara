import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { captureScreen, preparePage } from './capture'
import { HARNESS_MARKER } from './fixtures'

// Rain and heat in the plan (packages/core/src/weather-fit.ts), with the fixtures in
// rain-heat-fixtures.ts: a slot the rain moved, one the weather took away, the card
// lines, the readout's chance of rain and the activity dialog's settings. Phones are
// captured at 390 and 320 px, desktops at 1280 px.

/** The widths each project captures: 390 and 320 on phones, 1280 on desktops. */
function widths(testInfo: TestInfo): number[] {
  return testInfo.project.use.isMobile ? [390, 320] : [1280]
}

async function open(page: Page, fixture: string, query = '') {
  await page.goto(`/harness/?screen=dashboard&fixture=${fixture}${query}`)
  await expect(page.getByTestId(HARNESS_MARKER)).toBeVisible()
}

const card = (page: Page, id: string) =>
  page.getByTestId('activity-card').and(page.locator(`[data-activity="${id}"]`))

test('rain moves a slot, and the card and hero say why', async ({ page }, testInfo) => {
  const capture = await preparePage(page, testInfo)
  await open(page, 'rain-heat')
  const hero = page.getByTestId('hero-slot')
  // Running's lower-UV evening starts at 6pm; rain then moves it to 7pm.
  await expect(hero).toHaveAttribute('data-activity', 'run')
  await expect(page.getByTestId('hero-time')).toHaveText('7pm–7:45pm')
  await expect(hero.getByTestId('weather-note')).toHaveText('Rain likely 6pm–7pm')
  await expect(card(page, 'run').getByTestId('weather-note')).toHaveText('Rain likely 6pm–7pm')
  // Tennis keeps its latest slot, and its card names both the heat and the rain.
  const tennis = card(page, 'tennis').getByTestId('weather-note')
  await expect(tennis.locator('li')).toHaveText([
    'Too hot 4pm–6pm, feels like 93°F',
    'Rain likely 6pm–7pm',
  ])
  for (const width of widths(testInfo)) {
    await page.setViewportSize({ width, height: testInfo.project.use.isMobile ? 844 : 900 })
    await captureScreen(page, testInfo, capture, {
      name: `rain-heat-dashboard-${width}`,
      fullPage: true,
    })
  }
})

test('rain through every lower-UV hour leaves no slot, in plain words', async ({
  page,
}, testInfo) => {
  const capture = await preparePage(page, testInfo)
  await open(page, 'rain-late', '&activities=run')
  const empty = page.getByTestId('hero-empty')
  // The morning's windows have passed, so today is done; the note says rain took the evening.
  await expect(empty).toContainText('No lower-UV slot left today')
  await expect(empty.getByTestId('weather-note')).toHaveText('Rain likely 6pm–8pm')
  const briefing = page.getByTestId('daily-briefing')
  await expect(briefing.locator('[data-line="window"]')).toHaveText(
    'No lower-UV window left for Running without rain',
  )
  await expect(briefing.locator('[data-line="weather"]')).toHaveText('Rain likely 6pm–8pm')
  await expect(card(page, 'run').getByTestId('weather-note')).toHaveText('Rain likely 6pm–8pm')
  // The readout names likely rain for an hour that has it.
  await page.locator('button.uv-bar[data-hour="18"]').click()
  await expect(page.getByTestId('uv-readout-detail')).toContainText('80% rain')
  for (const width of widths(testInfo)) {
    await page.setViewportSize({ width, height: testInfo.project.use.isMobile ? 844 : 900 })
    await captureScreen(page, testInfo, capture, {
      name: `rain-late-dashboard-${width}`,
      fullPage: true,
    })
  }
})

test('a rainy day has no slot, and the hero says rain is why', async ({ page }, testInfo) => {
  const capture = await preparePage(page, testInfo)
  await open(page, 'rain-late', '&activities=run')
  await page.getByRole('button', { name: 'Tomorrow', exact: true }).click()
  const empty = page.getByTestId('hero-empty')
  await expect(empty).toContainText('Rain likely in the lower\u2011UV hours')
  await expect(empty.getByTestId('weather-note').locator('li')).toHaveCount(2)
  for (const width of widths(testInfo)) {
    await page.setViewportSize({ width, height: testInfo.project.use.isMobile ? 844 : 900 })
    await captureScreen(page, testInfo, capture, {
      name: `rain-tomorrow-dashboard-${width}`,
      fullPage: true,
    })
  }
})

test('rain and heat settings in the activity dialog', async ({ page }, testInfo) => {
  const capture = await preparePage(page, testInfo)
  await open(page, 'rain-heat', '&activities=run')
  await card(page, 'run').getByRole('button', { name: 'Edit Running' }).click()
  const edit = page.getByRole('dialog', { name: 'Edit activity' })
  await edit.getByRole('heading', { name: 'Rain and heat' }).scrollIntoViewIfNeeded()
  const rain = edit.getByRole('combobox', { name: 'Rain', exact: true })
  const heat = edit.getByRole('combobox', { name: 'Max feels-like' })
  // Running's defaults: skips likely rain, stops at a feels-like 90°F.
  await expect(rain).toHaveValue('avoid')
  await expect(heat.locator('option:checked')).toHaveText('90°F')
  for (const width of widths(testInfo)) {
    await page.setViewportSize({ width, height: testInfo.project.use.isMobile ? 844 : 900 })
    await edit.getByRole('heading', { name: 'Rain and heat' }).scrollIntoViewIfNeeded()
    await captureScreen(page, testInfo, capture, {
      name: `rain-heat-settings-${width}`,
      fullPage: false,
    })
  }

  // Going ahead in the rain brings the 6pm slot back.
  await rain.selectOption('ok')
  await edit.getByRole('button', { name: 'Save activity' }).click()
  await expect(edit).toHaveCount(0)
  await expect(page.getByTestId('hero-time')).toHaveText('6pm–6:45pm')
  await expect(page.getByTestId('hero-slot').getByTestId('weather-note')).toHaveCount(0)
})
