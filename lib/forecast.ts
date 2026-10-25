import * as core from '@solara/core'
import type { OpenMeteoPayload, OpenMeteoResponse } from '@solara/core'
import type {
  CurrentConditions,
  DayWeather,
  ForecastData,
  ForecastDay,
  HourlyForecast,
  Location,
  WeatherResponse,
} from './types'
import { roundCoordinate } from './geocoding'
import { addDays, formatDate, resolveTimeZone, zonedNow, type ZonedNow } from './time'

// The same Valibot-validated parser the calendar feed and notifier use, so every
// surface reads Open-Meteo identically (including how missing values are handled).
//
// A fetched forecast is stored as ForecastData: Celsius, the location's time zone
// and the provider's calendar dates, with no "today" baked in. forecastView turns
// it into what the screens show at one instant, so "today", "now" and the day
// labels always come from the location's clock and roll over at its midnight.

/** Open-Meteo WMO weather code to a short human label ("Unknown" when missing). */
export const weatherLabel = core.weatherLabel

/** Days of forecast the app requests (the paid tier's horizon; lower tiers see fewer). */
export const FORECAST_DAYS = 10

/**
 * The current reading is trusted for this long after the fetch. Past it, "now"
 * falls back to the forecast for the current hour, so a cached forecast never
 * presents an old reading as current.
 */
export const CURRENT_READING_MAX_AGE_MS = 90 * 60 * 1000

/**
 * Raw Open-Meteo forecast with the series the app requests. Values may be
 * `null` where the provider has no data.
 */
export type RawForecast = OpenMeteoPayload & {
  hourly: Required<Pick<OpenMeteoPayload['hourly'], 'uv_index' | 'temperature_2m' | 'weathercode'>>
}

/** A Celsius value rounded to 0.1, or null when the provider has no finite value. */
function roundCelsius(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 10) / 10 : null
}

interface Row {
  date: string
  hour: number
  uv: number | null
  tempC: number | null
  weatherCode: number | null
  cloudCover: number | null
}

function rowsOf({ hourly }: OpenMeteoResponse): Row[] {
  const rows: Row[] = []
  hourly.time.forEach((time, index) => {
    const at = core.splitTime(time)
    if (!at) return
    const cloud = hourly.cloudcover?.[index]
    rows.push({
      date: at.date,
      hour: at.hour,
      uv: core.roundUV(hourly.uv_index?.[index]),
      tempC: roundCelsius(hourly.temperature_2m?.[index]),
      weatherCode: hourly.weathercode?.[index] ?? null,
      cloudCover: cloud == null ? null : Math.round(cloud),
    })
  })
  return rows
}

/**
 * One day's daytime (06-20) hours with a known UV and temperature. Hours the
 * provider left blank are omitted rather than guessed, and the recommendation
 * engine never bridges an omitted hour, so unknown hours are never recommended.
 */
function daytimeHours(rows: Row[], dateStr: string): HourlyForecast[] {
  const hours: HourlyForecast[] = []
  for (const row of rows) {
    if (row.date !== dateStr || !core.isPlannableHour(row)) continue
    if (row.uv === null || row.tempC === null) continue
    hours.push({
      date: row.date,
      hour: row.hour,
      uv: row.uv,
      tempC: row.tempC,
      condition: core.weatherLabel(row.weatherCode),
      cloudCover: row.cloudCover ?? undefined,
    })
  }
  return hours
}

/**
 * Current conditions. Falls back to the hourly row for the current hour when the
 * provider's `current` block is missing a value. Throws when UV or temperature
 * is unknown either way, so a gap is never shown as UV 0.
 */
