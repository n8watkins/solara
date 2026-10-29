// The daily briefing: one day's UV "at a glance" as short sentences, built only
// from the forecast and the person's plan. It is deterministic (the same input
// always gives the same words) and free of Firebase, browser and Node-only APIs,
// so the dashboard card, a share and a future morning push all say the same.
import {
  burnMins,
  effectiveMaxUV,
  findWindows,
  lowestUVWindow,
  runsOn,
  summarizeWindow,
  type PreferredHours,
  type RecommendationWindow,
  type SkinType,
} from './recommendation'
import type { ExposureSetting } from './exposure'
import { cloudEffect, planningHours, type CloudEffect } from './forecast-quality'
import { formatUV, uvLabel } from './uv-scale'
import type { Daylight } from './sun-times'
import {
  formatTemperature,
  weatherLimits,
  weatherSpans,
  weatherText,
  type WeatherHour,
  type WeatherSetting,
  type WeatherSpan,
} from './weather-fit'

/** One forecast hour of the briefed day (local hour, forecast UV, rain and heat). */
export interface BriefingHour extends Partial<WeatherHour> {
  hour: number
  uv: number
  /** UV under a clear sky, when the forecast has it (see skyUV). */
  clearSkyUV?: number | null
}

/** A forecast day: its local date and daytime hours in order. */
export interface BriefingDay {
  date: string
  hourly: readonly BriefingHour[]
}

/** The parts of an activity the briefing plans with. */
export interface BriefingActivity extends WeatherSetting {
  name: string
  maxUV?: number | null
  sunscreen?: boolean | null
  durationMins?: number | null
  preferredHours?: PreferredHours | null
  daysOfWeek?: readonly number[] | null
  /** Plan with the forecast's clouds instead of a clear sky (see skyUV). */
  cloudSensitive?: boolean | null
  shade?: ExposureSetting['shade']
  surface?: ExposureSetting['surface']
}

/** UV at which public-health guidance recommends sun protection (WHO). */
export const PROTECT_FROM_UV = 3
/** UV at which the WHO advises seeking shade at midday ("Very high"). */
export const SHADE_FROM_UV = 8

// The thresholds in words (REVIEW5 L5): the bands read the whole-number index (WHO), so
// a forecast of 2.8 shows in a Moderate chip; copy that said "when UV is 3 or more"
// beside it read as a contradiction. Naming the bands, as the chips do, never does.
// In a sentence the band names are lower case ("while UV is moderate or higher").
const band = (uv: number) => uvLabel(uv).toLowerCase()
/** "moderate or higher": UV from PROTECT_FROM_UV on. */
const PROTECT_TEXT = `${band(PROTECT_FROM_UV)} or higher`
/** "low": UV below PROTECT_FROM_UV. */
const BELOW_PROTECT = band(PROTECT_FROM_UV - 1)
/** "very high or extreme": UV from SHADE_FROM_UV on. */
const SHADE_TEXT = `${band(SHADE_FROM_UV)} or ${band(11)}`
const NBSP = '\u00a0'
/** Below this the sun is down or UV is negligible (no burn estimate). */
const SUN_UP_UV = 0.5

/**
 * The day a briefing covers: today until today is over, then tomorrow, so the night
 * briefs the next day. `todayOver` is whether the sun has set at the place
 * (sun-times.ts), the same notion the dashboard's hero uses; without it, today is over
 * once no UV is left from `nowHour` on. Falls back to today when there is no tomorrow.
 */
export function briefingDay(
  today: BriefingDay,
  tomorrow: BriefingDay | null | undefined,
  nowHour: number,
  todayOver?: boolean | null,
): { day: BriefingDay; which: 'today' | 'tomorrow' } {
  const over = todayOver ?? !today.hourly.some(h => h.hour + 1 > nowHour && h.uv >= SUN_UP_UV)
  if (!over || !tomorrow?.hourly.length) return { day: today, which: 'today' }
  return { day: tomorrow, which: 'tomorrow' }
}

