import { describe, expect, it } from 'vitest'
import type { HourlyForecast } from './types'
import { hourSlots, uvBarCenter } from '@solara/core/uv-strip'
import {
  SUN_ARC_APEX_Y,
  SUN_ARC_BASELINE_Y,
  PEAK_LABEL_RISE,
  hourAtOffset,
  peakOffView,
  placePeakLabel,
  sunArcGeometry,
  type Circle,
  type LabelPlacement,
  type LabelSize,
} from './sun-arc'

const hour = (h: number, uv = 1): HourlyForecast => ({ hour: h, uv, tempC: 20, condition: '' })

describe('sunArcGeometry', () => {
  const slots = hourSlots([6, 7, 8, 9, 10].map(h => hour(h)))
  const width = 5 * 42 + 4 * 4
  const g = sunArcGeometry(slots, width)

  it('puts every hour over the center of its bar', () => {
    for (let i = 0; i < slots.length; i++)
      expect(g.pointForHour(6 + i)!.x).toBeCloseTo(uvBarCenter(i, slots.length, width))
    expect(g.pointForHour(5)).toBeNull()
    expect(g.pointForHour(11)).toBeNull()
  })

  it('rises from the baseline to the apex at the middle hour', () => {
    expect(g.pointForHour(6)!.y).toBeCloseTo(SUN_ARC_BASELINE_Y)
    expect(g.pointForHour(8)!.y).toBeCloseTo(SUN_ARC_APEX_Y)
    expect(g.pointForHour(10)!.y).toBeCloseTo(SUN_ARC_BASELINE_Y)
  })

  it('places fractional times between bars', () => {
    expect(g.indexForTime(7.5)).toBe(1.5)
    expect(g.indexForTime(12)).toBeNull()
  })

  it('clips the colored line around a gap', () => {
    const gapped = hourSlots([6, 7, 9, 10].map(h => hour(h)))
    const geo = sunArcGeometry(gapped, width)
    expect(geo.gaps).toEqual([[8, 8]])
    expect(geo.knownSpans).toEqual([
      [0, uvBarCenter(1, 5, width)],
      [uvBarCenter(3, 5, width), width],
    ])
  })
})

describe('hourAtOffset', () => {
  const width = 3 * 42 + 2 * 4

  it('maps a pointer to the bar under it', () => {
    const slots = hourSlots([6, 7, 8].map(h => hour(h)))
    expect(hourAtOffset(slots, 10, width)?.hour).toBe(6)
    expect(hourAtOffset(slots, 70, width)?.hour).toBe(7)
    expect(hourAtOffset(slots, width + 50, width)?.hour).toBe(8)
    expect(hourAtOffset(slots, -50, width)?.hour).toBe(6)
  })

  it('snaps out of a gap to the nearest hour with data', () => {
    const slots = hourSlots([6, 8].map(h => hour(h)))
    expect(hourAtOffset(slots, 70, width)?.hour).toBe(6)
  })

  it('has nothing to pick before layout', () => {
    expect(hourAtOffset(hourSlots([hour(6)]), 10, 0)).toBeNull()
  })
})

