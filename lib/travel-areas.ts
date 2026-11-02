// The travel prompt's "Not now" areas (ROADMAP item 53) and this browser's travel data for
// the account page's download. Loaded on demand, with the travel prompt or the account page.
import { activeNotNowAreas, notNowArea, type Point } from '@solara/core/travel'
import { readTravel, writeTravel, type TravelOwner } from './travel-place'
import type { Location } from './types'

/** "Not now": keeps the prompt quiet within the travel distance of `place` for a day. */
export function notNowFor(owner: TravelOwner, place: Point, now = Date.now()): void {
  const current = readTravel(owner)
  const notNow = activeNotNowAreas([...current.notNow, notNowArea(place, now)], now)
  writeTravel(owner, { ...current, notNow })
}

/**
 * This browser's travel data for the account page's download: the visit and the "Not
 * now" areas still in force, or null when there are none.
 */
export function travelExport(
  owner: TravelOwner,
  now = Date.now(),
): { visit: Location | null; notNow: { lat: number; lon: number; until: string }[] } | null {
  const { visit, notNow } = readTravel(owner)
  const areas = activeNotNowAreas(notNow, now).map(({ lat, lon, until }) => ({
    lat,
    lon,
    until: new Date(until).toISOString(),
  }))
  return visit || areas.length > 0 ? { visit, notNow: areas } : null
}