export interface BriefingInput {
  day: BriefingDay
  /** "Today", "Tomorrow" or a date label; starts the one-paragraph text. */
  dayLabel: string
  /**
   * Fractional local hour of "now" when `day` is today: windows and advice cover
   * only the rest of the day, and a passed peak is told in the past tense.
   * Omit for any other day.
   */
  nowHour?: number | null
  activities: readonly BriefingActivity[]
  skinType: SkinType
  /** Formats a fractional local hour ("6:45am"); default 12-hour. */
  formatTime?: (hours: number) => string
  /** Formats a Celsius temperature ("97°F"); default Fahrenheit. */
  formatTemp?: (celsius: number) => string
  /**
   * The day's hours with the sun up (sun-times.ts daylightHours): windows and low-UV
   * spans stay inside them, never in the dark. Omit when the place is unknown.
   */
  daylight?: Daylight | null
}

export interface BriefingWindow {
  /** The activity it suits, or null for the general low-UV hours (no activity runs that day). */
  activity: string | null
  /** Lower-UV spans, earliest first: one for an activity, up to two for low UV in general. */
  spans: { from: number; to: number }[]
}

export interface DailyBriefing {
  date: string
  /** The day's highest UV and its hour; null when UV stays near zero all day. */
  peak: { uv: number; hour: number; passed: boolean } | null
  /** Null when no activity, or no low-UV hour, fits the rest of the day. */
  window: BriefingWindow | null
  /** Minutes to a burn at the peak for the skin type; null without a peak or once it has passed. */
  burnMins: number | null
  /**
   * How much the forecast clouds lower the coming peak, when worth telling (cloudEffect);
   * the peak line then says what UV reaches if the sky clears. Null otherwise.
   */
  cloud: CloudEffect | null
  /** The rain or heat that moved the activity window or took it away (lines.weather), or null. */
  weather: WeatherSpan | null
  /**
   * The sentences, each without a final period. `weather` names the rain or heat that
   * moved or took away the activity window ("Rain likely 2pm–5pm"), and is null when the
   * weather changes nothing.
   */
  lines: { peak: string; window: string; weather: string | null; burn: string | null; tip: string }
  /** One paragraph for a share or a notification. */
  text: string
}

/** "6am", "6:45am", "12pm": the default 12-hour clock. */
export function formatBriefingTime(hours: number): string {
  const total = Math.round(hours * 60)
  const hour = Math.floor(total / 60) % 24
  const minute = total % 60
  const suffix = hour < 12 ? 'am' : 'pm'
  const h12 = hour % 12 === 0 ? 12 : hour % 12
  return `${h12}${minute ? `:${String(minute).padStart(2, '0')}` : ''}${suffix}`
}

interface ActivityPick {
  activity: BriefingActivity
  window: RecommendationWindow
}

/** The lowest window of each activity that runs on the day, trimmed to `from`; the best wins. */
function activityWindow(
  hourly: readonly BriefingHour[],
  activities: readonly BriefingActivity[],
  date: string,
  from: number,
  daylight: Daylight | null,
  weather = true,
): ActivityPick | null {
  let best: ActivityPick | null = null
  for (const activity of activities) {
    if (!runsOn(activity, date)) continue
    const duration = activity.durationMins ?? 0
    // Judged like the app's plans (planningHours): clouds counted once, shade and
    // surface, and the hours its rain and heat limits rule out skipped.
    const planned = planningHours(hourly, activity, weather)
    const windows = findWindows(
      planned,
      effectiveMaxUV(activity),
      duration,
      activity.preferredHours,
      daylight,
    ).flatMap(w => {
      const start = Math.max(w.from, from)
      if (w.to <= start || (w.to - start) * 60 < duration) return []
      return [start === w.from ? w : summarizeWindow(hourly, start, w.to)]
    })
    const window = lowestUVWindow(windows)
    if (window && (!best || window.avgUV < best.window.avgUV)) {
      best = { activity, window }
    }
  }
  return best
}

