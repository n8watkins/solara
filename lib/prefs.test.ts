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
