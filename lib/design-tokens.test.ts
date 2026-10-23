import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Guards the WCAG AA contract of the color tokens in app/globals.css (REPORT
// A11Y-1): every text token reaches 4.5:1 on every surface it is used on, in
// both themes.
const css = readFileSync(join(__dirname, '..', 'app', 'globals.css'), 'utf8')

function tokens(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`)
  expect(start, `${selector} block`).toBeGreaterThanOrEqual(0)
  const body = css.slice(start, css.indexOf('}', start))
  const out: Record<string, string> = {}
  for (const match of body.matchAll(/--([\w-]+):\s*([^;]+);/g)) {
    out[match[1]!] = match[2]!.trim()
  }
  return out
}

function luminance(hex: string): number {
  const match = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!match) throw new Error(`not a 6-digit hex color: ${hex}`)
  const channels = [0, 2, 4].map(i => parseInt(match[1]!.slice(i, i + 2), 16) / 255)
  const [r, g, b] = channels.map(c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}

const SURFACES = ['bg', 'bg-card', 'bg-metric', 'bg-subtle', 'accent-soft']
const TEXT = ['text', 'text-2', 'text-3', 'accent', 'success', 'warning', 'danger']

describe.each([
  ['light', ':root'],
  ['dark', '.dark'],
])('%s theme tokens', (_name, selector) => {
  const t = tokens(selector)

  it.each(TEXT.flatMap(fg => SURFACES.map(bg => [fg, bg] as const)))(
    '--%s on --%s meets 4.5:1',
    (fg, bg) => {
      expect(contrast(t[fg]!, t[bg]!)).toBeGreaterThanOrEqual(4.5)
    },
  )

  it('primary buttons: --on-accent on --accent and --accent-hover meet 4.5:1', () => {
    expect(contrast(t['on-accent']!, t.accent!)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(t['on-accent']!, t['accent-hover']!)).toBeGreaterThanOrEqual(4.5)
  })

  it('notice banners meet 4.5:1', () => {
    expect(contrast(t['notice-text']!, t['notice-bg']!)).toBeGreaterThanOrEqual(4.5)
  })

  it('the brand stays orange', () => {
    expect(t.brand).toBe('#f97316')
  })
})

describe('globals.css', () => {
  it('does not import fonts from a third party at runtime (REPORT FE-6, PERF-4)', () => {
    expect(css).not.toMatch(/@import\s+url\(/)
    expect(css).not.toMatch(/fonts\.googleapis\.com/)
  })

  it('applies hover styles only on devices that can hover (no sticky hover on touch)', () => {
    const outsideHoverQuery = css.replace(/@media \(hover: hover\) \{[\s\S]*?\n\}\n/g, '')
    expect(outsideHoverQuery).not.toMatch(/:hover/)
  })
})
