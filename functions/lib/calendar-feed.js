const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/
const CACHE_TTL_MS = 10 * 60 * 1000
const MAX_CACHE_ENTRIES = 100

const forecastCache = new Map()

function validFeedToken(token) {
  return typeof token === 'string' && TOKEN_PATTERN.test(token)
}

function validCoordinates(location) {
  return location
    && Number.isFinite(location.lat)
    && Number.isFinite(location.lon)
    && location.lat >= -90
    && location.lat <= 90
    && location.lon >= -180
    && location.lon <= 180
}

function forecastKey(location, days) {
  return `${location.lat.toFixed(2)}:${location.lon.toFixed(2)}:${days}`
}

async function cachedForecast(fetchForecast, location, days, now = Date.now()) {
  const key = forecastKey(location, days)
  const cached = forecastCache.get(key)
  if (cached && cached.expiresAt > now) return cached.value

  const value = await fetchForecast(location.lat, location.lon, days)
  if (forecastCache.size >= MAX_CACHE_ENTRIES) {
    forecastCache.delete(forecastCache.keys().next().value)
  }
  forecastCache.set(key, { expiresAt: now + CACHE_TTL_MS, value })
  return value
}

function setFeedHeaders(res) {
  res.set('Cache-Control', 'private, no-store, max-age=0')
  res.set('Content-Type', 'text/calendar; charset=utf-8')
  res.set('Referrer-Policy', 'no-referrer')
  res.set('X-Content-Type-Options', 'nosniff')
  res.set('X-Robots-Tag', 'noindex, nofollow, noarchive')
}

function createCalendarFeedHandler({ buildICS, buildSunEvents, db, days, fetchForecast }) {
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

    try {
      const snapshot = await db.collection('users')
        .where('calendarFeedToken', '==', token).limit(1).get()
      if (snapshot.empty) {
        res.status(404).send('Unknown feed')
        return
      }

      const user = snapshot.docs[0].data()
      if (user.accountDeletionStartedAt) {
        res.status(404).send('Unknown feed')
        return
      }
      const calendar = validCoordinates(user.location)
        ? buildICS(buildSunEvents(user, await cachedForecast(fetchForecast, user.location, days)))
        : buildICS([])
      if (req.method === 'HEAD') res.status(200).send('')
      else res.status(200).send(calendar)
    } catch (error) {
      console.error('calendarFeed failed', { name: error?.name, message: error?.message })
      res.status(502).send('Could not build feed')
    }
  }
}

function clearForecastCache() {
  forecastCache.clear()
}

module.exports = {
  cachedForecast,
  clearForecastCache,
  createCalendarFeedHandler,
  validCoordinates,
  validFeedToken,
}
