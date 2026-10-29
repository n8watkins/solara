import { solaraForecastProxy } from '@solara/core'
import { describe, expect, it, vi } from 'vitest'
import {
  ONBOARDING_BACK,
  ONBOARDING_PROGRESS,
  SKIN_OPTIONS,
  fetchCurrentUV,
  geolocationErrorMessage,
  setupBurnMinutes,
  setupBurnNote,
  setupBurnUV,
} from './onboarding'

function respond(body: unknown, status = 200) {
  return vi.fn<typeof fetch>(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
  )
}

describe('fetchCurrentUV', () => {
  it('asks Open-Meteo for the current UV at the location and rounds to one decimal', async () => {
    const fetchImpl = respond({ current: { uv_index: 6.437 } })
    await expect(fetchCurrentUV({ lat: 34.15, lon: -118.14 }, fetchImpl)).resolves.toBe(6.4)
    const url = new URL(String(fetchImpl.mock.calls[0]?.[0]))
    expect(url.origin).toBe('https://api.open-meteo.com')
    expect(url.searchParams.get('latitude')).toBe('34.15')
    expect(url.searchParams.get('longitude')).toBe('-118.14')
    expect(url.searchParams.get('current')).toBe('uv_index')
  })

  it('asks the forecast proxy instead when the build uses it', async () => {
    const fetchImpl = respond({
      current: { uv_index: 6.437 },
      hourly: { time: ['2026-10-27T12:00'], uv_index: [6.4] },
    })
    const proxy = async () => solaraForecastProxy('https://fn.example.com', 'app-check-token')
    await expect(fetchCurrentUV({ lat: 34.1512, lon: -118.1437 }, fetchImpl, proxy)).resolves.toBe(
      6.4,
    )
    const [requested, init] = fetchImpl.mock.calls[0] ?? []
    const url = new URL(String(requested))
    expect(url.origin + url.pathname).toBe('https://fn.example.com/forecast')
    expect(url.searchParams.get('lat')).toBe('34.15')
    expect(url.searchParams.get('lon')).toBe('-118.14')
    expect(init?.headers).toEqual({ 'X-Firebase-AppCheck': 'app-check-token' })
    // Never the free API once the proxy is on.
    const hosts = fetchImpl.mock.calls.map(([u]) => new URL(String(u)).hostname)
    expect(hosts.some(host => host === 'open-meteo.com' || host.endsWith('.open-meteo.com'))).toBe(
      false,
    )
  })

  it('accepts a UV of zero at night', async () => {
    await expect(
      fetchCurrentUV({ lat: 0, lon: 0 }, respond({ current: { uv_index: 0 } })),
    ).resolves.toBe(0)
  })

  it('rejects a failed request or a response without a usable value', async () => {
    await expect(fetchCurrentUV({ lat: 0, lon: 0 }, respond({}, 500))).rejects.toThrow()
    await expect(fetchCurrentUV({ lat: 0, lon: 0 }, respond({ current: {} }))).rejects.toThrow()
    await expect(
      fetchCurrentUV({ lat: 0, lon: 0 }, respond({ current: { uv_index: null } })),
    ).rejects.toThrow()
  })
})

describe('setup data', () => {
  it('offers every skin type, lightest first, with the engine burn times', () => {
    expect(SKIN_OPTIONS.map(o => [o.label, o.burnTime])).toEqual([
      ['Very fair', '~10 min'],
      ['Fair', '~15 min'],
      ['Medium', '~25 min'],
      ['Olive', '~35 min'],
      ['Dark', '~50 min'],
    ])
  })

  it('quotes the skin step burn times at the UV setup has just shown (REVIEW8 QA L3)', () => {
    // UV 8.2 on the preview: fair skin burns in about 18 minutes, as the dashboard says.
    expect(setupBurnUV(8.2)).toEqual({ uv: 8.2, live: true })
    expect(setupBurnMinutes('fair', 8.2)).toBe(18)
    expect(setupBurnNote(setupBurnUV(8.2))).toBe(
      'Times are rough minutes to a burn without sunscreen at UV 8.2, the UV right now.',
    )
    // A low or missing reading falls back to UV 10, and says so.
    for (const uv of [null, 0, 2.9]) expect(setupBurnUV(uv)).toEqual({ uv: 10, live: false })
    expect(setupBurnMinutes('fair', 10)).toBe(15)
    expect(setupBurnNote(setupBurnUV(null))).toBe(
      'Times are rough minutes to a burn without sunscreen at UV 10.0 (very high).',
    )
  })

  it('keeps the UV preview on the first progress step', () => {
    expect(ONBOARDING_PROGRESS).toEqual({ location: 1, uvpreview: 1, skin: 2, finish: 3 })
  })

  it('goes back one step from every step but the first', () => {
    expect(ONBOARDING_BACK).toEqual({
      location: null,
      uvpreview: 'location',
      skin: 'location',
      finish: 'skin',
    })
  })
})

describe('geolocationErrorMessage', () => {
  it('says why "Use my location" failed', () => {
    expect(geolocationErrorMessage(1)).toMatch(/turned off for this site/)
    expect(geolocationErrorMessage(2)).toMatch(/couldn't be found/)
    expect(geolocationErrorMessage(3)).toMatch(/took too long/)
    expect(geolocationErrorMessage(null)).toMatch(/can't share your location/)
  })
})
