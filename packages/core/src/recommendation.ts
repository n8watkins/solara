// The recommendation engine shared by the web app, the calendar feed and the
// notification worker. Keep it free of Firebase, browser and Node-only APIs so
// every delivery surface runs exactly the same calculations.
import type { Daylight } from './sun-times'

export type SkinType = 'very-fair' | 'fair' | 'medium' | 'olive' | 'dark'

/** Minutes to a burn at UV 10 for each skin type (scaled by 10 / UV). */
export const SKIN_BURN_BASE: Readonly<Record<SkinType, number>> = Object.freeze({
  'very-fair': 10,
  fair: 15,
  medium: 25,
  olive: 35,
  dark: 50,
})

/** Every skin type, lightest first. */
export const SKIN_TYPES: readonly SkinType[] = Object.freeze([
  'very-fair',
  'fair',
  'medium',
  'olive',
  'dark',
])

/** A Fitzpatrick skin phototype, as Solara groups them. */
export type FitzpatrickType = 'I' | 'II' | 'III' | 'IV' | 'V-VI'

/**
 * The Fitzpatrick phototype each skin type stands for (Fitzpatrick TB, "The validity
 * and practicality of sun-reactive skin types I through VI", Arch Dermatol 1988;
 * 124:869-871). Types V and VI share one skin type and its burn estimate, the more
 * cautious type V one; the standard questionnaire's scoring groups them the same way
 * (lib/skin-quiz.ts).
 */
export const FITZPATRICK_TYPES: Readonly<Record<SkinType, FitzpatrickType>> = Object.freeze({
  'very-fair': 'I',
  fair: 'II',
  medium: 'III',
  olive: 'IV',
  dark: 'V-VI',
})

/**
 * The skin type that burns fastest among `skinTypes` (the shortest time to a burn in
 * SKIN_BURN_BASE), or null for none. Planning for a group uses it, so a plan that suits
 * the most sensitive person suits everyone in it.
 */
export function mostSensitiveSkinType(skinTypes: Iterable<SkinType>): SkinType | null {
  let most: SkinType | null = null
  for (const skin of skinTypes) {
    if (most === null || SKIN_BURN_BASE[skin] < SKIN_BURN_BASE[most]) most = skin
  }
  return most
}

export function isSkinType(value: unknown): value is SkinType {
  return typeof value === 'string' && (SKIN_TYPES as readonly string[]).includes(value)
}

export interface PreferredHours {
  /** Inclusive start hour (0-23). */
  from: number
  /** Exclusive end hour (1-24). */
  to: number
}

export type WindowLabel = 'Morning' | 'Midday' | 'Afternoon' | 'Evening' | 'All day'

/** A contiguous [from, to) span of hours whose UV stays under an activity's limit. */
export interface RecommendationWindow {
  from: number
  to: number
  label: WindowLabel
  peakUV: number
  avgUV: number
}

/**
 * One hourly sample. `planningUV` may hold a conservative adjustment (for
 * example cloud cover) while `uv` always remains the forecast value reported in
 * window summaries.
 */
export interface RecommendationHour {
  hour: number
  uv: number
  planningUV?: number
}

export interface UVLimitedActivity {
  maxUV?: number | null
  sunscreen?: boolean | null
}

/** The UV limit an activity is planned against; SPF 30+ raises it (capped at 11). */
export function effectiveMaxUV(activity: UVLimitedActivity): number {
  const base = activity.maxUV ?? 4
  return activity.sunscreen ? Math.min(Math.round(base * 2.5), 11) : base
}

/** Estimated minutes to a burn at `uv`, or null when UV is negligible. */
export function burnMins(uv: number, skinType: SkinType): number | null {
  if (uv < 0.5) return null
  const base = SKIN_BURN_BASE[skinType] as number | undefined
  if (base == null) throw new Error(`Unknown skin type: ${String(skinType)}`)
  return Math.round((base * 10) / uv)
}

/** Day of the week (0 = Sunday) for a 'YYYY-MM-DD' date, or null when it is not a real date. */
export function weekdayForDate(dateStr: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    return null
  return date.getUTCDay()
}

/** Whether an activity's weekday restriction includes the date. No restriction means every day. */
export function runsOn(
  activity: { daysOfWeek?: readonly number[] | null },
  dateStr: string,
): boolean {
  if (!Array.isArray(activity.daysOfWeek) || activity.daysOfWeek.length === 0) return true
  const weekday = weekdayForDate(dateStr)
  return weekday !== null && activity.daysOfWeek.includes(weekday)
}

