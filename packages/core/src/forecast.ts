// Open-Meteo parsing shared by the web app, the calendar feed and the
// notification worker. Keep it free of Firebase, browser and Node-only APIs so
// every surface reads the provider the same way.
//
// The response is validated with Valibot at this boundary (./schema.ts; its modular
// API tree-shakes, so the parser adds little to the client bundle). Missing values are never
// coerced: a UV or temperature that is not a finite number is `null`, and an hour
// without a known UV is dropped from the daytime series. The recommendation
// engine never bridges a dropped hour, so an unknown hour can never become part
// of a recommended window.

import * as v from 'valibot'
import { finiteNumber, record } from './schema'

export const OPEN_METEO_FORECAST_URL = 'https://api.open-meteo.com/v1/forecast'
/** Open-Meteo's commercial endpoint: the same API on its own host, with an API key. */
export const OPEN_METEO_CUSTOMER_FORECAST_URL = 'https://customer-api.open-meteo.com/v1/forecast'
export const DAY_START_HOUR = 6
export const DAY_END_HOUR = 20
export const FETCH_TIMEOUT_MS = 5000

/**
 * WMO weather interpretation codes (Open-Meteo `weathercode`) to short labels.
 * Each row covers codes up to and including `max`.
 */
export const WEATHER_LABELS: readonly { max: number; label: string }[] = Object.freeze([
  { max: 0, label: 'Clear' },
  { max: 3, label: 'Partly cloudy' },
  { max: 49, label: 'Foggy' },
  { max: 67, label: 'Rainy' },
  { max: 77, label: 'Snowy' },
  { max: 82, label: 'Showers' },
  { max: 86, label: 'Snowy' },
  { max: 99, label: 'Stormy' },
])

/** A WMO weather code as a short label ("Unknown" when missing or out of range). */
export function weatherLabel(code: number | null | undefined): string {
  if (typeof code !== 'number' || !Number.isInteger(code) || code < 0) return 'Unknown'
  return WEATHER_LABELS.find(row => code <= row.max)?.label ?? 'Unknown'
}

/** The provider's raw forecast as requested. Values may be `null` where it has no data. */
export interface OpenMeteoPayload {
  /** IANA zone of the forecast location (Open-Meteo `timezone=auto`). */
  timezone?: string
  current?: {
    time?: string
    uv_index?: number | null
    temperature_2m?: number | null
    weathercode?: number | null
  }
  hourly: {
    time: string[]
    uv_index?: (number | null)[]
    temperature_2m?: (number | null)[]
    weathercode?: (number | null)[]
    cloudcover?: (number | null)[]
  }
}

/** A finite number, or null for anything else (missing, null, NaN, Infinity, wrong type). */
const value = v.fallback(v.nullable(finiteNumber), null)
/** A value series; anything that is not an array counts as missing. */
const series = v.fallback(v.optional(v.array(value)), undefined)

/**
 * The parts of an Open-Meteo response Solara reads. Only the hourly time axis is
 * required; every value is lenient, so a gap stays a gap instead of failing the
 * whole forecast.
 */
export const OpenMeteoResponseSchema = record({
  timezone: v.fallback(v.optional(v.string()), undefined),
  current: v.fallback(
    v.optional(
      record({
        time: v.fallback(v.optional(v.string()), undefined),
        uv_index: value,
        temperature_2m: value,
        weathercode: value,
      }),
    ),
    undefined,
  ),
  hourly: record({
    // Unreadable timestamps are skipped row by row (see splitTime).
    time: v.array(v.unknown()),
    uv_index: series,
    temperature_2m: series,
    weathercode: series,
    cloudcover: series,
  }),
})

export type OpenMeteoResponse = v.InferOutput<typeof OpenMeteoResponseSchema>

/** Validate an Open-Meteo response. Throws when it has no hourly time series. */
export function parseOpenMeteoResponse(raw: unknown): OpenMeteoResponse {
  const result = v.safeParse(OpenMeteoResponseSchema, raw)
  if (!result.success) throw new Error('Forecast response was incomplete')
  return result.output
}

