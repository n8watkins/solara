// The calendar feed endpoint: an ICS subscription URL authorized by a feed token.

import { createHash } from 'node:crypto'

import { type IcsEvent, accountForecastDays } from '#core'
import type { DocumentData, Firestore } from 'firebase-admin/firestore'
import { logger } from 'firebase-functions/logger'
import type { Request, Response } from 'firebase-functions/v2/https'

import { loggableError } from '../shared/errors'
import { clientAddress } from '../shared/http'
import { FixedWindowLimiter } from '../shared/rate-limit'
import { feedTokenHash, resolveFeedOwner, validFeedToken } from './tokens'

export { validFeedToken }

export interface Coordinates {
  lat: number
  lon: number
}

export type FetchForecast = (lat: number, lon: number, days: number) => Promise<unknown>

const CACHE_TTL_MS = 10 * 60 * 1000
const MAX_CACHE_ENTRIES = 100
/** Calendar apps poll; 15 minutes of client caching matches the forecast cache. */
const FEED_MAX_AGE_SECONDS = 900
/** Per-feed budget: generous for calendar apps, tight enough to stop a hammering client. */
export const FEED_REQUESTS_PER_MINUTE = 30
/** Per-address budget for tokens that do not resolve, to make enumeration expensive. */
export const UNKNOWN_FEED_REQUESTS_PER_MINUTE = 20

const forecastCache = new Map<string, { expiresAt: number; value: unknown }>()
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

function forecastKey(location: Coordinates, days: number): string {
  return `${location.lat.toFixed(2)}:${location.lon.toFixed(2)}:${days}`
}

export async function cachedForecast(
  fetchForecast: FetchForecast,
  location: Coordinates,
  days: number,
  now = Date.now(),
): Promise<unknown> {
  const key = forecastKey(location, days)
  const cached = forecastCache.get(key)
  if (cached && cached.expiresAt > now) return cached.value

  const value = await fetchForecast(location.lat, location.lon, days)
  if (forecastCache.size >= MAX_CACHE_ENTRIES) {
    const oldest = forecastCache.keys().next()
    if (!oldest.done) forecastCache.delete(oldest.value)
  }
  forecastCache.set(key, { expiresAt: now + CACHE_TTL_MS, value })
  return value
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
  db: Firestore
  fetchForecast: (lat: number, lon: number, days: number) => Promise<Forecast>
  now?: () => number
}

export function createCalendarFeedHandler<Forecast>({
  buildICS,
  buildSunEvents,
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

    const address = clientAddress(req)
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
      const uid = await resolveFeedOwner(db, token)
      const user = uid ? (await db.collection('users').doc(uid).get()).data() : undefined
      if (!user || user.accountDeletionStartedAt) {
        unknownFeedLimiter.take(address, timestamp)
        res.status(404).send('Unknown feed')
        return
      }

      // The feed covers the days the account's plan shows in the app: Free's two, Pro's ten.
      const days = accountForecastDays(user.tier)
      const events = validCoordinates(user.location)
        ? buildSunEvents(
            user,
            (await cachedForecast(fetchForecast, user.location, days, timestamp)) as Forecast,
          )
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
      logger.error('calendarFeed failed', { error: loggableError(error) })
      res.status(502).send('Could not build feed')
    }
  }
}

export function clearForecastCache(): void {
  forecastCache.clear()
}

export function clearFeedRateLimits(): void {
  feedLimiter.clear()
  unknownFeedLimiter.clear()
}