/** The part of the day a [from, to) window covers. */
export function labelWindow(from: number, to: number): WindowLabel {
  if (from <= 7 && to >= 19) return 'All day'
  const midpoint = (from + to) / 2
  if (midpoint < 11) return 'Morning'
  if (midpoint < 14) return 'Midday'
  if (midpoint < 17) return 'Afternoon'
  return 'Evening'
}

/** Whether `hour` falls inside the preferred [from, to) hours (always true without a preference). */
export function hourAllowed(hour: number, preferredHours?: PreferredHours | null): boolean {
  return !preferredHours || (hour >= preferredHours.from && hour < preferredHours.to)
}

const roundTenth = (n: number) => Math.round(n * 10) / 10

/**
 * Label plus peak and average forecast UV for a [from, to) span. `from` may be
 * fractional (a window trimmed to "now"); the hour it falls in is included.
 */
export function summarizeWindow(
  hourly: readonly RecommendationHour[],
  from: number,
  to: number,
): RecommendationWindow {
  const samples = hourly.filter(hour => hour.hour >= Math.floor(from) && hour.hour < to)
  const peakUV = samples.length ? Math.max(...samples.map(hour => hour.uv)) : 0
  const avgUV = samples.length
    ? roundTenth(samples.reduce((sum, hour) => sum + hour.uv, 0) / samples.length)
    : 0
  return { from, to, label: labelWindow(from, to), peakUV: roundTenth(peakUV), avgUV }
}

/**
 * Contiguous [from, to) windows whose planning UV is at or below `maxUV` and
 * that last at least `durationMins`.
 *
 * An hour without a finite UV never qualifies, and a window never spans a gap
 * in the hour sequence, so an unknown or missing hour is never recommended.
 * A window ends no later than the day's last hourly sample: the forecast day
 * shown to the user ends there, so every surface (dashboard, calendar, feed and
 * notifications) offers the same span.
 *
 * With the day's `daylight` (sun-times.ts daylightHours), a window is also cut to the
 * hours the sun is up, and dropped when what is left is too short: before sunrise and
 * after sunset the UV is 0, which would otherwise make the dark the "lowest-UV" time.
 */
export function findWindows(
  hourly: readonly RecommendationHour[],
  maxUV: number,
  durationMins = 0,
  preferredHours?: PreferredHours | null,
  daylight?: Daylight | null,
): RecommendationWindow[] {
  const windows: RecommendationWindow[] = []
  const lastHour = hourly.at(-1)?.hour
  let start: number | null = null

  for (let i = 0; i <= hourly.length; i++) {
    const current = hourly[i]
    const previous = hourly[i - 1]
    const planningUV = current ? (current.planningUV ?? current.uv) : null
    const qualifies =
      current !== undefined &&
      Number.isFinite(current.uv) &&
      planningUV !== null &&
      Number.isFinite(planningUV) &&
      planningUV <= maxUV &&
      hourAllowed(current.hour, preferredHours)
    const continues = qualifies && previous !== undefined && current.hour === previous.hour + 1

    if (start !== null && previous !== undefined && lastHour !== undefined && !continues) {
      const to = Math.min(previous.hour + 1, lastHour)
      if (to > start && (to - start) * 60 >= durationMins) {
        windows.push(summarizeWindow(hourly, start, to))
      }
      start = null
    }
    if (qualifies && start === null) start = current.hour
  }

  return daylight ? withinDaylight(windows, hourly, durationMins, daylight) : windows
}

/** `windows` cut to `daylight`, keeping those still at least `durationMins` long. */
export function withinDaylight(
  windows: readonly RecommendationWindow[],
  hourly: readonly RecommendationHour[],
  durationMins: number,
  daylight: Daylight,
): RecommendationWindow[] {
  return windows.flatMap(w => {
    const from = Math.max(w.from, daylight.from)
    const to = Math.min(w.to, daylight.to)
    if (to <= from || (to - from) * 60 < durationMins) return []
    return [from === w.from && to === w.to ? w : summarizeWindow(hourly, from, to)]
  })
}

/** The lowest-average-UV window, ties broken toward the longer one, then the earlier one. */
export function lowestUVWindow<W extends Pick<RecommendationWindow, 'from' | 'to' | 'avgUV'>>(
  windows: readonly W[],
): W | null {
  return (
    windows.slice().sort((a, b) => a.avgUV - b.avgUV || b.to - b.from - (a.to - a.from))[0] ?? null
  )
}

/** The best window for an activity on one day, or null when none fits. */
export function bestWindow(
  hourly: readonly RecommendationHour[],
  maxUV: number,
  durationMins = 0,
  preferredHours?: PreferredHours | null,
  daylight?: Daylight | null,
): RecommendationWindow | null {
  return lowestUVWindow(findWindows(hourly, maxUV, durationMins, preferredHours, daylight))
}
