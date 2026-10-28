import { expect, test } from '@playwright/test'
import { captureScreen } from './capture'
import {
  DAWN_MS,
  NIGHT_MS,
  NOW_MS,
  atNight,
  openDashboard,
  prepareLiveDashboard,
  type Raw,
} from './live-forecast'

// The daily briefing card (ROADMAP item 12.3): today at a glance by day, tomorrow
// after dark, and the words come from the shared briefing in @solara/core.

test.describe('logic checks', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-light', 'logic check, run once')
  })

  test('by day it briefs the rest of today', async ({ page }) => {
    await openDashboard(page, { at: NOW_MS, tier: 'free' })
    const briefing = page.getByTestId('daily-briefing')
    await expect(briefing.getByRole('heading', { name: 'Today at a glance' })).toBeVisible()
    await expect(briefing).toHaveAttribute('data-day', '2026-06-15')
    await expect(briefing).toContainText('UV peaks at 10.3 (Very high) around 1pm')
    await expect(briefing).toContainText('Lowest-UV window: Running 6pm–8pm')
    await expect(briefing).toContainText('can burn in about 15 min')
    await expect(briefing).toContainText('Seek shade from 11am to 5pm, when UV is 8 or more')
  })

  test('a guest gets today in full', async ({ page }) => {
    await openDashboard(page, { at: NOW_MS, tier: 'guest' })
    const briefing = page.getByTestId('daily-briefing')
    await expect(briefing).toContainText('Lowest-UV window: Running 6pm–8pm')
    await expect(briefing.getByRole('button', { name: 'Share' })).toBeVisible()
  })

  test('after dark it briefs tomorrow and leads the dashboard', async ({ page }) => {
    await openDashboard(page, { at: NIGHT_MS, tier: 'free', edit: atNight })
    const briefing = page.getByTestId('daily-briefing')
    await expect(briefing.getByRole('heading', { name: 'Tomorrow at a glance' })).toBeVisible()
    await expect(briefing).toHaveAttribute('data-day', '2026-06-16')
    await expect(briefing).toContainText('Lowest-UV window: Running 6am–9am')
    await expect(page.getByTestId('hero-empty')).toHaveCount(0)
    await expect(page.getByText('Sun is down')).toHaveCount(1)
  })

  test('a picked day is briefed as a whole day', async ({ page }) => {
    await openDashboard(page, { at: NOW_MS, tier: 'paid' })
    await page.getByRole('button', { name: 'Tomorrow', exact: true }).click()
    const briefing = page.getByTestId('daily-briefing')
    await expect(briefing.getByRole('heading', { name: 'Tomorrow at a glance' })).toBeVisible()
    await expect(briefing).toContainText('UV peaks at 9.7')
  })

  test('share copies the briefing where the share sheet is missing', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'share', { value: undefined })
      Object.defineProperty(navigator, 'clipboard', {
        value: {
          writeText: (text: string) => {
            ;(window as unknown as { copied: string }).copied = text
            return Promise.resolve()
          },
        },
      })
    })
    await openDashboard(page, { at: NOW_MS, tier: 'guest' })
    const briefing = page.getByTestId('daily-briefing')
    await briefing.getByRole('button', { name: 'Share' }).click()
    await expect(briefing.getByRole('status')).toHaveText('Copied the briefing and link.')
    const copied = await page.evaluate(() => (window as unknown as { copied: string }).copied)
    expect(copied).toMatch(/^Today in Los Angeles: UV peaks at 10\.3 \(Very high\) around 1pm\. /)
    expect(copied).toMatch(/ http:\/\/127\.0\.0\.1:\d+\/app\/$/)
  })
})

