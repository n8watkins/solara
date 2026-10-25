// Pure view logic for the dashboard (components/Dashboard.tsx and the pieces in
// components/dashboard/): which days the account may see, the day picker's
// chips, and the UV card's big readout. Kept free of React so it is unit tested.
import type {
  DayWeather,
  HourlyForecast,
  SkinType,
  TierLevel,
  UserPreferences,
  WeatherResponse,
} from './types'
import type { BusyPeriod } from './gcal-view'
import type { BusyInterval } from './scheduler'
import type { UpcomingSlot } from './planner'
import { busyIntervalsForDay } from './gcal-view'
import { getFutureDays } from './tiers'
import { burnMins, uvBand, vitDMins, type UVBand } from './weather'

/** The planning upsell shown to plans with locked forecast days. */
export const UPGRADE_COPY = 'Go Pro for 10-day planning'

/** The locked forecast tab's upsell (its accessible name). */
export const LOCKED_DAYS_UPSELL = 'See the next 10 days with Pro'

export interface DashboardAccess {
  /** Tier that decides how many forecast days show (a preview tier may override). */
  accessTier: TierLevel
  /** The account's own tier (guest, Free or Pro), which decides the activity limit. */
  activityTier: TierLevel
  accessibleDays: number
  visibleForecast: DayWeather[]
  /** The selected day when the tier may see it, else null (today). */
  selectedDay: DayWeather | null
  lockedForecastCount: number
  /** Upgrade copy for plans with locked days; null for Pro. */
  upgradeCopy: string | null
  showDayTabs: boolean
}

export function dashboardAccess(
  weather: WeatherResponse,
  prefs: UserPreferences,
  displayTier: TierLevel | undefined,
  selectedDay: DayWeather | null,
): DashboardAccess {
  const accessTier = displayTier || prefs.tier || 'anonymous'
  const activityTier = prefs.tier || 'anonymous'
  const accessibleDays = getFutureDays(accessTier)
  const visibleForecast = weather.forecast.slice(0, accessibleDays)
  const allowed =
    selectedDay && visibleForecast.some(day => day.dateStr === selectedDay.dateStr)
      ? selectedDay
      : null
  const lockedForecastCount = Math.max(0, weather.forecast.length - visibleForecast.length)
  const upgradeCopy = lockedForecastCount > 0 ? UPGRADE_COPY : null
  return {
    accessTier,
    activityTier,
    accessibleDays,
    visibleForecast,
    selectedDay: allowed,
    lockedForecastCount,
    upgradeCopy,
    showDayTabs: visibleForecast.length > 1 || lockedForecastCount > 0,
  }
}

export interface DayChips {
  todayActive: boolean
  tomorrow: DayWeather | null
  tomorrowActive: boolean
  /** The "More days" chip, labeled with a later selected day; null when hidden. */
  more: { label: string; active: boolean } | null
  /** Forecast days the plan cannot see, behind the locked "10 days" tab (0: no tab). */
  lockedDays: number
}

/**
 * Today and Tomorrow are direct chips; every later visible day sits behind a "More
 * days" chip that names the selected day, and a plan with locked days gets a locked
 * tab that opens the Pro plans.
 */
export function dayChips(
  access: Pick<DashboardAccess, 'visibleForecast' | 'selectedDay' | 'lockedForecastCount'>,
): DayChips {
  const { visibleForecast, selectedDay, lockedForecastCount } = access
  const tomorrow = visibleForecast[1] ?? null
  const tomorrowActive = !!(selectedDay && tomorrow && selectedDay.dateStr === tomorrow.dateStr)
  const beyond = selectedDay && !tomorrowActive ? selectedDay : null
  return {
    todayActive: !selectedDay,
    tomorrow,
    tomorrowActive,
    more:
      visibleForecast.length > 2
        ? { label: beyond ? beyond.label : 'More days', active: !!beyond }
        : null,
    lockedDays: lockedForecastCount,
  }
}

/** "today", "tomorrow" or "on Wed 17", for sentences about the selected day. */
export function dayPhrase(isToday: boolean, dateLabel: string): string {
  if (isToday) return 'today'
  return dateLabel === 'Tomorrow' ? 'tomorrow' : `on ${dateLabel}`
}

export interface UVReadout {
  /** The live UV today, or the day's peak on another day. */
  currentUV: number
  peakUV: number
  peakHour: number
  /** The big number: the focused hour's UV, else currentUV. */
  headUV: number
  headTemp: number | undefined
  headCond: string
  /** " at 2pm" for a focused hour, else " now" (today) or " peak". */
  headSuffix: string
  headBurn: number | null
  /** Burn and vitamin D minutes at currentUV, for the metric cards. */
  burn: number | null
  vitD: number | null
}

/**
 * The UV card's readout. With no focused hour it shows the live reading (today)
 * or the day's peak, matching the header and the burn card; a scrubbed hour
 * shows that hour's forecast.
 */
