import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { startClock } from './clock'
import { HARNESS_MARKER } from './fixtures'

// Layout assertions for the Calendar week view (REPORT UX-3), run at every harness
// width and theme. Geometry is read from the rendered page, so this catches lanes
// spilling into the next day, clipped chip labels and day headers, and an axis
// that starts after the first window.

const SHOT_DIR = join('test-results', 'ui-harness', 'screenshots')

async function openCalendar(page: Page, colorScheme: 'light' | 'dark') {
  await startClock(page)
  await page.addInitScript(theme => {
    try {
      window.localStorage.setItem('solara_theme', theme)
    } catch {}
  }, colorScheme)
  await page.goto('/harness/?screen=calendar')
  await expect(page.getByTestId(HARNESS_MARKER)).toHaveAttribute('data-screen', 'calendar')
  await expect(page.getByTestId('calendar-chip').first()).toBeVisible()
  await page.evaluate(async () => {
    await document.fonts.ready
  })
}

test.beforeEach(async ({ page }, testInfo) => {
  await openCalendar(page, testInfo.project.use.colorScheme === 'dark' ? 'dark' : 'light')
})

test('every chip stays inside its day column', async ({ page }) => {
  const report = await page.evaluate(() => {
    const out: string[] = []
    let chips = 0
    for (const col of document.querySelectorAll<HTMLElement>(
      '[data-testid="calendar-day-column"]',
    )) {
      const c = col.getBoundingClientRect()
      for (const chip of col.querySelectorAll<HTMLElement>('[data-testid="calendar-chip"]')) {
        chips++
        const r = chip.getBoundingClientRect()
        if (r.left < c.left - 0.5 || r.right > c.right + 0.5 || r.width < 20) {
          out.push(
            `${col.dataset.date} ${chip.getAttribute('aria-label')}: chip ${r.left}-${r.right}, column ${c.left}-${c.right}`,
          )
        }
      }
    }
    return { chips, out }
  })
  expect(report.chips).toBeGreaterThan(10)
  expect(report.out).toEqual([])
})

test('chip labels and day headers are not clipped', async ({ page }) => {
  const clipped = await page.evaluate(() => {
    const out: string[] = []
    const selector = [
      '[data-testid="calendar-chip"] span:not([data-sr-only])',
      '[data-testid="calendar-day-header"] span',
    ].join(',')
    for (const el of document.querySelectorAll<HTMLElement>(selector)) {
      if (el.scrollWidth > el.clientWidth + 0.5) out.push(el.textContent ?? '')
      const box = el.getBoundingClientRect()
      const parent = el.closest('button, [data-testid="calendar-day-header"]')
      const p = parent?.getBoundingClientRect()
      if (p && (box.left < p.left - 0.5 || box.right > p.right + 0.5)) {
        out.push(`${el.textContent ?? ''} overflows its container`)
      }
    }
    return out
  })
  expect(clipped).toEqual([])
})

test('day headers line up with their columns', async ({ page }) => {
  const headers = page.getByTestId('calendar-day-header')
  const columns = page.getByTestId('calendar-day-column')
  const count = await columns.count()
  expect(await headers.count()).toBe(count)
  for (let i = 0; i < count; i++) {
    const h = await headers.nth(i).boundingBox()
    const c = await columns.nth(i).boundingBox()
    expect(h && c && Math.abs(h.x - c.x) < 1 && Math.abs(h.width - c.width) < 1).toBe(true)
  }
})

test('the axis opens at the earliest window, uncut', async ({ page }) => {
  const result = await page.evaluate(() => {
    const scroller = document.querySelector<HTMLElement>('[data-testid="calendar-grid"]')
    const columns = [
      ...document.querySelectorAll<HTMLElement>('[data-testid="calendar-day-column"]'),
    ]
    const colTop = Math.min(...columns.map(c => c.getBoundingClientRect().top))
    const chipTops = [
      ...document.querySelectorAll<HTMLElement>('[data-testid="calendar-chip"]'),
    ].map(c => c.getBoundingClientRect().top)
    const headerBottom = Math.max(
      ...[...document.querySelectorAll('[data-testid="calendar-day-header"]')].map(
        h => h.getBoundingClientRect().bottom,
      ),
    )
    return {
      scrollTop: scroller?.scrollTop ?? -1,
      earliestChipBelowColumnTop: Math.min(...chipTops) >= colTop,
      earliestChipBelowHeader: Math.min(...chipTops) >= headerBottom,
    }
  })
  expect(result).toEqual({
    scrollTop: 0,
    earliestChipBelowColumnTop: true,
    earliestChipBelowHeader: true,
  })
  // The fixtures' first windows open at 6am, so that is the first hour on the axis.
  await expect(page.getByTestId('calendar-grid').getByText('6am', { exact: true })).toBeVisible()
})

test('a chip opens a detail sheet with a safe calendar link', async ({ page }, testInfo) => {
  const chip = page.getByTestId('calendar-chip').first()
  await chip.click()
  await expect(chip).toHaveAccessibleName(/^Running, Today, 6pm – 8pm, peak UV \d/)
  const sheet = page.getByRole('dialog', { name: /Running/ })
  await expect(sheet).toBeVisible()
  await expect(sheet).toBeFocused()
  const link = sheet.getByRole('link', { name: /Add to Google Calendar/ })
  await expect(link).toHaveAttribute('target', '_blank')
  await expect(link).toHaveAttribute('rel', /noopener/)
  await expect(link).toHaveAttribute('href', /^https:\/\/calendar\.google\.com\//)

  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 500))
  mkdirSync(SHOT_DIR, { recursive: true })
  await page.screenshot({
    path: join(SHOT_DIR, `calendar-sheet--${testInfo.project.name}.png`),
    animations: 'disabled',
    caret: 'hide',
  })

  await page.clock.resume()
  await page.keyboard.press('Escape')
  await expect(sheet).toBeHidden()
  await expect(chip).toBeFocused()
})

test('the day pager pages through the forecast without cutting a day', async ({ page }) => {
  const grid = page.getByTestId('calendar-grid')
  const later = page.getByRole('button', { name: 'Later days' })
  const earlier = page.getByRole('button', { name: 'Earlier days' })
  await expect(earlier).toBeDisabled()
  await later.click()
  await expect(earlier).toBeEnabled()
  await expect.poll(() => grid.evaluate(el => el.scrollLeft)).toBeGreaterThan(0)

  // Whatever is in view, no day header is only partly visible.
  await expect
    .poll(() =>
      grid.evaluate(el => {
        const box = el.getBoundingClientRect()
        const corner = el.querySelector('[data-testid="calendar-corner"]')
        // Days scroll under the sticky hour gutter; its right edge is the visible start.
        const start = corner?.getBoundingClientRect().right ?? box.left
        const end = box.left + el.clientLeft + el.clientWidth
        return [...el.querySelectorAll('[data-testid="calendar-day-header"]')]
          .map(h => h.getBoundingClientRect())
          .filter(r => r.right > start + 1 && r.left < end - 1)
          .filter(r => r.left < start - 1 || r.right > end + 1).length
      }),
    )
    .toBe(0)
})
