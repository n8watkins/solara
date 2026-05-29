import { describe, it, expect } from 'vitest'
import { bestUpcomingWindow, planUpcoming } from '@/lib/planner'
import { DayWeather, Activity, HourlyForecast } from '@/lib/types'

function day(dateStr: string, label: string, uvByHour: (h: number) => number): DayWeather {
  const hourly: HourlyForecast[] = []
  for (let h = 6; h <= 20; h++) hourly.push({ hour: h, uv: uvByHour(h), tempF: 70, condition: 'Clear' })
  return { dateStr, label, hourly }
}

const run: Activity = { id: 'run', name: 'Running', icon: '🏃', durationMins: 60, maxUV: 4, sunscreen: false }

describe('bestUpcomingWindow', () => {
  it('picks the day with the lowest-average-UV window', () => {
    const forecast = [
      day('2026-05-29', 'Today',    h => (h <= 9 ? 3 : 9)),   // morning avg 3
      day('2026-05-30', 'Tomorrow', h => (h <= 9 ? 1 : 9)),   // morning avg 1 ← best
      day('2026-05-31', 'Sat',      h => (h <= 9 ? 4 : 9)),   // morning avg 4
    ]
    const best = bestUpcomingWindow(forecast, run, 'fair', 10)
    expect(best).not.toBeNull()
    expect(best!.dateStr).toBe('2026-05-30')
    expect(best!.dayOffset).toBe(1)
    expect(best!.window.avgUV).toBe(1)
  })

  it('respects the day limit (Pro horizon unlocks better later days)', () => {
    const forecast = [
      day('2026-05-29', 'Today',    () => 3),  // all-day avg 3
      day('2026-05-30', 'Tomorrow', () => 4),  // worse
      day('2026-06-05', 'Thu',      () => 1),  // best, but day 6
    ]
    // Free horizon (2 days) can't see the great Thursday
    expect(bestUpcomingWindow(forecast, run, 'fair', 2)!.dateStr).toBe('2026-05-29')
    // Pro horizon (10 days) finds it
    expect(bestUpcomingWindow(forecast, run, 'fair', 10)!.dateStr).toBe('2026-06-05')
  })

  it('breaks ties toward the earlier day', () => {
    const forecast = [
      day('2026-05-29', 'Today',    () => 2),
      day('2026-05-30', 'Tomorrow', () => 2),
    ]
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
    const swim: Activity = { id: 'swim', name: 'Swimming', icon: '🏊', durationMins: 60, maxUV: 1, sunscreen: false } // never safe at uv2
    const plan = planUpcoming(forecast, [run, swim], 'fair', 10)
    expect(plan).toHaveLength(1)
    expect(plan[0].activity.id).toBe('run')
  })
})
