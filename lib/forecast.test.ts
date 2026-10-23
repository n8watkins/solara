import { describe, it, expect, vi, afterEach } from 'vitest'
import { parseForecast, weatherLabel, fetchForecast } from '@/lib/forecast'
import type { Location } from '@/lib/types'

const loc: Location = { lat: 34, lon: -118, city: 'LA', region: 'CA' }

// Build a raw Open-Meteo payload for `days` days, 24 hours each, starting today.
function rawPayload(days: number) {
  const time: string[] = []
  const uv_index: number[] = []
  const temperature_2m: number[] = []
  const weathercode: number[] = []
  const cloudcover: number[] = []
  const base = new Date()
  base.setHours(0, 0, 0, 0)
  for (let d = 0; d < days; d++) {
    const day = new Date(base)
    day.setDate(base.getDate() + d)
    const ds = day.toLocaleDateString('en-CA')
    for (let h = 0; h < 24; h++) {
      time.push(`${ds}T${String(h).padStart(2, '0')}:00`)
      uv_index.push(h)            // uv == hour, easy to assert
      temperature_2m.push(20)     // 20°C → 68°F
      weathercode.push(0)
      cloudcover.push(h * 4)      // 0..92
    }
  }
  return { current: { uv_index: 5, temperature_2m: 25, weathercode: 3 }, hourly: { time, uv_index, temperature_2m, weathercode, cloudcover } }
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
  it('keeps only daytime hours 06–20 and carries cloudCover', () => {
    const r = parseForecast(rawPayload(2), 10)
    expect(r.forecast).toHaveLength(2)
    const hours = r.forecast[0]!.hourly.map(h => h.hour)
    expect(Math.min(...hours)).toBe(6)
    expect(Math.max(...hours)).toBe(20)
    const noon = r.forecast[0]!.hourly.find(h => h.hour === 12)!
    expect(noon.uv).toBe(12)
    expect(noon.tempF).toBe(68)
    expect(noon.cloudCover).toBe(48) // 12 * 4
  })

  it('labels today/tomorrow and limits to `days`', () => {
    const r = parseForecast(rawPayload(10), 3)
    expect(r.forecast).toHaveLength(3)
    expect(r.forecast[0]!.label).toBe('Today')
    expect(r.forecast[1]!.label).toBe('Tomorrow')
    expect(r.today.length).toBeGreaterThan(0)
  })

  it('omits cloudCover when the provider does not return it', () => {
    const raw = rawPayload(1)
    delete (raw.hourly as { cloudcover?: number[] }).cloudcover
    const r = parseForecast(raw, 1)
    expect(r.forecast[0]!.hourly[0]!.cloudCover).toBeUndefined()
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
    expect(url).toContain('forecast_days=5')
    expect(r.forecast.length).toBe(5)
  })

  it('throws on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))
    await expect(fetchForecast(loc)).rejects.toThrow()
  })
})
