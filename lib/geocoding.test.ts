import { afterEach, describe, expect, it, vi } from 'vitest'
import { searchLocation } from './geocoding'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('searchLocation', () => {
  it('returns a direct city result', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [{ latitude: 34.1478, longitude: -118.1445, name: 'Pasadena', admin1: 'California', timezone: 'America/Los_Angeles' }],
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(searchLocation(' Pasadena ')).resolves.toEqual({
      lat: 34.1478,
      lon: -118.1445,
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
            { latitude: 29.6911, longitude: -95.2091, name: 'Pasadena', admin1: 'Texas', country: 'United States' },
            { latitude: 34.1478, longitude: -118.1445, name: 'Pasadena', admin1: 'California', country: 'United States' },
          ],
        }),
      })
    vi.stubGlobal('fetch', fetchMock)

    const result = await searchLocation('Pasadena, California')

    expect(result).toMatchObject({ city: 'Pasadena', region: 'California', lat: 34.1478 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1]![0]).toContain('name=Pasadena')
    expect(fetchMock.mock.calls[1]![0]).toContain('count=10')
  })

  it('returns null when no location matches', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }))
    await expect(searchLocation('Not a real city')).resolves.toBeNull()
  })

  it('rejects qualified results from a different region', async () => {
    const texasResult = { latitude: 29.6911, longitude: -95.2091, name: 'Pasadena', admin1: 'Texas', country: 'United States' }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ results: [texasResult] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ results: [texasResult] }) })
    vi.stubGlobal('fetch', fetchMock)

    await expect(searchLocation('Pasadena, California')).resolves.toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('rejects fuzzy city matches from the requested region', async () => {
    const nearbyResult = { latitude: 45.5231, longitude: -122.6765, name: 'East Portland', admin1: 'Oregon' }
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
      lat: 45.5152,
    })
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('rejects failed geocoding responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }))
    await expect(searchLocation('Pasadena')).rejects.toThrow('status 503')
  })
})
