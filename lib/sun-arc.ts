// Pure geometry for the sun path (components/SunArc.tsx). The SVG is drawn in real
// pixels at the UV strip's width, so every hour's x is the center of its bar.
import type { HourlyForecast } from './types'
import { UV_BAR_GAP, missingRuns, uvBarCenter, type HourSlot } from './uv-strip'

export const SUN_ARC_HEIGHT = 124
export const SUN_ARC_BASELINE_Y = 112
export const SUN_ARC_APEX_Y = 34
/** Quadratic bezier control point that puts the curve's apex (t = 0.5) at the apex y. */
export const SUN_ARC_CONTROL_Y = 2 * SUN_ARC_APEX_Y - SUN_ARC_BASELINE_Y

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

export interface Point {
  x: number
  y: number
}

export interface SunArcGeometry {
  /** The arc's first and last x (the first and last bar centers). */
  x0: number
  x1: number
  /** The quadratic bezier as an SVG path. */
  path: string
  /** Curve parameter t (0..1) over bar `index`; may be fractional. */
  tForIndex: (index: number) => number
  pointAt: (t: number) => Point
  /** Bar index of a whole hour, or -1 when the strip does not show it. */
  indexOfHour: (hour: number) => number
  /** Fractional bar index for a fractional hour (10.5 is halfway from 10am to 11am). */
  indexForTime: (time: number) => number | null
  /** The point over a whole hour's bar, or null when the strip does not show it. */
  pointForHour: (hour: number) => Point | null
  /** Unknown-UV runs as [firstHour, lastHour]. */
  gaps: Array<[number, number]>
  /** x-ranges with data on both sides; the colored line is clipped to them. */
  knownSpans: Array<[number, number]>
}

export function sunArcGeometry(slots: HourSlot[], width: number): SunArcGeometry {
  const count = slots.length
  const firstHour = slots[0]?.hour ?? 0
  const center = (index: number) => uvBarCenter(index, count, width)
  const x0 = center(0)
  const x1 = center(count - 1)
  // Bar centers are evenly spaced, and so are the bezier's control x-coords, so
  // x(t) is linear in t and t = index / (count - 1) lands exactly over bar `index`.
  const tForIndex = (index: number) => (count > 1 ? clamp(index / (count - 1), 0, 1) : 0.5)
  const pointAt = (t: number): Point => {
    const mt = 1 - t
    return {
      x: x0 + (x1 - x0) * t,
      y: mt * mt * SUN_ARC_BASELINE_Y + 2 * mt * t * SUN_ARC_CONTROL_Y + t * t * SUN_ARC_BASELINE_Y,
    }
  }
  const indexOfHour = (hour: number) =>
    hour >= firstHour && hour < firstHour + count ? hour - firstHour : -1
  const indexForTime = (time: number) => {
    const whole = indexOfHour(Math.floor(time))
    if (whole < 0) return null
    return whole + (time - Math.floor(time))
  }
  const pointForHour = (hour: number) => {
    const index = indexOfHour(hour)
    return index >= 0 ? pointAt(tForIndex(index)) : null
  }

  const gaps = missingRuns(slots)
  const knownSpans: Array<[number, number]> = []
  let spanStart = 0
  for (const [from, to] of gaps) {
    knownSpans.push([spanStart, center(indexOfHour(from) - 1)])
    spanStart = center(indexOfHour(to) + 1)
  }
  knownSpans.push([spanStart, width])

  return {
    x0,
    x1,
    path: `M ${x0} ${SUN_ARC_BASELINE_Y} Q ${(x0 + x1) / 2} ${SUN_ARC_CONTROL_Y} ${x1} ${SUN_ARC_BASELINE_Y}`,
    tForIndex,
    pointAt,
    indexOfHour,
    indexForTime,
    pointForHour,
    gaps,
    knownSpans,
  }
}

/**
 * The hour under a pointer `offsetX` px from the arc's left edge, which is
 * `width` px wide. A gap has nothing to inspect, so it snaps to the nearest hour
 * with data.
 */
export function hourAtOffset(
  slots: HourSlot[],
  offsetX: number,
  width: number,
): HourlyForecast | null {
  const count = slots.length
  if (width === 0 || count === 0) return null
  const pitch = (width + UV_BAR_GAP) / count
  const index = clamp(Math.floor((offsetX + UV_BAR_GAP / 2) / pitch), 0, count - 1)
  let h = slots[index]?.data ?? null
  for (let d = 1; !h && d < count; d++) h = slots[index - d]?.data ?? slots[index + d]?.data ?? null
  return h
}

/** Keeps the peak callout inside the arc near either edge. */
export function peakLabelAnchor(x: number, width: number): 'start' | 'middle' | 'end' {
  if (x < 60) return 'start'
  if (x > width - 60) return 'end'
  return 'middle'
}
