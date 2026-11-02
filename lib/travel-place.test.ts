import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const geocoding = vi.hoisted(() => ({ namedLocationAt: vi.fn() }))
vi.mock('./geocoding', () => geocoding)
import { TRAVEL_NOT_NOW_MS } from '@solara/core/travel'
import { notNowFor, travelExport } from './travel-areas'
import { locationAlreadyAllowed, placeToOffer } from './travel-check'
import {
  clearTravel,
  readTravel,
  saveVisit,
  subscribeTravel,
  TRAVEL_KEY,
  travelOwner,
  visitSnapshot,
  writeTravel,
} from './travel-place'
import type { Location } from './types'

const LA: Location = {
  lat: 34.05,
  lon: -118.24,
  city: 'Los Angeles',
  region: 'California',
  timezone: 'America/Los_Angeles',
}
const MADRID: Location = {
  lat: 40.42,
  lon: -3.7,
  city: 'Madrid',
  region: 'Comunidad de Madrid',
  timezone: 'Europe/Madrid',
}
const SAN_DIEGO: Location = { lat: 32.72, lon: -117.16, city: 'San Diego', region: 'California' }
const NOW = Date.parse('2026-07-01T10:00:00Z')
const GUEST = travelOwner('')
const ALICE = travelOwner('alice')

let store: Map<string, string>

beforeEach(() => {
  store = new Map()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  })
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
  geocoding.namedLocationAt.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
  clearTravel()
})

describe('a visit on this device', () => {
  it('belongs to its owner: a guest and each account', () => {
    expect(travelOwner(null)).toBe('guest')
    expect(travelOwner('')).toBe('guest')
    expect(travelOwner('alice')).toBe('uid:alice')

    saveVisit(ALICE, MADRID, LA)
    expect(readTravel(ALICE).visit).toEqual(MADRID)
    expect(visitSnapshot(ALICE)).toEqual(MADRID)
    // Nobody else sees it, and a guest's visit replaces it.
    expect(readTravel(GUEST).visit).toBeNull()
    expect(readTravel(travelOwner('bob')).visit).toBeNull()
    saveVisit(GUEST, SAN_DIEGO, LA)
    expect(readTravel(ALICE).visit).toBeNull()
    expect(JSON.parse(store.get(TRAVEL_KEY)!)).toMatchObject({ owner: 'guest' })
  })

  it('ends when home is shown again, and leaves nothing behind', () => {
    saveVisit(GUEST, MADRID, LA)
    saveVisit(GUEST, { ...LA, lat: 34.051 }, LA)
    expect(readTravel(GUEST).visit).toBeNull()
    expect(store.has(TRAVEL_KEY)).toBe(false)
    saveVisit(GUEST, MADRID, LA)
    saveVisit(GUEST, null, LA)
    expect(store.has(TRAVEL_KEY)).toBe(false)
  })

  it('keeps the same snapshot until it changes, and tells subscribers', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeTravel(listener)
    saveVisit(GUEST, MADRID, LA)
    expect(listener).toHaveBeenCalledTimes(1)
    const first = visitSnapshot(GUEST)
    expect(visitSnapshot(GUEST)).toBe(first)
    saveVisit(GUEST, SAN_DIEGO, LA)
    expect(visitSnapshot(GUEST)).not.toBe(first)
    expect(visitSnapshot(GUEST)).toEqual(SAN_DIEGO)
    clearTravel()
    expect(visitSnapshot(GUEST)).toBeNull()
    unsubscribe()
    saveVisit(GUEST, MADRID, LA)
    expect(listener).toHaveBeenCalledTimes(3)
  })

  it('ignores anything stored out of shape', () => {
    for (const raw of [
      '{not json',
      '[]',
      JSON.stringify({ visit: MADRID }),
      JSON.stringify({ owner: 'guest', visit: { ...MADRID, lat: 91 } }),
      JSON.stringify({ owner: 'guest', visit: { ...MADRID, lat: 40.4168 } }),
      JSON.stringify({ owner: 'guest', visit: { ...MADRID, city: '' } }),
      JSON.stringify({ owner: 'guest', visit: { ...MADRID, extra: true } }),
    ]) {
      store.set(TRAVEL_KEY, raw)
      clearTravel()
      store.set(TRAVEL_KEY, raw)
      expect(readTravel(GUEST).visit).toBeNull()
    }
    store.set(
      TRAVEL_KEY,
      JSON.stringify({
        owner: 'guest',
        notNow: [{ lat: 1, lon: 2, until: NOW + 1 }, { lat: 'x' }, null, { lat: 1, lon: 200 }],
      }),
    )
    expect(readTravel(GUEST).notNow).toEqual([{ lat: 1, lon: 2, until: NOW + 1 }])
  })
})

