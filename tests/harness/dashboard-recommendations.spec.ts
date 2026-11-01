import { expect, test, type Locator, type Page } from '@playwright/test'
import { HARNESS_DATE, startClock } from './clock'
import { HARNESS_MARKER } from './fixtures'

// Acceptance check for the dashboard's recommendations at the frozen 10:30: one
// consistent slot per activity across the hero, the activity cards and "Best day
// this week", nothing in the past, and nothing after the last hour the UV strip shows.
const NOW_HOUR = 10.5
const LAST_STRIP_HOUR = 20

async function numberAttr(locator: Locator, name: string): Promise<number> {
  const value = await locator.getAttribute(name)
  expect(value, `${name} attribute`).not.toBeNull()
  return Number(value)
}

async function openDashboard(page: Page) {
  // Block everything off-origin so the check never depends on the network.
  await page.route('**/*', route =>
    new URL(route.request().url()).hostname === '127.0.0.1'
      ? route.continue()
      : route.abort('blockedbyclient'),
  )
  await startClock(page)
  await page.goto('/harness/?screen=dashboard')
  await expect(page.getByTestId(HARNESS_MARKER)).toBeVisible()
  await expect(page.getByTestId('activity-card').first()).toBeVisible()
}

test('dashboard shows one consistent, future recommendation per activity', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-light', 'logic check, run once')
  await openDashboard(page)

  const cards = page.getByTestId('activity-card')
  const cardCount = await cards.count()
  expect(cardCount).toBeGreaterThan(0)

  const recommended = new Map<string, { start: number; end: number }>()
  for (let i = 0; i < cardCount; i++) {
    const card = cards.nth(i)
    const id = (await card.getAttribute('data-activity'))!

    // Every listed window is still ahead and inside the strip's day.
    const windows = card.getByTestId('activity-window')
    for (let w = 0; w < (await windows.count()); w++) {
      const from = await numberAttr(windows.nth(w), 'data-from')
      const to = await numberAttr(windows.nth(w), 'data-to')
      expect(from, `${id} window start`).toBeGreaterThanOrEqual(NOW_HOUR)
      expect(to, `${id} window end`).toBeLessThanOrEqual(LAST_STRIP_HOUR)
    }

    const slot = card.getByTestId('recommended-slot')
    if ((await slot.count()) === 0) continue
    const start = await numberAttr(slot, 'data-start')
    const end = await numberAttr(slot, 'data-end')
    expect(start, `${id} recommended start`).toBeGreaterThanOrEqual(NOW_HOUR)
    expect(end, `${id} recommended end`).toBeLessThanOrEqual(LAST_STRIP_HOUR)
    recommended.set(id, { start, end })
  }
  expect(recommended.size).toBeGreaterThan(0)

  // The hero is the soonest of the cards' own recommendations.
  const hero = page.getByTestId('hero-slot')
  const heroId = (await hero.getAttribute('data-activity'))!
  const heroSlot = {
    start: await numberAttr(hero, 'data-start'),
    end: await numberAttr(hero, 'data-end'),
  }
  expect(heroSlot).toEqual(recommended.get(heroId))
  const soonest = Math.min(...[...recommended.values()].map(s => s.start))
  expect(heroSlot.start).toBe(soonest)

  // "Best day this week" rows for today repeat the cards' slots exactly.
  const rows = page.getByTestId('plan-ahead-row')
  for (let i = 0; i < (await rows.count()); i++) {
    const row = rows.nth(i)
    const id = (await row.getAttribute('data-activity'))!
    const start = await numberAttr(row, 'data-start')
    const end = await numberAttr(row, 'data-end')
    if ((await row.getAttribute('data-date')) === HARNESS_DATE) {
      expect({ start, end }, `${id} plan-ahead slot`).toEqual(recommended.get(id))
    }
  }
})

test('header and UV card report the same "now" UV and burn time', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-light', 'logic check, run once')
  await openDashboard(page)

  const headerText = await page
    .locator('header')
    .getByText(/UV \d+\.\d/)
    .first()
    .textContent()
  const nowUV = /UV (\d+\.\d)/.exec(headerText ?? '')?.[1]
  expect(nowUV, 'header UV').toBeTruthy()

  const readout = page.getByTestId('uv-readout')
  await expect(readout).toContainText(`${nowUV}`)
  await expect(readout).toContainText('now')
  // One duration style on both (formatDuration): "45 min", "2 h 47 min".
  const burn = /burn ~(\d+(?: h)?(?: \d+ min| min)?)/.exec((await readout.textContent()) ?? '')?.[1]
  expect(burn, 'readout burn time').toBeTruthy()
  await expect(page.getByTestId('burn-metric')).toContainText(burn!)
})
