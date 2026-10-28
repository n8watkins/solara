import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  actionableWindows,
  lowestUVWindow,
  needsClouds,
  nowHourOf,
  planActivityDay,
  soonestPlan,
} from '@/lib/next-slot'
import { bestUpcomingSlot } from '@/lib/planner'
import type { Activity, HourlyForecast, SafeActivityWindow } from '@/lib/types'
import { buildPrefs, buildWeather } from '@/tests/harness/fixtures'
import { HARNESS_NOW } from '@/tests/harness/clock'

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

// The harness fixtures at the frozen 10:30: the scenario the dashboard screenshots
// show. Every activity's slot is in the future and inside the strip's day, and
// "Best day this week" picks the same slot for today as the cards.
describe('harness scenario at 10:30', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(HARNESS_NOW))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('never recommends the past or beyond the last strip hour', () => {
    const weather = buildWeather()
    const prefs = buildPrefs()
    const today = weather.forecast[0]!
    const nowHour = 10.5
    for (const activity of prefs.activities) {
      const plan = planActivityDay(today.hourly, activity, prefs.skinType, { nowHour })
      for (const w of plan.windows) {
        expect(w.from).toBeGreaterThanOrEqual(nowHour)
        expect(w.to).toBeLessThanOrEqual(20)
      }
      const upcoming = bestUpcomingSlot(weather.forecast, activity, prefs.skinType, 10, {}, nowHour)
      if (plan.slot) {
        expect(plan.slot.start).toBeGreaterThanOrEqual(nowHour)
        expect(plan.slot.end).toBeLessThanOrEqual(20)
        if (upcoming?.dateStr === today.dateStr) expect(upcoming.slot).toEqual(plan.slot)
      }
    }
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
