// Pure geometry for the sun path (components/SunArc.tsx). The SVG is drawn in real
// pixels at the UV strip's width, so every hour's x is the center of its bar.
import type { HourlyForecast } from './types'
import { UV_BAR_GAP, missingRuns, uvBarCenter, type HourSlot } from '@solara/core/uv-strip'

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
  /** The arc's y over `x`, clamped to the arc's ends. */
  yAtX: (x: number) => number
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
  const yAtX = (x: number) => pointAt(x1 > x0 ? clamp((x - x0) / (x1 - x0), 0, 1) : 0.5).y
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
    yAtX,
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

/** The callout text's measured box: its width and its extent above and below the baseline. */
export interface LabelSize {
  width: number
  ascent: number
  descent: number
}

/** A round marker on the arc, as the callout must avoid it: center and outer radius. */
export interface Circle {
  x: number
  y: number
  r: number
}

/** Where to draw the callout: `x` is its left edge (text-anchor start), `y` its baseline. */
export interface LabelPlacement {
  x: number
  y: number
}

/**
 * Which side of the shown part of the arc (`view`: what is not cut off or faded out)
 * the peak lies past, if any: the callout is then pinned to that edge and points
 * the way. A ring whose center is still in view needs no arrow.
 */
export function peakOffView(
  peakX: number,
  view: { left: number; right: number },
): 'left' | 'right' | null {
  if (peakX < view.left) return 'left'
  if (peakX > view.right) return 'right'
  return null
}

/** The callout's baseline sits this far above the peak marker's center when nothing is in the way. */
export const PEAK_LABEL_RISE = 14
/** Clear space kept between the callout and the line, the markers and the arc's edges. */
const LABEL_GAP = 4
/** Half the colored line's stroke (4 px wide). */
const LINE_HALF_WIDTH = 2
/** Half the peak ring's outer size (r 6, stroke 2): a sliding callout keeps spanning it. */
const RING_EXTENT = 7

/**
 * Place the peak callout ("Peak 10.3 · 1pm") so it can be read in full.
 *
 * It sits centered above the peak marker unless that would cut it off at the edge of
 * the visible part of the arc (`visible`, in arc px: on a phone the strip scrolls, so
 * this is the strip's viewport, not the whole arc); then it slides sideways, as far as
 * it can while still spanning the marker. A marker scrolled to or past an edge of the
 * view leaves the callout pinned to that edge. It is lifted clear of the line (which
 * climbs steeply near either end of the day) and of `obstacles` (the "now" sun and
 * the focus ring), sliding to whichever side keeps it closest to the marker.
 */
export function placePeakLabel({
  peak,
  size,
  visible,
  arcTop,
  obstacles,
}: {
  peak: Point
  size: LabelSize
  visible: { left: number; right: number }
  /** The arc's highest point (smallest y) over [left, right]. */
  arcTop: (left: number, right: number) => number
  obstacles: Circle[]
}): LabelPlacement {
  const { width, ascent, descent } = size
  // Left edges that keep the ring under the text, and that keep the text on screen.
  const ringLo = peak.x + RING_EXTENT - width
  const ringHi = peak.x - RING_EXTENT
  const lo = Math.max(ringLo, visible.left)
  const hi = Math.min(ringHi, visible.right - width)
  // Marker at (or past) an edge of the view: pin the callout to that edge, so the
  // peak stays readable and points the way while the strip is scrolled.
  const range: [number, number] =
    lo <= hi
      ? [lo, hi]
      : visible.left > ringHi
        ? [visible.left, visible.left]
        : [visible.right - width, visible.right - width]
  const ideal = peak.x - width / 2
  const idealY = peak.y - PEAK_LABEL_RISE

  const candidates = [clamp(ideal, ...range), range[0], range[1]]
  const avoid = [{ ...peak, r: RING_EXTENT }, ...obstacles]
  let best: { at: LabelPlacement; cost: number; fits: boolean } | null = null
  for (const left of candidates) {
    const right = left + width
    // Above the line across the callout's whole width, never lower than ideal.
    let y = Math.min(idealY, arcTop(left, right) - LINE_HALF_WIDTH - LABEL_GAP - descent)
    // Lift it over any marker it would cover. Markers are visited top-down from the
    // callout, so one pass settles it.
    for (const c of [...avoid].sort((a, b) => b.y - a.y)) {
      const overlapsX = left < c.x + c.r + LABEL_GAP && c.x - c.r - LABEL_GAP < right
      const overlapsY = y - ascent < c.y + c.r + LABEL_GAP && c.y - c.r - LABEL_GAP < y + descent
      if (overlapsX && overlapsY) y = c.y - c.r - LABEL_GAP - descent
    }
    const fits = y - ascent >= LABEL_GAP
    // Prefer centered over the marker and close above it.
    const cost = Math.abs(left + width / 2 - peak.x) + 2 * (idealY - y)
    if (!best || (fits && !best.fits) || (fits === best.fits && cost < best.cost))
      best = { at: { x: left, y: Math.max(y, ascent + LABEL_GAP) }, cost, fits }
  }
  return best!.at
}
