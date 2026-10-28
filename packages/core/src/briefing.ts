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
import { planningUV } from './forecast-quality'
import { formatUV, uvLabel } from './uv-scale'

/** One forecast hour of the briefed day (local hour, forecast UV). */
export interface BriefingHour {
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
export interface BriefingActivity {
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
/** Below this the sun is down or UV is negligible (no burn estimate). */
const SUN_UP_UV = 0.5

/**
 * The day a briefing covers: today while any UV is left from `nowHour` on, else
 * tomorrow (after sunset, or on a day with no UV left), so the evening and night
 * brief the next day. Falls back to today when there is no tomorrow.
 */
export function briefingDay(
  today: BriefingDay,
  tomorrow: BriefingDay | null | undefined,
  nowHour: number,
): { day: BriefingDay; which: 'today' | 'tomorrow' } {
  const uvLeft = today.hourly.some(h => h.hour + 1 > nowHour && h.uv >= SUN_UP_UV)
  if (uvLeft || !tomorrow?.hourly.length) return { day: today, which: 'today' }
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
  /** The sentences, each without a final period. */
  lines: { peak: string; window: string; burn: string | null; tip: string }
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

/** The lowest window of each activity that runs on the day, trimmed to `from`; the best wins. */
function activityWindow(
  hourly: readonly BriefingHour[],
  activities: readonly BriefingActivity[],
  date: string,
  from: number,
): { activity: string; window: RecommendationWindow } | null {
  let best: { activity: string; window: RecommendationWindow } | null = null
  for (const activity of activities) {
    if (!runsOn(activity, date)) continue
    const duration = activity.durationMins ?? 0
    // Judged like the app's plans (planningUV): clouds counted once, shade and surface.
    const planned = hourly.map(h => ({ ...h, planningUV: planningUV(h, activity) }))
    const windows = findWindows(
      planned,
      effectiveMaxUV(activity),
      duration,
      activity.preferredHours,
    ).flatMap(w => {
      const start = Math.max(w.from, from)
      if (w.to <= start || (w.to - start) * 60 < duration) return []
      return [start === w.from ? w : summarizeWindow(hourly, start, w.to)]
    })
    const window = lowestUVWindow(windows)
    if (window && (!best || window.avgUV < best.window.avgUV)) {
      best = { activity: activity.name, window }
    }
  }
  return best
}

/**
 * The UV index as the scale reads it: whole numbers, so 2.6 already counts as 3
 * (Moderate), matching the band names (uv-scale.ts).
 */
const index = (uv: number) => Math.round(uv)

/** Spans of at least an hour whose UV index stays below PROTECT_FROM_UV, from `from` on. */
function lowSpans(hourly: readonly BriefingHour[], from: number): { from: number; to: number }[] {
  const indexed = hourly.map(h => ({ ...h, planningUV: index(h.uv) }))
  return findWindows(indexed, PROTECT_FROM_UV - 1, 60)
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
 * A day's briefing: the peak UV and its time, the best lower-UV window for the
 * person's activities (or the low-UV hours when none runs that day), the burn time
 * at the peak for their skin type and one line of advice.
 */
export function dailyBriefing({
  day,
  dayLabel,
  nowHour,
  activities,
  skinType,
  formatTime = formatBriefingTime,
}: BriefingInput): DailyBriefing {
  const from = nowHour ?? -1
  const { hourly } = day
  const top = hourly.reduce<BriefingHour | null>(
    (best, h) => (!best || h.uv > best.uv ? h : best),
    null,
  )
  const peak =
    top && top.uv >= SUN_UP_UV ? { uv: top.uv, hour: top.hour, passed: top.hour + 1 <= from } : null
  const fromTo = (span: { from: number; to: number }) =>
    `from ${formatTime(span.from)} to ${formatTime(span.to)}`
  const range = (span: { from: number; to: number }) =>
    `${formatTime(span.from)}–${formatTime(span.to)}`

  const peakLine = peak
    ? `${peak.passed ? 'UV peaked' : 'UV peaks'} at ${formatUV(peak.uv)} (${uvLabel(peak.uv)}) around ${formatTime(peak.hour)}`
    : 'UV stays near zero'

  const running = activities.filter(a => runsOn(a, day.date))
  let window: BriefingWindow | null = null
  let windowLine: string
  if (running.length) {
    const best = activityWindow(hourly, running, day.date, from)
    window = best
      ? { activity: best.activity, spans: [{ from: best.window.from, to: best.window.to }] }
      : null
    const who = running.length === 1 ? running[0]!.name : 'your activities'
    windowLine = best
      ? `best lower-UV window: ${best.activity} ${range(best.window)}`
      : `no lower-UV window ${from >= 0 ? 'left ' : ''}for ${who}`
  } else {
    const spans = lowSpans(hourly, from)
    window = spans.length ? { activity: null, spans } : null
    const rest = from >= 0 ? 'the rest of the day' : 'all day'
    windowLine =
      !peak || index(peak.uv) < PROTECT_FROM_UV
        ? `UV stays under ${PROTECT_FROM_UV} ${rest}`
        : spans.length
          ? `UV is under ${PROTECT_FROM_UV} ${spans.map((span, i) => (i ? `${formatTime(span.from)} to ${formatTime(span.to)}` : fromTo(span))).join(' and ')}`
          : `UV stays at ${PROTECT_FROM_UV} or more ${rest}`
  }

  // A passed peak's burn time is history; the dashboard's burn card has the current one.
  const burn = peak && !peak.passed ? burnMins(peak.uv, skinType) : null
  const burnLine =
    burn === null ? null : `at the peak, unprotected skin like yours can burn in about ${burn} min`

  // From "now" on when today is under way: "until 5pm" once the span has begun.
  const during = (span: { from: number; to: number }) =>
    span.from <= from ? `until ${formatTime(span.to)}` : fromTo(span)
  const shade = spanAtOrAbove(hourly, SHADE_FROM_UV, from)
  const protect = spanAtOrAbove(hourly, PROTECT_FROM_UV, from)
  const tip = shade
    ? `seek shade ${during(shade)}, when UV is ${SHADE_FROM_UV} or more`
    : protect
      ? `use sun protection ${during(protect)}, when UV is ${PROTECT_FROM_UV} or more`
      : peak && index(peak.uv) >= PROTECT_FROM_UV
        ? 'UV stays low for the rest of the day'
        : 'UV stays low, so most people need little protection'

  const lines = {
    peak: sentence(peakLine),
    window: sentence(windowLine),
    burn: burnLine && sentence(burnLine),
    tip: sentence(tip),
  }
  const text = [`${dayLabel}: ${peakLine}`, windowLine, burnLine, tip]
    .filter(Boolean)
    .map(part => sentence(part!))
    .join('. ')
  return { date: day.date, peak, window, burnMins: burn, lines, text: `${text}.` }
}
