import { describe, expect, it } from 'vitest'
import { defaultPrefs } from './local-prefs'
import {
  allPlaces,
  canSaveMore,
  isSaved,
  otherPlaces,
  withHome,
  withPlaceRemoved,
  withPlaceSaved,
} from './places'
import type { Location } from './types'

const place = (city: string, lat: number): Location => ({ lat, lon: 0, city, region: '' })
const HOME = place('Home', 1)
const A = place('A', 2)
const B = place('B', 3)
const C = place('C', 4)
const D = place('D', 5)
const E = place('E', 6)

describe('saved places', () => {
  it('list home first, without a copy of it among the others', () => {
    const prefs = { ...defaultPrefs(HOME), savedLocations: [A, { ...HOME, lat: 1.001 }, B] }
    expect(otherPlaces(prefs)).toEqual([A, B])
    expect(allPlaces(prefs)).toEqual([HOME, A, B])
    expect(isSaved(prefs, HOME)).toBe(true)
    expect(isSaved(prefs, B)).toBe(true)
    expect(isSaved(prefs, C)).toBe(false)
  })

  it('count home toward the limit: home plus 4 at 5', () => {
    let prefs = defaultPrefs(HOME)
    for (const next of [A, B, C, D]) {
      expect(canSaveMore(prefs, 5)).toBe(true)
      prefs = withPlaceSaved(prefs, next, 5)!
    }
    expect(allPlaces(prefs)).toHaveLength(5)
    expect(canSaveMore(prefs, 5)).toBe(false)
    expect(withPlaceSaved(prefs, E, 5)).toBeNull()
    // Saving a place already saved is no change, even at the limit.
    expect(withPlaceSaved(prefs, A, 5)).toBe(prefs)
    expect(withPlaceSaved(prefs, HOME, 5)).toBe(prefs)
  })

  it('remove any place but home', () => {
    const prefs = { ...defaultPrefs(HOME), savedLocations: [A, B] }
    expect(otherPlaces(withPlaceRemoved(prefs, A))).toEqual([B])
    expect(withPlaceRemoved(prefs, HOME).location).toEqual(HOME)
  })
})

describe('setting home', () => {
  it('keeps the old home as a saved place when there is room', () => {
    const prefs = { ...defaultPrefs(HOME), savedLocations: [A, B] }
    const next = withHome(prefs, B, 5)
    expect(next.location).toEqual(B)
    expect(allPlaces(next)).toEqual([B, HOME, A])
  })

  it('swaps a saved place with home at the limit', () => {
    const prefs = { ...defaultPrefs(HOME), savedLocations: [A, B, C, D] }
    expect(allPlaces(withHome(prefs, C, 5))).toEqual([C, HOME, A, B, D])
  })

  it('drops the old home for a new place when the plan is full', () => {
    const prefs = { ...defaultPrefs(HOME), savedLocations: [A, B, C, D] }
    expect(allPlaces(withHome(prefs, E, 5))).toEqual([E, A, B, C, D])
  })

  it('takes the new copy of home itself', () => {
    const prefs = defaultPrefs(HOME)
    const renamed = { ...HOME, city: 'Casa' }
    expect(withHome(prefs, renamed, 5).location).toEqual(renamed)
  })
})
