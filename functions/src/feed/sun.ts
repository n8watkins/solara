// Calendar feed forecast: the daytime UV series per day and the ICS events for
// each activity's best window. The calculations come from @solara/core; the forecast
// itself comes from the shared forecast cache (forecast/proxy.ts, feed/functions.ts).

import {
  type IcsEvent,
  type PreferredHours,
  type RecommendationHour,
  type ShadeLevel,
  type Surface,
  bestWindow,
  effectiveMaxUV,
  findWindows,
  forecastDates,
  isPlannableHour,
  parseHourlyRows,
  planningUV,
  runsOn,
  validActivityId,
  windowEventSummary,
  windowEventUid,
} from '#core'

export interface SunForecastDay {
  dateStr: string
  /** UV with the forecast clouds, and under a clear sky when the provider gave it. */
  hourly: (RecommendationHour & { clearSkyUV?: number })[]
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
  cloudSensitive?: boolean | null
}

export { bestWindow, effectiveMaxUV, runsOn }

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
        .map(row => ({
          hour: row.hour,
          uv: row.uv as number,
          // Never below the cloud-aware value, as in the app (lib/forecast.ts).
          ...(row.clearSkyUV === null
            ? {}
            : { clearSkyUV: Math.max(row.clearSkyUV, row.uv as number) }),
        })),
    }))
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
      // Each hour is judged as in the app: clouds counted once, then shade and surface.
      const hourly = day.hourly.map(hour => ({ ...hour, planningUV: planningUV(hour, act) }))
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
