import { describe, expect, it } from 'vitest'
import {
  actionableWindows,
  lowestUVWindow,
  needsClouds,
  nowHourOf,
  planActivityDay,
  soonestPlan,
} from './next-slot'
import type { HourlyForecast, SafeActivityWindow } from './forecast-days'
import type { Activity } from './prefs'

/** A 6am-8pm day: low UV in the morning and evening, high at midday. */
function day(uvByHour: (h: number) => number = h => (h <= 10 || h >= 17 ? 2 : 9)) {
  const hourly: HourlyForecast[] = []
  for (let h = 6; h <= 20; h++)
    hourly.push({ hour: h, uv: uvByHour(h), tempC: 21, condition: 'Clear' })
  return hourly
}

const run: Activity = {
  id: 'run',
  name: 'Running',
  icon: '🏃',
  durationMins: 60,
  maxUV: 4,
  sunscreen: false,
}

const win = (from: number, to: number, label: SafeActivityWindow['label']): SafeActivityWindow => ({
  from,
  to,
  label,
  peakUV: 2,
  avgUV: 2,
})

describe('nowHourOf', () => {
  it('returns fractional hours rounded up to five minutes', () => {
    expect(nowHourOf({ hour: 10, minute: 30 })).toBe(10.5)
    expect(nowHourOf({ hour: 10, minute: 31 })).toBeCloseTo(10 + 35 / 60)
    expect(nowHourOf({ hour: 7, minute: 0 })).toBe(7)
  })
})

describe('actionableWindows', () => {
  const hourly = day()

  it('keeps whole windows on other days', () => {
    const windows = [win(6, 11, 'Morning'), win(17, 20, 'Evening')]
    expect(actionableWindows(windows, hourly, 60)).toEqual(windows)
  })

  it('drops windows that have already ended', () => {
    const result = actionableWindows(
      [win(6, 10, 'Morning'), win(17, 20, 'Evening')],
      hourly,
      60,
      12,
    )
    expect(result.map(w => [w.from, w.to])).toEqual([[17, 20]])
  })

  it('trims a window that is under way to start now, recomputing its stats', () => {
    const [trimmed] = actionableWindows(
      [win(6, 11, 'All day')],
      day(h => h),
      30,
      9.5,
    )
    expect(trimmed).toEqual({ from: 9.5, to: 11, label: 'Morning', peakUV: 10, avgUV: 9.5 })
  })

  it('drops a trimmed window that no longer fits the activity', () => {
    expect(actionableWindows([win(6, 12, 'Morning')], hourly, 120, 10.5)).toEqual([])
  })

  // The engine (@solara/core findWindows) ends windows at the last hourly
  // sample, so the plan ends there without a second clip here.
  it('ends windows at the last hour the strip shows', () => {
    const plan = planActivityDay(hourly, run, 'fair')
    expect(plan.windows.at(-1)).toMatchObject({ from: 17, to: 20 })
    const lastHourOnly = planActivityDay(
      day(h => (h === 20 ? 2 : 9)),
      { ...run, durationMins: 30 },
      'fair',
    )
    expect(lastHourOnly.windows).toEqual([])
  })

  it('returns nothing for an empty day', () => {
    expect(planActivityDay([], run, 'fair').windows).toEqual([])
  })
})

describe('lowestUVWindow', () => {
  it('prefers lower average UV, then the longer window', () => {
    const a = { ...win(6, 8, 'Morning'), avgUV: 1 }
    const b = { ...win(17, 20, 'Evening'), avgUV: 1 }
    const c = { ...win(9, 10, 'Morning'), avgUV: 0.5 }
    expect(lowestUVWindow([a, b])).toBe(b)
    expect(lowestUVWindow([a, b, c])).toBe(c)
    expect(lowestUVWindow([])).toBeNull()
  })
})

describe('planActivityDay', () => {
  it('recommends a slot that starts now when the current window still fits', () => {
    const plan = planActivityDay(day(), run, 'fair', { nowHour: 9.5 })
    expect(plan.slot).toMatchObject({ start: 9.5, end: 10.5 })
    expect(plan.startsNow).toBe(true)
    expect(plan.elapsed).toBe(false)
  })

  it('skips past an elapsed window to the next one', () => {
    const plan = planActivityDay(day(), run, 'fair', { nowHour: 10.5 })
    expect(plan.windows.map(w => [w.from, w.to])).toEqual([[17, 20]])
    expect(plan.slot).toMatchObject({ start: 17, end: 18 })
    expect(plan.startsNow).toBe(false)
  })

  it('flags a day whose matching windows have all passed', () => {
    const plan = planActivityDay(
      day(h => (h <= 9 ? 2 : 9)),
      run,
      'fair',
      { nowHour: 12 },
    )
    expect(plan.slot).toBeNull()
    expect(plan.windows).toEqual([])
    expect(plan.elapsed).toBe(true)
  })

  it('schedules around calendar busy blocks', () => {
    const plan = planActivityDay(day(), run, 'fair', { busy: [{ start: 6, end: 9.5 }] })
    expect(plan.slot).toMatchObject({ start: 9.5, end: 10.5 })
  })

  it('reports no match without calling it elapsed', () => {
    const plan = planActivityDay(
      day(() => 9),
      run,
      'fair',
      { nowHour: 8 },
    )
    expect(plan.slot).toBeNull()
    expect(plan.elapsed).toBe(false)
  })
})