export function uvReadout(
  weather: Pick<WeatherResponse, 'current'>,
  hourly: HourlyForecast[],
  isToday: boolean,
  focused: HourlyForecast | null,
  skinType: SkinType,
  formatHour: (hour: number) => string,
): UVReadout {
  const peakEntry = hourly.reduce<HourlyForecast | undefined>(
    (best, h) => (h.uv > (best?.uv ?? 0) ? h : best),
    hourly[0],
  )
  const currentUV = isToday ? weather.current.uv : (peakEntry?.uv ?? 0)
  const currentTemp = isToday ? weather.current.tempC : peakEntry?.tempC
  const currentCond = isToday ? weather.current.condition : (peakEntry?.condition ?? '')
  const peakUV = hourly.length ? Math.max(...hourly.map(h => h.uv)) : 0
  const peakHour = hourly.find(h => h.uv === peakUV)?.hour ?? 12
  const headUV = focused ? focused.uv : currentUV
  return {
    currentUV,
    peakUV,
    peakHour,
    headUV,
    headTemp: focused ? focused.tempC : currentTemp,
    headCond: focused ? focused.condition : currentCond,
    headSuffix: focused ? ` at ${formatHour(focused.hour)}` : isToday ? ' now' : ' peak',
    headBurn: burnMins(headUV, skinType),
    burn: burnMins(currentUV, skinType),
    vitD: vitDMins(currentUV, skinType),
  }
}

/** Theme tone for the big UV number; the label beside it names the band. */
export type UVNumberTone = 'none' | 'success' | 'warning' | 'accent' | 'danger'

const NUMBER_TONES: Record<UVBand, UVNumberTone> = {
  none: 'none',
  low: 'success',
  moderate: 'warning',
  high: 'accent',
  'very-high': 'danger',
  extreme: 'danger',
}

export function uvNumberTone(uv: number): UVNumberTone {
  return NUMBER_TONES[uvBand(uv)]
}

/** Calendar busy blocks per visible day, in the forecast's zone. */
export function busyByDate(
  periods: BusyPeriod[] | null,
  days: DayWeather[],
  timeZone: string,
): Record<string, BusyInterval[]> {
  const byDate: Record<string, BusyInterval[]> = {}
  if (periods)
    for (const day of days)
      byDate[day.dateStr] = busyIntervalsForDay(periods, day.dateStr, timeZone)
  return byDate
}

/** The free/busy query range: from now through the account's visible days. */
export function freeBusyRange(
  nowMs: number,
  accessibleDays: number,
): { timeMin: Date; timeMax: Date } {
  return {
    timeMin: new Date(nowMs),
    timeMax: new Date(nowMs + Math.max(1, accessibleDays) * 86_400_000),
  }
}

/**
 * What an activity card says once today's matching windows have passed: when the
 * next one is, or, on the guest plan (today only), that signing in shows tomorrow.
 * It never points at a section the plan does not show.
 */
export function windowsPassedNote(
  next: Pick<UpcomingSlot, 'label' | 'slot'> | null,
  laterDaysVisible: boolean,
  formatTime: (hour: number) => string,
): string {
  const passed = "Today's matching windows have passed."
  if (!laterDaysVisible) return `${passed} Sign in free to plan tomorrow too.`
  if (!next) return `${passed} None of your other forecast days has one either.`
  return `${passed} Next lower-UV slot: ${dayPhrase(false, next.label)} at ${formatTime(next.slot.start)}.`
}

/** An hour on today (tomorrow: false) or tomorrow. */
export interface DayHour {
  hour: number
  tomorrow: boolean
}

/**
 * The first hour from `nowHour` on, today or else tomorrow, whose UV passes
 * `test`; null when neither day has one.
 */
export function nextHourWhere(
  weather: Pick<WeatherResponse, 'today' | 'tomorrow'>,
  nowHour: number,
  test: (uv: number) => boolean,
): DayHour | null {
  const today = weather.today.find(h => h.hour + 1 > nowHour && test(h.uv))
  if (today) return { hour: today.hour, tomorrow: false }
  const tomorrow = weather.tomorrow.find(h => test(h.uv))
  return tomorrow ? { hour: tomorrow.hour, tomorrow: true } : null
}

/** "7am" today, "7am tomorrow". */
export function dayHourText(at: DayHour, formatHour: (hour: number) => string): string {
  return at.tomorrow ? `${formatHour(at.hour)} tomorrow` : formatHour(at.hour)
}

export interface SunDown {
  /** Before the day's first UV, or after its last. */
  phase: 'before-sunrise' | 'after-sunset'
  /** When UV comes back (UV 0.5 or more). */
  uvReturns: DayHour | null
}

/**
 * Today's sun-down state: the live UV reads none, and either no UV is left today
 * or it has not started yet. Null in daylight, including a heavily clouded hour
 * between two sunny ones.
 */
export function sunDown(
  weather: Pick<WeatherResponse, 'today' | 'tomorrow' | 'current'>,
  nowHour: number,
): SunDown | null {
  if (weather.current.uv >= 0.5) return null
  const sunny = weather.today.filter(h => h.uv >= 0.5)
  const first = sunny[0]
  const last = sunny.at(-1)
  const uvReturns = nextHourWhere(weather, nowHour, uv => uv >= 0.5)
  if (first && nowHour < first.hour) return { phase: 'before-sunrise', uvReturns }
  if (!last || nowHour >= last.hour + 1) return { phase: 'after-sunset', uvReturns }
  return null
}

export interface DayOutlook {
  peakUV: number
  peakHour: number
  /** The first hour at UV 3 (Moderate) or more, if any: lower UV lasts until then. */
  lowUntil: number | null
}

/** A day's peak and how long its morning stays below UV 3, for the after-dark hero. */
export function dayOutlook(hourly: HourlyForecast[]): DayOutlook | null {
  const first = hourly[0]
  if (!first) return null
  const peak = hourly.reduce((best, h) => (h.uv > best.uv ? h : best), first)
  if (peak.uv < 0.5) return null
  const moderate = hourly.find(h => uvBand(h.uv) !== 'none' && uvBand(h.uv) !== 'low')
  return { peakUV: peak.uv, peakHour: peak.hour, lowUntil: moderate?.hour ?? null }
}
