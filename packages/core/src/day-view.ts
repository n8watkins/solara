// Where the day stands at the place: whether today is over, when UV returns after
// dark, and the words for a day ("today", "on Wed 17"). Pure; the web dashboard
// (lib/dashboard-view.ts) re-exports it, and a native client reads the same notions.
import type { HourlyForecast } from './forecast-days'
import type { SunPhase } from './sun-times'

/** The parts of a day's forecast these read: today's and tomorrow's hours, and the live UV. */
export interface DayForecastView {
  today: readonly Pick<HourlyForecast, 'hour' | 'uv'>[]
  tomorrow: readonly Pick<HourlyForecast, 'hour' | 'uv'>[]
  current: { uv: number }
}

/** "today", "tomorrow" or "on Wed 17", for sentences about the selected day. */
export function dayPhrase(isToday: boolean, dateLabel: string): string {
  if (isToday) return 'today'
  return dateLabel === 'Tomorrow' ? 'tomorrow' : `on ${dateLabel}`
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
  weather: Pick<DayForecastView, 'today' | 'tomorrow'>,
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
  /** Before today's sunrise, or after today's sunset. */
  phase: 'before-sunrise' | 'after-sunset'
  /** When UV comes back (UV 0.5 or more). */
  uvReturns: DayHour | null
}

/**
 * Today's sun-down state: the live UV reads none and the sun is below the horizon,
 * before today's sunrise or after today's sunset at the place (`sun`, from
 * sun-times.ts). Null while the sun is up, even when its UV is still under 0.5 (a
 * low morning or evening sun, or heavy cloud; REVIEW6 L7). Without the sun's times (no
 * place) it falls back to the forecast: before the day's first UV, or after its last.
 */
export function sunDown(
  weather: DayForecastView,
  nowHour: number,
  sun: SunPhase | null = null,
): SunDown | null {
  if (weather.current.uv >= 0.5 || sun === 'up') return null
  const returns = (from: number) => nextHourWhere(weather, from, uv => uv >= 0.5)
  // After today's sunset, UV can only come back tomorrow.
  if (sun) return { phase: sun, uvReturns: returns(sun === 'after-sunset' ? 24 : nowHour) }
  const uvReturns = returns(nowHour)
  const sunny = weather.today.filter(h => h.uv >= 0.5)
  const first = sunny[0]
  const last = sunny.at(-1)
  if (first && nowHour < first.hour) return { phase: 'before-sunrise', uvReturns }
  if (!last || nowHour >= last.hour + 1) return { phase: 'after-sunset', uvReturns }
  return null
}

/**
 * Whether today is over at the place: the sun has set (`sun`, from sunPhaseAt in
 * sun-times.ts). The briefing then turns to tomorrow and the hero steps aside, both on
 * this one notion (they used to disagree in the evening: the briefing went by the UV
 * and the hero by the windows). Without the sun's times (no place) it falls back to
 * the forecast: no UV of 0.5 or more is left from `nowHour` on.
 */
export function todayOver(
  weather: Pick<DayForecastView, 'today'>,
  nowHour: number,
  sun: SunPhase | null,
): boolean {
  if (sun) return sun === 'after-sunset'
  return !weather.today.some(h => h.hour + 1 > nowHour && h.uv >= 0.5)
}
