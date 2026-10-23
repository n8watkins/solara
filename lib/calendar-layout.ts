// Pure layout rules for the Calendar week view (components/CalendarView.tsx).
//
// Every day column has the same whole-pixel width and every visible activity gets an
// equal lane inside it. The number of days side by side is chosen so no lane drops
// below MIN_LANE_W; the remaining days scroll horizontally.
import { fmtH, type SafeWindow } from './calendar'

/** Minimum width of the hour gutter; it also absorbs the sub-column remainder. */
export const GUTTER_W = 46
/** Narrowest lane that still fits an icon and a short time such as "10a". */
export const MIN_LANE_W = 25
/** Space between lanes and at both column edges. */
export const LANE_GAP = 2
/** At most a week side by side; further days scroll horizontally. */
export const MAX_DAYS_ACROSS = 7

export interface ColumnLayout {
  /** Width of one day column in px. */
  colW: number
  /** Width of the sticky hour gutter in px. */
  gutterW: number
  /** Days fully visible at once. */
  daysAcross: number
  /** Width of one activity lane inside a column in px. */
  laneW: number
}

/**
 * Column geometry for a grid `gridWidth` px wide (null before it is measured).
 * Columns are whole pixels and the gutter takes the remainder, so the last visible
 * day ends flush with the edge instead of a sliver of the next day peeking in.
 */
export function computeColumns(
  gridWidth: number | null,
  dayCount: number,
  activityCount: number,
): ColumnLayout {
  const lanes = Math.max(1, activityCount)
  const minColW = lanes * MIN_LANE_W + LANE_GAP * (lanes + 1)
  const available = gridWidth ? gridWidth - GUTTER_W : minColW * 3
  const daysAcross = Math.max(
    1,
    Math.min(Math.max(1, dayCount), MAX_DAYS_ACROSS, Math.floor(available / minColW)),
  )
  const colW = Math.max(minColW, Math.floor(available / daysAcross))
  const gutterW = gridWidth ? Math.max(GUTTER_W, gridWidth - colW * daysAcross) : GUTTER_W
  const laneW = (colW - LANE_GAP * (lanes + 1)) / lanes
  return { colW, gutterW, daysAcross, laneW }
}

export type ViewKey = 'full' | 'morning' | 'afternoon' | 'evening'

export const VIEWS: { key: ViewKey; label: string; from?: number; to?: number }[] = [
  { key: 'full', label: 'Full day' },
  { key: 'morning', label: 'Morning', from: 6, to: 12 },
  { key: 'afternoon', label: 'Afternoon', from: 12, to: 18 },
  { key: 'evening', label: 'Evening', from: 16, to: 21 },
]

/**
 * Hour range [from, to) of the time axis. Full day spans the user's hours and
 * widens to fit every window, so no window starts above the first hour line or
 * ends below the last. The other views are fixed zooms.
 */
export function computeAxis(
  view: ViewKey,
  windows: Pick<SafeWindow, 'from' | 'to'>[],
  hours?: { from: number; to: number },
): { from: number; to: number } {
  const preset = VIEWS.find(v => v.key === view)
  if (preset?.from !== undefined && preset.to !== undefined) {
    return { from: preset.from, to: preset.to }
  }
  const prefFrom = hours?.from ?? 6
  const prefTo = Math.max(prefFrom + 1, hours?.to ?? 20)
  return {
    from: Math.max(0, Math.min(prefFrom, ...windows.map(w => Math.floor(w.from)))),
    to: Math.min(24, Math.max(prefTo, ...windows.map(w => Math.ceil(w.to)))),
  }
}

export type ChipVariant = 'full' | 'stacked' | 'compact'

/** Label style for a chip in a lane `laneW` px wide. */
export function chipVariant(laneW: number): ChipVariant {
  if (laneW >= 76) return 'full'
  if (laneW >= 36) return 'stacked'
  return 'compact'
}

/** "6am" -> "6a", for the narrowest lanes. */
export function shortHour(h: number): string {
  return fmtH(h).replace(/([ap])m$/, '$1')
}

/** Indexes of the first and last fully visible day for a horizontal scroll offset. */
export function visibleDays(
  scrollLeft: number,
  layout: Pick<ColumnLayout, 'colW' | 'daysAcross'>,
  dayCount: number,
): { first: number; last: number } {
  const lastIndex = Math.max(0, dayCount - 1)
  const first = Math.min(Math.max(0, Math.round(scrollLeft / layout.colW)), lastIndex)
  return { first, last: Math.min(lastIndex, first + layout.daysAcross - 1) }
}

/** First day index after paging one screen in `direction`, clamped to the forecast. */
export function pageTarget(
  first: number,
  direction: 1 | -1,
  daysAcross: number,
  dayCount: number,
): number {
  return Math.min(Math.max(0, first + direction * daysAcross), Math.max(0, dayCount - daysAcross))
}

function monthDay(dateStr: string): string {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })
}

/** "Jun 15 – 21", or "Jun 28 – Jul 4" across a month boundary. */
export function rangeLabel(firstDate?: string, lastDate?: string): string {
  if (!firstDate || !lastDate) return ''
  if (firstDate === lastDate) return monthDay(firstDate)
  return firstDate.slice(0, 7) === lastDate.slice(0, 7)
    ? `${monthDay(firstDate)} – ${Number(lastDate.slice(8))}`
    : `${monthDay(firstDate)} – ${monthDay(lastDate)}`
}

export const UV_BANDS = [
  { max: 0.5, rgb: '156,163,175', label: null, weight: 0.4 },
  { max: 2, rgb: '74,222,128', label: 'Low', weight: 1 },
  { max: 5, rgb: '250,204,21', label: 'Moderate', weight: 1 },
  { max: 7, rgb: '251,146,60', label: 'High', weight: 1 },
  { max: 10, rgb: '248,113,113', label: 'Very high', weight: 1 },
  { max: Infinity, rgb: '192,132,252', label: 'Extreme', weight: 1 },
] as const

export type UVBand = (typeof UV_BANDS)[number]

/** WHO UV band for a reading; below 0.5 counts as no sun. */
export function uvBand(uv: number): UVBand {
  if (uv < UV_BANDS[0].max) return UV_BANDS[0]
  return UV_BANDS.find(b => b.label && uv <= b.max) ?? UV_BANDS[5]
}
