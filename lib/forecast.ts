import type { Location, WeatherResponse, HourlyForecast, DayWeather } from './types'

type OpenMeteoHourlyRow = {
  date: string
  hour: number
  uv: number | null
  tempF: number | null
  weatherCode: number | null
  cloudCover: number | null
}

type ForecastCore = {
  FETCH_TIMEOUT_MS: number
  weatherLabel: (code: number | null) => string
  roundUV: (value: unknown) => number | null
  toFahrenheit: (celsius: unknown) => number | null
  splitTime: (time: unknown) => { date: string; hour: number } | null
  parseHourlyRows: (raw: unknown) => OpenMeteoHourlyRow[]
  isPlannableHour: (row: OpenMeteoHourlyRow) => boolean
  forecastDates: (rows: OpenMeteoHourlyRow[]) => string[]
  forecastUrl: (request: {
    lat: number
    lon: number
    days: number
    hourly: string[]
    current?: string[]
  }) => string
  fetchJson: (
    url: string,
    opts?: { timeoutMs?: number; signal?: AbortSignal; fetchImpl?: typeof fetch },
  ) => Promise<unknown>
}

// The same portable parser the calendar feed and notifier use, so every surface
// reads Open-Meteo identically (including how missing values are handled).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const core = require('../functions/lib/forecast-core') as ForecastCore

/** Open-Meteo WMO weather code to a short human label ("Unknown" when missing). */
export const weatherLabel: (code: number | null) => string = core.weatherLabel

/** Local YYYY-MM-DD for `daysFromNow` (en-CA renders ISO-style). */
export function localDateString(daysFromNow = 0): string {
  const d = new Date()
  d.setDate(d.getDate() + daysFromNow)
  return d.toLocaleDateString('en-CA')
}

/** Raw Open-Meteo forecast. Values may be `null` where the provider has no data. */
export interface RawForecast {
  current?: {
    time?: string
    uv_index?: number | null
    temperature_2m?: number | null
    weathercode?: number | null
  }
  hourly: {
    time: string[]
    uv_index: (number | null)[]
    temperature_2m: (number | null)[]
    weathercode: (number | null)[]
    cloudcover?: (number | null)[]
  }
}

/**
 * One day's daytime (06-20) hours with a known UV and temperature. Hours the
 * provider left blank are omitted rather than guessed, and the recommendation
 * engine never bridges an omitted hour, so unknown hours are never recommended.
 */
function daytimeHours(rows: OpenMeteoHourlyRow[], dateStr: string): HourlyForecast[] {
  const hours: HourlyForecast[] = []
  for (const row of rows) {
    if (row.date !== dateStr || !core.isPlannableHour(row)) continue
    if (row.uv === null || row.tempF === null) continue
    hours.push({
      date: row.date,
      hour: row.hour,
      uv: row.uv,
      tempF: row.tempF,
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
function currentConditions(raw: RawForecast, rows: OpenMeteoHourlyRow[]) {
  const now = new Date()
  const at = core.splitTime(raw.current?.time) ?? {
    date: now.toLocaleDateString('en-CA'),
    hour: now.getHours(),
  }
  const row = rows.find(r => r.date === at.date && r.hour === at.hour)
  const uv = core.roundUV(raw.current?.uv_index) ?? row?.uv ?? null
  const tempF = core.toFahrenheit(raw.current?.temperature_2m) ?? row?.tempF ?? null
  if (uv === null || tempF === null) {
    throw new Error('Forecast response has no current UV or temperature')
  }
  const code = raw.current?.weathercode
  return {
    uv,
    tempF,
    condition: core.weatherLabel(
      typeof code === 'number' && Number.isFinite(code) ? code : (row?.weatherCode ?? null),
    ),
  }
}

/** Build the normalized WeatherResponse (current + today/tomorrow + N-day forecast). */
export function parseForecast(raw: RawForecast, days = 10): WeatherResponse {
  const rows = core.parseHourlyRows(raw)

  const forecast: DayWeather[] = core
    .forecastDates(rows)
    .slice(0, days)
    .map((dateStr, idx) => {
      const d = new Date(dateStr + 'T12:00:00')
      const label =
        idx === 0
          ? 'Today'
          : idx === 1
            ? 'Tomorrow'
            : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
      return { dateStr, label, hourly: daytimeHours(rows, dateStr) }
    })

  return {
    current: currentConditions(raw, rows),
    today: daytimeHours(rows, localDateString(0)),
    tomorrow: daytimeHours(rows, localDateString(1)),
    forecast,
  }
}

/**
 * Single source of truth for fetching the forecast. Both the Dashboard and the
 * Calendar consume this so they never disagree or double-fetch. `cloudcover` is
 * requested so cloud-sensitivity (P3) needs no fetch change. The request is
 * abandoned after 5 s so a slow provider surfaces as an error instead of a hang.
 */
export async function fetchForecast(
  location: Location,
  opts: { days?: number; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<WeatherResponse> {
  const { days = 10, signal, timeoutMs = core.FETCH_TIMEOUT_MS } = opts
  const url = core.forecastUrl({
    lat: location.lat,
    lon: location.lon,
    days,
    hourly: ['uv_index', 'temperature_2m', 'weathercode', 'cloudcover'],
    current: ['uv_index', 'temperature_2m', 'weathercode'],
  })
  const raw = (await core.fetchJson(url, { signal, timeoutMs })) as RawForecast
  return parseForecast(raw, days)
}
