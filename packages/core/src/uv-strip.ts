// Pure layout and wording for the hourly UV strip (components/UVTimeline.tsx) and
// the sun path drawn above it (components/SunArc.tsx), which share its geometry.
import type { HourlyForecast } from './forecast-days'
import { formatClock12 } from './clock'
import m from './messages/core'
import { formatUV, uvBand, uvLabel } from './uv-scale'

/** Space between bars, in px. SunArc uses it to put each hour above its bar. */
export const UV_BAR_GAP = 4
/** Narrowest a bar may get; below this the strip scrolls instead of squeezing. */
export const UV_BAR_MIN_WIDTH = 42
/**
 * Width (px) of the fade at each end of a scrolling strip (the `.uv-strip` mask in
 * app/globals.css). Content inside it is half hidden, so SunArc keeps its peak
 * callout out of it.
 */
export const UV_STRIP_EDGE_FADE = 16

/** Horizontal center (px) of bar `index` of `count` bars spread across `width` px. */
export function uvBarCenter(index: number, count: number, width: number): number {
  const barWidth = (width - (count - 1) * UV_BAR_GAP) / count
  return index * (barWidth + UV_BAR_GAP) + barWidth / 2
}

/** One hour on the strip: its forecast, or null when the forecast has no UV for it. */
export interface HourSlot {
  hour: number
  data: HourlyForecast | null
}

/**
 * Every hour from the day's first to its last forecast hour. Hours the forecast
 * omits (unknown UV) come back with `data: null` so the strip and sun path show
 * the gap instead of closing it up.
 */
export function hourSlots(hourly: HourlyForecast[]): HourSlot[] {
  const first = hourly[0]
  const last = hourly.at(-1)
  if (!first || !last) return []
  const byHour = new Map(hourly.map(h => [h.hour, h]))
  const slots: HourSlot[] = []
  for (let hour = first.hour; hour <= last.hour; hour++)
    slots.push({ hour, data: byHour.get(hour) ?? null })
  return slots
}

/** Contiguous runs of hours with no UV data, as [firstHour, lastHour] pairs. */
export function missingRuns(slots: HourSlot[]): Array<[number, number]> {
  const runs: Array<[number, number]> = []
  for (const s of slots) {
    if (s.data) continue
    const run = runs.at(-1)
    if (run && run[1] === s.hour - 1) run[1] = s.hour
    else runs.push([s.hour, s.hour])
  }
  return runs
}

/** A whole hour on the 12-hour clock ("9am", "12pm"), the default label. */
const hour12 = (hour: number) => formatClock12(hour)

const HIGH_OR_ABOVE = new Set(['high', 'very-high', 'extreme'])

/** One-sentence summary of the day for screen readers (the strip's description). */
export function uvDaySummary(
  hourly: HourlyForecast[],
  formatHour: (hour: number) => string = hour12,
): string {
  const first = hourly[0]
  if (!first) return m.stripNoForecast
  const peak = hourly.reduce((best, h) => (h.uv > best.uv ? h : best), first)
  const parts = [m.stripPeak(formatUV(peak.uv), uvLabel(peak.uv), formatHour(peak.hour))]
  const high = hourly.filter(h => HIGH_OR_ABOVE.has(uvBand(h.uv)))
  const firstHigh = high[0]
  const lastHigh = high.at(-1)
  if (firstHigh && lastHigh) {
    parts.push(
      firstHigh === lastHigh
        ? m.stripHighAt(formatHour(firstHigh.hour))
        : m.stripHighFromTo(formatHour(firstHigh.hour), formatHour(lastHigh.hour)),
    )
  }
  for (const [from, to] of missingRuns(hourSlots(hourly))) {
    parts.push(
      from === to
        ? m.stripNoDataAt(formatHour(from))
        : m.stripNoDataFromTo(formatHour(from), formatHour(to)),
    )
  }
  return parts.join(' ')
}
