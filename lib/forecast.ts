import * as core from '@solara/core'
import type { OpenMeteoHourlyRow, OpenMeteoPayload, OpenMeteoResponse } from '@solara/core'
import type { Location, WeatherResponse, HourlyForecast, DayWeather } from './types'
import { roundCoordinate } from './geocoding'

// The same Zod-validated parser the calendar feed and notifier use, so every
// surface reads Open-Meteo identically (including how missing values are handled).

/** Open-Meteo WMO weather code to a short human label ("Unknown" when missing). */
export const weatherLabel = core.weatherLabel

/** Local YYYY-MM-DD for `daysFromNow` (en-CA renders ISO-style). */
export function localDateString(daysFromNow = 0): string {
  const d = new Date()
  d.setDate(d.getDate() + daysFromNow)
  return d.toLocaleDateString('en-CA')
}

/**
 * Raw Open-Meteo forecast with the series the app requests. Values may be
 * `null` where the provider has no data.
 */
export type RawForecast = OpenMeteoPayload & {
  hourly: Required<Pick<OpenMeteoPayload['hourly'], 'uv_index' | 'temperature_2m' | 'weathercode'>>
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

/** Today's date and hour in the forecast location's zone, or the device's when unknown. */
function wallClockIn(timeZone: string | undefined): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date())
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === type)?.value ?? ''
  return { date: `${part('year')}-${part('month')}-${part('day')}`, hour: Number(part('hour')) }
}

/**
 * Current conditions. Falls back to the hourly row for the current hour when the
 * provider's `current` block is missing a value. Throws when UV or temperature
 * is unknown either way, so a gap is never shown as UV 0.
 */
function currentConditions(raw: OpenMeteoResponse, rows: OpenMeteoHourlyRow[]) {
  const at = core.splitTime(raw.current?.time) ?? wallClockIn(raw.timezone)
  const row = rows.find(r => r.date === at.date && r.hour === at.hour)
  const uv = core.roundUV(raw.current?.uv_index) ?? row?.uv ?? null
  const tempF = core.toFahrenheit(raw.current?.temperature_2m) ?? row?.tempF ?? null
  if (uv === null || tempF === null) {
    throw new Error('Forecast response has no current UV or temperature')
  }
  return {
    uv,
    tempF,
    condition: core.weatherLabel(raw.current?.weathercode ?? row?.weatherCode ?? null),
  }
}

/** Build the normalized WeatherResponse (current + today/tomorrow + N-day forecast). */
export function parseForecast(input: RawForecast, days = 10): WeatherResponse {
  const raw = core.parseOpenMeteoResponse(input)
  const rows = core.hourlyRows(raw)

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
    lat: roundCoordinate(location.lat),
    lon: roundCoordinate(location.lon),
    days,
    hourly: ['uv_index', 'temperature_2m', 'weathercode', 'cloudcover'],
    current: ['uv_index', 'temperature_2m', 'weathercode'],
  })
  const raw = await core.fetchJson(url, { signal, timeoutMs })
  return parseForecast(raw as RawForecast, days)
}
