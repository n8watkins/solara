// @solara/core/travel: when to offer the forecast where the phone is (ROADMAP item 53).
//
// The web app asks this once it has the device's position (only when location permission
// was already granted; nothing here asks for it), and a native client can ask the same.
// Pure: no storage, no clock, no network.

/** A position or a place: degrees of latitude and longitude. */
export interface Point {
  lat: number
  lon: number
}

/** A saved place, as far as the prompt needs it. */
export type NamedPoint = Point & { city: string }

/**
 * How far the device must be from the shown place before Solara offers the forecast where
 * it is (default, owner may change). Far enough that a commute or a day trip around a
 * city stays quiet, near enough that the UV and the sun's times may differ.
 */
export const TRAVEL_PROMPT_DISTANCE_KM = 50

/** How long "Not now" keeps the prompt quiet for an area (default, owner may change). */
export const TRAVEL_NOT_NOW_MS = 24 * 60 * 60 * 1000

/**
 * The decimals a "Not now" area is kept at: 1, about 11 km, coarser than a saved place's 2,
 * as the area is not a place the person chose and the 50 km it covers needs no more.
 */
export const NOT_NOW_DECIMALS = 1

/** The most "Not now" areas kept; the oldest go first. */
export const NOT_NOW_MAX_AREAS = 20

/** The mean Earth radius (IUGG), in kilometres. */
const EARTH_RADIUS_KM = 6371.0088

const radians = (degrees: number) => (degrees * Math.PI) / 180

/** The great-circle distance between two points, in kilometres (haversine). */
export function distanceKm(a: Point, b: Point): number {
  const dLat = radians(b.lat - a.lat)
  const dLon = radians(b.lon - a.lon)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** An area where "Not now" keeps the prompt quiet until `until` (epoch ms). */
export interface NotNowArea extends Point {
  until: number
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor + 0
}

/** The "Not now" area for a named place, rounded to {@link NOT_NOW_DECIMALS}. */
export function notNowArea(place: Point, now: number): NotNowArea {
  return {
    lat: roundTo(place.lat, NOT_NOW_DECIMALS),
    lon: roundTo(place.lon, NOT_NOW_DECIMALS),
    until: now + TRAVEL_NOT_NOW_MS,
  }
}

/**
 * The areas still in force at `now`, newest last, at most {@link NOT_NOW_MAX_AREAS}; an end
 * further away than one "Not now" (a clock moved back, or a hand-edited store) is dropped.
 */
export function activeNotNowAreas(areas: readonly NotNowArea[], now: number): NotNowArea[] {
  return areas
    .filter(area => area.until > now && area.until <= now + TRAVEL_NOT_NOW_MS)
    .slice(-NOT_NOW_MAX_AREAS)
}

/** Within {@link TRAVEL_PROMPT_DISTANCE_KM} of each other. */
export function nearby(a: Point, b: Point): boolean {
  return distanceKm(a, b) <= TRAVEL_PROMPT_DISTANCE_KM
}

/** What the travel prompt should do with a device position. */
export type TravelPromptDecision<P extends NamedPoint = NamedPoint> =
  /** The device is near the shown place, or the person said "Not now" for this area. */
  | { kind: 'none'; reason: 'near' | 'not-now' }
  /** Offer this saved place, the closest one near the device. */
  | { kind: 'saved'; place: P }
  /** Offer the place the device is in, once a reverse lookup has named it. */
  | { kind: 'lookup' }

/**
 * Whether to offer the forecast where the device is, and for which place.
 *
 * - Near the shown place (within {@link TRAVEL_PROMPT_DISTANCE_KM}): nothing.
 * - Within a "Not now" area still in force: nothing.
 * - Near a saved place (home included): that place, the closest one if several.
 * - Otherwise: the place a reverse lookup of the position names.
 */
export function decideTravelPrompt<P extends NamedPoint>({
  device,
  shown,
  places,
  notNow,
  now,
}: {
  /** The device's position. */
  device: Point
  /** The place the app shows now. */
  shown: Point
  /** The saved places, home included. */
  places: readonly P[]
  /** The "Not now" areas kept on the device. */
  notNow: readonly NotNowArea[]
  /** Epoch ms. */
  now: number
}): TravelPromptDecision<P> {
  if (nearby(device, shown)) return { kind: 'none', reason: 'near' }
  if (activeNotNowAreas(notNow, now).some(area => nearby(device, area))) {
    return { kind: 'none', reason: 'not-now' }
  }
  let closest: { place: P; km: number } | null = null
  for (const place of places) {
    const km = distanceKm(device, place)
    if (km <= TRAVEL_PROMPT_DISTANCE_KM && (!closest || km < closest.km)) closest = { place, km }
  }
  return closest ? { kind: 'saved', place: closest.place } : { kind: 'lookup' }
}
