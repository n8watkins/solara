import { afterEach, describe, it, expect, vi } from 'vitest'
import { defaultPrefs, normalizePrefs, saveLocalPrefs } from '@/lib/prefs'
import type { Location } from '@/lib/types'

const LA: Location = { lat: 34.05, lon: -118.24, city: 'Los Angeles', region: 'CA' }
const NYC: Location = { lat: 40.71, lon: -74.0, city: 'New York', region: 'NY' }

function base(extra: Record<string, unknown>) {
  return normalizePrefs({ location: LA, ...extra })!
}

describe('normalizePrefs — savedLocations', () => {
  it('defaults to empty and accepts valid entries', () => {
    expect(base({}).savedLocations).toEqual([])
    expect(base({ savedLocations: [NYC] }).savedLocations).toEqual([NYC])
  })

  it('drops invalid entries and dedupes by rounded lat/lon', () => {
    const near = { ...NYC, lat: 40.711 } // within 0.01 of NYC → duplicate
    const saved = base({ savedLocations: [NYC, near, { city: 'bad' }, 42] }).savedLocations
    expect(saved).toHaveLength(1)
    expect(saved![0]!.city).toBe('New York')
  })

  it('hard-caps the list at 12', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      lat: i,
      lon: i,
      city: `C${i}`,
      region: '',
    }))
    expect(base({ savedLocations: many }).savedLocations).toHaveLength(12)
  })

  it('rejects non-finite and out-of-range coordinates', () => {
    const invalid = [
      { lat: Number.NaN, lon: 0, city: 'NaN' },
      { lat: Number.POSITIVE_INFINITY, lon: 0, city: 'Infinity' },
      { lat: 90.01, lon: 0, city: 'North' },
      { lat: -90.01, lon: 0, city: 'South' },
      { lat: 0, lon: 180.01, city: 'East' },
      { lat: 0, lon: -180.01, city: 'West' },
    ]

    expect(base({ savedLocations: invalid }).savedLocations).toEqual([])
    expect(normalizePrefs({ location: invalid[0] as Location })).toBeNull()
    expect(normalizePrefs({ location: invalid[1] as Location }, invalid[2] as Location)).toBeNull()
  })
})

describe('normalizePrefs - location timezone', () => {
  it('keeps valid IANA timezones and drops malformed values', () => {
    expect(base({ location: { ...LA, timezone: 'America/Los_Angeles' } }).location.timezone).toBe(
      'America/Los_Angeles',
    )
    expect(base({ location: { ...LA, timezone: 'UTC' } }).location.timezone).toBe('UTC')
    expect(base({ location: { ...LA, timezone: '<script>' } }).location.timezone).toBeUndefined()
  })
})

describe('normalizePrefs - client-owned fields', () => {
  it('drops server-owned and unknown fields while preserving supported preferences', () => {
    const normalized = base({
      showSunPath: false,
      stripeCustomerId: 'cus_secret',
      stripeSubscriptionId: 'sub_secret',
      stripeEventCreated: 123,
      unknownField: 'unexpected',
    } as never)

    expect(normalized.showSunPath).toBe(false)
    expect(normalized).not.toHaveProperty('stripeCustomerId')
    expect(normalized).not.toHaveProperty('stripeSubscriptionId')
    expect(normalized).not.toHaveProperty('stripeEventCreated')
    expect(normalized).not.toHaveProperty('unknownField')
  })
})

describe('normalizePrefs - display units', () => {
  it('keeps known unit choices and drops anything else', () => {
    expect(base({ temperatureUnit: 'celsius', clockFormat: '24h' })).toMatchObject({
      temperatureUnit: 'celsius',
      clockFormat: '24h',
    })
    expect(base({ temperatureUnit: 'auto', clockFormat: 'auto' })).toMatchObject({
      temperatureUnit: 'auto',
      clockFormat: 'auto',
    })
    const odd = base({ temperatureUnit: 'kelvin', clockFormat: 24 } as never)
    expect(odd.temperatureUnit).toBeUndefined()
    expect(odd.clockFormat).toBeUndefined()
  })
})

describe('normalizePrefs — activity routine + cloud fields', () => {
  it('normalizes daysOfWeek (none/all-seven → undefined, else sorted unique subset)', () => {
    const act = (daysOfWeek: unknown) =>
      base({ activities: [{ id: 'run', name: 'Run', daysOfWeek }] }).activities[0]!
    expect(act([]).daysOfWeek).toBeUndefined()
    expect(act([0, 1, 2, 3, 4, 5, 6]).daysOfWeek).toBeUndefined()
    expect(act([5, 1, 1, 9, -1]).daysOfWeek).toEqual([1, 5]) // dedupe, sort, drop out-of-range
  })

  it('keeps cloudSensitive only when explicitly true', () => {
    const act = (cloudSensitive: unknown) =>
      base({ activities: [{ id: 'run', name: 'Run', cloudSensitive }] }).activities[0]!
    expect(act(true).cloudSensitive).toBe(true)
    expect(act(false).cloudSensitive).toBeUndefined()
    expect(act('yes').cloudSensitive).toBeUndefined()
  })

  it('keeps the rain and heat settings, unset meaning the defaults', () => {
    const act = (fields: Record<string, unknown>) =>
      base({ activities: [{ id: 'run', name: 'Run', ...fields }] }).activities[0]!
    expect(act({}).avoidRain).toBeUndefined()
    expect(act({}).maxFeelsLikeC).toBeUndefined()
    expect(act({ avoidRain: false }).avoidRain).toBe(false)
    expect(act({ avoidRain: 'no' }).avoidRain).toBeUndefined()
    // Celsius to 0.1, inside 15-50; null is "no limit"; anything else is unset.
    expect(act({ maxFeelsLikeC: 35.04 }).maxFeelsLikeC).toBe(35)
    expect(act({ maxFeelsLikeC: 80 }).maxFeelsLikeC).toBe(50)
    expect(act({ maxFeelsLikeC: null }).maxFeelsLikeC).toBeNull()
    expect(act({ maxFeelsLikeC: '35' }).maxFeelsLikeC).toBeUndefined()
  })
})

describe('limits shared with the Firestore rules', () => {
  it('drops legacy feed tokens and caps activities and their names', () => {
    const raw = {
      ...defaultPrefs({ lat: 34.05, lon: -118.24, city: 'Los Angeles', region: 'CA' }),
      calendarFeedToken: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      activities: Array.from({ length: 25 }, (_, i) => ({
        id: `custom_${i}`,
        name: 'x'.repeat(150),
        icon: '🏃',
        durationMins: 30,
        maxUV: 3,
        sunscreen: false,
      })),
    }
    const prefs = normalizePrefs(raw)
    expect(prefs).not.toHaveProperty('calendarFeedToken')
    expect(prefs?.activities).toHaveLength(20)
    expect(prefs?.activities.every(a => a.name.length === 100)).toBe(true)
  })
})

describe('saveLocalPrefs', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('never throws when browser storage is full or blocked', () => {
    const setItem = vi.fn(() => {
      throw new Error('QuotaExceededError')
    })
    vi.stubGlobal('window', {})
    vi.stubGlobal('localStorage', { setItem })
    expect(() => saveLocalPrefs(defaultPrefs(LA))).not.toThrow()
    expect(setItem).toHaveBeenCalledOnce()
  })
})
