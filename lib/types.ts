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

// The forecast day shapes the planning code works on live in @solara/core, shared with a
// native client.
export type {
  ActivityWindow,
  DayWeather,
  ForecastDay,
  HourlyForecast,
  SafeActivityWindow,
} from '@solara/core/forecast-days'
import type { DayWeather, ForecastDay, HourlyForecast } from '@solara/core/forecast-days'

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
