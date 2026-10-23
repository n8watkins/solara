import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CURRENT_READING_MAX_AGE_MS,
  dayLabel,
  fetchForecast,
  forecastView,
  parseForecast,
  weatherLabel,
} from '@/lib/forecast'
import { addDays, zonedNow } from '@/lib/time'
import type { Location } from '@/lib/types'
import { withDeviceZones } from './test-zones'

const loc: Location = { lat: 34, lon: -118, city: 'LA', region: 'CA' }
const TZ = 'America/Los_Angeles'
const FIRST_DAY = '2026-06-15'
// 10:30 in Los Angeles on FIRST_DAY.
const NOW_MS = Date.parse('2026-06-15T10:30:00-07:00')

// A raw Open-Meteo payload for `days` days, 24 hours each, local to TZ.
function rawPayload(days: number, timezone: string | null = TZ) {
  const time: string[] = []
  const uv_index: number[] = []
  const temperature_2m: number[] = []
  const weathercode: number[] = []
  const cloudcover: number[] = []
  for (let d = 0; d < days; d++) {
    const ds = addDays(FIRST_DAY, d)
    for (let h = 0; h < 24; h++) {
      time.push(`${ds}T${String(h).padStart(2, '0')}:00`)
      uv_index.push(h) // uv == hour, easy to assert
      temperature_2m.push(20.04) // stored as 20.0 °C
      weathercode.push(0)
      cloudcover.push(h * 4) // 0..92
    }
  }
  return {
    ...(timezone ? { timezone } : {}),
    current: { uv_index: 5, temperature_2m: 25, weathercode: 3 },
    hourly: { time, uv_index, temperature_2m, weathercode, cloudcover },
  }
}

describe('weatherLabel', () => {
  it('maps WMO codes to labels', () => {
    expect(weatherLabel(0)).toBe('Clear')
    expect(weatherLabel(2)).toBe('Partly cloudy')
    expect(weatherLabel(61)).toBe('Rainy')
    expect(weatherLabel(95)).toBe('Stormy')
  })
})

describe('parseForecast', () => {
  it('keeps only daytime hours 06–20, in Celsius, with cloudCover', () => {
    const r = parseForecast(rawPayload(2), { fetchedAt: NOW_MS })
    expect(r.timezone).toBe(TZ)
    expect(r.fetchedAt).toBe(NOW_MS)
    expect(r.days).toHaveLength(2)
    const hours = r.days[0]!.hourly.map(h => h.hour)
    expect(Math.min(...hours)).toBe(6)
    expect(Math.max(...hours)).toBe(20)
    const noon = r.days[0]!.hourly.find(h => h.hour === 12)!
    expect(noon.uv).toBe(12)
    expect(noon.tempC).toBe(20)
    expect(noon.cloudCover).toBe(48) // 12 * 4
    expect(r.current).toEqual({ uv: 5, tempC: 25, condition: 'Partly cloudy' })
  })

  it('limits to `days`', () => {
    expect(parseForecast(rawPayload(10), { days: 3 }).days).toHaveLength(3)
  })

  it('uses the location zone when the response names none, else the device zone', () => {
    expect(parseForecast(rawPayload(1, null), { timeZone: 'Asia/Tokyo' }).timezone).toBe(
      'Asia/Tokyo',
    )
    expect(parseForecast(rawPayload(1, null), { timeZone: 'Not/AZone' }).timezone).toBe(
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    )
  })

  it('omits cloudCover when the provider does not return it', () => {
    const raw = rawPayload(1)
    delete (raw.hourly as { cloudcover?: number[] }).cloudcover
    const r = parseForecast(raw, { days: 1 })
    expect(r.days[0]!.hourly[0]!.cloudCover).toBeUndefined()
  })
})

describe('forecastView', () => {
  const data = parseForecast(rawPayload(10), { fetchedAt: NOW_MS })

  it('picks today and tomorrow by the location date and labels days from it', () => {
    const view = forecastView(data, zonedNow(TZ, NOW_MS))
    expect(view.now).toMatchObject({ date: FIRST_DAY, hour: 10, minute: 30 })
    expect(view.forecast.map(d => d.label).slice(0, 3)).toEqual([
      'Today',
      'Tomorrow',
      'Wed, Jun 17',
    ])
    expect(view.today).toBe(view.forecast[0]!.hourly)
    expect(view.tomorrow).toBe(view.forecast[1]!.hourly)
  })

  it('rolls over at the location midnight: yesterday drops out', () => {
    const afterMidnight = Date.parse('2026-06-16T00:01:00-07:00')
    const view = forecastView(data, zonedNow(TZ, afterMidnight))
    expect(view.forecast[0]).toMatchObject({ dateStr: '2026-06-16', label: 'Today' })
    expect(view.forecast[1]).toMatchObject({ dateStr: '2026-06-17', label: 'Tomorrow' })
    expect(view.forecast).toHaveLength(9)
  })

  it('stops presenting an old reading as current', () => {
    const fresh = forecastView(data, zonedNow(TZ, NOW_MS + CURRENT_READING_MAX_AGE_MS))
    expect(fresh.current).toEqual(data.current)
    // Two hours later the 12:00 forecast hour stands in for "now".
    const later = forecastView(data, zonedNow(TZ, NOW_MS + 2 * 3_600_000))
    expect(later.current).toEqual({ uv: 12, tempC: 20, condition: 'Clear' })
  })

  it('has no today when the whole forecast is in the past', () => {
    const view = forecastView(data, zonedNow(TZ, Date.parse('2026-07-01T09:00:00-07:00')))
    expect(view.forecast).toEqual([])
    expect(view.today).toEqual([])
  })

  it('does not depend on the device time zone', () => {
    const results = withDeviceZones(() => {
      const parsed = parseForecast(rawPayload(3, null), {
        timeZone: TZ,
        fetchedAt: NOW_MS,
      })
      const view = forecastView(parsed, zonedNow(parsed.timezone, NOW_MS))
      return {
        now: view.now,
        labels: view.forecast.map(d => `${d.dateStr} ${d.label}`),
        todayHours: view.today.map(h => h.hour),
        current: view.current,
      }
    })
    expect(results.UTC).toEqual(results['America/Los_Angeles'])
    expect(results['Asia/Tokyo']).toEqual(results['America/Los_Angeles'])
    expect(results.UTC!.labels[0]).toBe('2026-06-15 Today')
  })
})

describe('dayLabel', () => {
  it('names today and tomorrow, then short dates, across month ends', () => {
    expect(dayLabel('2026-06-30', '2026-06-30')).toBe('Today')
    expect(dayLabel('2026-07-01', '2026-06-30')).toBe('Tomorrow')
    expect(dayLabel('2026-07-02', '2026-06-30')).toBe('Thu, Jul 2')
  })
})

describe('fetchForecast', () => {
  afterEach(() => vi.restoreAllMocks())

  it('requests cloudcover and the right day count, then parses', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => rawPayload(5) })
    vi.stubGlobal('fetch', fetchMock)
    const r = await fetchForecast(loc, { days: 5 })
    const url = fetchMock.mock.calls[0]![0] as string
    expect(url).toContain('cloudcover')
    expect(url).toContain('timezone=auto')
    expect(url).toContain('forecast_days=5')
    expect(r.days.length).toBe(5)
  })

  it('throws on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))
    await expect(fetchForecast(loc)).rejects.toThrow()
  })
})
