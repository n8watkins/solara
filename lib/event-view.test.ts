import { describe, expect, it } from 'vitest'
import type { ImportedEvent } from '@solara/core/event-import'
import { durationText, eventCardView, type EventCardInput } from './event-view'
import { unitFormatters } from './units'
import type { HourlyForecast, WeatherResponse } from './types'

const LA = 'America/Los_Angeles'
const NOW = Date.parse('2026-06-15T17:30:00Z')
const UV = [0.2, 1, 2.5, 4.5, 6.5, 8.2, 9.4, 9, 7.6, 5.6, 3.4, 1.6, 0.6, 0.1, 0]
const hours = (date: string): HourlyForecast[] =>
  UV.map((uv, i) => ({ date, hour: 6 + i, uv, tempC: 24, condition: 'Clear' }))

const weather = {
  timezone: LA,
  now: { timeZone: LA, date: '2026-06-15', hour: 10, minute: 30, epochMs: NOW },
  current: { uv: 6.5, tempC: 24, condition: 'Clear' },
  today: hours('2026-06-15'),
  tomorrow: hours('2026-06-16'),
  forecast: ['2026-06-15', '2026-06-16', '2026-06-17'].map((dateStr, i) => ({
    dateStr,
    label: ['Today', 'Tomorrow', 'Wed, Jun 17'][i]!,
    hourly: hours(dateStr),
  })),
} as WeatherResponse

const item = (start: string, end: string): ImportedEvent => ({
  key: 'a'.repeat(32),
  source: 'file',
  seriesId: 'fedcba9876543210fedcba9876543210',
  title: 'Saturday 10K',
  start,
  end,
  timeZone: LA,
  where: '',
  lat: 34.05,
  lon: -118.24,
  placeLabel: 'Los Angeles, California',
  placeGuessed: true,
  activityId: '',
  url: '',
  createdAt: '2026-06-15T17:30:00.000Z',
  updatedAt: '2026-06-15T17:30:00.000Z',
})

const base: Omit<EventCardInput, 'item'> = {
  weather,
  activity: null,
  skinType: 'fair',
  mostSensitive: null,
  planDays: 2,
  nowMs: NOW,
  fmt: unitFormatters({ temperature: 'fahrenheit', clock: '12h' }),
}

describe('eventCardView', () => {
  it('describes a long midday event: peak, burn, sunscreen and reapplying', () => {
    // Tomorrow 9am-2pm in Los Angeles.
    const view = eventCardView({
      ...base,
      item: item('2026-06-16T16:00:00.000Z', '2026-06-16T21:00:00.000Z'),
    })
    expect(view).toMatchObject({
      when: 'Tomorrow · 9am – 2pm',
      badge: { value: '9.4', label: 'Very high', band: 'very-high' },
      peak: 'Peak UV 9.4 at 12pm · average 7.5',
      burn: 'Unprotected, fair skin could burn in about 16 min at the peak; the event lasts 5 h.',
      sunscreen:
        'Sunscreen: apply 8:30am – 8:45am, reapply at 11am and 1pm, and after swimming or heavy sweating.',
      later: null,
    })
  })

  it('names the most sensitive person in group mode and applies the activity setting', () => {
    const view = eventCardView({
      ...base,
      item: item('2026-06-16T19:00:00.000Z', '2026-06-16T19:30:00.000Z'),
      activity: {
        id: 'run',
        name: 'Running',
        icon: '🏃',
        durationMins: 45,
        maxUV: 4,
        sunscreen: false,
        shade: 'full',
      },
      skinType: 'very-fair',
      mostSensitive: { name: 'Mia' },
    })
    expect(view.exposure).toBe('Mostly shade · 50% of forecast UV')
    expect(view.badge?.value).toBe('4.7')
    expect(view.burn).toBe(
      'Unprotected, Mia (very fair skin, the most sensitive) could burn in about 21 min at the peak; the event lasts 30 min.',
    )
    expect(view.sunscreen).toBe(
      'Sunscreen: apply 11:30am – 11:45am; reapply after swimming or heavy sweating.',
    )
  })

  it('skips sunscreen and burn for an evening with little UV', () => {
    const view = eventCardView({
      ...base,
      item: item('2026-06-16T02:00:00.000Z', '2026-06-16T03:30:00.000Z'),
    })
    expect(view).toMatchObject({ when: 'Today · 7pm – 8:30pm', sunscreen: null })
    expect(view.peak).toBe('UV stays near 0 during the event.')
    expect(view.burn).toBeNull()
  })

  it('shows an event across midnight with both days', () => {
    const view = eventCardView({
      ...base,
      item: item('2026-06-16T06:00:00.000Z', '2026-06-16T08:00:00.000Z'),
    })
    expect(view.when).toBe('Today · 11pm – Tomorrow 1am')
  })

  it('says when an event past the plan becomes live', () => {
    const view = eventCardView({
      ...base,
      item: item('2026-06-20T15:00:00.000Z', '2026-06-20T16:30:00.000Z'),
    })
    expect(view).toMatchObject({
      when: 'Sat, Jun 20 · 8am – 9:30am',
      later: 'Forecast from Fri, Jun 19',
      badge: null,
      burn: null,
    })
  })

  it('shows only when while the forecast loads', () => {
    const view = eventCardView({
      ...base,
      weather: null,
      item: item('2026-06-16T16:00:00.000Z', '2026-06-16T17:00:00.000Z'),
    })
    expect(view).toMatchObject({ when: 'Tomorrow · 9am – 10am', uv: null, later: null })
  })

  it('formats durations', () => {
    expect(durationText(45 * 60_000)).toBe('45 min')
    expect(durationText(120 * 60_000)).toBe('2 h')
    expect(durationText(90 * 60_000)).toBe('1 h 30 min')
  })
})
