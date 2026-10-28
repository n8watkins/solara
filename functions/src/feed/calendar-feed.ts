// The calendar feed endpoint: an ICS subscription URL authorized by a feed token.

import { createHash } from 'node:crypto'

import { type IcsEvent, accountForecastDays } from '#core'
import type { DocumentData, Firestore } from 'firebase-admin/firestore'
import type { Request, Response } from 'firebase-functions/v2/https'

import { HttpError, loggableError } from '../shared/errors'
import { clientScopes } from '../shared/http'
import { ThrottledLog } from '../shared/log-throttle'
import { FixedWindowLimiter } from '../shared/rate-limit'
import { feedTokenHash, resolveFeedOwner, validFeedToken } from './tokens'

export { validFeedToken }

export interface Coordinates {
  lat: number
  lon: number
}

/** Calendar apps poll; 15 minutes of client caching matches the forecast cache. */
const FEED_MAX_AGE_SECONDS = 900
/** Per-feed budget: generous for calendar apps, tight enough to stop a hammering client. */
export const FEED_REQUESTS_PER_MINUTE = 30
/** Per-address budget for tokens that do not resolve, to make enumeration expensive. */
export const UNKNOWN_FEED_REQUESTS_PER_MINUTE = 20
/**
 * Upstream forecast calls one feed may cause per hour per instance (finding M3): enough
 * for an account that moves a few times, not for one that keeps moving to make the
 * feed call the paid API on every request. Calls past it serve the cached forecast.
 */
export const FEED_UPSTREAM_PER_HOUR = 4
/** Calendar apps keep their last copy; this is when to ask again after a 503. */
const UNAVAILABLE_RETRY_SECONDS = 900

const feedUpstreamLimiter = new FixedWindowLimiter({
  limit: FEED_UPSTREAM_PER_HOUR,
  windowMs: 60 * 60 * 1000,
})
const feedLogs = new ThrottledLog()
const feedLimiter = new FixedWindowLimiter({ limit: FEED_REQUESTS_PER_MINUTE, windowMs: 60_000 })
const unknownFeedLimiter = new FixedWindowLimiter({
  limit: UNKNOWN_FEED_REQUESTS_PER_MINUTE,
  windowMs: 60_000,
})

export function validCoordinates(location: unknown): location is Coordinates {
  const value = location as Partial<Coordinates> | null | undefined
  return (
    !!value &&
    typeof value.lat === 'number' &&
    typeof value.lon === 'number' &&
    Number.isFinite(value.lat) &&
    Number.isFinite(value.lon) &&
    value.lat >= -90 &&
    value.lat <= 90 &&
    value.lon >= -180 &&
    value.lon <= 180
  )
}

function setFeedHeaders(res: Response): void {
  res.set('Cache-Control', 'private, no-store, max-age=0')
  res.set('Content-Type', 'text/calendar; charset=utf-8')
  res.set('Referrer-Policy', 'no-referrer')
  res.set('X-Content-Type-Options', 'nosniff')
  res.set('X-Robots-Tag', 'noindex, nofollow, noarchive')
}

/**
 * A weak validator over the feed's events. The ICS body itself is not stable (DTSTAMP is
 * the build time), but two bodies built from the same events are semantically equal.
 */
function feedEtag(events: unknown): string {
  const digest = createHash('sha256').update(JSON.stringify(events)).digest('base64url')
  return `W/"${digest.slice(0, 32)}"`
}

