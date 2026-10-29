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
import { isStoreBuild } from './store-build'
import { getFutureDays } from './tiers'
import { burnMins, uvBand, vitDMins, type UVBand } from './weather'
import { dayPhrase } from '@solara/core/day-view'

// Today's state at the place (todayOver, sunDown, when UV returns) is pure and shared
// with a native client, in @solara/core (packages/core/src/day-view.ts).
export {
  dayHourText,
  dayPhrase,
  nextHourWhere,
  sunDown,
  todayOver,
  type DayHour,
  type DayForecastView,
  type SunDown,
} from '@solara/core/day-view'

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
  // A store build offers no Pro days to buy (lib/store-build.ts): no locked tab or upsell.
  const lockedForecastCount = isStoreBuild()
    ? 0
    : Math.max(0, weather.forecast.length - visibleForecast.length)
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
 *
 * Today's current hour is "now": its chip on the strip shows the live reading (the
 * provider's value at the clock's instant, which drifts from the hour's forecast as the
 * hour goes on), so focusing it keeps the live reading here too. Before, at 5:20pm the
 * readout said "0.1 Low now" beside a ringed 5pm chip reading 0.3 (REVIEW7 L7.3).
 */
export function uvReadout(
  weather: Pick<WeatherResponse, 'current' | 'now'>,
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
  const shown = focused && !(isToday && focused.hour === weather.now.hour) ? focused : null
  const headUV = shown ? shown.uv : currentUV
  return {
    currentUV,
    peakUV,
    peakHour,
    headUV,
    headTemp: shown ? shown.tempC : currentTemp,
    headCond: shown ? shown.condition : currentCond,
    headSuffix: shown ? ` at ${formatHour(shown.hour)}` : isToday ? ' now' : ' peak',
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
 * What an activity card says once today's matching windows have passed. The
 * card's "Done for today" badge already says the day is over, so this only names
 * what comes next: the next slot, or, on the guest plan (today only), that signing
 * in shows tomorrow. It never points at a section the plan does not show.
 */
export function windowsPassedNote(
  next: Pick<UpcomingSlot, 'label' | 'slot'> | null,
  laterDaysVisible: boolean,
  formatTime: (hour: number) => string,
): string {
  if (!laterDaysVisible) return 'Sign in free to plan tomorrow.'
  if (!next) return 'No later forecast day has a lower-UV slot for it.'
  return `Next slot: ${dayPhrase(false, next.label)} at ${formatTime(next.slot.start)}.`
}
