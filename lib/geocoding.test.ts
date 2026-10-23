import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  locationFromCoordinates,
  resetReverseGeocodeCache,
  reverseGeocode,
  REVERSE_GEOCODE_MIN_INTERVAL_MS,
  roundCoordinate,
  searchLocation,
} from './geocoding'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('searchLocation', () => {
  it('returns a direct city result', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          {
            latitude: 34.1478,
            longitude: -118.1445,
            name: 'Pasadena',
            admin1: 'California',
            timezone: 'America/Los_Angeles',
          },
        ],
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(searchLocation(' Pasadena ')).resolves.toEqual({
      lat: 34.15,
      lon: -118.14,
      city: 'Pasadena',
      region: 'California',
      timezone: 'America/Los_Angeles',
    })
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('falls back to the city and matches a qualified region', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [
            {
              latitude: 29.6911,
              longitude: -95.2091,
              name: 'Pasadena',
              admin1: 'Texas',
              country: 'United States',
            },
            {
              latitude: 34.1478,
              longitude: -118.1445,
              name: 'Pasadena',
              admin1: 'California',
              country: 'United States',
            },
          ],
        }),
      })
    vi.stubGlobal('fetch', fetchMock)

    const result = await searchLocation('Pasadena, California')

    expect(result).toMatchObject({ city: 'Pasadena', region: 'California', lat: 34.15 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1]![0]).toContain('name=Pasadena')
    expect(fetchMock.mock.calls[1]![0]).toContain('count=10')
  })

  it('returns null when no location matches', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }))
    await expect(searchLocation('Not a real city')).resolves.toBeNull()
  })

  it('rejects qualified results from a different region', async () => {
    const texasResult = {
      latitude: 29.6911,
      longitude: -95.2091,
      name: 'Pasadena',
      admin1: 'Texas',
      country: 'United States',
    }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ results: [texasResult] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ results: [texasResult] }) })
    vi.stubGlobal('fetch', fetchMock)

    await expect(searchLocation('Pasadena, California')).resolves.toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('rejects fuzzy city matches from the requested region', async () => {
    const nearbyResult = {
      latitude: 45.5231,
      longitude: -122.6765,
      name: 'East Portland',
      admin1: 'Oregon',
    }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ results: [nearbyResult] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ results: [nearbyResult] }) })
    vi.stubGlobal('fetch', fetchMock)

    await expect(searchLocation('Portland, Oregon')).resolves.toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('matches region abbreviations without accepting substrings', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          { latitude: 38.5816, longitude: -121.4944, name: 'Portland', admin1: 'California' },
          { latitude: 45.5152, longitude: -122.6784, name: 'Portland', admin1: 'Oregon' },
        ],
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(searchLocation('Portland, OR')).resolves.toMatchObject({
      city: 'Portland',
      region: 'Oregon',
      lat: 45.52,
    })
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('rejects failed geocoding responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }))
    await expect(searchLocation('Pasadena')).rejects.toThrow('status 503')
  })
})

describe('roundCoordinate', () => {
  it('rounds to two decimals and never returns negative zero', () => {
    expect(roundCoordinate(34.147812)).toBe(34.15)
    expect(roundCoordinate(-118.144516)).toBe(-118.14)
    expect(Object.is(roundCoordinate(-0.001), 0)).toBe(true)
  })
})

function nominatimResponse(address: Record<string, string>) {
  return { ok: true, json: async () => ({ address }) }
}

describe('reverseGeocode', () => {
  beforeEach(() => {
    resetReverseGeocodeCache()
  })

  it('sends only rounded coordinates at city zoom', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(nominatimResponse({ city: 'Pasadena', state: 'California' }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(reverseGeocode(34.147812, -118.144516)).resolves.toEqual({
      city: 'Pasadena',
      region: 'California',
    })
    const url = new URL(fetchMock.mock.calls[0]![0] as string)
    expect(url.origin + url.pathname).toBe('https://nominatim.openstreetmap.org/reverse')
    expect(url.searchParams.get('lat')).toBe('34.15')
    expect(url.searchParams.get('lon')).toBe('-118.14')
    expect(url.searchParams.get('zoom')).toBe('10')
    expect(url.search).not.toContain('147812')
  })

  it('caches by rounded position and shares concurrent requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue(nominatimResponse({ town: 'Altadena' }))
    vi.stubGlobal('fetch', fetchMock)

    const [a, b] = await Promise.all([
      reverseGeocode(34.18901, -118.13102),
      reverseGeocode(34.18899, -118.13098),
    ])
    await reverseGeocode(34.189, -118.131)

    expect(a).toEqual({ city: 'Altadena', region: '' })
    expect(b).toBe(a)
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('spaces requests for different positions at least one second apart', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn().mockResolvedValue(nominatimResponse({ city: 'Somewhere' }))
    vi.stubGlobal('fetch', fetchMock)

    const first = reverseGeocode(10, 10)
    const second = reverseGeocode(20, 20)
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(REVERSE_GEOCODE_MIN_INTERVAL_MS)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await Promise.all([first, second])
  })

  it('falls back to a generic label on failure and retries later', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 429 })
      .mockResolvedValueOnce(nominatimResponse({ village: 'Sierra Madre', state: 'California' }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(reverseGeocode(34.16, -118.05)).resolves.toEqual({
      city: 'Your location',
      region: '',
    })
    vi.useFakeTimers()
    const retry = reverseGeocode(34.16, -118.05)
    await vi.advanceTimersByTimeAsync(REVERSE_GEOCODE_MIN_INTERVAL_MS)
    await expect(retry).resolves.toEqual({ city: 'Sierra Madre', region: 'California' })
  })
})

describe('locationFromCoordinates', () => {
  beforeEach(() => {
    resetReverseGeocodeCache()
  })

  it('stores rounded coordinates with the place name', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(nominatimResponse({ city: 'Pasadena', state: 'California' })),
    )

    await expect(locationFromCoordinates(34.147812, -118.144516)).resolves.toMatchObject({
      lat: 34.15,
      lon: -118.14,
      city: 'Pasadena',
      region: 'California',
    })
  })
})
