const recommendation = require('./recommendation-engine')
const {
  fetchJson,
  forecastDates,
  forecastUrl,
  isPlannableHour,
  parseHourlyRows,
} = require('./forecast-core')
const { validActivityId } = require('./ics')

const { effectiveMaxUV, runsOn, bestWindow } = recommendation

// A forecast older than this is no longer served when the provider is down.
const LAST_GOOD_MAX_AGE_MS = 6 * 60 * 60 * 1000
const MAX_LAST_GOOD_ENTRIES = 500
const lastGoodForecasts = new Map()

function safeWindows(hourly, maxUV, durationMins, activity) {
  return recommendation.findWindows(hourly, maxUV, durationMins, activity?.preferredHours)
}

/** Daytime (06-20) hours with a known UV, grouped by date. Unknown hours are omitted. */
function parseSunForecast(raw, days) {
  const rows = parseHourlyRows(raw)
  return forecastDates(rows)
    .slice(0, days)
    .map(dateStr => ({
      dateStr,
      hourly: rows
        .filter(row => row.date === dateStr && isPlannableHour(row))
        .map(row => ({ hour: row.hour, uv: row.uv })),
    }))
}

function lastGoodKey(lat, lon, days) {
  return `${Number(lat).toFixed(2)}:${Number(lon).toFixed(2)}:${days}`
}

function rememberLastGood(key, forecast, now) {
  lastGoodForecasts.delete(key)
  lastGoodForecasts.set(key, { forecast, fetchedAt: now })
  if (lastGoodForecasts.size > MAX_LAST_GOOD_ENTRIES) {
    lastGoodForecasts.delete(lastGoodForecasts.keys().next().value)
  }
}

/**
 * Fetch daytime (06-20) hourly UV per day for `days` days. The request times out
 * after 5 s. When the provider fails, the last good forecast for the same place
 * (at most 6 hours old) is returned instead; otherwise the error is thrown.
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
        message: error?.message,
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

/** Build ICS events for each activity's best window on each eligible day. */
function buildSunEvents(user, forecast) {
  const activities = (user.activities || []).filter(act => validActivityId(act?.id))
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
        uid: `${day.dateStr}-${act.id}-${Math.round(start * 60)}@solara`,
        summary: `${act.icon || '☀️'} ${act.name}: lower-UV window`,
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
