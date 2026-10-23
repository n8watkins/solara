const { createHash } = require('node:crypto')
const { feedTokenHash, resolveFeedOwner, validFeedToken } = require('./feed-tokens')
const { clientAddress } = require('./http')
const { FixedWindowLimiter } = require('./rate-limit')

/**
 * @typedef {import('firebase-admin/firestore').Firestore} Firestore
 * @typedef {import('firebase-functions/v2/https').Request} Request
 * @typedef {import('express').Response} Response
 * @typedef {{ lat: number, lon: number }} Coordinates
 * @typedef {(lat: number, lon: number, days: number) => Promise<unknown>} FetchForecast
 */

const CACHE_TTL_MS = 10 * 60 * 1000
const MAX_CACHE_ENTRIES = 100
/** Calendar apps poll; 15 minutes of client caching matches the forecast cache. */
const FEED_MAX_AGE_SECONDS = 900
/** Per-feed budget: generous for calendar apps, tight enough to stop a hammering client. */
const FEED_REQUESTS_PER_MINUTE = 30
/** Per-address budget for tokens that do not resolve, to make enumeration expensive. */
const UNKNOWN_FEED_REQUESTS_PER_MINUTE = 20

/** @type {Map<string, { expiresAt: number, value: unknown }>} */
const forecastCache = new Map()
const feedLimiter = new FixedWindowLimiter({ limit: FEED_REQUESTS_PER_MINUTE, windowMs: 60_000 })
const unknownFeedLimiter = new FixedWindowLimiter({
  limit: UNKNOWN_FEED_REQUESTS_PER_MINUTE,
  windowMs: 60_000,
})

/** @param {unknown} location @returns {location is Coordinates} */
function validCoordinates(location) {
  const value = /** @type {Partial<Coordinates> | null | undefined} */ (location)
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

/** @param {Coordinates} location @param {number} days */
function forecastKey(location, days) {
  return `${location.lat.toFixed(2)}:${location.lon.toFixed(2)}:${days}`
}

/**
 * @param {FetchForecast} fetchForecast
 * @param {Coordinates} location
 * @param {number} days
 * @param {number} [now]
 */
async function cachedForecast(fetchForecast, location, days, now = Date.now()) {
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

/** @param {Response} res */
function setFeedHeaders(res) {
  res.set('Cache-Control', 'private, no-store, max-age=0')
  res.set('Content-Type', 'text/calendar; charset=utf-8')
  res.set('Referrer-Policy', 'no-referrer')
  res.set('X-Content-Type-Options', 'nosniff')
  res.set('X-Robots-Tag', 'noindex, nofollow, noarchive')
}

/**
 * A weak validator over the feed's events. The ICS body itself is not stable (DTSTAMP is
 * the build time), but two bodies built from the same events are semantically equal.
 *
 * @param {unknown} events
 */
function feedEtag(events) {
  const digest = createHash('sha256').update(JSON.stringify(events)).digest('base64url')
  return `W/"${digest.slice(0, 32)}"`
}

/**
 * @param {string | undefined} header
 * @param {string} etag
 */
function etagMatches(header, etag) {
  if (!header) return false
  const opaque = etag.replace(/^W\//, '')
  return header.split(',').some(candidate => {
    const value = candidate.trim()
    return value === '*' || value.replace(/^W\//, '') === opaque
  })
}

/**
 * @param {Response} res
 * @param {number} retryAfterSeconds
 */
function tooManyRequests(res, retryAfterSeconds) {
  res.set('Retry-After', String(retryAfterSeconds))
  res.status(429).send('Too many requests')
}

/**
 * @param {{
 *   buildICS: (events: any[]) => string,
 *   buildSunEvents: (user: any, forecast: any) => any[],
 *   db: Firestore,
 *   days: number,
 *   fetchForecast: FetchForecast,
 *   now?: () => number,
 * }} options
 * @returns {(req: Request, res: Response) => Promise<void>}
 */
function createCalendarFeedHandler({
  buildICS,
  buildSunEvents,
  db,
  days,
  fetchForecast,
  now = Date.now,
}) {
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

      const events = validCoordinates(user.location)
        ? buildSunEvents(user, await cachedForecast(fetchForecast, user.location, days, timestamp))
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
      const failure = /** @type {{ name?: string, message?: string } | null} */ (error)
      console.error('calendarFeed failed', { name: failure?.name, message: failure?.message })
      res.status(502).send('Could not build feed')
    }
  }
}

function clearForecastCache() {
  forecastCache.clear()
}

function clearFeedRateLimits() {
  feedLimiter.clear()
  unknownFeedLimiter.clear()
}

module.exports = {
  FEED_REQUESTS_PER_MINUTE,
  UNKNOWN_FEED_REQUESTS_PER_MINUTE,
  cachedForecast,
  clearFeedRateLimits,
  clearForecastCache,
  createCalendarFeedHandler,
  validCoordinates,
  validFeedToken,
}