describe('"Not now"', () => {
  it('keeps the area of the place at one decimal for a day', () => {
    notNowFor(GUEST, MADRID, NOW)
    expect(readTravel(GUEST).notNow).toEqual([
      { lat: 40.4, lon: -3.7, until: NOW + TRAVEL_NOT_NOW_MS },
    ])
    // A visit and the areas live side by side.
    saveVisit(GUEST, MADRID, LA)
    expect(readTravel(GUEST).notNow).toHaveLength(1)
    // An area that has ended is dropped on the next write.
    notNowFor(GUEST, SAN_DIEGO, NOW + TRAVEL_NOT_NOW_MS)
    expect(readTravel(GUEST).notNow).toEqual([
      { lat: 32.7, lon: -117.2, until: NOW + 2 * TRAVEL_NOT_NOW_MS },
    ])
  })

  it('is in the data download with the visit, as dates', () => {
    expect(travelExport(ALICE, NOW)).toBeNull()
    saveVisit(ALICE, MADRID, LA)
    notNowFor(ALICE, SAN_DIEGO, NOW)
    expect(travelExport(ALICE, NOW)).toEqual({
      visit: MADRID,
      notNow: [{ lat: 32.7, lon: -117.2, until: '2026-07-02T10:00:00.000Z' }],
    })
    expect(travelExport(GUEST, NOW)).toBeNull()
  })
})

describe('the travel check', () => {
  function grant(state: PermissionState | 'unsupported', position?: { lat: number; lon: number }) {
    const getCurrentPosition = vi.fn(
      (ok: PositionCallback, fail: PositionErrorCallback, options?: PositionOptions) => {
        void options
        if (position) ok({ coords: { latitude: position.lat, longitude: position.lon } } as never)
        else fail({ code: 2 } as never)
      },
    )
    vi.stubGlobal('navigator', {
      geolocation: { getCurrentPosition },
      ...(state === 'unsupported'
        ? {}
        : { permissions: { query: vi.fn(async () => ({ state })) } }),
    })
    return getCurrentPosition
  }

  it('never reads the position without permission already granted', async () => {
    for (const state of ['prompt', 'denied', 'unsupported'] as const) {
      const getCurrentPosition = grant(state, MADRID)
      expect(await locationAlreadyAllowed()).toBe(false)
      expect(await placeToOffer({ owner: GUEST, shown: LA, places: [LA], now: NOW })).toBeNull()
      expect(getCurrentPosition).not.toHaveBeenCalled()
    }
  })

  it('reads a recent, low-accuracy position once permission is granted', async () => {
    const getCurrentPosition = grant('granted', { lat: 34.06, lon: -118.3 })
    expect(await placeToOffer({ owner: GUEST, shown: LA, places: [LA], now: NOW })).toBeNull()
    expect(getCurrentPosition).toHaveBeenCalledTimes(1)
    expect(getCurrentPosition.mock.calls[0]?.[2]).toEqual({
      enableHighAccuracy: false,
      maximumAge: 600000,
      timeout: 15000,
    })
    expect(geocoding.namedLocationAt).not.toHaveBeenCalled()
  })

  it('offers the place a lookup names when far from every saved place', async () => {
    grant('granted', { lat: 40.4168, lon: -3.7038 })
    geocoding.namedLocationAt.mockResolvedValue(MADRID)
    expect(await placeToOffer({ owner: GUEST, shown: LA, places: [LA], now: NOW })).toEqual(MADRID)
    expect(geocoding.namedLocationAt).toHaveBeenCalledWith(40.4168, -3.7038)
  })

  it('offers a nearby saved place without a lookup', async () => {
    grant('granted', { lat: 32.75, lon: -117.1 })
    expect(
      await placeToOffer({ owner: GUEST, shown: LA, places: [LA, SAN_DIEGO], now: NOW }),
    ).toEqual(SAN_DIEGO)
    expect(geocoding.namedLocationAt).not.toHaveBeenCalled()
  })

  it('says nothing without a position, without a name, or after "Not now"', async () => {
    grant('granted')
    expect(await placeToOffer({ owner: GUEST, shown: LA, places: [LA], now: NOW })).toBeNull()
    grant('granted', MADRID)
    geocoding.namedLocationAt.mockResolvedValue(null)
    expect(await placeToOffer({ owner: GUEST, shown: LA, places: [LA], now: NOW })).toBeNull()
    geocoding.namedLocationAt.mockRejectedValue(new Error('offline'))
    expect(await placeToOffer({ owner: GUEST, shown: LA, places: [LA], now: NOW })).toBeNull()
    geocoding.namedLocationAt.mockResolvedValue(MADRID)
    notNowFor(GUEST, MADRID, NOW)
    expect(await placeToOffer({ owner: GUEST, shown: LA, places: [LA], now: NOW })).toBeNull()
    // Another owner's "Not now" does not count, and a day later it asks again.
    expect(await placeToOffer({ owner: ALICE, shown: LA, places: [LA], now: NOW })).toEqual(MADRID)
    expect(
      await placeToOffer({
        owner: GUEST,
        shown: LA,
        places: [LA],
        now: NOW + TRAVEL_NOT_NOW_MS + 1,
      }),
    ).toEqual(MADRID)
  })

  it('never stores the position', async () => {
    grant('granted', { lat: 40.4168, lon: -3.7038 })
    geocoding.namedLocationAt.mockResolvedValue(MADRID)
    await placeToOffer({ owner: GUEST, shown: LA, places: [LA], now: NOW })
    expect(store.size).toBe(0)
    writeTravel(GUEST, { visit: null, notNow: [] })
    expect(store.size).toBe(0)
  })
})
