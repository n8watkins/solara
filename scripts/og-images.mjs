#!/usr/bin/env node
// Draws the social cards (Open Graph and Twitter images), public/og-image.png in English
// and public/og-image-es.png in Spanish (lib/page-language.ts picks one per page), with
// the site's own words and sun mark (components/SolaraMark.tsx) in Inter, the app's font.
// Run by hand when the words or the look change; the build only reads the checked-in
// PNGs. The words are the landing page's title and heading in each language, which
// lib/og-image.test.ts checks.
//
// Usage: node scripts/og-images.mjs
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

/** Each card: its file and its three lines. */
export const CARDS = [
  {
    file: 'public/og-image.png',
    lang: 'en',
    tagline: 'Plan around UV',
    line: 'Know when to go outside',
  },
  {
    file: 'public/og-image-es.png',
    lang: 'es',
    tagline: 'Planifica según el UV',
    line: 'Sabe cuándo salir',
  },
]

const WIDTH = 1200
const HEIGHT = 630
const BRAND = '#f97316'

/** SolaraMark's geometry (a 24-unit square) drawn at `size` px. */
function sunMark(size) {
  const rays = Array.from({ length: 8 }, (_, i) => (i * Math.PI) / 4)
    .map(angle => {
      const at = r => (12 + Math.cos(angle) * r).toFixed(3)
      const on = r => (12 + Math.sin(angle) * r).toFixed(3)
      return `<line x1="${at(7.6)}" y1="${on(7.6)}" x2="${at(10.4)}" y2="${on(10.4)}" stroke="${BRAND}" stroke-width="2" stroke-linecap="round"/>`
    })
    .join('')
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="5" fill="${BRAND}"/>${rays}</svg>`
}

function cardHtml({ lang, tagline, line }, font) {
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><style>
@font-face { font-family: Inter; src: url(data:font/woff2;base64,${font}) format('woff2'); font-weight: 100 900; }
html, body { margin: 0; width: ${WIDTH}px; height: ${HEIGHT}px; }
body { background: #fffbf5; font-family: Inter, sans-serif; display: flex; align-items: center; gap: 64px; padding: 0 96px; box-sizing: border-box; }
.text { display: flex; flex-direction: column; gap: 14px; }
.name { font-size: 104px; font-weight: 800; letter-spacing: -0.03em; color: #1a1208; line-height: 1; }
.tagline { font-size: 52px; font-weight: 750; letter-spacing: -0.015em; color: #c2410c; line-height: 1.1; }
.line { font-size: 34px; font-weight: 500; color: #6b5b3e; line-height: 1.2; }
</style></head><body>${sunMark(300)}<div class="text"><div class="name">Solara</div><div class="tagline">${tagline}</div><div class="line">${line}</div></div></body></html>`
}

async function main() {
  const { chromium } = await import('playwright')
  const font = readFileSync(
    'node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2',
  ).toString('base64')
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({
      viewport: { width: WIDTH, height: HEIGHT },
      deviceScaleFactor: 1,
    })
    for (const card of CARDS) {
      await page.setContent(cardHtml(card, font))
      await page.evaluate(() => document.fonts.ready)
      // Every line must fit inside the card with its margin.
      const overflow = await page.evaluate(
        width =>
          [...document.querySelectorAll('svg, .text > div')].some(
            el => el.getBoundingClientRect().right > width - 64,
          ),
        WIDTH,
      )
      if (overflow) throw new Error(`${card.file}: a line runs past the card's margin`)
      await page.screenshot({ path: card.file, omitBackground: false })
      console.log(`Wrote ${card.file}`)
    }
  } finally {
    await browser.close()
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main()
