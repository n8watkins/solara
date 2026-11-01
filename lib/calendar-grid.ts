// Pure data and vertical geometry for the Calendar week grid (components/calendar/).
// Column and lane widths live in lib/calendar-layout.ts; this file places things on
// the hour axis and decides what each day column shows.
import { formatDuration } from '@solara/core/duration'
import type {
  Activity,
  DayWeather,
  SafeActivityWindow,
  UserPreferences,
  WeatherResponse,
} from './types'
import {
  cloudEffect,
  forecastConfidence,
  type CloudEffect,
  type ForecastConfidence,
} from '@solara/core'
import { planActivityDay } from '@solara/core/next-slot'
import { activityRunsOnDate } from './recommendation'
import { recommendSlot, type SlotRecommendation } from '@solara/core/scheduler'
import { scheduledOn, type ScheduledActivity, type ScheduledSpan } from './scheduled'
import { formatDate, zonedNow } from './time'
import { uvBand } from './calendar-layout'

/** Height of one hour row in px. */
export const ROW_H = 44
/** Room above the first and below the last hour line so their labels are not cut. */
export const AXIS_PAD = 10
/** Height of the sticky day header row in px: weekday, date, peak UV and confidence. */
export const HEADER_H = 74

const UV_ROW_ALPHA = 0.11

/** Hours the forecast has no UV for are hatched, so a gap never reads as "no sun". */
export const NO_DATA_BG =
  'repeating-linear-gradient(135deg, rgba(128,128,128,0.16) 0 3px, transparent 3px 7px)'

/** Background of one hour row: a light tint of its UV band, or the no-data hatch. */
export function uvRowBg(uv: number | undefined): string {
  if (uv === undefined) return NO_DATA_BG
  const band = uvBand(uv)
  return `rgba(${band.rgb},${UV_ROW_ALPHA * band.weight})`
}

/** "45 min", "1 h", "1 h 30 min" (formatDuration). */
export function durationText(mins: number): string {
  return formatDuration(mins)
}

export interface CalendarDay extends DayWeather {
  /** Column header: "Today", or the weekday ("Tue"). */
  shortLabel: string
  isToday: boolean
  /** The day's peak forecast UV as a whole number (no false precision); null without data. */
  peakUV: number | null
  /** How much the forecast clouds lower the peak, when it is worth telling. */
  cloud: CloudEffect | null
  /** Forecast confidence by how far ahead the day is. */
  confidence: ForecastConfidence
}

/** The first `limit` forecast days, labelled for the column headers. */
export function calendarDays(weather: WeatherResponse, limit: number): CalendarDay[] {
  return weather.forecast.slice(0, limit).map((day, daysAhead) => {
    const isToday = day.dateStr === weather.now.date
    const peak = day.hourly.length ? Math.max(...day.hourly.map(h => h.uv)) : null
    return {
      ...day,
      isToday,
      peakUV: peak,
      cloud: cloudEffect(day.hourly),
      // The forecast starts today, so a day's index is how far ahead it is.
      confidence: forecastConfidence(daysAhead),
      shortLabel: isToday ? 'Today' : formatDate(day.dateStr, { weekday: 'short' }),
    }
  })
}

/** The hour range the grid shows, as whole hours [from, to]. */
export interface Axis {
  from: number
  to: number
}

/** The hour lines of the axis, first to last inclusive (at least one row). */
export function axisHours({ from, to }: Axis): number[] {
  const rows = Math.max(1, to - from)
  return Array.from({ length: rows + 1 }, (_, i) => from + i)
}

/** Height of the grid body in px: every row plus the padding above and below. */
export function axisBodyHeight({ from, to }: Axis): number {
  return Math.max(1, to - from) * ROW_H + AXIS_PAD * 2
}

/** Whether any shown hour of any day has no UV reading (the legend then explains the hatch). */
export function hasUVGaps(
  days: readonly Pick<DayWeather, 'hourly'>[],
  { from, to }: Axis,
): boolean {
  return days.some(day => {
    const known = new Set(day.hourly.map(h => h.hour))
    for (let h = from; h < to; h++) if (!known.has(h)) return true
    return false
  })
}

/** Where a block sits in its lane, in px from the top of the lane area. */
export interface Block {
  top: number
  height: number
  /** The block continues above the axis, so its top corners are square. */
  cutTop: boolean
  /** The block continues below the axis, so its bottom corners are square. */
  cutBottom: boolean
  /** How many 13 px text lines fit. */
  lines: number
}

/** A lower-UV window's chip, clipped to the axis; null when nothing of it is shown. */
export function windowBlock(from: number, to: number, axis: Axis): Block | null {
  const topH = Math.max(from, axis.from)
  const botH = Math.min(to, axis.to)
  if (botH <= topH) return null
  const height = (botH - topH) * ROW_H - 2
  return {
    top: (topH - axis.from) * ROW_H + 1,
    height,
    cutTop: from < axis.from,
    cutBottom: to > axis.to,
    lines: Math.floor((height - 6) / 13),
  }
}

