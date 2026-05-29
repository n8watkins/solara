import { SafeActivityWindow, TimePreference } from './types'

/** A busy block from the calendar, in fractional hours within a single day: [start, end). */
export interface BusyInterval {
  start: number
  end: number
}

export interface SlotRecommendation {
  /** Recommended start/end of the activity itself (fractional hours). */
  start: number
  end: number
  /**
   * The range of *start* times that still fit the activity inside the free+safe
   * interval: [earliestStart, latestStart]. latestStart = intervalEnd - duration,
   * so starting at latestStart still ends within the safe window. When the two
   * are equal there is no wiggle room. `start` always lies within this range.
   */
  earliestStart: number
  latestStart: number
  windowLabel: SafeActivityWindow['label']
  peakUV: number
  avgUV: number
  reason: string
}

interface FreeSlot {
  from: number
  to: number
  label: SafeActivityWindow['label']
  peakUV: number
  avgUV: number
}

/**
 * Subtract busy intervals from a [winFrom, winTo) window, returning the free
 * sub-intervals. Handles overlapping/unsorted busy blocks via a sweep.
 */
function subtractBusy(winFrom: number, winTo: number, busy: BusyInterval[]): Array<[number, number]> {
  const clipped = busy
    .map(b => [Math.max(b.start, winFrom), Math.min(b.end, winTo)] as [number, number])
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0])

  const free: Array<[number, number]> = []
  let cursor = winFrom
  for (const [s, e] of clipped) {
    if (s > cursor) free.push([cursor, s])
    cursor = Math.max(cursor, e)
  }
  if (cursor < winTo) free.push([cursor, winTo])
  return free
}

function labelPhrase(label: SafeActivityWindow['label']): string {
  return label === 'All day' ? 'safe' : label.toLowerCase()
}

/**
 * Recommend a concrete start time for an activity by intersecting its safe-UV
 * windows with real availability, honoring a time-of-day preference.
 *
 * @param safeWindows  Safe windows for one day (already respect preferredHours + effectiveMaxUV).
 * @param busy         Calendar busy blocks for that day. Pass [] when no calendar is connected.
 * @param durationMins Activity length.
 * @param timePreference 'earliest' (default) | 'latest' | 'sunniest'.
 * @param nowHour      Current hour to forbid past slots on today; pass -1 for future days.
 * @returns The chosen slot plus its flexible range, or null if nothing fits.
 */
export function recommendSlot(
  safeWindows: SafeActivityWindow[],
  busy: BusyInterval[],
  durationMins: number,
  timePreference: TimePreference = 'earliest',
  nowHour = -1,
): SlotRecommendation | null {
  if (durationMins <= 0) return null
  const durHours = durationMins / 60
  const feasible: FreeSlot[] = []

  for (const w of safeWindows) {
    for (const [s, e] of subtractBusy(w.from, w.to, busy)) {
      const from = nowHour >= 0 ? Math.max(s, nowHour) : s
      if ((e - from) * 60 >= durationMins) {
        feasible.push({ from, to: e, label: w.label, peakUV: w.peakUV, avgUV: w.avgUV })
      }
    }
  }
  if (!feasible.length) return null

  let chosen: FreeSlot
  let start: number

  if (timePreference === 'latest') {
    chosen = feasible.reduce((best, f) => (f.to > best.to ? f : best))
    start = chosen.to - durHours
  } else if (timePreference === 'sunniest') {
    chosen = feasible.reduce((best, f) =>
      f.avgUV > best.avgUV || (f.avgUV === best.avgUV && f.from < best.from) ? f : best)
    start = chosen.from
  } else {
    chosen = feasible.reduce((best, f) => (f.from < best.from ? f : best))
    start = chosen.from
  }

  const reason =
    timePreference === 'latest'
      ? `Latest safe spot in your ${labelPhrase(chosen.label)} window`
      : timePreference === 'sunniest'
        ? `Your sunniest safe window that's still free`
        : `Earliest free spot in your ${labelPhrase(chosen.label)} window`

  return {
    start,
    end: start + durHours,
    earliestStart: chosen.from,
    latestStart: chosen.to - durHours,
    windowLabel: chosen.label,
    peakUV: chosen.peakUV,
    avgUV: chosen.avgUV,
    reason,
  }
}
