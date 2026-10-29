import { expect, test } from '@playwright/test'
import { captureScreen } from './capture'
import {
  NIGHT_MS,
  NOW_MS,
  type Raw,
  atNight,
  openDashboard,
  prepareLiveDashboard,
  withUVAt,
} from './live-forecast'

/** 19:30, before sunset: UV 1.1 is left, but no window long enough for any activity. */
const EVENING_MS = NOW_MS + 9 * 60 * 60_000
const noWindowsLeft = (raw: Raw): Raw => ({ ...raw, current: { ...raw.current, uv_index: 1.1 } })

// Regression checks for the design audit's bugs (handoff/design-audit.md items 1-4),
// run in the browser against the real dashboard with Open-Meteo played by page.route.

test.describe('logic checks', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-light', 'logic check, run once')
  })

  // Item 1: the WHO bands apply to the rounded index, so 5.4 is Moderate (3-5), not High.
  test('a UV of 5.4 reads Moderate everywhere, as the scale legend says', async ({ page }) => {
    await openDashboard(page, { edit: withUVAt(10, 5.4) })
    const readout = page.getByTestId('uv-readout')
    await expect(readout).toContainText('5.4')
    await expect(readout).toContainText('Moderate')
    await expect(page.getByTitle('Current UV index 5.4, Moderate')).toBeVisible()
    await expect(page.locator('button.uv-bar[data-hour="10"]')).toContainText('Moderate')
  })

  // Item 2: guests have no "Best day this week", so nothing may point to it.
  test('a guest is never sent to a "best day" section they cannot see', async ({ page }) => {
    await openDashboard(page, { at: NIGHT_MS, tier: 'guest', edit: atNight })
    await expect(page.getByText('Done for today')).toBeVisible()
    await expect(page.getByText('Best day this week')).toHaveCount(0)
    await expect(page.getByText(/best day/i)).toHaveCount(0)
    await expect(page.getByText(/below/)).toHaveCount(0)
    await page.getByRole('button', { name: 'Sign in free to plan tomorrow' }).click()
    await expect(page.getByRole('dialog', { name: 'Solara Pro' })).toBeVisible()
  })

  test('a free or Pro plan is told when the next slot is', async ({ page }) => {
    // In the evening, once today's windows have passed but before sunset.
    await openDashboard(page, { at: EVENING_MS, tier: 'free', edit: noWindowsLeft })
    const hero = page.getByTestId('hero-empty')
    await expect(hero).toContainText('Next: Running tomorrow at 6am')
    await expect(hero).not.toContainText(/best day/i)
    const card = page.getByTestId('activity-card').filter({ hasText: 'Running' })
    await expect(card).toContainText('Next slot: tomorrow at 6am')
  })
})

test.describe('phone strip', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-light', 'phone layout check, run once')
  })

  // Item 4: a strip resting at either end shows that end's chip whole: the edge fade
  // only appears on a side with more hours to scroll to.
  test('the hour strip fades only the side that has more hours', async ({ page }) => {
    await openDashboard(page, { at: NIGHT_MS, edit: atNight })
    const strip = page.getByRole('group', { name: 'UV forecast by hour' })
    // Where the strip's mask turns fully opaque at each end, and the first and last
    // bars' edges, all in px from the strip's visible left edge.
    const edges = () =>
      strip.evaluate(el => {
        const mask = getComputedStyle(el).maskImage
        const stops = [...mask.matchAll(/rgb\(0, 0, 0\) (calc\([^)]*\)|[^,)]+)/g)].map(m => m[1]!)
        const px = (stop: string) => {
          const calc = /calc\(100% - ([\d.]+)px\)/.exec(stop)
          if (calc) return el.clientWidth - Number(calc[1])
          return stop.endsWith('%')
            ? (el.clientWidth * Number.parseFloat(stop)) / 100
            : Number.parseFloat(stop)
        }
        const bars = el.querySelectorAll<HTMLElement>('button.uv-bar')
        const left = el.getBoundingClientRect().left
        const first = bars[0]!.getBoundingClientRect()
        const last = bars[bars.length - 1]!.getBoundingClientRect()
        return {
          mask,
          opaqueFrom: px(stops[0]!),
          opaqueTo: px(stops[1]!),
          firstBar: first.left - left,
          lastBar: last.right - left,
        }
      })

    await strip.evaluate(el => el.scrollTo({ left: 0 }))
    await expect
      .poll(async () => {
        const e = await edges()
        return e.opaqueFrom <= e.firstBar
      })
      .toBe(true)
    // The other side still fades: there are more hours that way.
    const atStart = await edges()
    expect(atStart.opaqueTo, atStart.mask).toBeLessThan(await strip.evaluate(el => el.clientWidth))

    await strip.evaluate(el => el.scrollTo({ left: el.scrollWidth }))
    await expect
      .poll(async () => {
        const e = await edges()
        return e.opaqueTo >= e.lastBar
      })
      .toBe(true)
    expect((await edges()).opaqueFrom).toBeGreaterThan(0)
  })
})

// Screens for review: the dashboard after dark (every window passed) on the guest
// and Free plans, and a 5.4 reading. Same output as the other harness specs.
const SCREENS = [
  { name: 'dashboard-night-guest', at: NIGHT_MS, tier: 'guest', edit: atNight },
  { name: 'dashboard-night-free', at: NIGHT_MS, tier: 'free', edit: atNight },
  { name: 'dashboard-uv-5-4', at: NOW_MS, tier: 'paid', edit: withUVAt(10, 5.4) },
]

for (const screen of SCREENS) {
  test(screen.name, async ({ page }, testInfo) => {
    const capture = await prepareLiveDashboard(page, testInfo, screen)
    await captureScreen(page, testInfo, capture, { name: screen.name, fullPage: true })
  })
}
