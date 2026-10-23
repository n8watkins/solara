// Open-Meteo parsing shared by the web app, the calendar feed and the
// notification worker. Keep it free of Firebase, browser and Node-only APIs so
// every surface reads the provider the same way.
//
// The response is validated with Zod at this boundary (zod/mini, whose functional API
// tree-shakes, so the parser adds little to the client bundle). Missing values are never
// coerced: a UV or temperature that is not a finite number is `null`, and an hour
// without a known UV is dropped from the daytime series. The recommendation
// engine never bridges a dropped hour, so an unknown hour can never become part
// of a recommended window.

import * as z from 'zod/mini'

export const OPEN_METEO_FORECAST_URL = 'https://api.open-meteo.com/v1/forecast'
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
const value = z.catch(z.nullable(z.number()), null)
/** A value series; anything that is not an array counts as missing. */
const series = z.catch(z.optional(z.array(value)), undefined)

/**
 * The parts of an Open-Meteo response Solara reads. Only the hourly time axis is
 * required; every value is lenient, so a gap stays a gap instead of failing the
 * whole forecast.
 */
export const OpenMeteoResponseSchema = z.object({
  timezone: z.catch(z.optional(z.string()), undefined),
  current: z.catch(
    z.optional(
      z.object({
        time: z.catch(z.optional(z.string()), undefined),
        uv_index: value,
        temperature_2m: value,
        weathercode: value,
      }),
    ),
    undefined,
  ),
  hourly: z.object({
    // Unreadable timestamps are skipped row by row (see splitTime).
    time: z.array(z.unknown()),
    uv_index: series,
    temperature_2m: series,
    weathercode: series,
    cloudcover: series,
  }),
})

export type OpenMeteoResponse = z.infer<typeof OpenMeteoResponseSchema>

/** Validate an Open-Meteo response. Throws when it has no hourly time series. */
export function parseOpenMeteoResponse(raw: unknown): OpenMeteoResponse {
  const result = OpenMeteoResponseSchema.safeParse(raw)
  if (!result.success) throw new Error('Forecast response was incomplete')
  return result.data
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
export function forecastUrl({ lat, lon, days, hourly, current }: ForecastRequest): string {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isInteger(days)) {
    throw new Error('Invalid forecast request')
  }
  const currentParam = current?.length ? `&current=${current.join(',')}` : ''
  return (
    `${OPEN_METEO_FORECAST_URL}?latitude=${lat}&longitude=${lon}` +
    `&hourly=${hourly.join(',')}${currentParam}&timezone=auto&forecast_days=${days}`
  )
}

export interface FetchJsonOptions {
  timeoutMs?: number
  signal?: AbortSignal
  fetchImpl?: typeof fetch
}

/**
 * GET a JSON document, aborting after `timeoutMs` or when `signal` aborts.
 * Rejects on a non-2xx status.
 */
export async function fetchJson(
  url: string,
  { timeoutMs = FETCH_TIMEOUT_MS, signal, fetchImpl }: FetchJsonOptions = {},
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
    const response = await doFetch(url, { signal: controller.signal })
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
