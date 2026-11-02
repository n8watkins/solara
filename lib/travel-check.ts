// The travel prompt's check (ROADMAP item 53), loaded on demand once the dashboard shows:
// only when location permission is already granted, it reads the device's position once
// and, when it is far from the shown place, names the place to offer. It never asks for
// permission.
import { decideTravelPrompt, type Point } from '@solara/core/travel'
import { namedLocationAt } from './geocoding'
import { readTravel, type TravelOwner } from './travel-place'
import type { Location } from './types'

/** How old a cached device position may be (default, owner may change). */
export const POSITION_MAX_AGE_MS = 10 * 60 * 1000
/** How long the position may take before the check gives up quietly. */
export const POSITION_TIMEOUT_MS = 15 * 1000

/**
 * Whether this site already has location permission. False without the Permissions API
 * (nothing is ever asked from here), and for "prompt" and "denied".
 */
export async function locationAlreadyAllowed(): Promise<boolean> {
  try {
    if (!('geolocation' in navigator) || !navigator.permissions?.query) return false
    const status = await navigator.permissions.query({ name: 'geolocation' })
    return status.state === 'granted'
  } catch {
    return false
  }
}

function devicePosition(): Promise<Point | null> {
  return new Promise(resolve => {
    try {
      navigator.geolocation.getCurrentPosition(
        ({ coords }) => resolve({ lat: coords.latitude, lon: coords.longitude }),
        () => resolve(null),
        {
          enableHighAccuracy: false,
          maximumAge: POSITION_MAX_AGE_MS,
          timeout: POSITION_TIMEOUT_MS,
        },
      )
    } catch {
      resolve(null)
    }
  })
}

/**
 * The place to offer ("You seem to be in <place>. Show UV here?"), or null to say nothing:
 * permission not already granted, no position, near the shown place, a "Not now" area,
 * or no name for the place. The position itself is never stored.
 */
export async function placeToOffer({
  owner,
  shown,
  places,
  now = Date.now(),
}: {
  owner: TravelOwner
  /** The place the app shows now. */
  shown: Location
  /** Home and the other saved places. */
  places: readonly Location[]
  now?: number
}): Promise<Location | null> {
  if (!(await locationAlreadyAllowed())) return null
  const device = await devicePosition()
  if (!device) return null
  const decision = decideTravelPrompt({
    device,
    shown,
    places,
    notNow: readTravel(owner).notNow,
    now,
  })
  if (decision.kind === 'none') return null
  if (decision.kind === 'saved') return decision.place
  return namedLocationAt(device.lat, device.lon).catch(() => null)
}
