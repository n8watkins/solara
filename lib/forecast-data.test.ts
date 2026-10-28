import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { forecastView, parseForecast, type RawForecast } from '@/lib/forecast'
import { getActivityWindow } from '@/lib/weather'
import { getSafeWindowsForActivity } from '@/lib/calendar'
import { buildICS } from '@/lib/ics'
import type { Activity } from '@/lib/types'

/* eslint-disable @typescript-eslint/no-require-imports */
const engine = require('../functions/core')
const sun = require('../functions/lib/feed/sun')
const { alertDayHours } = require('../functions/lib/notifications/alerts')
/* eslint-enable @typescript-eslint/no-require-imports */

// Acceptance for CQ-1: Open-Meteo returns `null` for hours it has no data for.
// Those hours sit between two runs of low UV, so treating `null` as 0 (or
// bridging over the gap) would recommend the unknown midday hours as "lower UV".
const DATE = '2026-06-15'
const NOW = new Date(`${DATE}T12:00:00Z`) // the same calendar date in every timezone from -11 to +11
const UNKNOWN_FROM = 10
const UNKNOWN_TO = 15 // exclusive

function uvAt(hour: number): number | null {
  if (hour >= UNKNOWN_FROM && hour < UNKNOWN_TO) return null
  return hour < UNKNOWN_FROM ? 1 : 2
}

function rawWithGap(): RawForecast & { timezone: string } {
  const time: string[] = []
  for (let hour = 0; hour < 24; hour++) time.push(`${DATE}T${String(hour).padStart(2, '0')}:00`)
  return {
    timezone: 'UTC',
    current: { time: `${DATE}T08:00`, uv_index: null, temperature_2m: 21, weathercode: 1 },
    hourly: {
      time,
      uv_index: time.map((_, hour) => uvAt(hour)),
      temperature_2m: time.map(() => 20),
      weathercode: time.map(() => 0),
      cloudcover: time.map(() => null),
    },
  }
}

const walk: Activity = {
  id: 'walk',
  name: 'Walk',
  icon: '🚶',
  durationMins: 60,
  maxUV: 3,
  sunscreen: false,
}

function touchesUnknownHours(window: { from: number; to: number }) {
  return window.from < UNKNOWN_TO && window.to > UNKNOWN_FROM
}

function okJson(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as unknown as Response
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  sun.clearLastGoodForecasts()
})

describe('null UV gaps never produce a recommendation', () => {
  it('app: parsed hours omit the gap and no window covers it', () => {
    const weather = forecastView(parseForecast(rawWithGap(), { days: 1 }))
    const hours = weather.today.map(h => h.hour)
    expect(hours).toEqual([6, 7, 8, 9, 15, 16, 17, 18, 19, 20])
    expect(weather.today.every(h => h.uv > 0)).toBe(true)

    const dashboard = getActivityWindow(weather.today, walk, 12)
    expect(dashboard.safeNow).toBe(false)
    expect(dashboard.allWindows.map(w => [w.from, w.to])).toEqual([
      [6, 10],
      [15, 20],
    ])
    expect(dashboard.allWindows.some(touchesUnknownHours)).toBe(false)

    const calendar = getSafeWindowsForActivity(weather.forecast[0]!.hourly, walk)
    expect(calendar.length).toBeGreaterThan(0)
    expect(calendar.some(touchesUnknownHours)).toBe(false)
  })

  it('app: current UV falls back to the hourly value, never to 0', () => {
    const raw = rawWithGap()
    raw.current = { time: `${DATE}T08:00`, uv_index: null, temperature_2m: null, weathercode: 3 }
    const weather = parseForecast(raw, { days: 1 })
    expect(weather.current).toEqual({ uv: 1, tempC: 20, condition: 'Partly cloudy' })

    raw.current = { time: `${DATE}T12:00`, uv_index: null, temperature_2m: 21, weathercode: 3 }
    expect(() => parseForecast(raw, { days: 1 })).toThrow(/no current UV/)
  })

  it('app: without a current time, the fallback hour is read in the forecast zone', () => {
    const raw = rawWithGap()
    raw.current = { uv_index: null, temperature_2m: null, weathercode: 3 }
    // NOW is 12:00 UTC, inside the gap; in Los Angeles it is 05:00, before it.
    expect(() => parseForecast(raw, { days: 1 })).toThrow(/no current UV/)
    raw.timezone = 'America/Los_Angeles'
    expect(parseForecast(raw, { days: 1 }).current.uv).toBe(1)
  })

  it('feed: the calendar feed has no event in the gap', async () => {
    const fetchImpl = vi.fn(async () => okJson(rawWithGap()))
    const forecast = await sun.fetchForecast(34, -118, 1, { fetchImpl })
    expect(forecast[0].hourly.map((h: { hour: number }) => h.hour)).toEqual([
      6, 7, 8, 9, 15, 16, 17, 18, 19, 20,
    ])
    const events = sun.buildSunEvents({ activities: [walk] }, forecast)
    expect(events).toHaveLength(1)
    expect(events[0].start).toBe(6)
    expect(events[0].description).toContain('6:00–10:00')
    expect(buildICS(events, NOW)).toContain('DTSTART:20260615T060000')
  })

  it('alerts: the morning alert never names a window across the gap', () => {
    const hourly = alertDayHours(engine.parseOpenMeteoResponse(rawWithGap()), DATE)
    expect(hourly.map((h: { hour: number }) => h.hour)).toEqual([
      6, 7, 8, 9, 15, 16, 17, 18, 19, 20,
    ])
    const message = engine.morningAlertMessage({
      date: DATE,
      city: 'Los Angeles',
      hourly,
      activities: [walk],
      skinType: 'fair',
    })
    expect(message.title).toBe('🚶 Walk: 6am to 10am')
  })
})

describe('findWindows', () => {
  it('never qualifies an hour without a finite UV', () => {
    const hourly = [
      { hour: 9, uv: 1 },
      { hour: 10, uv: null },
      { hour: 11, uv: Number.NaN },
      { hour: 12, uv: 1, planningUV: Number.NaN },
      { hour: 13, uv: 1 },
      // Windows end at the day's last sample, so the day continues past 13.
      { hour: 14, uv: 9 },
    ]
    expect(engine.findWindows(hourly, 3).map((w: { from: number }) => w.from)).toEqual([9, 13])
  })

  it('breaks a window where the hour sequence has a gap', () => {
    const hourly = [
      { hour: 8, uv: 1 },
      { hour: 9, uv: 1 },
      { hour: 12, uv: 1 },
      { hour: 13, uv: 1 },
      { hour: 14, uv: 9 },
    ]
    expect(
      engine.findWindows(hourly, 3).map((w: { from: number; to: number }) => [w.from, w.to]),
    ).toEqual([
      [8, 10],
      [12, 14],
    ])
    expect(engine.findWindows(hourly, 3, 180)).toEqual([])
  })

  it('still joins consecutive qualifying hours into one window', () => {
    const hourly = [...[6, 7, 8, 9].map(hour => ({ hour, uv: 1 })), { hour: 10, uv: 9 }]
    expect(engine.findWindows(hourly, 3, 240)).toEqual([
      { from: 6, to: 10, label: 'Morning', peakUV: 1, avgUV: 1 },
    ])
  })
})
