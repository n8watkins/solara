// When a day needs sun protection: one calculation for every place Solara says so, so
// the dashboard's briefing, the Pro morning alert, the Pro UV alert and the free daily
// UV push never give two different times for the same day (REVIEW9 QA M1).
//
// - The UV index reads whole numbers (uv-scale.ts), so a forecast of 2.5 already shows
//   as 3 ("Moderate"); a band starts where the forecast reaches its index minus 0.5.
// - Each hour's value is the UV at the start of that hour. The window is read between
//   the hourly values on 5-minute steps, earlier at the start and later at the end, so
//   it errs on the side of protection.
// - Protection advice leans on the clear sky, as activity plans do (skyUV): clouds are
//   among the least predictable parts of a forecast, and advice that relaxes for clouds
//   may not hold if they break (REVIEW9 QA M2, owner may change). The forecast with its
//   clouds stays in the message as context ("2.2, or 5.1 if the sky clears").
import { cloudEffect, skyUV, type CloudEffect, type SkyHour } from './forecast-quality'
import type { Daylight } from './sun-times'

/** UV index at which public-health guidance recommends sun protection (WHO "Moderate"). */
export const PROTECT_FROM_UV = 3
/** UV index at which the WHO advises seeking shade at midday ("Very high"). */
export const SHADE_FROM_UV = 8

/** One forecast hour: the UV at that whole local hour, and under a clear sky when known. */
export interface ProtectionHour extends SkyHour {
  hour: number
}

/** When the UV is at or above an index on a day. */
export interface UvSpan {
  /** Fractional local hour the UV first reaches the index, on a 5-minute step. */
  from: number
  /** Fractional local hour it last drops below the index, on a 5-minute step. */
  to: number
  /**
   * Whether the forecast with its clouds reaches the index too; false when only a clear
   * sky would (the advice then says "if the sky clears").
   */
  forecastReaches: boolean
}

/** When sun protection is needed on a day, the day's forecast peak and the cloud effect. */
export interface ProtectionWindow extends UvSpan {
  /** The day's highest forecast UV (with clouds) and its hour, as the briefing quotes it. */
  peak: { uv: number; hour: number }
  /** How much the forecast clouds lower the peak, when worth telling (cloudEffect). */
  cloud: CloudEffect | null
}

/** The UV protection advice is judged by: the clear-sky UV when known (skyUV). */
export function protectionUV(hour: SkyHour): number {
  return skyUV(hour)
}

const STEP = 1 / 12

/** Rounds a fractional hour down (or up) to a 5-minute step. */
function toStep(hours: number, direction: 'down' | 'up'): number {
  const steps = hours / STEP
  // A tiny tolerance so 10.0000001 stays 10:00 instead of 10:05.
  const rounded = direction === 'down' ? Math.floor(steps + 1e-6) : Math.ceil(steps - 1e-6)
  return rounded * STEP
}

function sortedHours<H extends ProtectionHour>(hourly: readonly H[]): H[] {
  return hourly
    .filter(h => Number.isFinite(h.uv) && Number.isFinite(h.hour))
    .slice()
    .sort((a, b) => a.hour - b.hour)
}

/** The span over one series of values (already sorted by hour), or null. */
function spanOf(
  hours: readonly { hour: number; value: number }[],
  at: number,
): { from: number; to: number } | null {
  const firstIndex = hours.findIndex(h => h.value >= at)
  if (firstIndex < 0) return null
  let lastIndex = firstIndex
  hours.forEach((h, i) => {
    if (h.value >= at) lastIndex = i
  })
  const first = hours[firstIndex]!
  const last = hours[lastIndex]!
  const before = hours[firstIndex - 1]
  const from =
    before && before.hour === first.hour - 1 && before.value < at
      ? before.hour + (at - before.value) / (first.value - before.value)
      : first.hour
  const after = hours[lastIndex + 1]
  const to =
    after && after.hour === last.hour + 1 && after.value < at
      ? last.hour + (last.value - at) / (last.value - after.value)
      : last.hour + 1
  const start = toStep(from, 'down')
  // A peak that only touches the index still gets one 5-minute step.
  return { from: start, to: Math.max(toStep(to, 'up'), start + STEP) }
}

/**
 * When the UV index is at `index` or higher on a day, judged on the clear-sky UV (see
 * protectionUV): from the first moment it reaches it to the last moment it is above it,
 * as one span even if a cloudy hour dips below in the middle, inside the daylight when
 * given. Null when it never does.
 */
export function uvSpanAtOrAbove(
  hourly: readonly ProtectionHour[],
  index: number,
  daylight?: Daylight | null,
): UvSpan | null {
  const hours = sortedHours(hourly)
  const at = index - 0.5
  const span = spanOf(
    hours.map(h => ({ hour: h.hour, value: protectionUV(h) })),
    at,
  )
  if (!span) return null
  const from = daylight ? Math.max(span.from, daylight.from) : span.from
  const to = daylight ? Math.min(span.to, daylight.to) : span.to
  if (to <= from) return null
  const forecastReaches = hours.some(h => h.uv >= at && h.hour + 1 > from && h.hour < to)
  return { from, to, forecastReaches }
}

/**
 * When sun protection is needed on a day (UV index 3, "Moderate", or higher; see the
 * notes at the top), with the day's forecast peak and the cloud effect. Null when the
 * UV stays low all day, even under a clear sky.
 */
export function protectionWindow(
  hourly: readonly ProtectionHour[],
  daylight?: Daylight | null,
): ProtectionWindow | null {
  const span = uvSpanAtOrAbove(hourly, PROTECT_FROM_UV, daylight)
  if (!span) return null
  const hours = sortedHours(hourly)
  const top = hours.reduce((max, h) => (h.uv > max.uv ? h : max), hours[0]!)
  return { ...span, peak: { uv: top.uv, hour: top.hour }, cloud: cloudEffect(hours) }
}

/** When the advice is to seek shade (UV index 8, "Very high", or higher), or null. */
export function shadeWindow(
  hourly: readonly ProtectionHour[],
  daylight?: Daylight | null,
): UvSpan | null {
  return uvSpanAtOrAbove(hourly, SHADE_FROM_UV, daylight)
}