describe('placePeakLabel', () => {
  // "Peak 10.3 · 1pm" at 11.5 px Inter, as measured in Chromium.
  const size: LabelSize = { width: 86, ascent: 11, descent: 3 }
  // 15 hours (6am to 8pm) at the minimum bar width: the strip scrolls on phones.
  const slots = hourSlots(Array.from({ length: 15 }, (_, i) => hour(6 + i)))
  const width = 15 * 42 + 14 * 4
  const g = sunArcGeometry(slots, width)
  const arcTop = (left: number, right: number) =>
    g.yAtX(Math.min(Math.max((g.x0 + g.x1) / 2, left), right))

  const place = (h: number, visible = { left: 8, right: width - 8 }, obstacles: Circle[] = []) => {
    const peak = g.pointForHour(h)!
    return { peak, at: placePeakLabel({ peak, size, visible, arcTop, obstacles }) }
  }
  const box = (at: LabelPlacement) => ({
    left: at.x,
    right: at.x + size.width,
    top: at.y - size.ascent,
    bottom: at.y + size.descent,
  })
  const overlaps = (at: LabelPlacement, c: Circle) => {
    const b = box(at)
    return b.left < c.x + c.r && c.x - c.r < b.right && b.top < c.y + c.r && c.y - c.r < b.bottom
  }
  /** True when the callout clears the line everywhere along its width. */
  const clearOfLine = (at: LabelPlacement) => {
    const b = box(at)
    for (let x = b.left; x <= b.right; x++) if (b.bottom > g.yAtX(x) - 2) return false
    return true
  }

  it('centers the callout above a mid-day peak', () => {
    const { peak, at } = place(13)
    expect(at.x + size.width / 2).toBeCloseTo(peak.x)
    expect(at.y).toBeCloseTo(peak.y - PEAK_LABEL_RISE)
  })

  it('slides inside the visible part of a scrolled strip', () => {
    // The noon ring (x 297) is on screen, but a centered callout would run past the
    // view's right edge.
    const visible = { left: 20, right: 310 }
    const { peak, at } = place(12, visible)
    expect(peak.x + size.width / 2).toBeGreaterThan(visible.right)
    expect(box(at).right).toBeLessThanOrEqual(visible.right)
    expect(box(at).left).toBeGreaterThanOrEqual(visible.left)
    // Still spans the peak ring.
    expect(at.x).toBeLessThanOrEqual(peak.x - 7)
    expect(at.y).toBeCloseTo(peak.y - PEAK_LABEL_RISE)
  })

  it('pins to the edge of the view nearest a marker scrolled out of it', () => {
    // The 320 px phone on load: noon and later are off to the right.
    expect(place(13, { left: 20, right: 234 }).at.x).toBe(234 - size.width)
    expect(place(6, { left: 300, right: 520 }).at.x).toBe(300)
  })

  for (const [name, h] of [
    ['first', 6],
    ['second', 7],
    ['second-to-last', 19],
    ['last', 20],
  ] as const) {
    it(`fits and clears the steep line for a peak at the ${name} hour`, () => {
      const visible = { left: 8, right: width - 8 }
      const { peak, at } = place(h, visible)
      expect(box(at).left).toBeGreaterThanOrEqual(visible.left)
      expect(box(at).right).toBeLessThanOrEqual(visible.right)
      expect(box(at).top).toBeGreaterThanOrEqual(0)
      expect(clearOfLine(at)).toBe(true)
      expect(overlaps(at, { ...peak, r: 7 })).toBe(false)
    })
  }

  it('moves clear of the "now" sun and the focus ring', () => {
    for (const [peakHour, otherHour] of [
      [13, 12],
      [13, 14],
      [7, 8],
      [19, 18],
    ] as const) {
      const sun = { ...g.pointForHour(otherHour)!, r: 8 }
      const ring = { ...g.pointForHour(otherHour)!, r: 10.25 }
      for (const obstacle of [sun, ring]) {
        const { peak, at } = place(peakHour, undefined, [obstacle])
        expect(overlaps(at, obstacle)).toBe(false)
        expect(overlaps(at, { ...peak, r: 7 })).toBe(false)
        expect(box(at).top).toBeGreaterThanOrEqual(0)
        expect(clearOfLine(at)).toBe(true)
      }
    }
  })
})

describe('peakOffView', () => {
  const view = { left: 16, right: 238 }

  it('names the side a peak is scrolled past', () => {
    expect(peakOffView(100, view)).toBeNull()
    // A ring partly in the edge fade is still in view.
    expect(peakOffView(232, view)).toBeNull()
    expect(peakOffView(20, view)).toBeNull()
    expect(peakOffView(300, view)).toBe('right')
    expect(peakOffView(-40, view)).toBe('left')
  })
})
