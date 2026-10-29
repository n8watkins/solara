import { describe, expect, it } from 'vitest'
import { dayPhrase, nextHourWhere, sunDown, todayOver } from './day-view'
import type { HourlyForecast } from './forecast-days'

const hour = (h: number, uv: number, tempC = 20): HourlyForecast => ({
  hour: h,
  uv,
  tempC,
  condition: `c${h}`,
})

describe('dayPhrase', () => {
  it('reads naturally in a sentence', () => {
    expect(dayPhrase(true, 'Today')).toBe('today')
    expect(dayPhrase(false, 'Tomorrow')).toBe('tomorrow')
    expect(dayPhrase(false, 'Wed 17')).toBe('on Wed 17')
  })
})

describe('sunDown and nextHourWhere', () => {
  const day = (peak: number) =>
    [6, 7, 8, 12, 18, 19, 20].map(h => hour(h, h === 6 || h === 20 ? 0 : h === 12 ? peak : 1))
  const weather = (currentUV: number) => ({
    current: { uv: currentUV, tempC: 20, condition: 'Clear' },
    today: day(8),
    tomorrow: day(9),
  })

  it('is after sunset once the day has no UV left', () => {
    expect(sunDown(weather(0), 21.5)).toEqual({
      phase: 'after-sunset',
      uvReturns: { hour: 7, tomorrow: true },
    })
  })

  it('is before sunrise until the first UV', () => {
    expect(sunDown(weather(0), 5)).toEqual({
      phase: 'before-sunrise',
      uvReturns: { hour: 7, tomorrow: false },
    })
  })

  it('is null in daylight, even in a dull hour', () => {
    expect(sunDown(weather(3), 12)).toBeNull()
    expect(sunDown(weather(0.2), 12)).toBeNull()
  })

  it("follows the place's sun when it is known, not the UV (REVIEW6 L7)", () => {
    // 8:05am with the sun up for an hour and UV still 0.4: daylight, not "Before sunrise".
    const lowMorning = { ...weather(0.4), today: [hour(8, 0.4), hour(9, 1.2), hour(12, 8)] }
    expect(sunDown(lowMorning, 8.1)).toEqual({
      phase: 'before-sunrise',
      uvReturns: { hour: 9, tomorrow: false },
    })
    expect(sunDown(lowMorning, 8.1, 'up')).toBeNull()
    // The sun's phase decides before or after, and when UV returns still comes from the forecast.
    expect(sunDown(weather(0), 5, 'before-sunrise')).toEqual({
      phase: 'before-sunrise',
      uvReturns: { hour: 7, tomorrow: false },
    })
    expect(sunDown(weather(0), 19.9, 'after-sunset')).toEqual({
      phase: 'after-sunset',
      uvReturns: { hour: 7, tomorrow: true },
    })
    // A live reading of 0.5 or more is daylight whatever the sun's times say.
    expect(sunDown(weather(0.6), 5, 'before-sunrise')).toBeNull()
  })

  it('finds the next hour from now, today first', () => {
    const w = weather(0)
    expect(nextHourWhere(w, 12.5, uv => uv >= 1)).toEqual({ hour: 12, tomorrow: false })
    expect(nextHourWhere(w, 19.5, uv => uv >= 5)).toEqual({ hour: 12, tomorrow: true })
    expect(nextHourWhere(w, 19.5, uv => uv >= 50)).toBeNull()
  })
})

describe('todayOver', () => {
  const today = [hour(16, 1.3), hour(17, 0.3), hour(18, 0), hour(19, 0)]

  it("goes by the place's sunset when it is known", () => {
    // 5:20pm, no UV of 0.5 left, the sun still up: today is not over.
    expect(todayOver({ today }, 17.33, 'up')).toBe(false)
    expect(todayOver({ today }, 6.67, 'before-sunrise')).toBe(false)
    expect(todayOver({ today }, 18.17, 'after-sunset')).toBe(true)
  })

  it('falls back to the UV left without a place', () => {
    expect(todayOver({ today }, 16.5, null)).toBe(false)
    expect(todayOver({ today }, 17.33, null)).toBe(true)
  })
})
