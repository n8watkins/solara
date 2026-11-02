import { describe, expect, it } from 'vitest'
import {
  activeNotNowAreas,
  decideTravelPrompt,
  distanceKm,
  NOT_NOW_MAX_AREAS,
  notNowArea,
  TRAVEL_NOT_NOW_MS,
  TRAVEL_PROMPT_DISTANCE_KM,
} from './travel'

const LOS_ANGELES = { lat: 34.05, lon: -118.24, city: 'Los Angeles' }
const SANTA_MONICA = { lat: 34.02, lon: -118.49, city: 'Santa Monica' }
const SAN_DIEGO = { lat: 32.72, lon: -117.16, city: 'San Diego' }
const MADRID = { lat: 40.42, lon: -3.7, city: 'Madrid' }
const TOLEDO = { lat: 39.86, lon: -4.02, city: 'Toledo' }
const NOW = Date.parse('2026-07-01T10:00:00Z')

describe('distanceKm', () => {
  it('is zero for one point and symmetric', () => {
    expect(distanceKm(MADRID, MADRID)).toBe(0)
    expect(distanceKm(MADRID, LOS_ANGELES)).toBeCloseTo(distanceKm(LOS_ANGELES, MADRID), 9)
  })

  it('matches known great-circle distances', () => {
    // Los Angeles to San Diego is about 179 km; Madrid to Los Angeles about 9,400 km.
    expect(distanceKm(LOS_ANGELES, SAN_DIEGO)).toBeGreaterThan(175)
    expect(distanceKm(LOS_ANGELES, SAN_DIEGO)).toBeLessThan(185)
    expect(distanceKm(MADRID, LOS_ANGELES)).toBeGreaterThan(9300)
    expect(distanceKm(MADRID, LOS_ANGELES)).toBeLessThan(9500)
    // A degree of latitude is about 111 km anywhere.
    expect(distanceKm({ lat: 0, lon: 0 }, { lat: 1, lon: 0 })).toBeCloseTo(111.2, 0)
    expect(distanceKm({ lat: 60, lon: 10 }, { lat: 61, lon: 10 })).toBeCloseTo(111.2, 0)
  })

  it('crosses the antimeridian and the poles the short way', () => {
    expect(distanceKm({ lat: 0, lon: 179.9 }, { lat: 0, lon: -179.9 })).toBeLessThan(23)
    expect(distanceKm({ lat: 89.9, lon: 0 }, { lat: 89.9, lon: 180 })).toBeLessThan(23)
    // Antipodes: half the Earth's circumference, without a NaN from rounding.
    expect(distanceKm({ lat: 0, lon: 0 }, { lat: 0, lon: 180 })).toBeCloseTo(20015, -1)
  })
})

describe('decideTravelPrompt', () => {
  const base = { places: [LOS_ANGELES], notNow: [], now: NOW }

  it('stays quiet near the shown place', () => {
    expect(decideTravelPrompt({ ...base, device: SANTA_MONICA, shown: LOS_ANGELES })).toEqual({
      kind: 'none',
      reason: 'near',
    })
  })

  it('treats exactly the threshold as near and just past it as far', () => {
    // Due north along a meridian: 1 km is 1/111.2 of a degree.
    const step = 1 / 111.195
    const at = { lat: LOS_ANGELES.lat + TRAVEL_PROMPT_DISTANCE_KM * step * 0.999, lon: -118.24 }
    const past = { lat: LOS_ANGELES.lat + TRAVEL_PROMPT_DISTANCE_KM * step * 1.01, lon: -118.24 }
    expect(decideTravelPrompt({ ...base, device: at, shown: LOS_ANGELES }).kind).toBe('none')
    expect(decideTravelPrompt({ ...base, device: past, shown: LOS_ANGELES }).kind).toBe('lookup')
  })

  it('asks for a lookup when far from every saved place', () => {
    expect(decideTravelPrompt({ ...base, device: MADRID, shown: LOS_ANGELES })).toEqual({
      kind: 'lookup',
    })
  })

  it('offers the closest saved place near the device', () => {
    const decision = decideTravelPrompt({
      ...base,
      places: [LOS_ANGELES, TOLEDO, MADRID],
      device: { lat: 40.4, lon: -3.72 },
      shown: LOS_ANGELES,
    })
    expect(decision).toEqual({ kind: 'saved', place: MADRID })
  })

  it('offers home when the device is back home while another place shows', () => {
    const decision = decideTravelPrompt({
      ...base,
      places: [LOS_ANGELES, MADRID],
      device: SANTA_MONICA,
      shown: MADRID,
    })
    expect(decision).toEqual({ kind: 'saved', place: LOS_ANGELES })
  })

  it('stays quiet within a "Not now" area until it ends', () => {
    const notNow = [notNowArea(MADRID, NOW)]
    const near = { lat: 40.3, lon: -3.6 }
    expect(decideTravelPrompt({ ...base, notNow, device: near, shown: LOS_ANGELES })).toEqual({
      kind: 'none',
      reason: 'not-now',
    })
    // Toledo is about 70 km from Madrid: outside the area, so it asks again.
    expect(decideTravelPrompt({ ...base, notNow, device: TOLEDO, shown: LOS_ANGELES }).kind).toBe(
      'lookup',
    )
    // A day later the area has ended.
    const later = NOW + TRAVEL_NOT_NOW_MS + 1
    expect(
      decideTravelPrompt({ ...base, notNow, now: later, device: near, shown: LOS_ANGELES }).kind,
    ).toBe('lookup')
  })
})

describe('"Not now" areas', () => {
  it('keep the place at one decimal and end a day later', () => {
    expect(notNowArea({ lat: 40.4168, lon: -3.7038 }, NOW)).toEqual({
      lat: 40.4,
      lon: -3.7,
      until: NOW + TRAVEL_NOT_NOW_MS,
    })
    expect(notNowArea({ lat: -0.04, lon: 0.04 }, NOW)).toMatchObject({ lat: 0, lon: 0 })
    expect(Object.is(notNowArea({ lat: -0.04, lon: 0 }, NOW).lat, -0)).toBe(false)
  })

  it('drop ended areas, ends too far ahead and the oldest past the cap', () => {
    const live = notNowArea(MADRID, NOW)
    const ended = { ...live, until: NOW }
    const tooFar = { ...live, until: NOW + TRAVEL_NOT_NOW_MS + 60_000 }
    expect(activeNotNowAreas([ended, live, tooFar], NOW)).toEqual([live])
    const many = Array.from({ length: NOT_NOW_MAX_AREAS + 5 }, (_, i) => ({
      lat: i,
      lon: 0,
      until: NOW + 1000 + i,
    }))
    const kept = activeNotNowAreas(many, NOW)
    expect(kept).toHaveLength(NOT_NOW_MAX_AREAS)
    expect(kept[0]?.lat).toBe(5)
  })
})