function currentConditions(raw: OpenMeteoResponse, rows: Row[], timeZone: string, at: number) {
  const now = core.splitTime(raw.current?.time) ?? zonedNow(timeZone, at)
  const row = rows.find(r => r.date === now.date && r.hour === now.hour)
  const uv = core.roundUV(raw.current?.uv_index) ?? row?.uv ?? null
  const tempC = roundCelsius(raw.current?.temperature_2m) ?? row?.tempC ?? null
  if (uv === null || tempC === null) {
    throw new Error('Forecast response has no current UV or temperature')
  }
  return {
    uv,
    tempC,
    condition: core.weatherLabel(raw.current?.weathercode ?? row?.weatherCode ?? null),
  }
}

export interface ParseOptions {
  /** Days to keep (default FORECAST_DAYS). */
  days?: number
  /** Zone to assume when the response does not name one (normally the location's). */
  timeZone?: string
  /** When the response was received (default now). */
  fetchedAt?: number
}

/** Validate and normalize an Open-Meteo response into ForecastData. */
export function parseForecast(input: RawForecast, opts: ParseOptions = {}): ForecastData {
  const { days = FORECAST_DAYS, fetchedAt = Date.now() } = opts
  const raw = core.parseOpenMeteoResponse(input)
  const timezone = resolveTimeZone(raw.timezone, opts.timeZone)
  const rows = rowsOf(raw)
  const forecastDays: ForecastDay[] = core
    .forecastDates(rows)
    .slice(0, days)
    .map(dateStr => ({ dateStr, hourly: daytimeHours(rows, dateStr) }))
  return {
    timezone,
    fetchedAt,
    current: currentConditions(raw, rows, timezone, fetchedAt),
    days: forecastDays,
  }
}

/** "Today", "Tomorrow" or "Wed, Jun 17", relative to `today`. */
export function dayLabel(dateStr: string, today: string): string {
  if (dateStr === today) return 'Today'
  if (dateStr === addDays(today, 1)) return 'Tomorrow'
  return formatDate(dateStr, { weekday: 'short', month: 'short', day: 'numeric' })
}

/** The live reading while it is recent; afterwards the forecast for the current hour. */
function currentAt(data: ForecastData, today: HourlyForecast[], now: ZonedNow): CurrentConditions {
  if (now.epochMs - data.fetchedAt <= CURRENT_READING_MAX_AGE_MS) return data.current
  const hour = today.find(h => h.hour === now.hour)
  return hour ? { uv: hour.uv, tempC: hour.tempC, condition: hour.condition } : data.current
}

/**
 * The forecast as seen at `now` in the forecast's own zone: past days dropped,
 * "today" and "tomorrow" picked by the location's date, and labels relative to
 * it. The device's time zone plays no part.
 */
export function forecastView(
  data: ForecastData,
  now: ZonedNow = zonedNow(data.timezone),
): WeatherResponse {
  const forecast: DayWeather[] = data.days
    .filter(day => day.dateStr >= now.date)
    .map(day => ({ ...day, label: dayLabel(day.dateStr, now.date) }))
  const today = forecast.find(day => day.dateStr === now.date)?.hourly ?? []
  const tomorrow = forecast.find(day => day.dateStr === addDays(now.date, 1))?.hourly ?? []
  return {
    timezone: data.timezone,
    now,
    current: currentAt(data, today, now),
    today,
    tomorrow,
    forecast,
  }
}

/**
 * Single source of truth for fetching the forecast. `cloudcover` is requested so
 * cloud sensitivity needs no fetch change. The request is abandoned after 5 s
 * so a slow provider surfaces as an error instead of a hang.
 */
export async function fetchForecast(
  location: Location,
  opts: { days?: number; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<ForecastData> {
  const { days = FORECAST_DAYS, signal, timeoutMs = core.FETCH_TIMEOUT_MS } = opts
  const url = core.forecastUrl({
    lat: roundCoordinate(location.lat),
    lon: roundCoordinate(location.lon),
    days,
    hourly: ['uv_index', 'temperature_2m', 'weathercode', 'cloudcover'],
    current: ['uv_index', 'temperature_2m', 'weathercode'],
  })
  const raw = await core.fetchJson(url, { signal, timeoutMs })
  return parseForecast(raw as RawForecast, { days, timeZone: location.timezone })
}
