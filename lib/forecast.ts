import type { Location, WeatherResponse, HourlyForecast, DayWeather } from './types'

/** Open-Meteo WMO weather code → short human label. */
export function weatherLabel(code: number): string {
  if (code === 0) return 'Clear'
  if (code <= 3) return 'Partly cloudy'
  if (code <= 49) return 'Foggy'
  if (code <= 67) return 'Rainy'
  if (code <= 77) return 'Snowy'
  if (code <= 82) return 'Showers'
  return 'Stormy'
}

/** Local YYYY-MM-DD for `daysFromNow` (en-CA renders ISO-style). */
export function localDateString(daysFromNow = 0): string {
  const d = new Date()
  d.setDate(d.getDate() + daysFromNow)
  return d.toLocaleDateString('en-CA')
}

const DAY_START = 6
const DAY_END = 20

interface RawForecast {
  current?: { uv_index: number; temperature_2m: number; weathercode: number }
  hourly: {
    time: string[]
    uv_index: number[]
    temperature_2m: number[]
    weathercode: number[]
    cloudcover?: number[]
  }
}

/** Parse one day's daytime (06–20) hours out of the flat Open-Meteo arrays. */
function parseDay(raw: RawForecast, dateStr: string): HourlyForecast[] {
  return raw.hourly.time
    .map((t, i): HourlyForecast => ({
      date: t.split('T')[0]!,
      hour: parseInt(t.split('T')[1]!.split(':')[0]!),
      uv: Math.round(raw.hourly.uv_index[i]! * 10) / 10,
      tempF: Math.round((raw.hourly.temperature_2m[i]! * 9) / 5 + 32),
      condition: weatherLabel(raw.hourly.weathercode[i]!),
      cloudCover: raw.hourly.cloudcover ? Math.round(raw.hourly.cloudcover[i]!) : undefined,
    }))
    .filter(h => h.date === dateStr && h.hour >= DAY_START && h.hour <= DAY_END)
}

/** Build the normalized WeatherResponse (current + today/tomorrow + N-day forecast). */
export function parseForecast(raw: RawForecast, days = 10): WeatherResponse {
  const dateSet = new Set<string>()
  raw.hourly.time.forEach(t => dateSet.add(t.split('T')[0]!))
  const allDates = Array.from(dateSet).sort()

  const forecast: DayWeather[] = allDates.slice(0, days).map((dateStr, idx) => {
    const d = new Date(dateStr + 'T12:00:00')
    const label =
      idx === 0
        ? 'Today'
        : idx === 1
          ? 'Tomorrow'
          : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    return { dateStr, label, hourly: parseDay(raw, dateStr) }
  })

  const cur = raw.current
  return {
    current: {
      uv: cur ? Math.round(cur.uv_index * 10) / 10 : 0,
      tempF: cur ? Math.round((cur.temperature_2m * 9) / 5 + 32) : 0,
      condition: cur ? weatherLabel(cur.weathercode) : 'Clear',
    },
    today: parseDay(raw, localDateString(0)),
    tomorrow: parseDay(raw, localDateString(1)),
    forecast,
  }
}

/**
 * Single source of truth for fetching the forecast. Both the Dashboard and the
 * Calendar consume this so they never disagree or double-fetch. `cloudcover` is
 * requested so cloud-sensitivity (P3) needs no fetch change.
 */
export async function fetchForecast(
  location: Location,
  opts: { days?: number; signal?: AbortSignal } = {},
): Promise<WeatherResponse> {
  const { days = 10, signal } = opts
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${location.lat}&longitude=${location.lon}` +
    `&hourly=uv_index,temperature_2m,weathercode,cloudcover` +
    `&current=uv_index,temperature_2m,weathercode` +
    `&timezone=auto&forecast_days=${days}`
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`Forecast fetch failed: ${res.status}`)
  return parseForecast(await res.json(), days)
}
