import { expect, test, type Page } from '@playwright/test'
import { HARNESS_DATE, HARNESS_NOW } from './clock'
import { HARNESS_MARKER, buildRawForecast } from './fixtures'
import { captureScreen, preparePage } from './capture'

// Regression checks for the design audit's bugs (handoff/design-audit.md items 1-4),
// run in the browser against the real dashboard with Open-Meteo played by page.route.
const FORECAST = /^https:\/\/api\.open-meteo\.com\/v1\/forecast\?/
const MINUTE = 60_000
const NOW_MS = new Date(HARNESS_NOW).getTime()
/** 21:30 in Los Angeles on the first forecast day: the sun is down, every window has passed. */
const NIGHT_MS = NOW_MS + 11 * 60 * MINUTE

type Raw = ReturnType<typeof buildRawForecast>

/** Answers the forecast with `edit(raw)` and opens the live-data dashboard at `at`. */
async function openDashboard(
  page: Page,
  { at = NOW_MS, tier = 'paid', edit }: { at?: number; tier?: string; edit?: (raw: Raw) => Raw },
) {
  const raw = edit ? edit(buildRawForecast()) : buildRawForecast()
  await page.route('**/*', route => {
    const url = route.request().url()
    if (FORECAST.test(url))
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(raw) })
    return new URL(url).hostname === '127.0.0.1' ? route.continue() : route.abort('blockedbyclient')
  })
  await page.clock.install({ time: at })
  await page.goto(`/harness/?screen=dashboard&data=live&tier=${tier}`)
  await expect(page.getByTestId(HARNESS_MARKER)).toBeVisible()
  await expect(page.getByRole('group', { name: 'UV forecast by hour' })).toBeVisible()
}

/** Sets the live reading, and the first forecast day's UV at `hour` (local), to `uv`. */
function withUVAt(hour: number, uv: number) {
  return (raw: Raw): Raw => {
    const at = `${HARNESS_DATE}T${String(hour).padStart(2, '0')}:00`
    const index = raw.hourly.time.indexOf(at)
    const values = [...raw.hourly.uv_index]
    values[index] = uv
    return {
      ...raw,
      current: { ...raw.current, uv_index: uv },
      hourly: { ...raw.hourly, uv_index: values },
    }
  }
}

/** The live reading after sunset. */
const atNight = (raw: Raw): Raw => ({ ...raw, current: { ...raw.current, uv_index: 0 } })

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
    await expect(page.getByText('No lower-UV slot left today')).toBeVisible()
    await expect(page.getByText('Best day this week')).toHaveCount(0)
    await expect(page.getByText(/best day/i)).toHaveCount(0)
    await expect(page.getByText(/below/)).toHaveCount(0)
    await page.getByRole('button', { name: 'Sign in free to plan tomorrow' }).click()
    await expect(page.getByRole('dialog', { name: 'Solara Pro' })).toBeVisible()
  })

  test('a free or Pro plan is told when the next slot is', async ({ page }) => {
    await openDashboard(page, { at: NIGHT_MS, tier: 'free', edit: atNight })
    const hero = page.getByTestId('hero-empty')
    await expect(hero).toContainText('Next: Running tomorrow at 6am')
    await expect(hero).not.toContainText('below')
    const card = page.getByTestId('activity-card').filter({ hasText: 'Running' })
    await expect(card).toContainText('Next lower-UV slot: tomorrow at 6am')
  })

  // Item 3: the tip never shows a sliver of a neighbouring one, and never moves by itself.
  test('the sun safety tip is one static card with nothing beside it', async ({ page }) => {
    await openDashboard(page, {})
    const tip = page.getByRole('note', { name: 'Sun safety tip' })
    await expect(tip).toBeVisible()
    await expect(page.locator('[aria-roledescription="carousel"]')).toHaveCount(0)
    const before = await tip.textContent()
    await page.clock.runFor(20_000)
    expect(await tip.textContent()).toBe(before)
    const overflow = await tip.evaluate(el => el.scrollWidth - el.clientWidth)
    expect(overflow).toBe(0)
  })

  test('a dismissed tip stays dismissed, and the next visit shows another', async ({ page }) => {
    await openDashboard(page, {})
    const tip = page.getByRole('note', { name: 'Sun safety tip' })
    const first = await tip.textContent()
    await page.reload()
    await expect(tip).toBeVisible()
    expect(await tip.textContent()).not.toBe(first)
    await tip.getByRole('button', { name: 'Hide tips' }).click()
    await expect(tip).toHaveCount(0)
    await page.reload()
    await expect(page.getByRole('group', { name: 'UV forecast by hour' })).toBeVisible()
    await expect(tip).toHaveCount(0)
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
    const raw = JSON.stringify(screen.edit(buildRawForecast()))
    const capture = await preparePage(
      page,
      testInfo,
      (route, url) =>
        url.hostname === 'api.open-meteo.com'
          ? route.fulfill({ contentType: 'application/json', body: raw })
          : false,
      { at: screen.at },
    )
    await page.goto(`/harness/?screen=dashboard&data=live&tier=${screen.tier}`)
    await expect(page.getByTestId(HARNESS_MARKER)).toBeVisible()
    await expect(page.getByRole('group', { name: 'UV forecast by hour' })).toBeVisible()
    await captureScreen(page, testInfo, capture, { name: screen.name, fullPage: true })
  })
}
