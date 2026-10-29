// The forecast shapes the planning modules work on (planner, next slot, scheduler and the
// day views): hourly UV and weather for one forecast day, in the place's own time zone.
// The web app re-exports them from lib/types.ts; a native client uses the same ones.
import type { Activity } from './prefs'
import type { RecommendationWindow } from './recommendation'
import type { Daylight } from './sun-times'

export interface HourlyForecast {
  date?: string
  hour: number
  uv: number
  /** Air temperature in Celsius; convert only for display. */
  tempC: number
  condition: string
  cloudCover?: number // % cloud cover (0-100); used by cloud-sensitive exposure
  /** UV under a cloudless sky (never below `uv`, which includes the forecast clouds). */
  clearSkyUV?: number
  /** Chance of rain in the hour, percent (weather-fit.ts); absent in older forecasts. */
  rainChance?: number
  /** Feels-like temperature in Celsius (weather-fit.ts); absent in older forecasts. */
  feelsC?: number
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
   * The day's hours with the sun up at the forecast's place (daylightHours in
   * sun-times.ts), which bound every slot offered on it; absent or null when the place
   * is unknown.
   */
  daylight?: Daylight | null
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
