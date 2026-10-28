// Place lookups for linked calendars' LOCATION text (docs/integrations/EVENTS.md, phase 2).
//
// They use the commercial place search, but count against a budget of their own
// (REVIEW5 M1: EVENT_PLACE_LOOKUPS_PER_HOUR and _PER_DAY, counters
// `forecastUpstream/event-places-*`), never place search's, so linked calendars cannot
// take the searches guests and new accounts need to set a place. Inside that budget each
// account has an hourly share (EVENT_PLACE_LOOKUPS_PER_ACCOUNT), like a caller of the
// proxy (REVIEW4 H1), so a few accounts cannot spend the hour for everyone.

import type { GeocodingResult } from '#core'
import type { Firestore } from 'firebase-admin/firestore'

import { CallerShare } from '../forecast/caller-share'
import { PlaceSearchCache } from '../forecast/place-search'
import { UpstreamBudget, type UpstreamLimits } from '../forecast/upstream-budget'

export interface EventPlaceSearchOptions {
  db: Firestore
  /** The plan's API key, or null when none is configured. */
  apiKey: () => string | null
  /** Whether the cost guard allows calls upstream. */
  upstreamAllowed: () => Promise<boolean>
  /** The global budget for these lookups (read on each refill). */
  limits: () => UpstreamLimits
  /** Lookups one account may cause per UTC hour. */
  perAccountPerHour: () => number
  now?: () => number
  fetchImpl?: typeof fetch
}

/**
 * A `searchPlace(uid, query)` for SubscriptionDeps: the matches for a town name, cached,
 * or looked up within the budget and the account's share, or a rejection (the caller
 * then uses the person's place).
 */
export function eventPlaceSearch({
  db,
  apiKey,
  upstreamAllowed,
  limits,
  perAccountPerHour,
  now,
  fetchImpl,
}: EventPlaceSearchOptions): (uid: string, query: string) => Promise<GeocodingResult[]> {
  const places = new PlaceSearchCache({
    apiKey,
    upstreamAllowed,
    upstreamBudget: new UpstreamBudget({
      db,
      label: 'linked calendar place lookups',
      prefix: 'event-places-',
      limits,
      ...(now ? { now } : {}),
    }),
    ...(now ? { now } : {}),
    ...(fetchImpl ? { fetchImpl } : {}),
  })
  const share = new CallerShare({
    db,
    scope: 'event-places',
    perHour: perAccountPerHour,
    ...(now ? { now } : {}),
  })
  return async (uid, query) =>
    (
      await places.search(
        { name: query, count: 5 },
        { mayFetch: () => share.take([{ key: `uid:${uid}`, weight: 1 }]) },
      )
    ).results
}
