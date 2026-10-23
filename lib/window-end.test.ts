import { describe, expect, it } from 'vitest'
import { getSafeWindowsForActivity } from '@/lib/calendar'
import { planActivityDay } from '@/lib/next-slot'
import type { Activity, HourlyForecast } from '@/lib/types'

/* eslint-disable @typescript-eslint/no-require-imports */
const sun = require('../functions/lib/feed/sun')
const { buildMessage } = require('../functions/scripts/notification-core')
/* eslint-enable @typescript-eslint/no-require-imports */

// A 6am-8pm day whose UV is low from 5pm on, so the last window runs to the
// end of the forecast day. Every surface must end it at the last hourly sample
// (8pm), not one hour past it.
const DATE = '2026-06-15'
const hourly: HourlyForecast[] = []
for (let hour = 6; hour <= 20; hour++) {
  hourly.push({ hour, uv: hour <= 9 || hour >= 17 ? 2 : 9, tempC: 21, condition: 'Clear' })
}

const evening: Activity = {
  id: 'walk',
  name: 'Walk',
  icon: '🚶',
  durationMins: 60,
  maxUV: 3,
  sunscreen: false,
  preferredHours: { from: 16, to: 22 },
}

describe('the last window of a day', () => {
  it('ends at the last hourly sample on the dashboard', () => {
    const plan = planActivityDay(hourly, evening, 'fair')
    expect(plan.windows.map(w => [w.from, w.to])).toEqual([[17, 20]])
  })

  it('ends at the last hourly sample in the calendar view', () => {
    expect(getSafeWindowsForActivity(hourly, evening).map(w => [w.from, w.to])).toEqual([[17, 20]])
  })

  it('ends at the last hourly sample in the calendar feed', () => {
    const [event] = sun.buildSunEvents({ activities: [{ ...evening, durationMins: 180 }] }, [
      { dateStr: DATE, hourly },
    ])
    expect(event).toMatchObject({ start: 17, end: 20 })
    expect(event.description).toContain('17:00–20:00')
  })

  it('ends at the last hourly sample in the morning notification', () => {
    const message = buildMessage({ activities: [evening], skinType: 'fair' }, hourly, DATE)
    expect(message.title).toBe('🚶 Walk: 5pm to 8pm')
  })

  it('drops a window that would start at the last sample', () => {
    const lastHourOnly = hourly.map(h => ({ ...h, uv: h.hour === 20 ? 2 : 9 }))
    const brief = { ...evening, durationMins: 0 }
    expect(planActivityDay(lastHourOnly, brief, 'fair').windows).toEqual([])
    expect(getSafeWindowsForActivity(lastHourOnly, brief)).toEqual([])
    expect(
      sun.buildSunEvents({ activities: [brief] }, [{ dateStr: DATE, hourly: lastHourOnly }]),
    ).toEqual([])
  })
})
