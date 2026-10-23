// A forecast with a hole in it: every day is overcast (UV stays at or below 3,
// so every activity's threshold is met all day), but Open-Meteo has no UV for
// 12:00-14:00 and returns `null` there. Solara must not recommend those hours;
// before CQ-1 was fixed, the null hours read as UV 0 and every activity got one
// all-day window straight through the gap.
import { parseForecast } from '@/lib/forecast'
import type { WeatherResponse } from '@/lib/types'
import { buildRawForecast } from './fixtures'

/** Local hours [from, to) whose UV the provider left blank, on every day. */
export const UV_GAP = { from: 12, to: 15 } as const

const OVERCAST_PEAK_UV = 3

export function buildGapWeather(): WeatherResponse {
  const raw = buildRawForecast()
  const known = raw.hourly.uv_index.filter((uv): uv is number => uv !== null)
  const peak = Math.max(...known)
  const uv = raw.hourly.time.map((time, i) => {
    const hour = Number(time.slice(11, 13))
    const value = raw.hourly.uv_index[i] ?? null
    if (value === null || (hour >= UV_GAP.from && hour < UV_GAP.to)) return null
    return Math.round((value / peak) * OVERCAST_PEAK_UV * 10) / 10
  })
  return parseForecast(
    {
      ...raw,
      current: { ...raw.current, uv_index: null },
      hourly: { ...raw.hourly, uv_index: uv },
    },
    10,
  )
}
