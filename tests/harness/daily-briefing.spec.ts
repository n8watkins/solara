import { expect, test } from '@playwright/test'
import { captureScreen } from './capture'
import { NIGHT_MS, NOW_MS, atNight, openDashboard, prepareLiveDashboard } from './live-forecast'

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
    await expect(briefing).toContainText('Best lower-UV window: Running 6pm–8pm')
    await expect(briefing).toContainText('can burn in about 15 min')
    await expect(briefing).toContainText('Seek shade from 11am to 5pm, when UV is 8 or more')
  })

  test('a guest gets today in full', async ({ page }) => {
    await openDashboard(page, { at: NOW_MS, tier: 'guest' })
    const briefing = page.getByTestId('daily-briefing')
    await expect(briefing).toContainText('Best lower-UV window: Running 6pm–8pm')
    await expect(briefing.getByRole('button', { name: 'Share' })).toBeVisible()
  })

  test('after dark it briefs tomorrow and leads the dashboard', async ({ page }) => {
    await openDashboard(page, { at: NIGHT_MS, tier: 'free', edit: atNight })
    const briefing = page.getByTestId('daily-briefing')
    await expect(briefing.getByRole('heading', { name: 'Tomorrow at a glance' })).toBeVisible()
    await expect(briefing).toHaveAttribute('data-day', '2026-06-16')
    await expect(briefing).toContainText('Best lower-UV window: Running 6am–10am')
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

// Screens for review, at 390 px and 1440 px in both themes.
const SCREENS = [
  { name: 'briefing-day-free', at: NOW_MS, tier: 'free' },
  { name: 'briefing-night-free', at: NIGHT_MS, tier: 'free', edit: atNight },
  { name: 'briefing-night-guest', at: NIGHT_MS, tier: 'guest', edit: atNight },
]

for (const screen of SCREENS) {
  test(screen.name, async ({ page }, testInfo) => {
    const capture = await prepareLiveDashboard(page, testInfo, screen)
    await captureScreen(page, testInfo, capture, { name: screen.name, fullPage: false })
  })
}