function finiteOrNull(input: unknown): number | null {
  return typeof input === 'number' && Number.isFinite(input) ? input : null
}

/** Forecast UV rounded to one decimal, or null when the provider has no value. */
export function roundUV(input: unknown): number | null {
  const uv = finiteOrNull(input)
  return uv === null || uv < 0 ? null : Math.round(uv * 10) / 10
}

/** Celsius to whole Fahrenheit, or null when the provider has no value. */
export function toFahrenheit(celsius: unknown): number | null {
  const c = finiteOrNull(celsius)
  return c === null ? null : Math.round((c * 9) / 5 + 32)
}

function roundPercent(input: number | null | undefined): number | null {
  return input == null ? null : Math.round(input)
}

const TIME_PATTERN = /^(\d{4}-\d{2}-\d{2})T(\d{2}):\d{2}/

/** Split an Open-Meteo local time ("2026-06-15T10:00") into date and hour. */
export function splitTime(time: unknown): { date: string; hour: number } | null {
  const match = typeof time === 'string' ? TIME_PATTERN.exec(time) : null
  if (!match?.[1]) return null
  const hour = Number(match[2])
  return hour <= 23 ? { date: match[1], hour } : null
}

/** One hourly row of an Open-Meteo response, with unknown values as `null`. */
export interface OpenMeteoHourlyRow {
  date: string
  hour: number
  uv: number | null
  tempF: number | null
  weatherCode: number | null
  cloudCover: number | null
}

/**
 * Every hourly row of an Open-Meteo response, with unknown values as `null`.
 * Rows whose timestamp cannot be read are skipped. Throws when the response has
 * no hourly time series at all.
 */
export function parseHourlyRows(raw: unknown): OpenMeteoHourlyRow[] {
  return hourlyRows(parseOpenMeteoResponse(raw))
}

/** Every hourly row of an already validated response (see parseHourlyRows). */
export function hourlyRows({ hourly }: OpenMeteoResponse): OpenMeteoHourlyRow[] {
  const rows: OpenMeteoHourlyRow[] = []
  hourly.time.forEach((time, index) => {
    const at = splitTime(time)
    if (!at) return
    rows.push({
      date: at.date,
      hour: at.hour,
      uv: roundUV(hourly.uv_index?.[index]),
      tempF: toFahrenheit(hourly.temperature_2m?.[index]),
      weatherCode: hourly.weathercode?.[index] ?? null,
      cloudCover: roundPercent(hourly.cloudcover?.[index]),
    })
  })
  return rows
}

/** True for daytime rows (06-20 local) that carry a known UV value. */
export function isPlannableHour(row: Pick<OpenMeteoHourlyRow, 'uv' | 'hour'>): boolean {
  return row.uv !== null && row.hour >= DAY_START_HOUR && row.hour <= DAY_END_HOUR
}

/** Distinct dates in the response, in order. */
export function forecastDates(rows: readonly Pick<OpenMeteoHourlyRow, 'date'>[]): string[] {
  return Array.from(new Set(rows.map(row => row.date))).sort()
}

export interface ForecastRequest {
  lat: number
  lon: number
  days: number
  hourly: readonly string[]
  current?: readonly string[]
}

/** Open-Meteo forecast URL for the given hourly and current variables. */
export function forecastUrl(
  { lat, lon, days, hourly, current }: ForecastRequest,
  base: string = OPEN_METEO_FORECAST_URL,
): string {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isInteger(days)) {
    throw new Error('Invalid forecast request')
  }
  const currentParam = current?.length ? `&current=${current.join(',')}` : ''
  return (
    `${base}?latitude=${lat}&longitude=${lon}` +
    `&hourly=${hourly.join(',')}${currentParam}&timezone=auto&forecast_days=${days}`
  )
}

/** Days of forecast the app asks for: the paid tier's horizon; lower tiers see fewer. */
export const APP_FORECAST_DAYS = 10

/**
 * The one forecast the app asks for at a place: ten days of hourly UV, temperature,
 * weather code and cloud cover, and the current reading. The forecast proxy fetches
 * exactly this and nothing else, so its cache serves every account at a place.
 */
