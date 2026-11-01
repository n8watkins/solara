import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CARDS } from '../scripts/og-images.mjs'
import { OG_IMAGES, pageText } from './page-language'

// The social cards (REVIEW10 VERIFY10 N3): one per language, with the landing page's own
// words, at the size the metadata states.

/** A PNG's width and height, from its IHDR chunk. */
function pngSize(file: string): { width: number; height: number } {
  const png = readFileSync(file)
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) }
}

describe('the social cards', () => {
  it('exist for every language at the size the metadata states', () => {
    for (const [locale, image] of Object.entries(OG_IMAGES)) {
      const card = CARDS.find(c => c.lang === locale)
      expect(card?.file).toBe(`public${image.url}`)
      expect(pngSize(`public${image.url}`)).toEqual({ width: image.width, height: image.height })
    }
  })

  it("say the landing page's title and heading in their language", () => {
    for (const card of CARDS) {
      const landing = pageText(card.lang as 'en' | 'es').landing
      const tagline = landing.title.replace(/^Solara: /, '')
      expect(card.tagline.toLowerCase()).toBe(tagline.toLowerCase())
      expect(card.line).toBe(landing.heading)
    }
  })
})
