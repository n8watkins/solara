import { mkdirSync } from 'node:fs'
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test'
import { captureScreen, preparePage } from './capture'
import { HARNESS_MARKER, HARNESS_PLACES } from './fixtures'
import { prepareLiveDashboard } from './live-forecast'
import { SUN_PHASE_PLACES, localInstant, sunPhaseRaw } from './sun-phase-fixtures'

// Two small dashboard fixes (ROADMAP item 31):
// - at 320 px the header cut the place name to "San Luis O..." (even "Los Angeles" lost
//   its end on a signed-in account); the full name now reads, on two lines if it must,
//   without crowding the other controls or scrolling sideways;
// - while the sun is up but UV is under 0.5 (5:20pm in Los Angeles in late October), the
//   burn and vitamin D cards said "None" in the 23 px type of a number; they now say
//   "No burn risk" and "UV too low" in a smaller type, at the same height as a number.

// Optional copies at 320, 390 and 1280 px for review (POLISH_SHOTS=<folder>).
const SHOTS = process.env.POLISH_SHOTS
if (SHOTS) mkdirSync(SHOTS, { recursive: true })

const LA = SUN_PHASE_PLACES.find(place => place.param === 'los-angeles')!

const mobile = (t: TestInfo) => t.project.name.startsWith('mobile')
const widths = (t: TestInfo) => (mobile(t) ? [320, 390] : [1280])
const scheme = (t: TestInfo) => t.project.name.split('-')[1]

/** Runs `check` at each width, then proves nothing scrolls sideways and saves a copy. */
async function atEachWidth(
  page: Page,
  t: TestInfo,
  name: string,
  shot: Locator,
  check: (width: number) => Promise<void>,
) {
  for (const width of widths(t)) {
    await page.setViewportSize({ width, height: mobile(t) ? 844 : 900 })
    if (SHOTS) {
      await shot.scrollIntoViewIfNeeded()
      await shot.screenshot({
        path: `${SHOTS}/${name}-${width}-${scheme(t)}.png`,
        animations: 'disabled',
        caret: 'hide',
      })
    }
    await check(width)
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow, `${name} at ${width} px scrolls sideways`).toBeLessThanOrEqual(0)
  }
}

type Box = { x: number; y: number; width: number; height: number }
const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

for (const tier of ['guest', 'paid'] as const) {
  for (const place of ['san-luis-obispo', 'los-angeles', 'ojai'] as const) {
    const city = HARNESS_PLACES[place]!.city
    test(`header: "${city}" reads in full beside the controls (${tier})`, async ({ page }, t) => {
      const capture = await preparePage(page, t)
      await page.goto(`/harness/?screen=dashboard&tier=${tier}&place=${place}`)
      await expect(page.getByTestId(HARNESS_MARKER)).toBeVisible()
      const header = page.locator('header').first()
      const name = header.getByTestId('header-place-name')
      await expect(name).toHaveText(city)
      await atEachWidth(page, t, `header-${place}-${tier}`, header, async width => {
        // Nothing of the name is cut off: no ellipsis, no clipped line.
        const clipped = await name.evaluate(
          el => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1,
        )
        expect(clipped, `"${city}" is cut off at ${width} px`).toBe(false)
        // Each control keeps its own room: no two overlap, and all sit inside the screen.
        const controls = [
          header.getByRole('button', { name: 'Solara' }),
          header.getByRole('button', { name: city }),
          ...(await header.locator('[data-header-controls] > *:visible').all()),
        ]
        const boxes: Box[] = []
        for (const control of controls) {
          const box = (await control.boundingBox())!
          expect(box.x).toBeGreaterThanOrEqual(0)
          expect(box.x + box.width).toBeLessThanOrEqual(width)
          for (const other of boxes) expect(overlaps(box, other)).toBe(false)
          boxes.push(box)
        }
        // The header grows by one line at most: a two-line name, never three.
        const height = (await header.boundingBox())!.height
        expect(height, `header height at ${width} px`).toBeLessThanOrEqual(60)
      })
      if (mobile(t)) await page.setViewportSize({ width: 320, height: 844 })
      await captureScreen(page, t, capture, {
        name: `header-${place}-${tier}-320`,
        fullPage: false,
      })
    })
  }
}

/** The live dashboard in Los Angeles at `hhmm`, with the live reading set to `uv`. */
async function evening(page: Page, t: TestInfo, hhmm: string, uv?: number) {
  const at = localInstant(LA, hhmm)
  return prepareLiveDashboard(page, t, {
    at,
    tier: 'guest',
    edit: () => {
      const raw = sunPhaseRaw(LA, at)
      return uv === undefined ? raw : { ...raw, current: { ...raw.current, uv_index: uv } }
    },
    query: '&place=los-angeles',
  })
}

/** The two cards' value and detail lines, and their boxes. */
async function metrics(page: Page) {
  const read = async (id: string) => {
    const card = page.getByTestId(id)
    const value = card.getByTestId('metric-value')
    return {
      card,
      value,
      detail: card.getByTestId('metric-detail'),
      box: (await card.boundingBox())!,
      valueBox: (await value.boundingBox())!,
      fontSize: await value.evaluate(el => parseFloat(getComputedStyle(el).fontSize)),
    }
  }
  return { burn: await read('burn-metric'), vitD: await read('vitd-metric') }
}

