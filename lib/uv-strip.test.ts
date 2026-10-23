import { describe, expect, it } from 'vitest'
import {
  UV_BAR_GAP,
  hourSlots,
  missingRuns,
  uvBarCenter,
  uvDaySummary,
} from '@/components/UVTimeline'
import type { HourlyForecast } from '@/lib/types'

const hour = (h: number, uv: number): HourlyForecast => ({
  hour: h,
  uv,
  tempF: 70,
  condition: 'Clear',
})

describe('uvBarCenter', () => {
  it('puts each hour at the center of its bar, gaps included', () => {
    // 3 bars across 134px with 4px gaps: bars are 42px wide at 0, 46 and 92.
    expect(UV_BAR_GAP).toBe(4)
    expect(uvBarCenter(0, 3, 134)).toBe(21)
    expect(uvBarCenter(1, 3, 134)).toBe(67)
    expect(uvBarCenter(2, 3, 134)).toBe(113)
  })
})

describe('uvDaySummary', () => {
  it('names the peak and the high-UV stretch', () => {
    const day = [hour(9, 3), hour(10, 6.2), hour(11, 9.4), hour(12, 7), hour(13, 4)]
    expect(uvDaySummary(day)).toBe(
      'UV peaks at 9.4, Very high, at 11am. High or above from 10am to 12pm.',
    )
  })

  it('omits the high stretch on a low day and handles an empty day', () => {
    expect(uvDaySummary([hour(9, 1), hour(10, 2.5)])).toBe('UV peaks at 2.5, Moderate, at 10am.')
    expect(uvDaySummary([])).toBe('No UV forecast for this day.')
  })
})

describe('hourSlots and missingRuns', () => {
  it('keeps hours with no UV data as explicit gaps', () => {
    const day = [hour(10, 5), hour(11, 6), hour(14, 7), hour(16, 3)]
    const slots = hourSlots(day)
    expect(slots.map(s => [s.hour, s.data?.uv ?? null])).toEqual([
      [10, 5],
      [11, 6],
      [12, null],
      [13, null],
      [14, 7],
      [15, null],
      [16, 3],
    ])
    expect(missingRuns(slots)).toEqual([
      [12, 13],
      [15, 15],
    ])
    expect(uvDaySummary(day)).toBe(
      'UV peaks at 7.0, High, at 2pm. High or above from 11am to 2pm. No UV data from 12pm to 1pm. No UV data at 3pm.',
    )
  })

  it('returns no slots for an empty day', () => {
    expect(hourSlots([])).toEqual([])
    expect(missingRuns([])).toEqual([])
  })
})