export function appForecastRequest(lat: number, lon: number): ForecastRequest {
  return {
    lat,
    lon,
    days: APP_FORECAST_DAYS,
    hourly: ['uv_index', 'temperature_2m', 'weathercode', 'cloudcover'],
    current: ['uv_index', 'temperature_2m', 'weathercode'],
  }
}

// ---- Providers -------------------------------------------------------------------------

/**
 * Where a forecast comes from. Every provider answers in Open-Meteo's response shape,
 * and every caller validates the answer with the same parser (parseOpenMeteoResponse),
 * so switching providers never changes how a forecast is read.
 */
export interface ForecastProvider {
  readonly name: string
  /** The HTTP request for a forecast: its URL and any headers. */
  request(forecast: ForecastRequest): { url: string; headers?: Record<string, string> }
}

/** Open-Meteo's free, non-commercial API, called directly. */
export const openMeteoFree: ForecastProvider = Object.freeze({
  name: 'open-meteo-free',
  request: (forecast: ForecastRequest) => ({ url: forecastUrl(forecast) }),
})

/**
 * Open-Meteo's commercial API: the customer host and the subscription's API key.
 * `base` is for tests against a local stand-in.
 */
export function openMeteoCommercial(
  apiKey: string,
  base: string = OPEN_METEO_CUSTOMER_FORECAST_URL,
): ForecastProvider {
  if (!apiKey) throw new Error('Open-Meteo API key is missing')
  return {
    name: 'open-meteo-commercial',
    request: forecast => ({
      url: `${forecastUrl(forecast, base)}&apikey=${encodeURIComponent(apiKey)}`,
    }),
  }
}

/**
 * Solara's forecast proxy (the `forecast` Function), which calls the commercial API with
 * the key kept on the server and caches per place and hour. It serves only the app's
 * forecast (appForecastRequest), so only the coordinates are sent. `appCheckToken` is
 * the App Check token the Function requires.
 */
export function solaraForecastProxy(
  functionsBaseUrl: string,
  appCheckToken: string,
): ForecastProvider {
  return {
    name: 'solara-proxy',
    request: ({ lat, lon }) => ({
      url: `${functionsBaseUrl.replace(/\/$/, '')}/forecast?lat=${lat}&lon=${lon}`,
      headers: { 'X-Firebase-AppCheck': appCheckToken },
    }),
  }
}

/**
 * Fetches a forecast from `provider` and validates it. Rejects on a timeout, a non-2xx
 * status or a response without an hourly time series.
 */
export async function fetchProviderForecast(
  provider: ForecastProvider,
  forecast: ForecastRequest,
  options: Omit<FetchJsonOptions, 'headers'> = {},
): Promise<OpenMeteoResponse> {
  const { url, headers } = provider.request(forecast)
  return parseOpenMeteoResponse(await fetchJson(url, { ...options, headers }))
}

export interface FetchJsonOptions {
  timeoutMs?: number
  signal?: AbortSignal
  fetchImpl?: typeof fetch
  headers?: Record<string, string>
}

/**
 * GET a JSON document, aborting after `timeoutMs` or when `signal` aborts.
 * Rejects on a non-2xx status.
 */
export async function fetchJson(
  url: string,
  { timeoutMs = FETCH_TIMEOUT_MS, signal, fetchImpl, headers }: FetchJsonOptions = {},
): Promise<unknown> {
  const doFetch = fetchImpl ?? globalThis.fetch
  const controller = new AbortController()
  const timer = setTimeout(
    () => controller.abort(new Error(`Forecast request timed out after ${timeoutMs} ms`)),
    timeoutMs,
  )
  const forwardAbort = () => controller.abort(signal?.reason)
  if (signal) {
    if (signal.aborted) forwardAbort()
    else signal.addEventListener('abort', forwardAbort, { once: true })
  }
  try {
    const response = await doFetch(url, {
      signal: controller.signal,
      ...(headers ? { headers } : {}),
    })
    if (!response.ok) throw new Error(`Forecast request failed: ${response.status}`)
    return (await response.json()) as unknown
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