test('after 5pm with the sun still up, the cards say why there is no estimate', async ({
  page,
}, t) => {
  const capture = await evening(page, t, '17:20')
  await expect(page.getByTestId('uv-readout')).toContainText('Low now')
  const row = page.getByTestId('exposure-metrics')
  await atEachWidth(page, t, 'metrics-low-uv', row, async width => {
    const { burn, vitD } = await metrics(page)
    await expect(burn.value).toHaveText('No burn risk')
    await expect(burn.detail).toHaveText(/^Until \d+(:\d\d)?am tomorrow$/)
    await expect(vitD.value).toHaveText('UV too low')
    await expect(vitD.detail).toHaveText(/^Until \d+(:\d\d)?am tomorrow$/)
    // Sized like the dashboard's other words, not like a number, on one line each.
    for (const m of [burn, vitD]) {
      expect(m.fontSize, `empty value size at ${width} px`).toBeLessThanOrEqual(16)
      expect(await m.value.evaluate(el => el.getClientRects().length)).toBe(1)
      expect(await m.value.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    }
    // Side by side at every width, at the same height and with their lines aligned.
    expect(Math.abs(burn.box.y - vitD.box.y)).toBeLessThanOrEqual(1)
    expect(Math.abs(burn.box.height - vitD.box.height)).toBeLessThanOrEqual(1)
    expect(Math.abs(burn.valueBox.y - vitD.valueBox.y)).toBeLessThanOrEqual(1)
  })
  // A screen reader hears words, not a bare "None".
  await expect(page.getByTestId('burn-metric')).toContainText('No burn risk')
  if (mobile(t)) await page.setViewportSize({ width: 320, height: 844 })
  await page.getByTestId('exposure-metrics').scrollIntoViewIfNeeded()
  await captureScreen(page, t, capture, { name: 'metrics-low-uv-320', fullPage: false })
})

test('a burn time beside "UV too low" keeps both cards the same height', async ({ page }, t) => {
  const capture = await evening(page, t, '17:20', 0.7)
  const row = page.getByTestId('exposure-metrics')
  // A number card, measured once with both cards empty, sets the height to match.
  await atEachWidth(page, t, 'metrics-mixed', row, async width => {
    const { burn, vitD } = await metrics(page)
    await expect(burn.value).toHaveText(/^\d+m$/)
    // Spoken as minutes, not "m".
    expect(await burn.card.innerText()).not.toContain('None')
    await expect(burn.card.getByTestId('metric-value-spoken')).toHaveText(/^\d+ minutes$/)
    await expect(vitD.value).toHaveText('UV too low')
    expect(burn.fontSize).toBeGreaterThan(20)
    expect(
      Math.abs(burn.box.height - vitD.box.height),
      `heights at ${width} px`,
    ).toBeLessThanOrEqual(1)
    // The words sit on the number's line, so the detail lines start level too.
    const details = await Promise.all([burn.detail.boundingBox(), vitD.detail.boundingBox()])
    expect(Math.abs(details[0]!.y - details[1]!.y)).toBeLessThanOrEqual(1)
  })
  if (mobile(t)) await page.setViewportSize({ width: 320, height: 844 })
  await page.getByTestId('exposure-metrics').scrollIntoViewIfNeeded()
  await captureScreen(page, t, capture, { name: 'metrics-mixed-320', fullPage: false })
})

// Found on the same pass at 320 px: the third day chip ("More days") dropped to a row of
// its own beside an empty refresh row, and "Best day this week" split "6pm–" / "6:45pm".
test('the day chips share one row, and a best-day time never splits', async ({ page }, t) => {
  const capture = await preparePage(page, t)
  await page.goto('/harness/?screen=dashboard&tier=paid')
  await expect(page.getByTestId(HARNESS_MARKER)).toBeVisible()
  const picker = page.getByTestId('day-picker')
  const rows = page.getByTestId('plan-ahead-when')
  await expect(rows.first()).toBeVisible()
  await atEachWidth(page, t, 'day-picker', picker, async width => {
    // One row: every button's middle on the same line (the refresh button is shorter).
    const middles = await picker.getByRole('button').evaluateAll(buttons =>
      buttons.map(b => {
        const r = b.getBoundingClientRect()
        return r.top + r.height / 2
      }),
    )
    expect(middles.length).toBe(4)
    expect(
      Math.max(...middles) - Math.min(...middles),
      `day picker rows at ${width} px`,
    ).toBeLessThanOrEqual(2)
    for (const row of await rows.all()) {
      // Each part on one line (an element with several text nodes reports a rect per
      // node, so count lines by height).
      for (const part of await row.locator('span').all()) {
        // One line is at most about 1.6 em tall, two at least 2.4 em.
        const ems = await part.evaluate(
          el => el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).fontSize),
        )
        expect(ems, await part.innerText()).toBeLessThan(2)
      }
    }
    if (SHOTS) {
      const plan = page.getByTestId('plan-ahead')
      await plan.scrollIntoViewIfNeeded()
      await plan.screenshot({ path: `${SHOTS}/plan-ahead-${width}-${scheme(t)}.png` })
    }
  })
  if (mobile(t)) await page.setViewportSize({ width: 320, height: 844 })
  await captureScreen(page, t, capture, { name: 'day-picker-320', fullPage: false })
})
