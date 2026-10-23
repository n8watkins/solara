import { describe, expect, it } from 'vitest'
import {
  activityRunsOnDate,
  bestRecommendationWindow,
  burnMins,
  effectiveMaxUV,
  findRecommendationWindows,
} from '@/lib/recommendation'
import { getSafeWindowsForActivity } from '@/lib/calendar'
import { getActivityWindow } from '@/lib/weather'
import type { Activity, HourlyForecast, SkinType } from '@/lib/types'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const functionsEngine = require('../functions/lib/recommendation-engine')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const functionsSun = require('../functions/lib/sun')

const hourly: HourlyForecast[] = [
  { hour: 6, uv: 1, tempF: 60, condition: 'Clear' },
  { hour: 7, uv: 1.5, tempF: 62, condition: 'Clear' },
  { hour: 8, uv: 5, tempF: 65, condition: 'Clear' },
  { hour: 9, uv: 2, tempF: 67, condition: 'Cloudy' },
  { hour: 10, uv: 2.5, tempF: 68, condition: 'Cloudy' },
]

const activity: Activity = {
  id: 'walk',
  name: 'Walk',
  icon: '🚶',
  durationMins: 90,
  maxUV: 3,
  sunscreen: false,
  preferredHours: { from: 6, to: 10 },
  daysOfWeek: [1, 3, 5],
}

describe('shared recommendation engine contracts', () => {
  it('keeps effective UV and burn estimates identical in every runtime', () => {
    const variants = [
      activity,
      { ...activity, maxUV: 4, sunscreen: true },
      { ...activity, maxUV: 6, sunscreen: true },
    ]
    for (const variant of variants) {
      expect(effectiveMaxUV(variant)).toBe(functionsEngine.effectiveMaxUV(variant))
      expect(effectiveMaxUV(variant)).toBe(functionsSun.effectiveMaxUV(variant))
    }

    const skinTypes: SkinType[] = ['very-fair', 'fair', 'medium', 'olive', 'dark']
    for (const skinType of skinTypes) {
      for (const uv of [0, 0.4, 1, 3.7, 11]) {
        expect(burnMins(uv, skinType)).toBe(functionsEngine.burnMins(uv, skinType))
      }
    }
  })

  it('derives weekday restrictions from the date, independent of runtime locale', () => {
    const dates = [
      ['2026-05-29', true],
      ['2026-05-30', false],
      ['2026-06-01', true],
      ['not-a-date', false],
    ] as const
    for (const [dateStr, expected] of dates) {
      expect(activityRunsOnDate(activity, dateStr)).toBe(expected)
      expect(functionsSun.runsOn(activity, dateStr)).toBe(expected)
    }
  })

  it('keeps window boundaries, summaries, duration, and preferred hours in parity', () => {
    const clientWindows = findRecommendationWindows(
      hourly,
      effectiveMaxUV(activity),
      activity.durationMins,
      activity.preferredHours,
    )
    const functionWindows = functionsSun.safeWindows(
      hourly,
      functionsSun.effectiveMaxUV(activity),
      activity.durationMins,
      activity,
    )

    expect(clientWindows).toEqual(functionWindows)
    expect(clientWindows).toEqual([{ from: 6, to: 8, label: 'Morning', peakUV: 1.5, avgUV: 1.3 }])
    expect(getSafeWindowsForActivity(hourly, activity)).toEqual([{ from: 6, to: 8, peakUV: 1.5 }])
    expect(getActivityWindow(hourly, activity, 6, 'fair').allWindows).toEqual(clientWindows)
  })

  it('uses the same lowest-average-UV best-window tie breaking', () => {
    const maxUV = effectiveMaxUV(activity)
    expect(bestRecommendationWindow(hourly, maxUV, 60)).toEqual(
      functionsSun.bestWindow(hourly, maxUV, 60),
    )
  })
})
