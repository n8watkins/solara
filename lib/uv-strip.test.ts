import { describe, expect, it } from 'vitest'
import { UV_BAR_GAP, uvBarCenter, uvDaySummary } from '@/components/UVTimeline'
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
