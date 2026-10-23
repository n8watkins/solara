'use strict'

// Portable Open-Meteo parsing shared by the browser bundle (lib/forecast.ts), the
// calendar feed (functions/lib/sun.js) and the notification worker
// (scripts/send-notifications.js). Keep it free of Firebase, browser and Node-only
// APIs so every surface reads the provider the same way.
//
// Missing values are never coerced: a UV or temperature that is not a finite
// number is `null`, and an hour without a known UV is dropped from the daytime
// series. The recommendation engine never bridges a dropped hour, so an unknown
// hour can never become part of a recommended window.

const OPEN_METEO_FORECAST_URL = 'https://api.open-meteo.com/v1/forecast'
const DAY_START_HOUR = 6
const DAY_END_HOUR = 20
const FETCH_TIMEOUT_MS = 5000

/**
 * WMO weather interpretation codes (Open-Meteo `weathercode`) to short labels.
 * Each row covers codes up to and including `max`.
 */
const WEATHER_LABELS = Object.freeze([
  { max: 0, label: 'Clear' },
  { max: 3, label: 'Partly cloudy' },
  { max: 49, label: 'Foggy' },
  { max: 67, label: 'Rainy' },
  { max: 77, label: 'Snowy' },
  { max: 82, label: 'Showers' },
  { max: 86, label: 'Snowy' },
  { max: 99, label: 'Stormy' },
])

function weatherLabel(code) {
  if (!Number.isInteger(code) || code < 0) return 'Unknown'
  return WEATHER_LABELS.find(row => code <= row.max)?.label ?? 'Unknown'
}

function finiteOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** Forecast UV rounded to one decimal, or null when the provider has no value. */
function roundUV(value) {
  const uv = finiteOrNull(value)
  return uv === null || uv < 0 ? null : Math.round(uv * 10) / 10
}

/** Celsius to whole Fahrenheit, or null when the provider has no value. */
function toFahrenheit(celsius) {
  const c = finiteOrNull(celsius)
  return c === null ? null : Math.round((c * 9) / 5 + 32)
}

function roundPercent(value) {
  const pct = finiteOrNull(value)
  return pct === null ? null : Math.round(pct)
}

const TIME_PATTERN = /^(\d{4}-\d{2}-\d{2})T(\d{2}):\d{2}/

/** Split an Open-Meteo local time ("2026-06-15T10:00") into date and hour. */
function splitTime(time) {
  const match = typeof time === 'string' ? TIME_PATTERN.exec(time) : null
  if (!match) return null
  const hour = Number(match[2])
  return hour <= 23 ? { date: match[1], hour } : null
}

function seriesValue(series, index) {
  return Array.isArray(series) ? series[index] : undefined
}

/**
 * Every hourly row of an Open-Meteo response, with unknown values as `null`.
 * Rows whose timestamp cannot be read are skipped. Throws when the response has
 * no hourly time series at all.
 */
function parseHourlyRows(raw) {
  const hourly = raw?.hourly
  if (!hourly || !Array.isArray(hourly.time)) {
    throw new Error('Forecast response was incomplete')
  }
  const rows = []
  hourly.time.forEach((time, index) => {
    const at = splitTime(time)
    if (!at) return
    rows.push({
      date: at.date,
      hour: at.hour,
      uv: roundUV(seriesValue(hourly.uv_index, index)),
      tempF: toFahrenheit(seriesValue(hourly.temperature_2m, index)),
      weatherCode: finiteOrNull(seriesValue(hourly.weathercode, index)),
      cloudCover: roundPercent(seriesValue(hourly.cloudcover, index)),
    })
  })
  return rows
}

/** True for daytime rows (06-20 local) that carry a known UV value. */
function isPlannableHour(row) {
  return row.uv !== null && row.hour >= DAY_START_HOUR && row.hour <= DAY_END_HOUR
}

/** Distinct dates in the response, in order. */
function forecastDates(rows) {
  return Array.from(new Set(rows.map(row => row.date))).sort()
}

/** Open-Meteo forecast URL for the given hourly and current variables. */
function forecastUrl({ lat, lon, days, hourly, current }) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isInteger(days)) {
    throw new Error('Invalid forecast request')
  }
  const currentParam = current?.length ? `&current=${current.join(',')}` : ''
  return (
    `${OPEN_METEO_FORECAST_URL}?latitude=${lat}&longitude=${lon}` +
    `&hourly=${hourly.join(',')}${currentParam}&timezone=auto&forecast_days=${days}`
  )
}

/**
 * GET a JSON document, aborting after `timeoutMs` or when `signal` aborts.
 * Rejects on a non-2xx status.
 */
async function fetchJson(url, { timeoutMs = FETCH_TIMEOUT_MS, signal, fetchImpl } = {}) {
  const doFetch = fetchImpl ?? globalThis.fetch
  const controller = new AbortController()
  const timer = setTimeout(
    () => controller.abort(new Error(`Forecast request timed out after ${timeoutMs} ms`)),
    timeoutMs,
  )
  const forwardAbort = () => controller.abort(signal.reason)
  if (signal) {
    if (signal.aborted) forwardAbort()
    else signal.addEventListener('abort', forwardAbort, { once: true })
  }
  try {
    const response = await doFetch(url, { signal: controller.signal })
    if (!response.ok) throw new Error(`Forecast request failed: ${response.status}`)
    return await response.json()
  } catch (error) {
    // Report the timeout or caller's reason rather than a generic AbortError.
    if (controller.signal.aborted && controller.signal.reason !== undefined) {
      throw controller.signal.reason
    }
    throw error
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', forwardAbort)
  }
}

module.exports = {
  DAY_END_HOUR,
  DAY_START_HOUR,
  FETCH_TIMEOUT_MS,
  WEATHER_LABELS,
  fetchJson,
  forecastDates,
  forecastUrl,
  isPlannableHour,
  parseHourlyRows,
  roundUV,
  splitTime,
  toFahrenheit,
  weatherLabel,
}
