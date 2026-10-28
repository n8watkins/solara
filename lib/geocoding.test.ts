import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  locationFromCoordinates,
  PLACE_SEARCH_MIN_INTERVAL_MS,
  resetPlaceSearchCache,
  resetReverseGeocodeCache,
  reverseGeocode,
  REVERSE_GEOCODE_MIN_INTERVAL_MS,
  roundCoordinate,
  searchLocation,
  searchPlaces,
} from './geocoding'

// The proxy path asks Firebase for an App Check token; nothing else here loads it.
vi.mock('./firebase', () => ({ appCheckToken: async () => 'app-check-token' }))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

beforeEach(() => {
  resetPlaceSearchCache()
})

/** Runs the one-second spacing between searches on fake time, then resolves. */
async function settle<T>(pending: Promise<T>): Promise<T> {
  await vi.runAllTimersAsync()
  return pending
}

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
    vi.useFakeTimers()
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

    const result = await settle(searchLocation('Pasadena, California'))

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
    vi.useFakeTimers()
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

    await expect(settle(searchLocation('Pasadena, California'))).resolves.toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('rejects fuzzy city matches from the requested region', async () => {
    vi.useFakeTimers()
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

    await expect(settle(searchLocation('Portland, Oregon'))).resolves.toBeNull()
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

  it('skips malformed results instead of returning a broken location', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          { latitude: '34.1', longitude: -118.1, name: 'Pasadena' },
          { latitude: 34.1478, longitude: -118.1445, name: '  ' },
          { latitude: 134.1, longitude: -118.1, name: 'Pasadena' },
          null,
          { latitude: 34.1478, longitude: -118.1445, name: 'Pasadena', admin1: 42 },
        ],
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(searchLocation('Pasadena')).resolves.toEqual({
      lat: 34.15,
      lon: -118.14,
      city: 'Pasadena',
      region: '',
    })
  })

  it('rejects a response that does not have the documented shape', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ results: 'none' }) }),
    )
    await expect(searchLocation('Pasadena')).rejects.toThrow('unexpected response')
  })
})

function placeResponse(results: unknown[]) {
  return { ok: true, json: async () => ({ results }) }
}

const PASADENAS = [
  {
    latitude: 34.1478,
    longitude: -118.1445,
    name: 'Pasadena',
    admin1: 'California',
    country: 'United States',
    timezone: 'America/Los_Angeles',
  },
  {
    latitude: 29.6911,
    longitude: -95.2091,
    name: 'Pasadena',
    admin1: 'Texas',
    country: 'United States',
    timezone: 'America/Chicago',
  },
  {
    latitude: 29.6911,
    longitude: -95.2091,
    name: 'Pasadena',
    admin1: 'Texas',
    country: 'United States',
  },
  { latitude: -34.98, longitude: 138.58, name: 'Pasadena', admin1: 'South Australia' },
]

