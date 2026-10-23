import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { pauseClock, startClock } from './clock'
import { HARNESS_MARKER } from './fixtures'
import { UV_GAP } from './uv-gap-fixtures'

// Acceptance for CQ-1 in the app: a forecast whose UV is `null` for part of
// today must never yield a recommendation that covers those hours. The fixture
// keeps UV low all day, so the only thing standing between the user and an
// all-day window straight through the gap is how unknown hours are handled.
const SHOT_DIR = join('test-results', 'ui-harness', 'screenshots')

/** "10am", "1:30pm" to a fractional hour. */
function parseClock(text: string): number {
  const match = /^(\d{1,2})(?::(\d{2}))?(am|pm)$/.exec(text)
  if (!match) throw new Error(`Unrecognized time: ${text}`)
  const hour12 = Number(match[1]) % 12
  return hour12 + (match[3] === 'pm' ? 12 : 0) + Number(match[2] ?? 0) / 60
}

/** Every "<time>–<time>" range shown on the page, as [from, to) hours. */
async function shownRanges(page: Page): Promise<{ text: string; from: number; to: number }[]> {
  const text = await page.locator('main').innerText()
  return [...text.matchAll(/(\d{1,2}(?::\d{2})?[ap]m)\s*[–-]\s*(\d{1,2}(?::\d{2})?[ap]m)/g)].map(
    ([whole, from, to]) => ({ text: whole, from: parseClock(from!), to: parseClock(to!) }),
  )
}

for (const view of ['dashboard', 'calendar'] as const) {
  test(`uv gaps: ${view} never recommends unknown hours`, async ({ page }, testInfo) => {
    const pageErrors: string[] = []
    page.on('pageerror', err => pageErrors.push(err.message))
    await page.route('**/*', route =>
      new URL(route.request().url()).hostname === '127.0.0.1'
        ? route.continue()
        : route.abort('blockedbyclient'),
    )
    await startClock(page)
    const theme = testInfo.project.use.colorScheme === 'dark' ? 'dark' : 'light'
    await page.addInitScript(value => {
      try {
        window.localStorage.setItem('solara_theme', value)
      } catch {}
    }, theme)

    await page.goto(`/harness/?screen=${view}&fixture=uv-gaps`)
    await expect(page.getByTestId(HARNESS_MARKER)).toHaveAttribute('data-screen', view)
    await expect(page.locator('main')).toContainText(/\d(am|pm)/)
    await pauseClock(page)

    const ranges = await shownRanges(page)
    // The fixture leaves a usable morning and evening, so recommendations exist.
    expect(ranges.length).toBeGreaterThan(0)
    const overlapping = ranges.filter(r => r.from < UV_GAP.to && r.to > UV_GAP.from)
    // Preferred-hours chips (Tennis 4pm–8pm) are settings, not recommendations,
    // and sit outside the gap; anything overlapping the gap is a bug.
    expect(overlapping, 'time ranges shown across the unknown UV hours').toEqual([])

    mkdirSync(SHOT_DIR, { recursive: true })
    await page.screenshot({
      path: join(SHOT_DIR, `uv-gaps-${view}--${testInfo.project.name}.png`),
      fullPage: true,
      animations: 'disabled',
      caret: 'hide',
    })
    expect(pageErrors, 'uncaught page errors').toEqual([])
  })
}
