import { mkdirSync } from 'node:fs'
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page, type TestInfo } from '@playwright/test'
import cities from '../../lib/cities/cities.json' with { type: 'json' }
import { preparePage } from './capture'

// The static pages in Spanish (ROADMAP item 46, decision "Language pages"): the landing
// page, the privacy policy, the terms, the city index and every city page, at 320 and
// 390 px (mobile projects) and 1280 px (desktop), light and dark. Each is checked for
// <html lang="es">, sideways scrolling, cut-off text and leftover English, and gets a clean
// axe run. Their English pages, which now link to them, get the same layout checks.
// I18N_SHOTS=<folder> saves a full-page copy of each.

const SHOTS = process.env.I18N_SHOTS
if (SHOTS) mkdirSync(SHOTS, { recursive: true })

const mobile = (t: TestInfo) => t.project.name.startsWith('mobile')
const widths = (t: TestInfo) => (mobile(t) ? [320, 390] : [1280])
const scheme = (t: TestInfo) => t.project.name.split('-')[1]

/** English words only the pages' own text would show (names and sources aside). */
const ENGLISH =
  /\b(?:the|your|and|with|Today|Tomorrow|Settings|Sign in|Loading|minutes|window|Privacy|Terms|Month|Rarely|Typical|Step|Guest|month|year|Last updated)\b/

const PAGES: { name: string; path: string; heading: string | RegExp; lang: 'en' | 'es' }[] = [
  { name: 'landing', path: '/es/', heading: 'Sabe cuándo salir', lang: 'es' },
  { name: 'privacy', path: '/es/privacy/', heading: 'Política de privacidad', lang: 'es' },
  { name: 'terms', path: '/es/terms/', heading: 'Términos de uso', lang: 'es' },
  { name: 'city-index', path: '/es/uv/', heading: 'UV por ciudad', lang: 'es' },
  ...cities.map(city => ({
    name: `city-${city.slug}`,
    path: `/es/uv/${city.slug}/`,
    heading: /^Índice UV en /,
    lang: 'es' as const,
  })),
  { name: 'landing', path: '/', heading: 'Know when to go outside', lang: 'en' },
  { name: 'privacy', path: '/privacy/', heading: 'Privacy Policy', lang: 'en' },
  { name: 'terms', path: '/terms/', heading: 'Terms of Use', lang: 'en' },
  { name: 'city-index', path: '/uv/', heading: 'UV by city', lang: 'en' },
  {
    name: 'city-salt-lake-city',
    path: '/uv/salt-lake-city/',
    heading: /^UV index in /,
    lang: 'en',
  },
]

for (const screen of PAGES) {
  test(`${screen.name} in ${screen.lang === 'es' ? 'Spanish' : 'English'}`, async ({
    page,
  }, testInfo) => {
    await preparePage(page, testInfo)
    await page.goto(screen.path)
    await expect(page.locator('html')).toHaveAttribute('lang', screen.lang)
    await expect(page.getByRole('heading', { level: 1, name: screen.heading })).toBeVisible()
    await page.evaluate(async () => {
      await document.fonts.ready
    })
    await page.waitForLoadState('networkidle')
    const shot = page.locator('img[src^="/landing/"]')
    if (await shot.count()) await expect(shot).toHaveJSProperty('complete', true)

    for (const width of widths(testInfo)) {
      await page.setViewportSize({ width, height: mobile(testInfo) ? 844 : 900 })
      if (SHOTS) {
        await page.screenshot({
          path: `${SHOTS}/${screen.lang}-${screen.name}-${width}-${scheme(testInfo)}.png`,
          fullPage: true,
          animations: 'disabled',
          caret: 'hide',
        })
      }
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )
      expect(overflow, `${screen.name} at ${width} px scrolls sideways`).toBeLessThanOrEqual(0)
      // Nothing clips its own text, and no line runs past the page's edge.
      const clipped = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('body *')]
          .filter(el => {
            if (el.closest('.sr-only, [aria-hidden="true"], [hidden]')) return false
            if (!el.textContent?.trim() || el.children.length > 0) return false
            if (el.clientWidth <= 1 || el.clientHeight <= 1) return false
            const box = el.getBoundingClientRect()
            if (box.right > document.documentElement.clientWidth + 0.5) return true
            const style = getComputedStyle(el)
            if (style.overflow === 'visible' && style.textOverflow !== 'ellipsis') return false
            return el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1
          })
          .map(el => el.textContent!.trim().slice(0, 60)),
      )
      expect(clipped, `${screen.name} at ${width} px cuts text off`).toEqual([])
      // The chart's peak values never run into each other.
      const touching = await page.evaluate(() => {
        const labels = [
          ...document.querySelectorAll<HTMLElement>(
            '[data-testid="city-chart"] > div > span:first-child',
          ),
        ].map(el => {
          const range = document.createRange()
          range.selectNodeContents(el)
          const box = range.getBoundingClientRect()
          return { text: el.textContent, left: box.left, right: box.right }
        })
        return labels
          .slice(1)
          .filter((label, i) => label.left < labels[i]!.right + 1)
          .map((label, i) => `${labels[i]!.text}|${label.text}`)
      })
      expect(touching, `${screen.name} at ${width} px: chart values touch`).toEqual([])
    }

    if (screen.lang === 'es') await noEnglish(page)

    const axe = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze()
    expect(
      axe.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(' | ')}`),
    ).toEqual([])
  })
}

/** No English is left, outside what is marked English (the link to the English page). */
async function noEnglish(page: Page) {
  const leftovers = await page.evaluate(source => {
    const english = new RegExp(source)
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    const found: string[] = []
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement
      if (!parent || parent.closest('[aria-hidden="true"], [hidden], script, style')) continue
      if (parent.closest('[lang]')?.getAttribute('lang') === 'en') continue
      if (getComputedStyle(parent).display === 'none') continue
      const text = node.textContent?.trim() ?? ''
      if (text && english.test(text)) found.push(text.slice(0, 80))
    }
    return found
  }, ENGLISH.source)
  expect(leftovers, `${page.url()} shows English`).toEqual([])
  // The page's title and description are Spanish too.
  expect(await page.title()).not.toMatch(ENGLISH)
  const description = await page.locator('meta[name="description"]').getAttribute('content')
  expect(description ?? '').not.toMatch(ENGLISH)
}