/** A scheduled activity's block: at least one line tall, so a short one still shows its check. */
export function scheduledBlock(from: number, to: number, axis: Axis): Block | null {
  const topH = Math.max(from, axis.from)
  const botH = Math.min(to, axis.to)
  if (botH <= topH) return null
  const height = Math.max(20, (botH - topH) * ROW_H - 2)
  return {
    top: (topH - axis.from) * ROW_H + 1,
    height,
    cutTop: from < axis.from,
    cutBottom: to > axis.to,
    lines: Math.floor((height - 4) / 13),
  }
}

/**
 * Today's "now" on the axis: the height of the faded past (null before the axis
 * starts) and the top of the 2 px now line (null when now is off the axis).
 */
export function nowMarker(
  nowFrac: number,
  axis: Axis,
): { pastHeight: number | null; lineTop: number | null } {
  return {
    pastHeight:
      nowFrac > axis.from ? AXIS_PAD + (Math.min(nowFrac, axis.to) - axis.from) * ROW_H : null,
    lineTop:
      nowFrac >= axis.from && nowFrac <= axis.to
        ? AXIS_PAD + (nowFrac - axis.from) * ROW_H - 1
        : null,
  }
}

/** Whether a window holds a scheduled activity (it then recedes to a tint). */
export function holdsScheduled(
  win: Pick<SafeActivityWindow, 'from' | 'to'>,
  scheduled: readonly { span: Pick<ScheduledSpan, 'from' | 'to'> }[],
): boolean {
  return scheduled.some(({ span }) => span.from < win.to && span.to > win.from)
}

export interface CalendarLane {
  act: Activity
  color: string
  scheduled: { item: ScheduledActivity; span: ScheduledSpan }[]
  windows: SafeActivityWindow[]
}

export interface CalendarDayPlan {
  day: CalendarDay
  lanes: CalendarLane[]
}

export interface PlanCalendarOptions {
  skinType: UserPreferences['skinType']
  colorFor: (act: Pick<Activity, 'id'>) => string
  scheduledItems: readonly ScheduledActivity[]
  /** The forecast location's zone. */
  timeZone: string
  /** The earliest start offered today (see nowHourOf). */
  todayNowHour: number
}

/**
 * Every day's lanes: the same actionable windows the dashboard offers
 * (packages/core/src/next-slot.ts). Today's windows that have already passed are left out, one
 * under way starts now, and an activity limited to certain weekdays only appears on
 * those days.
 */
export function planCalendarDays(
  days: readonly CalendarDay[],
  activities: readonly Activity[],
  { skinType, colorFor, scheduledItems, timeZone, todayNowHour }: PlanCalendarOptions,
): CalendarDayPlan[] {
  return days.map(day => ({
    day,
    lanes: activities.map(act => ({
      act,
      color: colorFor(act),
      scheduled: scheduledOn(scheduledItems, act.id, day.dateStr, timeZone),
      windows: activityRunsOnDate(act, day.dateStr)
        ? planActivityDay(day.hourly, act, skinType, {
            nowHour: day.isToday ? todayNowHour : -1,
            daylight: day.daylight,
          }).windows
        : [],
    })),
  }))
}

/** The slot inside a window that "Add to Google Calendar" books. */
export function windowSlot(
  act: Activity,
  win: SafeActivityWindow,
  day: Pick<DayWeather, 'hourly'>,
): SlotRecommendation | null {
  return recommendSlot(
    [win],
    [],
    act.durationMins,
    act.timePreference ?? 'earliest',
    -1,
    day.hourly,
  )
}

export interface ScheduledDetail {
  item: ScheduledActivity
  /** The activity it was scheduled for, when it still exists. */
  activity: Activity | undefined
  /** The item's local date in the forecast zone. */
  dateStr: string
  /** That day's lower-UV windows for the activity, for "Change time". */
  windows: SafeActivityWindow[]
}

/** What the Scheduled sheet needs about an open item. */
export function scheduledDetail(
  item: ScheduledActivity,
  activities: readonly Activity[],
  days: readonly CalendarDay[],
  { skinType, timeZone, todayNowHour }: Omit<PlanCalendarOptions, 'colorFor' | 'scheduledItems'>,
): ScheduledDetail {
  const activity = activities.find(a => a.id === item.activityId)
  const dateStr = zonedNow(timeZone, Date.parse(item.start)).date
  const day = days.find(d => d.dateStr === dateStr)
  const windows =
    activity && day
      ? planActivityDay(day.hourly, activity, skinType, {
          nowHour: day.isToday ? todayNowHour : -1,
          daylight: day.daylight,
        }).windows
      : []
  return { item, activity, dateStr, windows }
}
