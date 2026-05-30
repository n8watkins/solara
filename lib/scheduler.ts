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

/** Peak/avg UV over the hours the activity actually occupies [from, to). */
function summarizeUV(hourly: { hour: number; uv: number }[], from: number, to: number): { peak: number; avg: number } | null {
  const lo = Math.floor(from)
  const hi = Math.ceil(to)
  const samples = hourly.filter(h => h.hour >= lo && h.hour < hi).map(h => h.uv)
  if (!samples.length) return null
  const round = (n: number) => Math.round(n * 10) / 10
  return {
    peak: round(Math.max(...samples)),
    avg: round(samples.reduce((s, v) => s + v, 0) / samples.length),
  }
}

/**
 * For 'sunniest', slide a duration-long window across a free fragment and return
 * the start time whose occupied slot has the highest average UV. Candidate starts
 * are the fragment's own start plus each whole hour up to the latest feasible start
 * — enough granularity given UV is sampled hourly. Falls back to the fragment start
 * when no hourly data overlaps. This makes 'sunniest' pick the sunniest *placement*,
 * not just the sunniest window — correct even when a busy block splits a window.
 */
function sunniestPlacement(
  f: FreeSlot,
  durHours: number,
  hourly: { hour: number; uv: number }[],
): { start: number; avg: number } {
  const latest = f.to - durHours
  const candidates = [f.from]
  for (let h = Math.ceil(f.from); h <= latest + 1e-9; h++) candidates.push(h)

  let bestStart = f.from
  let bestAvg = -Infinity
  for (const c of candidates) {
    if (c > latest + 1e-9) continue
    const s = summarizeUV(hourly, c, c + durHours)
    const avg = s ? s.avg : f.avgUV
    if (avg > bestAvg) { bestAvg = avg; bestStart = c }
  }
  return { start: bestStart, avg: bestAvg }
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
 * @param hourly       Optional day's hourly UV. When given, the reported peak/avg
 *                     UV are recomputed over the occupied slot rather than the whole
 *                     window — accurate when a busy block splits a window.
 * @returns The chosen slot plus its flexible range, or null if nothing fits.
 */
export function recommendSlot(
  safeWindows: SafeActivityWindow[],
  busy: BusyInterval[],
  durationMins: number,
  timePreference: TimePreference = 'earliest',
  nowHour = -1,
  hourly?: { hour: number; uv: number }[],
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
    if (hourly) {
      // Evaluate the sunniest placement *within* each fragment, then pick the best
      // across fragments — so a busy block splitting a window can't mislead us with
      // a stale window-level average. Ties break toward the earlier start.
      let best: { f: FreeSlot; start: number; avg: number } | null = null
      for (const f of feasible) {
        const p = sunniestPlacement(f, durHours, hourly)
        if (!best || p.avg > best.avg || (p.avg === best.avg && p.start < best.start)) {
          best = { f, start: p.start, avg: p.avg }
        }
      }
      chosen = best!.f
      start = best!.start
    } else {
      chosen = feasible.reduce((best, f) =>
        f.avgUV > best.avgUV || (f.avgUV === best.avgUV && f.from < best.from) ? f : best)
      start = chosen.from
    }
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

  const end = start + durHours
  // Prefer UV measured over the slot the user actually occupies; fall back to the
  // window aggregate when no hourly data is supplied.
  const occ = hourly ? summarizeUV(hourly, start, end) : null

  return {
    start,
    end,
    earliestStart: chosen.from,
    latestStart: chosen.to - durHours,
    windowLabel: chosen.label,
    peakUV: occ ? occ.peak : chosen.peakUV,
    avgUV: occ ? occ.avg : chosen.avgUV,
    reason,
  }
}
