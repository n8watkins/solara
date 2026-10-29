import { describe, expect, it } from 'vitest'
import {
  appForecastRequest,
  bestWindow,
  fetchProviderForecast,
  fetchServedForecast,
  findWindows,
  isValidFeedToken,
  parseHourlyRows,
  parseOpenMeteoResponse,
  parseServedForecast,
  solaraForecastProxy,
  summarizeWindow,
} from '@solara/core'

/** A 6am-8pm day with the given UV per hour. */
const day = (uvByHour: (hour: number) => number) =>
  Array.from({ length: 15 }, (_, i) => ({ hour: 6 + i, uv: uvByHour(6 + i) }))

const lowFrom = (start: number) => day(h => (h >= start ? 2 : 9))
const lowUntil = (end: number) => day(h => (h <= end ? 1 : 9))
const lowOnlyAt = (hour: number) => day(h => (h === hour ? 2 : 9))
const rising = day(h => h)

describe('findWindows', () => {
  it('ends the last window at the last hourly sample', () => {
    expect(findWindows(lowFrom(17), 3)).toEqual([
      { from: 17, to: 20, label: 'Evening', peakUV: 2, avgUV: 2 },
    ])
  })

  it('never offers a window that starts at the last sample', () => {
    expect(findWindows(lowOnlyAt(20), 3)).toEqual([])
  })

  it('applies the duration after the end is clipped', () => {
    expect(findWindows(lowFrom(18), 3, 120)).toEqual([
      { from: 18, to: 20, label: 'Evening', peakUV: 2, avgUV: 2 },
    ])
    expect(findWindows(lowFrom(18), 3, 121)).toEqual([])
    expect(bestWindow(lowFrom(18), 3, 180)).toBeNull()
  })

  it('keeps windows that end before the last sample unchanged', () => {
    expect(findWindows(lowUntil(9), 3)).toEqual([
      { from: 6, to: 10, label: 'Morning', peakUV: 1, avgUV: 1 },
    ])
  })
})

describe('summarizeWindow', () => {
  it('includes the hour a fractional start falls in', () => {
    expect(summarizeWindow(rising, 9.5, 11)).toEqual({
      from: 9.5,
      to: 11,
      label: 'Morning',
      peakUV: 10,
      avgUV: 9.5,
    })
  })
})

describe('Open-Meteo parsing', () => {
  it('rejects a response without an hourly time axis', () => {
    expect(() => parseOpenMeteoResponse(null)).toThrow(/incomplete/)
    expect(() => parseOpenMeteoResponse({ hourly: { time: 'x' } })).toThrow(/incomplete/)
  })

  it('reads malformed values as unknown instead of failing the forecast', () => {
    const parsed = parseOpenMeteoResponse({
      timezone: 42,
      current: 'bad',
      hourly: {
        time: ['2026-06-15T10:00', 7],
        uv_index: [Number.POSITIVE_INFINITY, 'x'],
        temperature_2m: 'not a series',
        weathercode: [1.5],
      },
    })
    expect(parsed.timezone).toBeUndefined()
    expect(parsed.current).toBeUndefined()
    expect(parsed.hourly.uv_index).toEqual([null, null])
    expect(parsed.hourly.temperature_2m).toBeUndefined()
    expect(parseHourlyRows(parsed)).toEqual([
      {
        date: '2026-06-15',
        hour: 10,
        uv: null,
        clearSkyUV: null,
        tempF: null,
        weatherCode: 1.5,
        cloudCover: null,
        rainChance: null,
        feelsC: null,
      },
    ])
  })
})

describe("the forecast proxy's earlier copy", () => {
  const forecast = { timezone: 'America/Los_Angeles', hourly: { time: ['2026-06-15T10:00'] } }
  const marker = { stale: true, fetchedAt: '2026-06-15T16:40:00.000Z' }
  const proxy = solaraForecastProxy('https://fn.example.com', 'token')
  const REQUEST = appForecastRequest(34, -118)
  const answering = (body: unknown) => async () => new Response(JSON.stringify(body))

  it('keeps the stale marker and when the copy was fetched', async () => {
    expect(parseServedForecast({ ...forecast, ...marker })).toMatchObject(marker)
    const served = await fetchServedForecast(proxy, REQUEST, {
      fetchImpl: answering({ ...forecast, ...marker }),
    })
    expect(served).toMatchObject(marker)
  })

  it("reads a fresh answer exactly like Open-Meteo's", () => {
    const served = parseServedForecast(forecast)
    expect(served).toEqual(parseOpenMeteoResponse(forecast))
    expect(Object.keys(served)).not.toContain('stale')
    expect(Object.keys(served)).not.toContain('fetchedAt')
  })

  it('drops a marker that is incomplete or malformed', () => {
    for (const bad of [
      { stale: true },
      { fetchedAt: marker.fetchedAt },
      { stale: 'yes', fetchedAt: marker.fetchedAt },
      { stale: true, fetchedAt: 'this morning' },
      { stale: true, fetchedAt: 1_750_000_000_000 },
    ]) {
      expect(parseServedForecast({ ...forecast, ...bad })).toEqual(parseOpenMeteoResponse(forecast))
    }
  })

  it('never passes the marker on from the upstream fetch the proxy itself makes', async () => {
    const upstream = await fetchProviderForecast(proxy, REQUEST, {
      fetchImpl: answering({ ...forecast, ...marker }),
    })
    expect(upstream).toEqual(parseOpenMeteoResponse(forecast))
  })
})

describe('feed token policy', () => {
  it('accepts server-minted and legacy tokens only', () => {
    expect(isValidFeedToken('A'.repeat(43))).toBe(true)
    expect(isValidFeedToken('A'.repeat(32))).toBe(true)
    expect(isValidFeedToken('A'.repeat(31))).toBe(false)
    expect(isValidFeedToken(`${'A'.repeat(42)}!`)).toBe(false)
    expect(isValidFeedToken(['A'.repeat(43)])).toBe(false)
  })
})
