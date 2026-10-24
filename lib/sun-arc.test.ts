import { describe, expect, it } from 'vitest'
import type { HourlyForecast } from './types'
import { hourSlots, uvBarCenter } from './uv-strip'
import {
  SUN_ARC_APEX_Y,
  SUN_ARC_BASELINE_Y,
  hourAtOffset,
  peakLabelAnchor,
  sunArcGeometry,
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

describe('peakLabelAnchor', () => {
  it('keeps the callout inside the arc', () => {
    expect(peakLabelAnchor(20, 500)).toBe('start')
    expect(peakLabelAnchor(250, 500)).toBe('middle')
    expect(peakLabelAnchor(480, 500)).toBe('end')
  })
})
