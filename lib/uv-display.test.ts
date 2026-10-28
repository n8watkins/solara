import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { downloadICS } from '@/lib/ics'
import {
  UV_BANDS,
  fmtClock,
  fmtDays,
  gcalLink,
  uvBand,
  uvColor,
  uvLabel,
  uvTextColor,
} from '@/lib/weather'

// The UV palette is defined once, as --color-uv-* theme variables in
// app/globals.css; lib/weather.ts only picks the variable for a value.
const css = readFileSync(join(__dirname, '..', 'app', 'globals.css'), 'utf8')
const palette = Object.fromEntries(
  [...css.matchAll(/--color-uv-([\w-]+):\s*(#[0-9a-f]{6});/gi)].map(m => [m[1]!, m[2]!]),
)

/** Resolves a var(--color-uv-*) value from uvColor/uvTextColor to its hex. */
function hex(value: string): string {
  const name = /^var\(--color-uv-([\w-]+)\)$/.exec(value)?.[1]
  expect(name, value).toBeDefined()
  const color = palette[name!]
  expect(color, `--color-uv-${name} in app/globals.css`).toBeDefined()
  return color!
}

// The UV scale bands drive every UV color in the app; a band edge that drifts
// shows a high UV hour in a "low" color.
const BAND_SAMPLES = [0, 1, 4, 6, 9, 11]

describe('UV color bands', () => {
  it('defines every band once in the theme, plus the text color', () => {
    expect(Object.keys(palette).sort()).toEqual([...UV_BANDS, 'ink'].sort())
  })

  it('gives each band its own background and AA-contrast text', () => {
    expect(BAND_SAMPLES.map(uvBand)).toEqual(UV_BANDS)
    expect(BAND_SAMPLES.map(uv => hex(uvColor(uv)))).toEqual([
      '#d1d5db',
      '#86efac',
      '#fcd34d',
      '#fb923c',
      '#f87171',
      '#c084fc',
    ])
    for (const uv of BAND_SAMPLES) {
      expect(contrastRatio(hex(uvTextColor(uv)), hex(uvColor(uv)))).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('bands the rounded index, as the WHO scale and the legend do', () => {
    expect([0.49, 0.5, 2.49, 2.5, 5.4, 5.5, 7.49, 7.5, 10.49, 10.5].map(uvBand)).toEqual([
      'none',
      'low',
      'low',
      'moderate',
      'moderate',
      'high',
      'high',
      'very-high',
      'very-high',
      'extreme',
    ])
  })

  it('labels each band', () => {
    // The WHO's Low band is 0-2; the app's gray "none" shade of it has the same name.
    expect(BAND_SAMPLES.map(uvLabel)).toEqual([
      'Low',
      'Low',
      'Moderate',
      'High',
      'Very high',
      'Extreme',
    ])
  })
})

describe('time and day formatting', () => {
  it('formats fractional hours, rolling :60 over', () => {
    expect(fmtClock(6.75)).toBe('6:45am')
    expect(fmtClock(17)).toBe('5pm')
    expect(fmtClock(11.999)).toBe('12pm')
    expect(fmtClock(12.5)).toBe('12:30pm')
  })

  it('summarizes weekday restrictions', () => {
    expect(fmtDays(undefined)).toBeNull()
    expect(fmtDays([0, 1, 2, 3, 4, 5, 6])).toBeNull()
    expect(fmtDays([5, 1, 2, 3, 4])).toBe('Weekdays')
    expect(fmtDays([6, 0])).toBe('Weekends')
    expect(fmtDays([3, 1])).toBe('Mon, Wed')
  })

  it('builds a Google Calendar link for a lower-UV window', () => {
    const link = new URL(gcalLink('Walk', { from: 7, to: 9 }, 30, '2026-06-16', 'Europe/London'))
    expect(link.searchParams.get('text')).toBe('Walk: lower-UV window')
    // 7:00 British Summer Time is 06:00 UTC.
    expect(link.searchParams.get('dates')).toBe('20260616T060000Z/20260616T063000Z')
  })
})

describe('downloadICS', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('is a no-op outside the browser', () => {
    expect(() => downloadICS('plan.ics', 'BEGIN:VCALENDAR')).not.toThrow()
  })

  it('downloads the calendar as a text/calendar file and releases the URL', async () => {
    const anchor = { href: '', download: '', click: vi.fn(), remove: vi.fn() }
    const appendChild = vi.fn()
    const createObjectURL = vi.fn(() => 'blob:solara')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('window', {})
    vi.stubGlobal('document', { createElement: () => anchor, body: { appendChild } })
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })

    downloadICS('plan.ics', 'BEGIN:VCALENDAR')

    const blob = (createObjectURL.mock.calls[0] as unknown[])[0] as Blob
    expect(blob.type).toBe('text/calendar;charset=utf-8')
    expect(await blob.text()).toBe('BEGIN:VCALENDAR')
    expect(anchor).toMatchObject({ href: 'blob:solara', download: 'plan.ics' })
    expect(appendChild).toHaveBeenCalledWith(anchor)
    expect(anchor.click).toHaveBeenCalledOnce()
    expect(anchor.remove).toHaveBeenCalledOnce()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:solara')
  })
})

function luminance(hex: string): number {
  const channels = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
  const [r = 0, g = 0, b = 0] = channels.map(c =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  )
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}
