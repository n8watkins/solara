import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { planActivityDay } from '@solara/core/next-slot'
import { bestUpcomingSlot } from '@solara/core/planner'
import { buildPrefs, buildWeather } from '@/tests/harness/fixtures'
import { HARNESS_NOW } from '@/tests/harness/clock'

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