describe('searchPlaces', () => {
  it('offers rounded, distinct places with the region and country that tell them apart', async () => {
    const fetchMock = vi.fn().mockResolvedValue(placeResponse(PASADENAS))
    vi.stubGlobal('fetch', fetchMock)

    const suggestions = await searchPlaces('Pasadena')

    expect(suggestions).toEqual([
      {
        location: {
          lat: 34.15,
          lon: -118.14,
          city: 'Pasadena',
          region: 'California',
          timezone: 'America/Los_Angeles',
        },
        detail: 'California, United States',
      },
      {
        location: {
          lat: 29.69,
          lon: -95.21,
          city: 'Pasadena',
          region: 'Texas',
          timezone: 'America/Chicago',
        },
        detail: 'Texas, United States',
      },
      {
        location: { lat: -34.98, lon: 138.58, city: 'Pasadena', region: 'South Australia' },
        detail: 'South Australia',
      },
    ])
    const url = new URL(fetchMock.mock.calls[0]![0] as string)
    expect(url.searchParams.get('name')).toBe('Pasadena')
    expect(url.searchParams.get('count')).toBe('5')
  })

  it('answers an empty query without a request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(searchPlaces('  , ')).resolves.toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('caches each query for the session and shares concurrent searches', async () => {
    const fetchMock = vi.fn().mockResolvedValue(placeResponse(PASADENAS))
    vi.stubGlobal('fetch', fetchMock)

    const [a, b] = await Promise.all([searchPlaces('Pasadena'), searchPlaces(' pasadena ')])
    await searchPlaces('PASADENA')

    expect(b).toEqual(a)
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('sends at most one search per second', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn().mockResolvedValue(placeResponse(PASADENAS))
    vi.stubGlobal('fetch', fetchMock)

    const first = searchPlaces('Pas')
    const second = searchPlaces('Pasadena')
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(PLACE_SEARCH_MIN_INTERVAL_MS - 1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await Promise.all([first, second])
  })

  it('never sends a search that is cancelled while it waits for its turn', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn().mockResolvedValue(placeResponse(PASADENAS))
    vi.stubGlobal('fetch', fetchMock)

    await searchPlaces('Pa')
    const controller = new AbortController()
    const stale = searchPlaces('Pas', { signal: controller.signal })
    const staleResult = expect(stale).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort()
    await staleResult

    // The cancelled search left the slot free for the next one.
    const latest = searchPlaces('Pasadena')
    await vi.advanceTimersByTimeAsync(PLACE_SEARCH_MIN_INTERVAL_MS)
    await latest
    expect(
      fetchMock.mock.calls.map(([url]) => new URL(url as string).searchParams.get('name')),
    ).toEqual(['Pa', 'Pasadena'])
  })

  it('retries a search that failed', async () => {
    vi.useFakeTimers()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 429 })
      .mockResolvedValueOnce(placeResponse(PASADENAS))
    vi.stubGlobal('fetch', fetchMock)

    await expect(searchPlaces('Pasadena')).rejects.toThrow('status 429')
    const retry = searchPlaces('Pasadena')
    await vi.advanceTimersByTimeAsync(PLACE_SEARCH_MIN_INTERVAL_MS)
    await expect(retry).resolves.toHaveLength(3)
  })

  it('narrows "city, region" to that region', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(placeResponse(PASADENAS)))
    const suggestions = await searchPlaces('Pasadena, TX')
    expect(suggestions.map(s => s.detail)).toEqual(['Texas, United States'])
  })
})

describe('roundCoordinate', () => {
  it('rounds to two decimals and never returns negative zero', () => {
    expect(roundCoordinate(34.147812)).toBe(34.15)
    expect(roundCoordinate(-118.144516)).toBe(-118.14)
    expect(Object.is(roundCoordinate(-0.001), 0)).toBe(true)
  })
})

function nominatimResponse(address: Record<string, unknown>) {
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
    // A browser cannot set User-Agent, so the Referer (origin only) identifies the app.
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ referrerPolicy: 'strict-origin' })
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

  it('ignores address parts that are not text', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(nominatimResponse({ city: 7, town: 'Altadena', state: ['CA'] })),
    )
    await expect(reverseGeocode(34.19, -118.13)).resolves.toEqual({
      city: 'Altadena',
      region: '',
    })
  })

  it('falls back to a generic label for a malformed response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [] }))
    await expect(reverseGeocode(34.2, -118.2)).resolves.toEqual({
      city: 'Your location',
      region: '',
    })
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

describe('place search through the proxy', () => {
  it('asks the placeSearch Function with App Check once the forecast proxy is on', async () => {
    vi.stubEnv('NEXT_PUBLIC_FORECAST_PROXY', '1')
    vi.stubEnv('NEXT_PUBLIC_FUNCTIONS_URL', 'https://fn.example.com/project/us-central1/')
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          { latitude: 34.1478, longitude: -118.1445, name: 'Pasadena', admin1: 'California' },
        ],
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(searchLocation('Pasadena')).resolves.toMatchObject({ city: 'Pasadena' })
    const [url, init] = fetchMock.mock.calls[0] ?? []
    const requested = new URL(String(url))
    expect(requested.origin + requested.pathname).toBe(
      'https://fn.example.com/project/us-central1/placeSearch',
    )
    expect(requested.searchParams.get('name')).toBe('Pasadena')
    expect(requested.searchParams.get('count')).toBe('1')
    expect(init).toEqual({ headers: { 'X-Firebase-AppCheck': 'app-check-token' } })
    // Never the free API once the proxy is on.
    expect(String(url)).not.toContain('open-meteo.com')
  })
})
