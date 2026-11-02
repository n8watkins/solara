// When to run the travel check (ROADMAP item 53): a little after the dashboard shows, and
// again when Solara comes back to the foreground after an hour or more. The check itself
// (lib/travel-check.ts, with the place lookup) loads on demand, and asks for nothing: it
// runs only when location permission is already granted.
import { useEffect, useEffectEvent, useState } from 'react'
import { samePlace } from '@solara/core/coordinates'
import { withMessages } from './i18n'
import type { TravelOwner } from './travel-place'
import type { Location } from './types'

/** How long after the dashboard shows the first check starts. */
export const TRAVEL_CHECK_DELAY_MS = 2000
/** How long Solara must have been in the background before it checks again. */
export const TRAVEL_RECHECK_MS = 60 * 60 * 1000

interface Offer {
  owner: TravelOwner
  /** The place shown when the check ran: the offer lapses once another place shows. */
  shown: Location
  place: Location
}

/**
 * The place to offer while the owner and the shown place are the ones it was found for,
 * and a way to hide it.
 */
export function useTravelPrompt({
  active,
  owner,
  shown,
  places,
}: {
  /** The dashboard shows a plan that can change (not while an account is confirmed). */
  active: boolean
  owner: TravelOwner
  shown: Location | null
  places: readonly Location[]
}): { offer: Location | null; hide: () => void } {
  const [offer, setOffer] = useState<Offer | null>(null)

  const check = useEffectEvent((isCurrent: () => boolean) => {
    if (!shown) return
    const from = { owner, shown }
    withMessages(['setup'], () => import('./travel-check'))
      .then(({ placeToOffer }) => placeToOffer({ owner, shown: from.shown, places }))
      .then(place => {
        if (place && isCurrent()) setOffer({ ...from, place })
      })
      .catch(error => console.error('Travel check failed:', error))
  })

  useEffect(() => {
    if (!active) return
    let current = true
    let lastCheck = 0
    const run = () => {
      lastCheck = Date.now()
      check(() => current)
    }
    const timer = window.setTimeout(run, TRAVEL_CHECK_DELAY_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastCheck >= TRAVEL_RECHECK_MS) {
        run()
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      current = false
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [active, owner])

  const live =
    offer && shown && offer.owner === owner && samePlace(offer.shown, shown) ? offer.place : null
  return { offer: live, hide: () => setOffer(null) }
}