/**
 * The rain or heat that moved the lowest-UV window, or took it away: the first weather
 * span inside the window the UV alone would pick. Null when the weather changes nothing.
 */
function weatherChange(
  hourly: readonly BriefingHour[],
  activities: readonly BriefingActivity[],
  date: string,
  from: number,
  daylight: Daylight | null,
  best: ActivityPick | null,
) {
  const uvOnly = activityWindow(hourly, activities, date, from, daylight, false)
  if (!uvOnly) return null
  const same =
    best &&
    best.activity === uvOnly.activity &&
    best.window.from === uvOnly.window.from &&
    best.window.to === uvOnly.window.to
  if (same) return null
  return weatherSpans(hourly, weatherLimits(uvOnly.activity), [uvOnly.window])[0] ?? null
}

/**
 * The UV index as the scale reads it: whole numbers, so 2.6 already counts as 3
 * (Moderate), matching the band names (uv-scale.ts).
 */
const index = (uv: number) => Math.round(uv)

/**
 * Spans of at least an hour whose UV index stays below PROTECT_FROM_UV, from `from` on,
 * in daylight.
 */
function lowSpans(
  hourly: readonly BriefingHour[],
  from: number,
  daylight: Daylight | null,
): { from: number; to: number }[] {
  const indexed = hourly.map(h => ({ ...h, planningUV: index(h.uv) }))
  return findWindows(indexed, PROTECT_FROM_UV - 1, 60, null, daylight)
    .map(w => ({ from: Math.max(w.from, from), to: w.to }))
    .filter(w => w.to - w.from >= 1)
    .slice(0, 2)
}

/** The first and last hour (exclusive end) at or above a UV index, from `from` on; null when none. */
function spanAtOrAbove(
  hourly: readonly BriefingHour[],
  uv: number,
  from: number,
): { from: number; to: number } | null {
  const hours = hourly.filter(h => index(h.uv) >= uv && h.hour + 1 > from)
  const first = hours[0]
  const last = hours.at(-1)
  return first && last ? { from: Math.max(first.hour, from), to: last.hour + 1 } : null
}

