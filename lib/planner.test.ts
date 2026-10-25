import { describe, it, expect } from 'vitest'
import {
  bestUpcomingWindow,
  planUpcoming,
  bestUpcomingSlot,
  planUpcomingSlots,
  activityRunsOn,
  nextSlotAfterToday,
} from '@/lib/planner'
import type { DayWeather, Activity, HourlyForecast } from '@/lib/types'

function day(dateStr: string, label: string, uvByHour: (h: number) => number): DayWeather {
  const hourly: HourlyForecast[] = []
  for (let h = 6; h <= 20; h++)
    hourly.push({ hour: h, uv: uvByHour(h), tempC: 21, condition: 'Clear' })
  return { dateStr, label, hourly }
}

const run: Activity = {
  id: 'run',
  name: 'Running',
  icon: '🏃',
  durationMins: 60,
  maxUV: 4,
  sunscreen: false,
}

describe('activityRunsOn (weekday routines)', () => {
  // 2026-05-29 Fri, 05-30 Sat, 05-31 Sun, 06-01 Mon
  it('runs every day when unrestricted', () => {
    expect(activityRunsOn(run, '2026-05-30')).toBe(true)
    expect(activityRunsOn({ ...run, daysOfWeek: [] }, '2026-05-30')).toBe(true)
  })
  it('honors a weekday restriction', () => {
    const weekdayRun: Activity = { ...run, daysOfWeek: [1, 2, 3, 4, 5] }
    expect(activityRunsOn(weekdayRun, '2026-05-29')).toBe(true) // Fri
    expect(activityRunsOn(weekdayRun, '2026-05-30')).toBe(false) // Sat
    expect(activityRunsOn(weekdayRun, '2026-06-01')).toBe(true) // Mon
  })
  it('honors a weekend restriction', () => {
    const weekendHike: Activity = { ...run, daysOfWeek: [0, 6] }
    expect(activityRunsOn(weekendHike, '2026-05-30')).toBe(true) // Sat
    expect(activityRunsOn(weekendHike, '2026-05-31')).toBe(true) // Sun
    expect(activityRunsOn(weekendHike, '2026-06-01')).toBe(false) // Mon
  })
})

describe('weekday-restricted planning', () => {
  it("skips non-matching days and picks the activity's day", () => {
    const weekendHike: Activity = { ...run, daysOfWeek: [0, 6], name: 'Hike' }
    const forecast = [
      day('2026-05-29', 'Fri', () => 1), // best UV, but a weekday → skipped
      day('2026-05-30', 'Sat', () => 3), // first eligible weekend day
      day('2026-05-31', 'Sun', () => 2),
    ]
    expect(bestUpcomingWindow(forecast, weekendHike, 'fair', 10)!.dateStr).toBe('2026-05-31') // lowest UV among Sat/Sun
    expect(bestUpcomingSlot(forecast, weekendHike, 'fair', 10)!.dateStr).toBe('2026-05-30') // soonest eligible
  })
})

describe('bestUpcomingWindow', () => {
  it('picks the day with the lowest-average-UV window', () => {
    const forecast = [
      day('2026-05-29', 'Today', h => (h <= 9 ? 3 : 9)), // morning avg 3
      day('2026-05-30', 'Tomorrow', h => (h <= 9 ? 1 : 9)), // morning avg 1 ← best
      day('2026-05-31', 'Sat', h => (h <= 9 ? 4 : 9)), // morning avg 4
    ]
    const best = bestUpcomingWindow(forecast, run, 'fair', 10)
    expect(best).not.toBeNull()
    expect(best!.dateStr).toBe('2026-05-30')
    expect(best!.dayOffset).toBe(1)
    expect(best!.window.avgUV).toBe(1)
  })

  it('respects the day limit (Pro horizon unlocks better later days)', () => {
    const forecast = [
      day('2026-05-29', 'Today', () => 3), // all-day avg 3
      day('2026-05-30', 'Tomorrow', () => 4), // worse
      day('2026-06-05', 'Thu', () => 1), // best, but day 6
    ]
    // Free horizon (2 days) can't see the great Thursday
    expect(bestUpcomingWindow(forecast, run, 'fair', 2)!.dateStr).toBe('2026-05-29')
    // Pro horizon (10 days) finds it
    expect(bestUpcomingWindow(forecast, run, 'fair', 10)!.dateStr).toBe('2026-06-05')
  })

  it('breaks ties toward the earlier day', () => {
    const forecast = [day('2026-05-29', 'Today', () => 2), day('2026-05-30', 'Tomorrow', () => 2)]
    expect(bestUpcomingWindow(forecast, run, 'fair', 10)!.dateStr).toBe('2026-05-29')
  })

  it('returns null when no day has a long-enough window', () => {
    const forecast = [day('2026-05-29', 'Today', () => 9)] // never under threshold
    expect(bestUpcomingWindow(forecast, run, 'fair', 10)).toBeNull()
  })

  it('skips days with no forecast data', () => {
    const empty: DayWeather = { dateStr: '2026-05-29', label: 'Today', hourly: [] }
    const good = day('2026-05-30', 'Tomorrow', () => 1)
    const best = bestUpcomingWindow([empty, good], run, 'fair', 10)
    expect(best!.dateStr).toBe('2026-05-30')
  })
})

