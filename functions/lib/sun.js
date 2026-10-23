// Calendar feed forecast: the daytime UV series per day and the ICS events for
// each activity's best window. The calculations come from @solara/core.

const {
  bestWindow,
  effectiveMaxUV,
  fetchJson,
  findWindows,
  forecastDates,
  forecastUrl,
  isPlannableHour,
  parseHourlyRows,
  runsOn,
  validActivityId,
  windowEventSummary,
  windowEventUid,
} = require('#core')

/**
 * @typedef {import('#core').IcsEvent} IcsEvent
 * @typedef {import('#core').PreferredHours} PreferredHours
 * @typedef {import('#core').RecommendationHour} RecommendationHour
 * @typedef {{ dateStr: string, hourly: RecommendationHour[] }} SunForecastDay
 * @typedef {{
 *   id?: unknown,
 *   name: string,
 *   icon?: string | null,
 *   maxUV?: number | null,
 *   sunscreen?: boolean | null,
 *   durationMins?: number | null,
 *   preferredHours?: PreferredHours | null,
 *   daysOfWeek?: number[] | null,
 * }} FeedActivity
 */

// A forecast older than this is no longer served when the provider is down.
const LAST_GOOD_MAX_AGE_MS = 6 * 60 * 60 * 1000
const MAX_LAST_GOOD_ENTRIES = 500
/** @type {Map<string, { forecast: SunForecastDay[], fetchedAt: number }>} */
const lastGoodForecasts = new Map()

/**
 * @param {RecommendationHour[]} hourly
 * @param {number} maxUV
 * @param {number} [durationMins]
 * @param {{ preferredHours?: PreferredHours | null }} [activity]
 */
function safeWindows(hourly, maxUV, durationMins, activity) {
  return findWindows(hourly, maxUV, durationMins, activity?.preferredHours)
}

/**
 * Daytime (06-20) hours with a known UV, grouped by date. Unknown hours are omitted.
 *
 * @param {unknown} raw
 * @param {number} days
 * @returns {SunForecastDay[]}
 */
function parseSunForecast(raw, days) {
  const rows = parseHourlyRows(raw)
  return forecastDates(rows)
    .slice(0, days)
    .map(dateStr => ({
      dateStr,
      hourly: rows
        .filter(row => row.date === dateStr && isPlannableHour(row))
        .map(row => ({ hour: row.hour, uv: /** @type {number} */ (row.uv) })),
    }))
}

/** @param {number} lat @param {number} lon @param {number} days */
function lastGoodKey(lat, lon, days) {
  return `${Number(lat).toFixed(2)}:${Number(lon).toFixed(2)}:${days}`
}

/** @param {string} key @param {SunForecastDay[]} forecast @param {number} now */
function rememberLastGood(key, forecast, now) {
  lastGoodForecasts.delete(key)
  lastGoodForecasts.set(key, { forecast, fetchedAt: now })
  const oldest = lastGoodForecasts.keys().next().value
  if (lastGoodForecasts.size > MAX_LAST_GOOD_ENTRIES && oldest !== undefined) {
    lastGoodForecasts.delete(oldest)
  }
}

/**
 * Fetch daytime (06-20) hourly UV per day for `days` days. The request times out
 * after 5 s. When the provider fails, the last good forecast for the same place
 * (at most 6 hours old) is returned instead; otherwise the error is thrown.
 *
 * @param {number} lat
 * @param {number} lon
 * @param {number} days
 * @param {{ fetchImpl?: typeof fetch, now?: number }} [options]
 * @returns {Promise<SunForecastDay[]>}
 */
async function fetchForecast(lat, lon, days, { fetchImpl, now = Date.now() } = {}) {
  const key = lastGoodKey(lat, lon, days)
  try {
    const raw = await fetchJson(forecastUrl({ lat, lon, days, hourly: ['uv_index'] }), {
      fetchImpl,
    })
    const forecast = parseSunForecast(raw, days)
    rememberLastGood(key, forecast, now)
    return forecast
  } catch (error) {
    const lastGood = lastGoodForecasts.get(key)
    if (lastGood && now - lastGood.fetchedAt <= LAST_GOOD_MAX_AGE_MS) {
      console.warn('forecast fetch failed; serving last good forecast', {
        message: error instanceof Error ? error.message : undefined,
        ageMs: now - lastGood.fetchedAt,
      })
      return lastGood.forecast
    }
    throw error
  }
}

function clearLastGoodForecasts() {
  lastGoodForecasts.clear()
}

/**
 * Build ICS events for each activity's best window on each eligible day.
 *
 * @param {{ activities?: FeedActivity[] | null }} user
 * @param {SunForecastDay[]} forecast
 * @returns {IcsEvent[]}
 */
function buildSunEvents(user, forecast) {
  const activities = (user.activities || []).flatMap(act =>
    validActivityId(act?.id) ? [{ ...act, id: act.id }] : [],
  )
  /** @type {IcsEvent[]} */
  const events = []
  for (const day of forecast) {
    for (const act of activities) {
      if (!runsOn(act, day.dateStr)) continue
      const win = bestWindow(
        day.hourly,
        effectiveMaxUV(act),
        act.durationMins ?? 30,
        act.preferredHours,
      )
      if (!win) continue
      const durH = (act.durationMins ?? 30) / 60
      const start = win.from
      const end = Math.min(win.from + durH, win.to)
      events.push({
        uid: windowEventUid(day.dateStr, act.id, start),
        summary: windowEventSummary(act),
        description: `Estimated lower-UV window ${win.from}:00–${win.to}:00 (avg UV ${win.avgUV})${act.sunscreen ? ', assumes SPF 30+' : ', no sunscreen'}. Forecast-based estimate only. Recheck current UV and use sun protection. Planned by Solara.`,
        dateStr: day.dateStr,
        start,
        end,
      })
    }
  }
  return events
}

module.exports = {
  LAST_GOOD_MAX_AGE_MS,
  bestWindow,
  buildSunEvents,
  clearLastGoodForecasts,
  effectiveMaxUV,
  fetchForecast,
  parseSunForecast,
  runsOn,
  safeWindows,
}