function sentence(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/**
 * A day's briefing: the peak UV and its time (and what a clear sky would bring when
 * clouds lower it), the lowest-UV window for the person's activities (or the low-UV hours when none runs that day), the burn time
 * at the peak for their skin type and one line of advice.
 */
export function dailyBriefing({
  day,
  dayLabel,
  nowHour,
  activities,
  skinType,
  formatTime = formatBriefingTime,
  formatTemp = celsius => formatTemperature(celsius, 'fahrenheit'),
  daylight = null,
}: BriefingInput): DailyBriefing {
  const from = nowHour ?? -1
  const { hourly } = day
  const top = hourly.reduce<BriefingHour | null>(
    (best, h) => (!best || h.uv > best.uv ? h : best),
    null,
  )
  const peak =
    top && top.uv >= SUN_UP_UV ? { uv: top.uv, hour: top.hour, passed: top.hour + 1 <= from } : null
  // A time range never breaks inside ("5pm to 8pm" stays on one line, REVIEW5 UI 3);
  // the shared text and the alert get plain spaces back below.
  const fromTo = (span: { from: number; to: number }) =>
    `from ${formatTime(span.from)}${NBSP}to${NBSP}${formatTime(span.to)}`
  const range = (span: { from: number; to: number }) =>
    `${formatTime(span.from)}–${formatTime(span.to)}`

  // Clouds are among the least predictable parts of a forecast, so a coming peak they
  // lower also says what a clear sky would bring; a passed peak is history.
  const cloud = peak && !peak.passed ? cloudEffect(hourly) : null
  const peakLine = peak
    ? `${peak.passed ? 'UV peaked' : 'UV peaks'} at ${formatUV(peak.uv)} (${uvLabel(peak.uv)}) around ${formatTime(peak.hour)}${cloud ? `, or ${formatUV(cloud.clearSky)} if the sky clears` : ''}`
    : 'UV stays near zero'

  const running = activities.filter(a => runsOn(a, day.date))
  let window: BriefingWindow | null = null
  let windowLine: string
  let weather: WeatherSpan | null = null
  if (running.length) {
    const best = activityWindow(hourly, running, day.date, from, daylight)
    window = best
      ? { activity: best.activity.name, spans: [{ from: best.window.from, to: best.window.to }] }
      : null
    const who = running.length === 1 ? running[0]!.name : 'your activities'
    // Rain and heat are told only when they moved the window or took it away.
    weather = weatherChange(hourly, running, day.date, from, daylight, best)
    const left = from >= 0 ? 'left ' : ''
    windowLine = best
      ? // "Lowest", not "best": the dashboard's hero names the soonest slot, which can
        // be another window, and both must read as true at once.
        `lowest-UV window: ${best.activity.name} ${range(best.window)}`
      : weather
        ? `no lower-UV window ${left}for ${who} without ${weather.kind === 'rain' ? 'rain' : 'the heat'}`
        : `no lower-UV window ${left}for ${who}`
  } else {
    const spans = lowSpans(hourly, from, daylight)
    window = spans.length ? { activity: null, spans } : null
    const rest = from >= 0 ? 'the rest of the day' : 'all day'
    windowLine =
      !peak || index(peak.uv) < PROTECT_FROM_UV
        ? `UV stays ${BELOW_PROTECT} ${rest}`
        : spans.length
          ? `UV is ${BELOW_PROTECT} ${spans.map((span, i) => (i ? `${formatTime(span.from)}${NBSP}to${NBSP}${formatTime(span.to)}` : fromTo(span))).join(' and ')}`
          : `UV stays ${PROTECT_TEXT} ${rest}`
  }

  // A passed peak's burn time is history; the dashboard's burn card has the current one.
  const burn = peak && !peak.passed ? burnMins(peak.uv, skinType) : null
  const burnLine =
    burn === null ? null : `at the peak, unprotected skin like yours can burn in about ${burn} min`

  // From "now" on when today is under way: "until 5pm" once the span has begun.
  const during = (span: { from: number; to: number }) =>
    span.from <= from ? `until${NBSP}${formatTime(span.to)}` : fromTo(span)
  const shade = spanAtOrAbove(hourly, SHADE_FROM_UV, from)
  const protect = spanAtOrAbove(hourly, PROTECT_FROM_UV, from)
  // The band first, then the hours: "seek shade from 11am to 5pm, when UV is very high"
  // read as if 5pm itself were very high (REVIEW8 QA L4).
  const tip = shade
    ? `seek shade while UV is ${SHADE_TEXT}, ${during(shade)}`
    : protect
      ? `use sun protection while UV is ${PROTECT_TEXT}, ${during(protect)}`
      : peak && index(peak.uv) >= PROTECT_FROM_UV
        ? 'UV stays low for the rest of the day'
        : 'most people need little sun protection today'

  const weatherLine = weather && weatherText(weather, formatTime, formatTemp)
  const lines = {
    peak: sentence(peakLine),
    window: sentence(windowLine),
    weather: weatherLine && sentence(weatherLine),
    burn: burnLine && sentence(burnLine),
    tip: sentence(tip),
  }
  const text = [`${dayLabel}: ${peakLine}`, windowLine, weatherLine, burnLine, tip]
    .filter(Boolean)
    .map(part => sentence(part!))
    .join('. ')
    .replaceAll(NBSP, ' ')
  return {
    date: day.date,
    peak,
    window,
    burnMins: burn,
    cloud,
    weather,
    lines,
    text: `${text}.`,
  }
}
