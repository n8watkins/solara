import { mkdirSync } from 'node:fs'
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { preparePage } from './capture'
import { HARNESS_MARKER } from './fixtures'

// The main screens in Spanish (ROADMAP item 46): the dashboard (guest and Pro), the
// calendar, every Settings tab, the plans dialog and the account page, at 320 and 390 px
// (mobile projects) and 1280 px (desktop), light and dark. Spanish runs 20-30% longer than
// English, so each screen is checked for sideways scrolling and cut-off text, gets a clean
// axe run, and shows no leftover English. I18N_SHOTS=<folder> saves a copy of each.

const SHOTS = process.env.I18N_SHOTS
if (SHOTS) mkdirSync(SHOTS, { recursive: true })

const mobile = (t: TestInfo) => t.project.name.startsWith('mobile')
const widths = (t: TestInfo) => (mobile(t) ? [320, 390] : [1280])
const scheme = (t: TestInfo) => t.project.name.split('-')[1]

/** English words that only the app's own text would show (fixtures name places and activities). */
const ENGLISH =
  /\b(?:the|your|and|with|Today|Tomorrow|Settings|Sign in|Loading|minutes|window|Share|Edit|Remove|Cancel|Save)\b/

const SCREENS = [
  { name: 'dashboard-guest', path: '/harness/?screen=dashboard&tier=guest', full: true },
  { name: 'dashboard-pro', path: '/harness/?screen=dashboard', full: true },
  { name: 'calendar', path: '/harness/?screen=calendar', full: true },
  ...(['general', 'alerts', 'appearance', 'activities', 'location', 'account'] as const).map(
    tab => ({ name: `settings-${tab}`, path: `/harness/?screen=settings&tab=${tab}`, full: false }),
  ),
  { name: 'pricing', path: '/harness/?screen=pricing&tier=free', full: false },
  { name: 'account', path: '/harness/account/?state=pro', full: true },
] as const

async function inSpanish(page: Page, t: TestInfo) {
  await preparePage(page, t)
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem('solara_language', 'es')
    } catch {}
  })
}

for (const screen of SCREENS) {
  test(`${screen.name} in Spanish`, async ({ page }, testInfo) => {
    await inSpanish(page, testInfo)
    await page.goto(screen.path)
    await expect(page.locator('html')).toHaveAttribute('lang', 'es')
    if (screen.path.startsWith('/harness/?')) {
      await expect(page.getByTestId(HARNESS_MARKER)).toBeVisible()
    } else {
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    }
    await page.evaluate(async () => {
      await document.fonts.ready
    })
    await page.waitForLoadState('networkidle')
    // Today's dashboard keeps the sunscreen timer's place until it loads, after the page;
    // wait for it, as a person would see it a moment after opening.
    if (screen.name.startsWith('dashboard')) {
      await expect(
        page.getByRole('region', { name: /Temporizador de protector solar/ }),
      ).toBeVisible()
    }

    for (const width of widths(testInfo)) {
      await page.setViewportSize({ width, height: mobile(testInfo) ? 844 : 900 })
      if (SHOTS) {
        await page.screenshot({
          path: `${SHOTS}/${screen.name}-${width}-${scheme(testInfo)}.png`,
          fullPage: screen.full,
          animations: 'disabled',
          caret: 'hide',
        })
      }
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )
      expect(overflow, `${screen.name} at ${width} px scrolls sideways`).toBeLessThanOrEqual(0)
      // No text is cut off: an element that clips its own text (overflow hidden, an
      // ellipsis or a clamp) holds no more than it shows. Long names may truncate by design,
      // so only elements without a title (the full text on hover) are checked.
      const clipped = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('body *')]
          .filter(el => {
            if (el.closest('.sr-only, [aria-hidden="true"], [hidden]')) return false
            if (!el.textContent?.trim() || el.children.length > 0) return false
            // Visually hidden on purpose (screen-reader text, the wordmark under 360 px).
            if (el.clientWidth <= 1 || el.clientHeight <= 1) return false
            const style = getComputedStyle(el)
            if (style.overflow === 'visible' && style.textOverflow !== 'ellipsis') return false
            if (el.closest('[title]') || el.classList.contains('truncate')) return false
            return el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1
          })
          .map(el => el.textContent!.trim().slice(0, 60)),
      )
      expect(clipped, `${screen.name} at ${width} px cuts text off`).toEqual([])
      // Nothing pokes out of its card (the calendar's view switch once did at 320 px).
      const outside = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('.card button, .card [role="group"]')]
          .filter(el => {
            const cardEl = el.closest('.card')!
            // Inside a scrolling area (the calendar's days, the hourly strip) by design.
            for (let p = el.parentElement; p && p !== cardEl; p = p.parentElement) {
              if (/auto|scroll|hidden/.test(getComputedStyle(p).overflowX)) return false
            }
            const card = cardEl.getBoundingClientRect()
            const box = el.getBoundingClientRect()
            return box.width > 0 && (box.right > card.right + 0.5 || box.left < card.left - 0.5)
          })
          .map(el => (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 40)),
      )
      expect(outside, `${screen.name} at ${width} px runs past a card`).toEqual([])
    }

    const leftovers = await page.evaluate(source => {
      const english = new RegExp(source)
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
      const found: string[] = []
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const parent = node.parentElement
        if (!parent || parent.closest('[aria-hidden="true"], [hidden], script, style')) continue
        if (getComputedStyle(parent).display === 'none') continue
        const text = node.textContent?.trim() ?? ''
        if (text && english.test(text)) found.push(text.slice(0, 80))
      }
      return found
    }, ENGLISH.source)
    expect(leftovers, `${screen.name} shows English`).toEqual([])

    const axe = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze()
    expect(
      axe.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(' | ')}`),
    ).toEqual([])
  })
}
