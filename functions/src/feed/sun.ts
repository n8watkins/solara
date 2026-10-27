// Calendar feed forecast: the daytime UV series per day and the ICS events for
// each activity's best window. The calculations come from @solara/core.

import {
  type ForecastProvider,
  type IcsEvent,
  type PreferredHours,
  type RecommendationHour,
  type ShadeLevel,
  type Surface,
  bestWindow,
  effectiveMaxUV,
  exposedUV,
  fetchProviderForecast,
  findWindows,
  forecastDates,
  isPlannableHour,
  openMeteoFree,
  parseHourlyRows,
  runsOn,
  validActivityId,
  windowEventSummary,
  windowEventUid,
} from '#core'
import { logger } from 'firebase-functions/logger'

import { loggableError } from '../shared/errors'

export interface SunForecastDay {
  dateStr: string
  hourly: RecommendationHour[]
}

export interface FeedActivity {
  id?: unknown
  name: string
  icon?: string | null
  maxUV?: number | null
  sunscreen?: boolean | null
  durationMins?: number | null
  preferredHours?: PreferredHours | null
  daysOfWeek?: number[] | null
  shade?: ShadeLevel | null
  surface?: Surface | null
}

export { bestWindow, effectiveMaxUV, runsOn }

// A forecast older than this is no longer served when the provider is down.
export const LAST_GOOD_MAX_AGE_MS = 6 * 60 * 60 * 1000
const MAX_LAST_GOOD_ENTRIES = 500
const lastGoodForecasts = new Map<string, { forecast: SunForecastDay[]; fetchedAt: number }>()

export function safeWindows(
  hourly: RecommendationHour[],
  maxUV: number,
  durationMins?: number,
  activity?: { preferredHours?: PreferredHours | null },
) {
  return findWindows(hourly, maxUV, durationMins, activity?.preferredHours)
}

/** Daytime (06-20) hours with a known UV, grouped by date. Unknown hours are omitted. */
export function parseSunForecast(raw: unknown, days: number): SunForecastDay[] {
  const rows = parseHourlyRows(raw)
  return forecastDates(rows)
    .slice(0, days)
    .map(dateStr => ({
      dateStr,
      hourly: rows
        .filter(row => row.date === dateStr && isPlannableHour(row))
        .map(row => ({ hour: row.hour, uv: row.uv as number })),
    }))
}

function lastGoodKey(lat: number, lon: number, days: number): string {
  return `${Number(lat).toFixed(2)}:${Number(lon).toFixed(2)}:${days}`
}

function rememberLastGood(key: string, forecast: SunForecastDay[], now: number): void {
  lastGoodForecasts.delete(key)
  lastGoodForecasts.set(key, { forecast, fetchedAt: now })
  const oldest = lastGoodForecasts.keys().next().value
  if (lastGoodForecasts.size > MAX_LAST_GOOD_ENTRIES && oldest !== undefined) {
    lastGoodForecasts.delete(oldest)
  }
}

/**
 * Fetch daytime (06-20) hourly UV per day for `days` days from `provider` (the
 * commercial API once its key is set; see forecast/config.ts). The request times out
 * after 5 s. When the provider fails, the last good forecast for the same place
 * (at most 6 hours old) is returned instead; otherwise the error is thrown.
 */
export async function fetchForecast(
  lat: number,
  lon: number,
  days: number,
  {
    fetchImpl,
    now = Date.now(),
    provider = openMeteoFree,
  }: { fetchImpl?: typeof fetch; now?: number; provider?: ForecastProvider } = {},
): Promise<SunForecastDay[]> {
  const key = lastGoodKey(lat, lon, days)
  try {
    const raw = await fetchProviderForecast(
      provider,
      { lat, lon, days, hourly: ['uv_index'] },
      { fetchImpl },
    )
    const forecast = parseSunForecast(raw, days)
    rememberLastGood(key, forecast, now)
    return forecast
  } catch (error) {
    const lastGood = lastGoodForecasts.get(key)
    if (lastGood && now - lastGood.fetchedAt <= LAST_GOOD_MAX_AGE_MS) {
      // No coordinates in the log: they locate the user.
      logger.warn('Forecast fetch failed; serving the last good forecast', {
        error: loggableError(error),
        ageMs: now - lastGood.fetchedAt,
      })
      return lastGood.forecast
    }
    throw error
  }
}

export function clearLastGoodForecasts(): void {
  lastGoodForecasts.clear()
}

/** Build ICS events for each activity's best window on each eligible day. */
export function buildSunEvents(
  user: { activities?: FeedActivity[] | null },
  forecast: SunForecastDay[],
): IcsEvent[] {
  const activities = (user.activities || []).flatMap(act =>
    validActivityId(act?.id) ? [{ ...act, id: act.id }] : [],
  )
  const events: IcsEvent[] = []
  for (const day of forecast) {
    for (const act of activities) {
      if (!runsOn(act, day.dateStr)) continue
      // Each hour is judged by the UV the activity's shade and surface pass on, as in the app.
      const hourly = day.hourly.map(hour => ({ ...hour, planningUV: exposedUV(hour.uv, act) }))
      const win = bestWindow(
        hourly,
        effectiveMaxUV(act),
        act.durationMins ?? 30,
        act.preferredHours,
      )
      if (!win) continue
      const durH = (act.durationMins ?? 30) / 60
      const start = win.from
      const end = Math.min(win.from + durH, win.to)
      events.push({
        uid: windowEventUid(day.dateStr, act.id, start),
        summary: windowEventSummary(act),
        description: `Estimated lower-UV window ${win.from}:00–${win.to}:00 (avg UV ${win.avgUV})${act.sunscreen ? ', assumes SPF 30+' : ', no sunscreen'}. Forecast-based estimate only. Recheck current UV and use sun protection. Planned by Solara.`,
        dateStr: day.dateStr,
        start,
        end,
      })
    }
  }
  return events
}
