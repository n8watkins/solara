// Pure view logic for an imported event's card (components/events/EventCard.tsx): when
// it is, the UV during it, the burn estimate and sunscreen timing, as words. Kept free
// of React so it is unit tested.
import {
  eventBurn,
  eventUV,
  sunscreenTiming,
  wallClockAt,
  zonedDate,
  type EventUV,
  type ImportedEvent,
} from '@solara/core/event-import'
import { confidenceNote, forecastConfidence } from '@solara/core'
import { exposureSummary } from './activity-exposure'
import { dayLabel } from './forecast'
import { SKIN_TYPE_LABELS } from './profiles'
import { daysBetween, formatDate } from './time'
import type { Activity, Profile, SkinType, WeatherResponse } from './types'
import type { UnitFormatters } from './units'
import { formatUV, uvBand, uvLabel, type UVBand } from './weather'

export interface EventCardInput {
  item: ImportedEvent
  /** The forecast at the event's place, or null while it loads. */
  weather: WeatherResponse | null
  /** The activity the event counts as, if any. */
  activity: Activity | null
  skinType: SkinType
  /** In group mode, the most sensitive person, whose skin type is used. */
  mostSensitive: Pick<Profile, 'name'> | null
  /** Forecast days the person's plan shows. */
  planDays: number
  nowMs: number
  fmt: Pick<UnitFormatters, 'time'>
}

export interface EventCardView {
  /** "Today · 8am – 9:30am" in the event place's time. */
  when: string
  uv: EventUV | null
  /** The peak as a badge, when there is a forecast. */
  badge: { value: string; label: string; band: UVBand } | null
  /** "Peak UV 6.5 at 10am · average 4.5". */
  peak: string | null
  burn: string | null
  sunscreen: string | null
  /** "Forecast from Fri, Jun 19", for an event the plan cannot see yet. */
  later: string | null
  /** For a day 4 or more days ahead, how far to trust it (lib forecast-quality wording). */
  confidence: string | null
  /** How the activity's setting changes the UV ("Sand, some shade · 90% of forecast UV"). */
  exposure: string | null
}

function localHours(ms: number, timeZone: string): number {
  const local = wallClockAt(ms, timeZone)
  return local.hour + local.minute / 60
}

/** "1 h 30 min", "45 min", "2 h". */
export function durationText(ms: number): string {
  const minutes = Math.round(ms / 60_000)
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (!h) return `${m} min`
  return m ? `${h} h ${m} min` : `${h} h`
}

function list(items: string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

/** PURE. Everything an event card says. */
export function eventCardView({
  item,
  weather,
  activity,
  skinType,
  mostSensitive,
  planDays,
  nowMs,
  fmt,
}: EventCardInput): EventCardView {
  const zone = weather?.timezone ?? item.timeZone
  const start = Date.parse(item.start)
  const end = Date.parse(item.end)
  const today = weather?.now.date ?? zonedDate(nowMs, zone)
  const startDate = zonedDate(start, zone)
  const time = (ms: number) => fmt.time(localHours(ms, zone))
  const endDate = zonedDate(end, zone)
  const day = dayLabel(startDate, today)
  const endDay = endDate !== startDate ? `${dayLabel(endDate, today)} ` : ''
  const when = `${day} · ${time(start)} – ${endDay}${time(end)}`
  const setting = { shade: activity?.shade, surface: activity?.surface }
  const exposure = activity ? exposureSummary(setting) : null
  const empty = {
    when,
    uv: null,
    badge: null,
    peak: null,
    burn: null,
    sunscreen: null,
    confidence: null,
    exposure,
  }
  if (!weather) return { ...empty, later: null }

  const uv = eventUV({
    start,
    end,
    timeZone: zone,
    hoursOn: date => weather.forecast.find(d => d.dateStr === date)?.hourly,
    planDays,
    today,
    exposure: setting,
  })
  if (uv.kind === 'later') {
    const from = formatDate(uv.fromDate, { weekday: 'short', month: 'short', day: 'numeric' })
    return { ...empty, uv, later: `Forecast from ${from}` }
  }
  if (uv.kind === 'unknown') {
    return { ...empty, uv, later: null, peak: 'No UV forecast for these hours.' }
  }

  const peakAt = Math.max(uv.peakAt, start)
  const peak =
    uv.peakUV < 0.5
      ? 'UV stays near 0 during the event.'
      : `Peak UV ${formatUV(uv.peakUV)} at ${time(peakAt)} · average ${formatUV(uv.avgUV)}`
  const burnInfo = eventBurn(uv, start, end, skinType)
  const who = mostSensitive
    ? `${mostSensitive.name} (${SKIN_TYPE_LABELS[skinType].toLowerCase()} skin, the most sensitive)`
    : `${SKIN_TYPE_LABELS[skinType].toLowerCase()} skin`
  const burn =
    burnInfo.minutes === null
      ? null
      : `Unprotected, ${who} could burn in about ${burnInfo.minutes} min at the peak` +
        (burnInfo.outlasts ? `; the event lasts ${durationText(end - start)}.` : '.')
  const timing = sunscreenTiming(start, end, uv.peakUV)
  const sunscreen = timing
    ? `Sunscreen: apply ${time(timing.applyFrom)} – ${time(timing.applyBy)}` +
      (timing.reapplyAt.length
        ? `, reapply at ${list(timing.reapplyAt.map(time))}, and after swimming or heavy sweating.`
        : `; reapply after swimming or heavy sweating.`)
    : null
  return {
    when,
    uv,
    badge: { value: formatUV(uv.peakUV), label: uvLabel(uv.peakUV), band: uvBand(uv.peakUV) },
    peak,
    burn,
    sunscreen,
    later: null,
    confidence: confidenceNote(forecastConfidence(daysBetween(today, startDate))),
    exposure,
  }
}
