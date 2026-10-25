import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { startClock } from './clock'
import { HARNESS_MARKER } from './fixtures'

// The sun path's "Peak 10.3 · 1pm" callout must be fully readable wherever the
// peak marker is on screen: at phone and desktop widths, in both themes, for a
// peak in the middle of the day and at either end of it, and wherever the phone's
// strip is scrolled. It also must not sit on the peak, "now" or focus markers.
// Before the fix the callout was placed against the full (scrollable) arc, so on a
// 390 px phone the strip's edge cut it to "Peak 10.3 ·".
const SHOT_DIR = join('test-results', 'ui-harness', 'screenshots')
const FIXTURES = ['default', 'peak-early', 'peak-late'] as const
const SCROLLS = ['initial', 'start', 'peak', 'end'] as const
const softly = expect.configure({ soft: true, timeout: 3000 })

interface Box {
  left: number
  right: number
  top: number
  bottom: number
}

/** Every reason the callout is not cleanly readable at the current scroll position. */
async function labelProblems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const box = (el: Element | null): Box | null => {
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }
    }
    const overlaps = (a: Box, b: Box) =>
      a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
    const inside = (a: Box, b: Box) =>
      a.left >= b.left && a.right <= b.right && a.top >= b.top && a.bottom <= b.bottom
    const fmt = (b: Box) => `[${b.left.toFixed(1)}, ${b.right.toFixed(1)}]`

    const strip = document.querySelector('[role="group"][aria-label="UV forecast by hour"]')
    const svg = document.querySelector('[data-testid="sun-arc-peak"]')?.closest('svg')
    const peak = box(document.querySelector('[data-testid="sun-arc-peak"]'))
    if (!strip || !svg || !peak) return ['the sun path or its peak marker is missing']
    const label = box(document.querySelector('[data-testid="sun-arc-peak-label"]'))
    const focus = box(document.querySelector('[data-testid="sun-arc-focus"]'))
    const now = box(document.querySelector('[data-testid="sun-arc-now"]'))

    // What the user can see of the arc: the strip's viewport, minus the edge fade
    // phones get (globals.css masks 16 px on each side), within the arc's own box.
    const s = strip.getBoundingClientRect()
    const a = svg.getBoundingClientRect()
    const fade = getComputedStyle(strip).maskImage.includes('gradient') ? 16 : 0
    const visible: Box = {
      left: Math.max(s.left + fade, a.left),
      right: Math.min(s.right - fade, a.right),
      top: a.top,
      bottom: a.bottom,
    }

    const problems: string[] = []
    // The callout yields to the focus ring when the focus sits on the peak.
    const focusOnPeak =
      focus !== null &&
      Math.abs((focus.left + focus.right) / 2 - (peak.left + peak.right) / 2) < 1 &&
      Math.abs((focus.top + focus.bottom) / 2 - (peak.top + peak.bottom) / 2) < 1
    if (!label) {
      if (inside(peak, visible) && !focusOnPeak)
        problems.push('the peak marker is visible but its callout is missing')
      return problems
    }
    // Only judge the callout while its marker is on screen; scrolled away, both go.
    if (!inside(peak, visible)) return problems
    if (!inside(label, visible))
      problems.push(`callout ${fmt(label)} leaves the visible arc ${fmt(visible)}`)
    if (overlaps(label, peak)) problems.push('callout overlaps the peak marker')
    if (now && overlaps(label, now)) problems.push('callout overlaps the "now" sun')
    if (focus && overlaps(label, focus)) problems.push('callout overlaps the focus marker')
    // The line climbs steeply near either end of the day; the text must not sit on it.
    const text = document.querySelector<SVGTextElement>('[data-testid="sun-arc-peak-label"]')!
    const line = svg.querySelector<SVGPathElement>('path[stroke^="url("]')
    if (line) {
      const b = text.getBBox()
      const point = svg.createSVGPoint()
      let crossed = false
      for (let x = b.x; x <= b.x + b.width && !crossed; x += 1)
        for (let y = b.y; y <= b.y + b.height && !crossed; y += 1) {
          point.x = x
          point.y = y
          crossed = line.isPointInStroke(point)
        }
      if (crossed) problems.push('callout overlaps the sun path line')
    }
    // Readable: the full text, not squeezed or hidden.
    const content = text.textContent ?? ''
    if (!/^Peak \d+\.\d · \d{1,2}(:\d{2})?(am|pm)?$/.test(content.trim()))
      problems.push(`unexpected callout text "${content}"`)
    return problems
  })
}

async function scrollStrip(page: Page, to: (typeof SCROLLS)[number]) {
  if (to === 'initial') return
  await page.evaluate(to => {
    const strip = document.querySelector<HTMLElement>(
      '[role="group"][aria-label="UV forecast by hour"]',
    )!
    const peak = document.querySelector('[data-testid="sun-arc-peak"]')!.getBoundingClientRect()
    const s = strip.getBoundingClientRect()
    strip.scrollLeft =
      to === 'start'
        ? 0
        : to === 'end'
          ? strip.scrollWidth
          : strip.scrollLeft + (peak.left + peak.right) / 2 - (s.left + s.right) / 2
  }, to)
}

for (const fixture of FIXTURES) {
  test(`sun arc: the peak callout stays readable (${fixture})`, async ({ page }, testInfo) => {
    const mobile = testInfo.project.name.startsWith('mobile')
    const widths = mobile ? [320, 390] : [1440]
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

    for (const width of widths) {
      await page.setViewportSize({ width, height: mobile ? 844 : 900 })
      await page.goto(`/harness/?screen=dashboard&fixture=${fixture}`)
      await expect(page.getByTestId(HARNESS_MARKER)).toHaveAttribute('data-screen', 'dashboard')
      await expect(page.getByTestId('sun-arc-peak')).toBeAttached()
      await page.evaluate(async () => {
        await document.fonts.ready
      })

      for (const scroll of SCROLLS) {
        if (scroll === 'initial') {
          // The UV card as the page first shows it, for before/after review (taken
          // before the check so a failing run still shows what went wrong).
          mkdirSync(SHOT_DIR, { recursive: true })
          await page
            .getByTestId('uv-readout')
            .locator('..')
            .screenshot({
              path: join(SHOT_DIR, `sun-arc-${fixture}-${width}--${testInfo.project.name}.png`),
              animations: 'disabled',
              caret: 'hide',
            })
        }
        await scrollStrip(page, scroll)
        // Scrolling moves the shared focus (one frame later), and the callout follows.
        // Soft, so one run reports every width and scroll position that fails.
        await softly
          .poll(() => labelProblems(page), { message: `${width}px, scrolled to ${scroll}` })
          .toEqual([])
      }
    }
    expect(pageErrors, 'uncaught page errors').toEqual([])
  })
}
