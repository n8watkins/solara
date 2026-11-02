// Home and the saved places (ROADMAP item 54): pure helpers for the header's place menu.
// Home is the plan's `location`; the other saved places are `savedLocations`, and home
// counts toward the plan's limit (TIER_LIMITS.savedLocations), so a plan with a limit of 5
// keeps home plus 4 more.
import { samePlace } from '@solara/core/coordinates'
import type { Location, UserPreferences } from './types'

/** The saved places other than home, in their saved order. */
export function otherPlaces(prefs: UserPreferences): Location[] {
  return prefs.savedLocations.filter(place => !samePlace(place, prefs.location))
}

/** Home and the other saved places, home first. */
export function allPlaces(prefs: UserPreferences): Location[] {
  return [prefs.location, ...otherPlaces(prefs)]
}

/** Whether `place` is home or one of the saved places. */
export function isSaved(prefs: UserPreferences, place: Location): boolean {
  return allPlaces(prefs).some(saved => samePlace(saved, place))
}

/** Whether another place fits within the plan's limit (home included). */
export function canSaveMore(prefs: UserPreferences, limit: number): boolean {
  return allPlaces(prefs).length < limit
}

/** The plan with `place` saved, or null when the limit is reached; unchanged if saved. */
export function withPlaceSaved(
  prefs: UserPreferences,
  place: Location,
  limit: number,
): UserPreferences | null {
  if (isSaved(prefs, place)) return prefs
  if (!canSaveMore(prefs, limit)) return null
  return { ...prefs, savedLocations: [...otherPlaces(prefs), place] }
}

/** The plan without the saved place `place` (never home). */
export function withPlaceRemoved(prefs: UserPreferences, place: Location): UserPreferences {
  return { ...prefs, savedLocations: otherPlaces(prefs).filter(p => !samePlace(p, place)) }
}

/**
 * The plan with `place` as home. The old home stays a saved place when there is room
 * (`place` moves out of the list, so swapping two saved places always fits).
 */
export function withHome(prefs: UserPreferences, place: Location, limit: number): UserPreferences {
  if (samePlace(place, prefs.location)) return { ...prefs, location: place }
  const others = otherPlaces(prefs).filter(p => !samePlace(p, place))
  const keepOldHome = others.length + 2 <= limit
  return {
    ...prefs,
    location: place,
    savedLocations: keepOldHome ? [prefs.location, ...others] : others,
  }
}

/** What the header's place name and its menu work with (components/LocationPopover.tsx). */
export interface PlaceControls {
  home: Location
  /** The place shown on this device: home, or the place being visited. */
  shown: Location
  visiting: boolean
  /** The saved places other than home. */
  others: Location[]
  /** Saved places the plan keeps, home included. */
  limit: number
  /** Signed in: the server's calendar link and notifications use home. */
  signedIn: boolean
  /** Shows a place on this device: home ends the visit, any other place starts one. */
  show: (place: Location) => void
  /** Saves a place; false when the plan's limit is reached. */
  save: (place: Location) => boolean
  remove: (place: Location) => void
  setHome: (place: Location) => void
}