/** Today under heavy cloud: 60% of the clear-sky UV all day. */
const cloudyToday = (raw: Raw): Raw => {
  const uv = raw.hourly.uv_index.map((v, i) => (i < 24 && v !== null ? Math.round(v * 6) / 10 : v))
  const today = <T>(values: readonly (T | null)[] | undefined, value: T) =>
    (values ?? []).map((v, i) => (i < 24 ? value : v))
  return {
    ...raw,
    current: { ...raw.current, uv_index: uv[10]!, weathercode: 3 },
    hourly: {
      ...raw.hourly,
      uv_index: uv,
      weathercode: today(raw.hourly.weathercode, 3),
      cloudcover: today(raw.hourly.cloudcover, 85),
    },
  }
}

test.describe('consistency checks (REVIEW4)', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(!testInfo.project.name.endsWith('-light'), 'logic check, once per width')
  })

  test('the hour chips quote the peak exactly as the briefing does', async ({ page }) => {
    await openDashboard(page, { at: NOW_MS, tier: 'free' })
    await expect(page.getByTestId('daily-briefing')).toContainText('UV peaks at 10.3')
    const chip = page
      .getByRole('group', { name: 'UV forecast by hour' })
      .locator('[data-hour="13"]')
    await expect(chip).toContainText('10.3')
    // Every chip keeps its decimal, double digits too (no "10" beside "9.5").
    const values = await page
      .getByRole('group', { name: 'UV forecast by hour' })
      .locator('button[data-hour] > span:first-child')
      .allInnerTexts()
    expect(values.length).toBeGreaterThan(10)
    for (const value of values) expect(value.replace(/^UV\s*/, '')).toMatch(/^\d+\.\d\b/)
  })

  test('the briefing says what a clear sky would bring, and the UV card does not repeat it', async ({
    page,
  }) => {
    await openDashboard(page, { at: NOW_MS, tier: 'free', edit: cloudyToday })
    const briefing = page.getByTestId('daily-briefing')
    await expect(briefing).toContainText(
      /UV peaks at 6\.2 \(High\) around 1pm, or 10\.\d if the sky clears/,
    )
    await expect(page.getByText(/Clouds may cut UV/)).toHaveCount(0)
    // Another day keeps its own note under the UV card.
    await page.getByRole('button', { name: 'Tomorrow', exact: true }).click()
    await expect(briefing.getByRole('heading', { name: 'Tomorrow at a glance' })).toBeVisible()
  })

  test('the hero names the next slot and the briefing the lowest-UV window, never both "best"', async ({
    page,
  }) => {
    await openDashboard(page, { at: DAWN_MS, tier: 'free' })
    const hero = page.getByTestId('hero-slot')
    await expect(hero).toContainText('Next lower-UV slot')
    await expect(page.getByTestId('daily-briefing')).toContainText(/Lowest-UV window: /)
    await expect(page.getByText(/best lower-UV window/i)).toHaveCount(0)
  })

  test('before sunrise, when UV returns is said once', async ({ page }) => {
    await openDashboard(page, {
      at: DAWN_MS,
      tier: 'guest',
      edit: raw => ({ ...raw, current: { ...raw.current, uv_index: 0 } }),
    })
    await expect(page.getByTestId('uv-readout')).toContainText('Before sunrise')
    await expect(page.getByTestId('uv-readout')).toContainText('UV returns about 7am')
    await expect(page.getByText(/until 7am|No burn risk|UV too low/)).toHaveCount(0)
  })
})

// Screens for review, at 390 px and 1440 px in both themes.
const SCREENS = [
  { name: 'briefing-day-free', at: NOW_MS, tier: 'free' },
  { name: 'briefing-night-free', at: NIGHT_MS, tier: 'free', edit: atNight },
  { name: 'briefing-night-guest', at: NIGHT_MS, tier: 'guest', edit: atNight },
  { name: 'briefing-cloudy-free', at: NOW_MS, tier: 'free', edit: cloudyToday },
]

for (const screen of SCREENS) {
  test(screen.name, async ({ page }, testInfo) => {
    const capture = await prepareLiveDashboard(page, testInfo, screen)
    await captureScreen(page, testInfo, capture, { name: screen.name, fullPage: false })
  })
}
