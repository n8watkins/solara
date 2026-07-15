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
    expect(fetchMock.mock.calls[1][0]).toContain('name=Pasadena')
    expect(fetchMock.mock.calls[1][0]).toContain('count=10')
  })

  it('returns null when no location matches', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }))
    await expect(searchLocation('Not a real city')).resolves.toBeNull()
  })

  it('rejects failed geocoding responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }))
    await expect(searchLocation('Pasadena')).rejects.toThrow('status 503')
  })
})