describe('planUpcoming', () => {
  it('returns one entry per activity that has a window, omitting the rest', () => {
    const forecast = [day('2026-05-29', 'Today', h => (h <= 12 ? 2 : 9))]
    const swim: Activity = {
      id: 'swim',
      name: 'Swimming',
      icon: '🏊',
      durationMins: 60,
      maxUV: 1,
      sunscreen: false,
    } // never safe at uv2
    const plan = planUpcoming(forecast, [run, swim], 'fair', 10)
    expect(plan).toHaveLength(1)
    expect(plan[0]!.activity.id).toBe('run')
  })
})

describe('bestUpcomingSlot', () => {
  it('earliest: returns the soonest feasible day with a concrete slot', () => {
    const forecast = [
      day('2026-05-29', 'Today', h => (h <= 9 ? 2 : 9)),
      day('2026-05-30', 'Tomorrow', h => (h <= 9 ? 1 : 9)),
    ]
    const s = bestUpcomingSlot(forecast, run, 'fair', 10)!
    expect(s.dateStr).toBe('2026-05-29')
    expect(s.dayOffset).toBe(0)
    expect(s.slot.start).toBe(6)
  })

  it('sunniest: returns the day with the sunniest recommended slot', () => {
    const sunny: Activity = { ...run, timePreference: 'sunniest' }
    const forecast = [day('2026-05-29', 'Today', () => 2), day('2026-05-30', 'Tomorrow', () => 4)]
    const s = bestUpcomingSlot(forecast, sunny, 'fair', 10)!
    expect(s.dateStr).toBe('2026-05-30')
    expect(s.slot.avgUV).toBe(4)
  })

  it('skips a day that is fully booked', () => {
    const forecast = [
      day('2026-05-29', 'Today', h => (h <= 9 ? 1 : 9)),
      day('2026-05-30', 'Tomorrow', h => (h <= 9 ? 1 : 9)),
    ]
    const busyByDate = { '2026-05-29': [{ start: 0, end: 24 }] }
    const s = bestUpcomingSlot(forecast, run, 'fair', 10, busyByDate)!
    expect(s.dateStr).toBe('2026-05-30')
  })

  it('applies nowHourToday only to the first day', () => {
    const forecast = [
      day('2026-05-29', 'Today', h => (h <= 9 ? 1 : 9)), // morning window 6-10
      day('2026-05-30', 'Tomorrow', h => (h <= 9 ? 1 : 9)),
    ]
    // it's already 11am — today's only window has passed → fall through to tomorrow
    const s = bestUpcomingSlot(forecast, run, 'fair', 10, {}, 11)!
    expect(s.dateStr).toBe('2026-05-30')
    expect(s.slot.start).toBe(6) // tomorrow is unaffected by today's clock
  })

  it('returns null when no day has a feasible slot', () => {
    const forecast = [day('2026-05-29', 'Today', () => 9)]
    expect(bestUpcomingSlot(forecast, run, 'fair', 10)).toBeNull()
  })
})

describe('planUpcomingSlots', () => {
  it('returns one slot per feasible activity, omitting the rest', () => {
    const forecast = [day('2026-05-29', 'Today', h => (h <= 12 ? 2 : 9))]
    const swim: Activity = {
      id: 'swim',
      name: 'Swimming',
      icon: '🏊',
      durationMins: 60,
      maxUV: 1,
      sunscreen: false,
    }
    const plan = planUpcomingSlots(forecast, [run, swim], 'fair', 10)
    expect(plan).toHaveLength(1)
    expect(plan[0]!.activity.id).toBe('run')
    expect(plan[0]!.slot.start).toBe(6)
  })
})

describe('nextSlotAfterToday', () => {
  const swim: Activity = { ...run, id: 'swim', name: 'Swim', preferredHours: { from: 17, to: 20 } }
  const forecast = [
    day('2026-05-29', 'Today', () => 1),
    day('2026-05-30', 'Tomorrow', h => (h < 9 ? 2 : 8)),
    day('2026-05-31', 'Sun, May 31', () => 1),
  ]

  it('never looks at today', () => {
    expect(nextSlotAfterToday(forecast.slice(0, 1), [run], 'fair', 10)).toBeNull()
  })

  it('picks the earliest day, then the earliest start across activities', () => {
    const next = nextSlotAfterToday(forecast, [swim, run], 'fair', 10)!
    expect(next.activity.id).toBe('run')
    expect(next.label).toBe('Tomorrow')
    expect(next.slot.start).toBe(6)
  })

  it("stays within the plan's visible days", () => {
    const late = [forecast[0]!, day('2026-05-30', 'Tomorrow', () => 9), forecast[2]!]
    expect(nextSlotAfterToday(late, [run], 'fair', 2)).toBeNull()
    expect(nextSlotAfterToday(late, [run], 'fair', 3)!.label).toBe('Sun, May 31')
    expect(nextSlotAfterToday(late, [run], 'fair', 1)).toBeNull()
  })
})
