import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { pauseClock, startClock } from './clock'
import { HARNESS_MARKER } from './fixtures'

// PROD-4: temperatures are stored in Celsius and shown in the person's unit, and
// times follow their 12/24-hour clock. Both default from the browser locale and
// can be changed under Settings > Display.
const SHOT_DIR = join('test-results', 'ui-harness', 'screenshots')

async function open(page: Page, screen: 'dashboard' | 'settings', colorScheme = 'light') {
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
  await page.goto(`/harness/?screen=${screen}`)
  await expect(page.getByTestId(HARNESS_MARKER)).toHaveAttribute('data-screen', screen)
}

const readout = (page: Page) => page.getByTestId('uv-readout')
const hero = (page: Page) => page.getByTestId('hero-slot')

test('US English defaults to Fahrenheit and a 12-hour clock', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-light', 'logic check, run once')
  await open(page, 'dashboard')
  // 10:30 in the fixture is 25.6 °C.
  await expect(readout(page)).toContainText('78°F')
  await expect(hero(page)).toContainText('4pm–6pm')
})

test.describe('British English', () => {
  test.use({ locale: 'en-GB' })

  test('defaults to Celsius and a 24-hour clock', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-light', 'logic check, run once')
    await open(page, 'dashboard')
    await expect(readout(page)).toContainText('26°C')
    await expect(hero(page)).toContainText('16:00–18:00')
    // The current hour (10:00) reads "Now"; the next one shows the 24-hour clock.
    await expect(page.getByRole('button', { name: /, Now$/ })).toHaveAttribute('data-hour', '10')
    await expect(page.locator('button.uv-bar[data-hour="11"]')).toContainText('11:00')
  })
})

test('Display settings switch units and the dashboard follows', async ({ page }, testInfo) => {
  const colorScheme = testInfo.project.use.colorScheme === 'dark' ? 'dark' : 'light'
  await open(page, 'settings', colorScheme)
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('tab', { name: /Display/ }).click()
  const temperature = dialog.getByLabel('Temperature')
  const clock = dialog.getByLabel('Time format')
  await expect(temperature).toHaveValue('auto')
  await expect(temperature.locator('option:checked')).toHaveText('Automatic (°F)')
  await expect(clock.locator('option:checked')).toHaveText('Automatic (1pm)')

  await pauseClock(page)
  await page.evaluate(async () => {
    await document.fonts.ready
  })
  mkdirSync(SHOT_DIR, { recursive: true })
  await page.screenshot({
    path: join(SHOT_DIR, `settings-appearance--${testInfo.project.name}.png`),
    animations: 'disabled',
    caret: 'hide',
  })
  await page.clock.resume()

  await temperature.selectOption('celsius')
  await clock.selectOption('24h')
  await dialog.getByRole('button', { name: 'Save settings' }).click()
  await expect(dialog).toBeHidden()
  await expect(readout(page)).toContainText('26°C')
  await expect(hero(page)).toContainText('16:00–18:00')
})
