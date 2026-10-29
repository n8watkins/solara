import { expect, test, type Page } from '@playwright/test'
import { captureScreen } from './capture'
import { NIGHT_MS, NOW_MS, atNight, openDashboard, prepareLiveDashboard } from './live-forecast'

// After dark (handoff/polish.md): an activity card says once that today is done,
// and the hour strip opens on the hours when UV returns, not on a midday that is
// over. By day the strip still opens on the current hour.

const strip = (page: Page) => page.getByRole('group', { name: 'UV forecast by hour' })

/** The hours whose bars' centers are inside the strip's visible area. */
async function visibleHours(page: Page): Promise<number[]> {
  return strip(page).evaluate(el => {
    const left = el.scrollLeft
    const right = left + el.clientWidth
    return Array.from(el.querySelectorAll<HTMLElement>('button[data-hour]'))
      .filter(bar => {
        const mid = bar.offsetLeft + bar.offsetWidth / 2
        return mid >= left && mid <= right
      })
      .map(bar => Number(bar.dataset.hour))
  })
}

test.describe('logic checks', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(!testInfo.project.name.endsWith('-light'), 'logic check, once per width')
  })

  test('a done activity card says today is over once', async ({ page }) => {
    await openDashboard(page, { at: NIGHT_MS, tier: 'guest', edit: atNight })
    const card = page.getByTestId('activity-card')
    await expect(card.getByText('Done for today')).toHaveClass(/badge-done/)
    await expect(card).toContainText('Sign in free to plan tomorrow.')
    await expect(card).not.toContainText(/Best window|left today|have passed/)
    expect((await card.innerText()).match(/today/gi)).toHaveLength(1)
    // After sunset the briefing leads with tomorrow in place of the hero.
    await expect(page.getByTestId('hero-empty')).toHaveCount(0)
    await expect(page.getByTestId('daily-briefing')).toContainText('Tomorrow at a glance')
  })

  test('a signed-in card names the next slot instead', async ({ page }) => {
    await openDashboard(page, { at: NIGHT_MS, tier: 'free', edit: atNight })
    const card = page.getByTestId('activity-card').filter({ hasText: 'Running' })
    await expect(card).toContainText('Next slot: tomorrow at 6am.')
    expect((await card.innerText()).match(/today/gi)).toHaveLength(1)
  })

  test('after dark the strip opens where UV returns, and stays there', async ({ page }) => {
    await openDashboard(page, { at: NIGHT_MS, tier: 'guest', edit: atNight })
    await expect(page.getByTestId('uv-readout')).toContainText('UV returns about 7am tomorrow')
    await expect.poll(() => visibleHours(page)).toContain(7)
    expect((await visibleHours(page))[0]).toBe(6)
    // A layout change (a phone's toolbar, a full-page screenshot) must not move it.
    await page.setViewportSize({ ...page.viewportSize()!, height: 2400 })
    await page.waitForTimeout(300)
    expect((await visibleHours(page))[0]).toBe(6)
  })

  test('just after sunset, with the last hour still on the strip, it opens where UV returns', async ({
    page,
  }) => {
    // 20:30: the strip's last bar (8pm) is the current hour, but the day is over
    // (REVIEW4: the strip opened on the afternoon, under "UV returns about 7am").
    await openDashboard(page, { at: NIGHT_MS - 60 * 60_000, tier: 'guest', edit: atNight })
    await expect(page.getByTestId('uv-readout')).toContainText('Sun is down')
    await expect.poll(() => visibleHours(page)).toContain(7)
    expect((await visibleHours(page))[0]).toBe(6)
  })

  test('by day the strip opens on the current hour', async ({ page }) => {
    await openDashboard(page, { at: NOW_MS, tier: 'guest' })
    await expect.poll(() => visibleHours(page)).toContain(10)
    const hours = await visibleHours(page)
    // On a phone, where the strip scrolls, 10:30 sits in the middle of what is shown.
    const scrolls = await strip(page).evaluate(el => el.scrollWidth > el.clientWidth)
    if (scrolls)
      expect(Math.abs(hours.indexOf(10) - (hours.length - 1) / 2)).toBeLessThanOrEqual(0.5)
    await page.setViewportSize({ ...page.viewportSize()!, height: 2400 })
    await page.waitForTimeout(300)
    expect(await visibleHours(page)).toEqual(hours)
  })
})

// Screens for review, at 390 px and 1440 px in both themes.
const SCREENS = [{ name: 'dashboard-night-guest', at: NIGHT_MS, tier: 'guest', edit: atNight }]

for (const screen of SCREENS) {
  test(screen.name, async ({ page }, testInfo) => {
    const capture = await prepareLiveDashboard(page, testInfo, screen)
    await captureScreen(page, testInfo, capture, { name: screen.name, fullPage: true })
  })
}
