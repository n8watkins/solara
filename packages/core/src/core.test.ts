import { describe, expect, it } from 'vitest'
import {
  isValidFeedToken,
  parseHourlyRows,
  parseOpenMeteoResponse,
  summarizeWindow,
} from '@solara/core'

/** A 6am-8pm day with the given UV per hour. */
const day = (uvByHour: (hour: number) => number) =>
  Array.from({ length: 15 }, (_, i) => ({ hour: 6 + i, uv: uvByHour(6 + i) }))

const rising = day(h => h)

describe('summarizeWindow', () => {
  it('includes the hour a fractional start falls in', () => {
    expect(summarizeWindow(rising, 9.5, 11)).toEqual({
      from: 9.5,
      to: 11,
      label: 'Morning',
      peakUV: 10,
      avgUV: 9.5,
    })
  })
})

describe('Open-Meteo parsing', () => {
  it('rejects a response without an hourly time axis', () => {
    expect(() => parseOpenMeteoResponse(null)).toThrow(/incomplete/)
    expect(() => parseOpenMeteoResponse({ hourly: { time: 'x' } })).toThrow(/incomplete/)
  })

  it('reads malformed values as unknown instead of failing the forecast', () => {
    const parsed = parseOpenMeteoResponse({
      timezone: 42,
      current: 'bad',
      hourly: {
        time: ['2026-06-15T10:00', 7],
        uv_index: [Number.POSITIVE_INFINITY, 'x'],
        temperature_2m: 'not a series',
        weathercode: [1.5],
      },
    })
    expect(parsed.timezone).toBeUndefined()
    expect(parsed.current).toBeUndefined()
    expect(parsed.hourly.uv_index).toEqual([null, null])
    expect(parsed.hourly.temperature_2m).toBeUndefined()
    expect(parseHourlyRows(parsed)).toEqual([
      {
        date: '2026-06-15',
        hour: 10,
        uv: null,
        tempF: null,
        weatherCode: 1.5,
        cloudCover: null,
      },
    ])
  })
})

describe('feed token policy', () => {
  it('accepts server-minted and legacy tokens only', () => {
    expect(isValidFeedToken('A'.repeat(43))).toBe(true)
    expect(isValidFeedToken('A'.repeat(32))).toBe(true)
    expect(isValidFeedToken('A'.repeat(31))).toBe(false)
    expect(isValidFeedToken(`${'A'.repeat(42)}!`)).toBe(false)
    expect(isValidFeedToken(['A'.repeat(43)])).toBe(false)
  })
})
