import * as core from '@solara/core'
import type { OpenMeteoPayload, OpenMeteoResponse, ServedForecast } from '@solara/core'
import type {
  CurrentConditions,
  DayWeather,
  ForecastData,
  ForecastDay,
  HourlyForecast,
  Location,
  WeatherResponse,
} from './types'
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
export const FORECAST_DAYS = core.APP_FORECAST_DAYS

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
} & Pick<ServedForecast, 'stale' | 'fetchedAt'>

const roundCelsius = core.roundCelsius

interface Row {
  date: string
  hour: number
  uv: number | null
  clearSkyUV: number | null
  tempC: number | null
  weatherCode: number | null
  cloudCover: number | null
  rainChance: number | null
  feelsC: number | null
}

function rowsOf({ hourly }: OpenMeteoResponse): Row[] {
  const rows: Row[] = []
  hourly.time.forEach((time, index) => {
    const at = core.splitTime(time)
    if (!at) return
    const cloud = hourly.cloudcover?.[index]
    const rain = hourly.precipitation_probability?.[index]
    rows.push({
      date: at.date,
      hour: at.hour,
      uv: core.roundUV(hourly.uv_index?.[index]),
      clearSkyUV: core.roundUV(hourly.uv_index_clear_sky?.[index]),
      tempC: roundCelsius(hourly.temperature_2m?.[index]),
      weatherCode: hourly.weathercode?.[index] ?? null,
      cloudCover: cloud == null ? null : Math.round(cloud),
      rainChance: rain == null ? null : Math.min(100, Math.max(0, Math.round(rain))),
      feelsC: roundCelsius(hourly.apparent_temperature?.[index]),
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
      // Never below the cloud-aware value, so a provider rounding gap reads as no effect.
      clearSkyUV: row.clearSkyUV === null ? undefined : Math.max(row.clearSkyUV, row.uv),
      // Rain and heat (weather-fit.ts); absent when the provider gave none.
      ...(row.rainChance !== null && { rainChance: row.rainChance }),
      ...(row.feelsC !== null && { feelsC: row.feelsC }),
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

/**
 * When the forecast in `raw` was fetched: the proxy's own time for its earlier copy
 * (never later than when it arrived), otherwise when it arrived.
 */
function servedAt(raw: ServedForecast, receivedAt: number): number {
  return raw.stale && raw.fetchedAt ? Math.min(Date.parse(raw.fetchedAt), receivedAt) : receivedAt
}

/**
 * Validate and normalize a provider's answer into ForecastData. The forecast proxy's
 * earlier copy (`stale` with `fetchedAt`, @solara/core ServedForecastSchema) keeps its
 * real age, so "now" and the notices never present it as current.
 */
export function parseForecast(input: RawForecast, opts: ParseOptions = {}): ForecastData {
  const { days = FORECAST_DAYS } = opts
  const raw = core.parseServedForecast(input)
  const fetchedAt = servedAt(raw, opts.fetchedAt ?? Date.now())
  const timezone = resolveTimeZone(raw.timezone, opts.timeZone)
  const rows = rowsOf(raw)
  const forecastDays: ForecastDay[] = core
    .forecastDates(rows)
    .slice(0, days)
    .map(dateStr => ({ dateStr, hourly: daytimeHours(rows, dateStr) }))
  return {
    timezone,
    fetchedAt,
    ...(raw.stale && { stale: true }),
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
 * it. The device's time zone plays no part. With the forecast's `place`, each day
 * also carries its daylight, which bounds the slots offered on it.
 */
export function forecastView(
  data: ForecastData,
  now: ZonedNow = zonedNow(data.timezone),
  place: Pick<Location, 'lat' | 'lon'> | null = null,
): WeatherResponse {
  const forecast: DayWeather[] = data.days
    .filter(day => day.dateStr >= now.date)
    .map(day => ({
      ...day,
      label: dayLabel(day.dateStr, now.date),
      daylight: place ? core.daylightHours(place, day.dateStr, data.timezone) : null,
    }))
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
 * The Functions origin when the forecast proxy is switched on (NEXT_PUBLIC_FORECAST_PROXY,
 * from the FORECAST_PROXY_ENABLED repository variable), or null. Both values are fixed
 * at build time, so a build without the proxy carries none of its code.
 */
export function forecastProxyBaseUrl(
  env: { proxy?: string; functionsUrl?: string } = {
    proxy: process.env.NEXT_PUBLIC_FORECAST_PROXY,
    functionsUrl: process.env.NEXT_PUBLIC_FUNCTIONS_URL,
  },
): string | null {
  return env.proxy === '1' && env.functionsUrl ? env.functionsUrl.replace(/\/$/, '') : null
}

/**
 * Where this build gets forecasts: Solara's forecast proxy once it is switched on (the
 * commercial Open-Meteo API, decision D5), otherwise Open-Meteo's free API directly.
 * The proxy needs an App Check token, which loads Firebase and reCAPTCHA on demand.
 */
export async function forecastProvider(): Promise<core.ForecastProvider> {
  const proxy = forecastProxyBaseUrl()
  if (!proxy) return core.openMeteoFree
  const { appCheckToken } = await import('./firebase')
  const token = await appCheckToken()
  if (!token) throw new Error('Forecast unavailable: app verification is not set up')
  return core.solaraForecastProxy(proxy, token)
}

/**
 * Single source of truth for fetching the forecast: the app's request
 * (core.appForecastRequest: `uv_index` already includes the forecast clouds,
 * `uv_index_clear_sky` shows how much they take off and `cloudcover` feeds
 * cloud-sensitive activities) from the configured provider, through the shared validated parser.
 * The request is abandoned after 5 s so a slow provider surfaces as an error instead
 * of a hang.
 */
export async function fetchForecast(
  location: Location,
  opts: { days?: number; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<ForecastData> {
  const { days = FORECAST_DAYS, signal, timeoutMs = core.FETCH_TIMEOUT_MS } = opts
  const request = {
    ...core.appForecastRequest(
      core.roundCoordinate(location.lat),
      core.roundCoordinate(location.lon),
    ),
    days,
  }
  const provider = await forecastProvider()
  const raw = await core.fetchServedForecast(provider, request, { signal, timeoutMs })
  return parseForecast(raw as RawForecast, { days, timeZone: location.timezone })
}
