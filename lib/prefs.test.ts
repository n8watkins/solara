import { describe, it, expect } from 'vitest'
import { normalizePrefs } from '@/lib/prefs'
import { Location } from '@/lib/types'

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
    expect(saved![0].city).toBe('New York')
  })

  it('hard-caps the list at 12', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ lat: i, lon: i, city: `C${i}`, region: '' }))
    expect(base({ savedLocations: many }).savedLocations).toHaveLength(12)
  })
})

describe('normalizePrefs - location timezone', () => {
  it('keeps valid IANA timezones and drops malformed values', () => {
    expect(base({ location: { ...LA, timezone: 'America/Los_Angeles' } }).location.timezone).toBe('America/Los_Angeles')
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

describe('normalizePrefs — activity routine + cloud fields', () => {
  it('normalizes daysOfWeek (none/all-seven → undefined, else sorted unique subset)', () => {
    const act = (daysOfWeek: unknown) => base({ activities: [{ id: 'run', name: 'Run', daysOfWeek }] }).activities[0]
    expect(act([]).daysOfWeek).toBeUndefined()
    expect(act([0, 1, 2, 3, 4, 5, 6]).daysOfWeek).toBeUndefined()
    expect(act([5, 1, 1, 9, -1]).daysOfWeek).toEqual([1, 5]) // dedupe, sort, drop out-of-range
  })

  it('keeps cloudSensitive only when explicitly true', () => {
    const act = (cloudSensitive: unknown) => base({ activities: [{ id: 'run', name: 'Run', cloudSensitive }] }).activities[0]
    expect(act(true).cloudSensitive).toBe(true)
    expect(act(false).cloudSensitive).toBeUndefined()
    expect(act('yes').cloudSensitive).toBeUndefined()
  })
})
