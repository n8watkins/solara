import type { Activity, Daylight, RecommendationWindow } from '@solara/core'
import type { ZonedNow } from './time'

// Preference types are inferred from the Valibot schema in @solara/core (packages/core/src/prefs.ts),
// the single source of truth for the stored document.
export type {
  Activity,
  CalendarHours,
  Location,
  PreferredHours,
  Profile,
  SkinType,
  TierLevel,
  TimePreference,
  UserPreferences,
} from '@solara/core'

export interface HourlyForecast {
  date?: string
  hour: number
  uv: number
  /** Air temperature in Celsius; convert only for display (lib/units.ts). */
  tempC: number
  condition: string
  cloudCover?: number // % cloud cover (0–100); used by cloud-sensitive exposure
  /** UV under a cloudless sky (never below `uv`, which includes the forecast clouds). */
  clearSkyUV?: number
}

/** One forecast day as fetched: the provider's local date and its daytime hours. */
export interface ForecastDay {
  dateStr: string
  hourly: HourlyForecast[]
}

/** A forecast day labeled for display ("Today", "Tomorrow", "Wed, Jun 17"). */
export interface DayWeather extends ForecastDay {
  label: string
  /**
   * The day's hours with the sun up at the forecast's place (@solara/core daylightHours),
   * which bound every slot offered on it; absent or null when the place is unknown.
   */
  daylight?: Daylight | null
}

export interface CurrentConditions {
  uv: number
  /** Celsius. */
  tempC: number
  condition: string
}

/**
 * A parsed forecast as fetched and cached. It has no notion of "today": that is
 * decided when it is shown (lib/forecast.ts forecastView), in `timezone`.
 */
export interface ForecastData {
  /** IANA zone of the forecast location; every date and hour here is local to it. */
  timezone: string
  /** When the forecast was fetched from the weather provider (epoch ms). */
  fetchedAt: number
  /**
   * The forecast proxy answered with its last good copy from an earlier hour (its
   * upstream budget was spent), so `fetchedAt` is when that copy was fetched, not when
   * it arrived. Absent for a current forecast.
   */
  stale?: true
  current: CurrentConditions
  days: ForecastDay[]
}

/** The forecast as seen at one instant in the location's time zone. */
export interface WeatherResponse {
  timezone: string
  /** "Now" in the location's zone; every screen reads today and the current hour from it. */
  now: ZonedNow
  current: CurrentConditions
  today: HourlyForecast[]
  tomorrow: HourlyForecast[]
  forecast: DayWeather[] // all available days starting from today
}

export type SafeActivityWindow = RecommendationWindow

export interface ActivityWindow {
  activity: Activity
  bestWindow: { from: number; to: number } | null
  allWindows: SafeActivityWindow[]
  safeNow: boolean
  pctDaySafe: number
  burnMins: number | null
}
