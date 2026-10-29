// Display units: temperature unit and 12/24-hour clock.
//
// Forecast temperatures are stored in Celsius (the provider's unit) and only
// converted when shown. Both settings default from the browser's locale and can
// be overridden in Preferences; an unset preference keeps following the locale.

export type TemperatureUnit = 'celsius' | 'fahrenheit'
export type ClockFormat = '12h' | '24h'

/** A saved choice; 'auto' (or unset) follows the browser locale (schema in @solara/core). */
export {
  CLOCK_FORMAT_PREFERENCES,
  TEMPERATURE_UNIT_PREFERENCES,
  type ClockFormatPreference,
  type TemperatureUnitPreference,
} from '@solara/core'
import type { ClockFormatPreference, TemperatureUnitPreference } from '@solara/core'
import { formatTemperature } from '@solara/core/weather-fit'

export interface DisplayUnits {
  temperature: TemperatureUnit
  clock: ClockFormat
}

/** Unit preferences as stored on the account; unset or 'auto' follows the locale. */
export interface UnitPreferences {
  temperatureUnit?: TemperatureUnitPreference
  clockFormat?: ClockFormatPreference
}

/** Regions that use Fahrenheit for everyday temperatures (CLDR "measure system" US). */
const FAHRENHEIT_REGIONS = new Set([
  'US',
  'AS',
  'BS',
  'BZ',
  'FM',
  'GU',
  'KY',
  'LR',
  'MH',
  'MP',
  'PR',
  'PW',
  'UM',
  'VI',
])

export const DEFAULT_LOCALE = 'en-US'

/** The browser's preferred locales, or en-US outside a browser. */
export function browserLocales(): readonly string[] {
  if (typeof navigator === 'undefined') return [DEFAULT_LOCALE]
  const list = navigator.languages?.length ? navigator.languages : [navigator.language]
  return list.filter(Boolean).length ? list.filter(Boolean) : [DEFAULT_LOCALE]
}

function primaryLocale(locales: readonly string[]): string {
  for (const locale of locales) {
    try {
      return Intl.getCanonicalLocales(locale)[0] ?? DEFAULT_LOCALE
    } catch {
      // Skip a malformed tag and try the next one.
    }
  }
  return DEFAULT_LOCALE
}

/** The locale's region ("en" alone maximizes to US, "fr" to FR). */
function regionOf(locale: string): string | undefined {
  try {
    return new Intl.Locale(locale).maximize().region
  } catch {
    return undefined
  }
}

/** Fahrenheit for locales in Fahrenheit regions, Celsius everywhere else. */
export function defaultTemperatureUnit(
  locales: readonly string[] = browserLocales(),
): TemperatureUnit {
  const region = regionOf(primaryLocale(locales))
  return region && FAHRENHEIT_REGIONS.has(region) ? 'fahrenheit' : 'celsius'
}

/** The locale's customary clock: 12-hour where it prints "1 PM", else 24-hour. */
export function defaultClockFormat(locales: readonly string[] = browserLocales()): ClockFormat {
  try {
    const { hourCycle, hour12 } = new Intl.DateTimeFormat(primaryLocale(locales), {
      hour: 'numeric',
    }).resolvedOptions()
    if (hourCycle) return hourCycle === 'h11' || hourCycle === 'h12' ? '12h' : '24h'
    return hour12 ? '12h' : '24h'
  } catch {
    return '12h'
  }
}

/** The units to display: the saved preference, else the locale's default. */
export function resolveUnits(
  prefs: UnitPreferences | null | undefined,
  locales: readonly string[] = browserLocales(),
): DisplayUnits {
  const temperature = prefs?.temperatureUnit
  const clock = prefs?.clockFormat
  return {
    temperature:
      temperature && temperature !== 'auto' ? temperature : defaultTemperatureUnit(locales),
    clock: clock && clock !== 'auto' ? clock : defaultClockFormat(locales),
  }
}

/** Celsius to Fahrenheit, unrounded. */
export function celsiusToFahrenheit(celsius: number): number {
  return (celsius * 9) / 5 + 32
}

/** A Celsius reading in the display unit, rounded to a whole degree: "29°C", "84°F". */
export { formatTemperature }

/** Split fractional hours into whole hour and minute (10.5 -> 10:30), rounding to a minute. */
function hourMinute(hours: number): { hour: number; minute: number } {
  const total = Math.round(hours * 60)
  return { hour: Math.floor(total / 60), minute: total % 60 }
}

const pad2 = (n: number) => String(n).padStart(2, '0')

/** An hour on the clock: "9am", "12pm" (12-hour) or "09:00" (24-hour). 24 is midnight. */
export function formatHour(hour: number, clock: ClockFormat = '12h'): string {
  if (clock === '24h') return `${pad2(hour === 24 ? 24 : hour % 24)}:00`
  const h = hour % 24
  if (h === 0) return '12am'
  if (h === 12) return '12pm'
  return h < 12 ? `${h}am` : `${h - 12}pm`
}

/** A fractional time: "6:45am", "5pm" (12-hour) or "06:45", "17:00" (24-hour). */
export function formatClockTime(hours: number, clock: ClockFormat = '12h'): string {
  const { hour, minute } = hourMinute(hours)
  if (clock === '24h') return `${pad2(hour)}:${pad2(minute)}`
  const base = formatHour(hour, '12h')
  if (minute === 0) return base
  const match = /^(\d+)(am|pm)$/.exec(base)
  return match ? `${match[1]}:${pad2(minute)}${match[2]}` : base
}

/** The narrowest hour label: "6a", "12p" (12-hour) or "06" (24-hour). */
export function compactHour(hours: number, clock: ClockFormat = '12h'): string {
  const { hour, minute } = hourMinute(hours)
  if (clock === '24h') return minute ? `${pad2(hour)}:${pad2(minute)}` : pad2(hour)
  return formatClockTime(hours, '12h').replace(/([ap])m$/, '$1')
}

/** Formatters bound to one set of display units. */
export interface UnitFormatters {
  units: DisplayUnits
  /** A whole hour: "9am" / "09:00". */
  hour: (hour: number) => string
  /** A fractional time: "6:45am" / "06:45". */
  time: (hours: number) => string
  /** The narrowest hour label: "6a" / "06". */
  compactHour: (hours: number) => string
  /** A Celsius reading in the display unit: "84°F" / "29°C". */
  temp: (celsius: number) => string
}

export function unitFormatters(units: DisplayUnits): UnitFormatters {
  return {
    units,
    hour: hour => formatHour(hour, units.clock),
    time: hours => formatClockTime(hours, units.clock),
    compactHour: hours => compactHour(hours, units.clock),
    temp: celsius => formatTemperature(celsius, units.temperature),
  }
}
