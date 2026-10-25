import { describe, expect, it } from 'vitest'
import {
  GUTTER_W,
  MAX_DAYS_ACROSS,
  MIN_LANE_W,
  chipVariant,
  computeAxis,
  computeColumns,
  pageTarget,
  rangeLabel,
  shortHour,
  uvBand,
  visibleDays,
} from './calendar-layout'

describe('computeColumns', () => {
  it('fits a week on desktop and fills the width exactly', () => {
    const layout = computeColumns(1044, 10, 4)
    expect(layout.daysAcross).toBe(MAX_DAYS_ACROSS)
    expect(Number.isInteger(layout.colW)).toBe(true)
    expect(layout.gutterW + layout.colW * layout.daysAcross).toBe(1044)
    expect(layout.gutterW).toBeGreaterThanOrEqual(GUTTER_W)
    expect(layout.laneW).toBeGreaterThanOrEqual(MIN_LANE_W)
  })

  it('shows fewer days on a phone rather than squeezing lanes', () => {
    const layout = computeColumns(324, 10, 4)
    expect(layout.daysAcross).toBe(2)
    expect(layout.laneW).toBeGreaterThanOrEqual(MIN_LANE_W)
    expect(layout.gutterW + layout.colW * layout.daysAcross).toBe(324)
  })

  it('never shows more days than the forecast has', () => {
    expect(computeColumns(1044, 2, 1).daysAcross).toBe(2)
    expect(computeColumns(1044, 0, 0).daysAcross).toBe(1)
  })

  it('keeps the minimum lane width when the grid is narrower than one column', () => {
    const layout = computeColumns(100, 10, 6)
    expect(layout.daysAcross).toBe(1)
    expect(layout.laneW).toBeGreaterThanOrEqual(MIN_LANE_W)
  })

  it('has a usable layout before the grid is measured', () => {
    const layout = computeColumns(null, 7, 3)
    expect(layout.gutterW).toBe(GUTTER_W)
    expect(layout.daysAcross).toBe(3)
  })
})

describe('computeAxis', () => {
  it('starts at the earliest window and ends at the latest in the full-day view', () => {
    const axis = computeAxis(
      'full',
      [
        { from: 5.5, to: 9 },
        { from: 16, to: 21 },
      ],
      { from: 6, to: 20 },
    )
    expect(axis).toEqual({ from: 5, to: 21 })
  })

  it('keeps the preferred hours when windows sit inside them', () => {
    expect(computeAxis('full', [{ from: 8, to: 10 }], { from: 6, to: 20 })).toEqual({
      from: 6,
      to: 20,
    })
    expect(computeAxis('full', [])).toEqual({ from: 6, to: 20 })
  })

  it('clamps to the day and repairs an inverted preference', () => {
    expect(computeAxis('full', [{ from: 0, to: 24 }], { from: 9, to: 3 })).toEqual({
      from: 0,
      to: 24,
    })
    expect(computeAxis('full', [], { from: 9, to: 3 })).toEqual({ from: 9, to: 10 })
  })

  it('uses fixed ranges for the zoomed views', () => {
    expect(computeAxis('morning', [{ from: 4, to: 22 }])).toEqual({ from: 6, to: 12 })
    expect(computeAxis('afternoon', [])).toEqual({ from: 12, to: 18 })
    expect(computeAxis('evening', [])).toEqual({ from: 16, to: 21 })
  })
})

describe('chip labels', () => {
  it('picks a label style from the lane width', () => {
    expect(chipVariant(120)).toBe('full')
    expect(chipVariant(40)).toBe('stacked')
    expect(chipVariant(26)).toBe('compact')
  })

  it('shortens hours for the narrowest lanes', () => {
    expect(shortHour(6)).toBe('6a')
    expect(shortHour(12)).toBe('12p')
    expect(shortHour(21)).toBe('9p')
    expect(shortHour(0)).toBe('12a')
  })
})

describe('paging', () => {
  const layout = { colW: 100, daysAcross: 7 }

  it('reports the fully visible days for a scroll offset', () => {
    expect(visibleDays(0, layout, 10)).toEqual({ first: 0, last: 6 })
    expect(visibleDays(300, layout, 10)).toEqual({ first: 3, last: 9 })
    expect(visibleDays(-20, layout, 10)).toEqual({ first: 0, last: 6 })
    expect(visibleDays(0, layout, 0)).toEqual({ first: 0, last: 0 })
  })

  it('pages by a screen and stops at both ends', () => {
    expect(pageTarget(0, 1, 7, 10)).toBe(3)
    expect(pageTarget(3, -1, 7, 10)).toBe(0)
    expect(pageTarget(0, 1, 2, 10)).toBe(2)
    expect(pageTarget(8, 1, 2, 10)).toBe(8)
    expect(pageTarget(0, 1, 7, 3)).toBe(0)
  })

  it('labels the visible range', () => {
    expect(rangeLabel('2026-06-15', '2026-06-21')).toBe('Jun 15 – 21')
    expect(rangeLabel('2026-06-28', '2026-07-04')).toBe('Jun 28 – Jul 4')
    expect(rangeLabel('2026-06-15', '2026-06-15')).toBe('Jun 15')
    expect(rangeLabel(undefined, '2026-06-15')).toBe('')
  })
})

describe('uvBand', () => {
  it('maps readings to WHO bands', () => {
    expect(uvBand(0).label).toBeNull()
    expect(uvBand(0.4).label).toBeNull()
    expect(uvBand(0.5).label).toBe('Low')
    expect(uvBand(2).label).toBe('Low')
    expect(uvBand(2.4).label).toBe('Low')
    expect(uvBand(2.5).label).toBe('Moderate')
    expect(uvBand(5.4).label).toBe('Moderate')
    expect(uvBand(7).label).toBe('High')
    expect(uvBand(10).label).toBe('Very high')
    expect(uvBand(11.3).label).toBe('Extreme')
  })
})