function etagMatches(header: string | undefined, etag: string): boolean {
  if (!header) return false
  const opaque = etag.replace(/^W\//, '')
  return header.split(',').some(candidate => {
    const value = candidate.trim()
    return value === '*' || value.replace(/^W\//, '') === opaque
  })
}

function tooManyRequests(res: Response, retryAfterSeconds: number): void {
  res.set('Retry-After', String(retryAfterSeconds))
  res.status(429).send('Too many requests')
}

export interface CalendarFeedOptions<Forecast> {
  buildICS: (events: IcsEvent[]) => string
  buildSunEvents: (user: DocumentData, forecast: Forecast) => IcsEvent[]
  /** While engaged, the feed answers 503 instead of building (shared/cost-guard.ts). */
  costGuard?: { engaged: () => Promise<boolean> }
  db: Firestore
  /**
   * The account's forecast for `days` days, from the shared forecast cache
   * (forecast/proxy.ts). `mayFetch` is this feed's own budget for upstream calls; the
   * cache asks it only when a miss would call upstream.
   */
  fetchForecast: (
    location: Coordinates,
    days: number,
    lookup: { mayFetch: () => boolean },
  ) => Promise<Forecast>
  now?: () => number
}

export function createCalendarFeedHandler<Forecast>({
  buildICS,
  buildSunEvents,
  costGuard,
  db,
  fetchForecast,
  now = Date.now,
}: CalendarFeedOptions<Forecast>): (req: Request, res: Response) => Promise<void> {
  return async (req, res) => {
    setFeedHeaders(res)
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.set('Allow', 'GET, HEAD')
      res.status(405).send('Method Not Allowed')
      return
    }

    const token = req.query.token
    if (!validFeedToken(token)) {
      res.status(400).send('Missing or invalid token')
      return
    }

    const address = clientScopes(req)
    const timestamp = now()
    if (unknownFeedLimiter.exhausted(address, timestamp)) {
      tooManyRequests(res, 60)
      return
    }
    const feedBudget = feedLimiter.take(feedTokenHash(token), timestamp)
    if (!feedBudget.allowed) {
      tooManyRequests(res, feedBudget.retryAfterSeconds)
      return
    }

    try {
      if (await costGuard?.engaged()) {
        // Calendar apps keep their last copy and try again later.
        res.set('Retry-After', '3600')
        res.status(503).send('Feed paused')
        return
      }
      const feedKey = feedTokenHash(token)
      const uid = await resolveFeedOwner(db, token)
      const user = uid ? (await db.collection('users').doc(uid).get()).data() : undefined
      if (!user || user.accountDeletionStartedAt) {
        unknownFeedLimiter.take(address, timestamp)
        res.status(404).send('Unknown feed')
        return
      }

      // The feed covers the days the account's plan shows in the app: Free's two, Pro's ten.
      const days = accountForecastDays(user.tier)
      const mayFetch = () => feedUpstreamLimiter.take(feedKey, now()).allowed
      const events = validCoordinates(user.location)
        ? buildSunEvents(user, await fetchForecast(user.location, days, { mayFetch }))
        : []
      const etag = feedEtag(events)
      res.set('Cache-Control', `private, max-age=${FEED_MAX_AGE_SECONDS}`)
      res.set('ETag', etag)
      if (etagMatches(req.headers['if-none-match'], etag)) {
        res.status(304).send('')
        return
      }
      if (req.method === 'HEAD') res.status(200).send('')
      else res.status(200).send(buildICS(events))
    } catch (error) {
      // Never log the token or the account's location.
      if (error instanceof HttpError && error.code === 'unavailable') {
        // No forecast could be served (upstream budget or provider); calendar apps keep
        // their last copy. Expected under abuse, so a throttled WARNING.
        feedLogs.log('warn', 'unavailable', 'calendarFeed forecast unavailable', {
          error: loggableError(error),
        })
        res.set('Retry-After', String(UNAVAILABLE_RETRY_SECONDS))
        res.status(503).send('Feed temporarily unavailable')
        return
      }
      feedLogs.log('error', 'failed', 'calendarFeed failed', { error: loggableError(error) })
      res.status(502).send('Could not build feed')
    }
  }
}

export function clearFeedRateLimits(): void {
  feedLimiter.clear()
  unknownFeedLimiter.clear()
  feedUpstreamLimiter.clear()
  feedLogs.clear()
}
