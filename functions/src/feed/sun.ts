// Calendar feed forecast: the daytime UV series per day and the ICS events for
// each activity's best window. The calculations come from @solara/core; the forecast
// itself comes from the shared forecast cache (forecast/proxy.ts, feed/functions.ts).

import {
  type Daylight,
  type IcsEvent,
  type PreferredHours,
  type RecommendationHour,
  bestWindow,
  daylightHours,
  effectiveMaxUV,
  findWindows,
  formatUV,
  forecastDates,
  hourlyRows,
  isPlannableHour,
  parseOpenMeteoResponse,
  parsePlanningPreferences,
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
  /** The day's hours with the sun up at the place, which bound its windows, as in the app. */
  daylight?: Daylight | null
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

/**
 * Daytime (06-20) hours with a known UV, grouped by date. Unknown hours are omitted.
 * With the forecast's `place`, each day also carries its daylight (sunrise to sunset in
 * the forecast's zone), so no window is offered in the dark, as in the app.
 */
export function parseSunForecast(
  raw: unknown,
  days: number,
  place?: { lat: number; lon: number },
): SunForecastDay[] {
  const response = parseOpenMeteoResponse(raw)
  const rows = hourlyRows(response)
  const zone = response.timezone
  const sunUp = (dateStr: string) =>
    place && zone ? { daylight: daylightHours(place, dateStr, zone) } : {}
  return forecastDates(rows)
    .slice(0, days)
    .map(dateStr => ({
      dateStr,
      ...sunUp(dateStr),
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

/** "6:00", "7:10": a fractional local hour in the description's 24-hour clock. */
function clock(hours: number): string {
  const minutes = Math.round(hours * 60)
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`
}

/**
 * Build ICS events for each activity's best window on each eligible day. The account's
 * activities are read as the app reads them (packages/core/src/planning.ts): invalid
 * ones are skipped and bad fields fall back to the app's defaults.
 */
export function buildSunEvents(user: unknown, forecast: SunForecastDay[]): IcsEvent[] {
  const activities = parsePlanningPreferences(user).activities.filter(act =>
    validActivityId(act.id),
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
        day.daylight,
      )
      if (!win) continue
      const durH = (act.durationMins ?? 30) / 60
      const start = win.from
      const end = Math.min(win.from + durH, win.to)
      events.push({
        uid: windowEventUid(day.dateStr, act.id, start),
        summary: windowEventSummary(act),
        description: `Estimated lower-UV window ${clock(win.from)}–${clock(win.to)} (avg UV ${formatUV(win.avgUV)})${act.sunscreen ? ', assumes SPF 30+' : ', no sunscreen'}. Forecast-based estimate only. Recheck current UV and use sun protection. Planned by Solara.`,
        dateStr: day.dateStr,
        start,
        end,
      })
    }
  }
  return events
}