describe('planActivityDay in daylight', () => {
  // Sunrise 7:09am and sunset 6:04pm (Los Angeles in late October): daylightHours.
  const daylight = { from: 7 + 10 / 60, to: 18 }

  it('starts no slot before sunrise, though UV 0 counts as low', () => {
    const plan = planActivityDay(day(), run, 'fair', { nowHour: 6 + 40 / 60, daylight })
    expect(plan.slot?.start).toBeCloseTo(7 + 10 / 60)
    expect(plan.startsNow).toBe(false)
    expect(plan.windows.map(w => [w.from, w.to])).toEqual([
      [7 + 10 / 60, 11],
      [17, 18],
    ])
  })

  it('ends every slot by sunset, and drops one too short to fit before it', () => {
    const at5 = planActivityDay(day(), run, 'fair', { nowHour: 17, daylight })
    expect(at5.slot).toMatchObject({ start: 17, end: 18 })
    // 5:20pm: 40 minutes of daylight left for a 60-minute run.
    const at520 = planActivityDay(day(), run, 'fair', { nowHour: 17 + 20 / 60, daylight })
    expect(at520.slot).toBeNull()
    expect(at520.elapsed).toBe(true)
  })

  it('counts only daylight hours in the share of the day that fits', () => {
    // 6am-8pm has 15 hours, 9 of them low; the 11 daylight hours (7am-5pm) have 5.
    expect(planActivityDay(day(), run, 'fair').pctDaySafe).toBe(60)
    expect(planActivityDay(day(), run, 'fair', { daylight }).pctDaySafe).toBe(45)
  })

  it('says when preferred hours are all in the dark', () => {
    const early = { ...run, preferredHours: { from: 5, to: 7 } }
    const plan = planActivityDay(day(), early, 'fair', { daylight })
    expect(plan.slot).toBeNull()
    expect(plan.hoursInDark).toBe(true)
    expect(planActivityDay(day(), early, 'fair').hoursInDark).toBe(false)
    expect(planActivityDay(day(), run, 'fair', { daylight }).hoursInDark).toBe(false)
  })

  it('offers nothing in the polar night', () => {
    const plan = planActivityDay(day(), run, 'fair', { daylight: { from: 0, to: 0 } })
    expect(plan.windows).toEqual([])
    expect(plan.slot).toBeNull()
  })
})

describe('soonestPlan', () => {
  it('picks the plan whose slot starts first, keeping list order on ties', () => {
    const hourly = day()
    const late = planActivityDay(hourly, { ...run, id: 'late', timePreference: 'latest' }, 'fair')
    const early = planActivityDay(hourly, { ...run, id: 'early' }, 'fair')
    const twin = planActivityDay(hourly, { ...run, id: 'twin' }, 'fair')
    const none = planActivityDay(hourly, { ...run, id: 'none', maxUV: 1 }, 'fair')
    expect(soonestPlan([none, late, early, twin])?.activity.id).toBe('early')
    expect(soonestPlan([none])).toBeNull()
  })
})

describe('needsClouds', () => {
  const hours = [6, 7, 8, 9].map(hour => ({
    hour,
    uv: 3.5,
    clearSkyUV: hour < 8 ? 3.8 : 6,
    tempC: 18,
    condition: 'Cloudy',
  }))
  const walk = { id: 'w', name: 'Walk', icon: '🚶', durationMins: 60, maxUV: 4, sunscreen: false }

  it('marks a cloud-sensitive window that a clear sky would put over the limit', () => {
    const plan = planActivityDay(hours, { ...walk, cloudSensitive: true }, 'fair')
    expect(plan.windows.map(w => [w.from, w.to])).toEqual([[6, 9]])
    expect(plan.cloudDependent).toEqual([true])
    expect(needsClouds({ from: 6, to: 8 }, hours, { ...walk, cloudSensitive: true })).toBe(false)
  })

  it('never marks an activity that plans for a clear sky', () => {
    const plan = planActivityDay(hours, walk, 'fair')
    expect(plan.windows.map(w => [w.from, w.to])).toEqual([[6, 8]])
    expect(plan.cloudDependent).toEqual([false])
  })
})
