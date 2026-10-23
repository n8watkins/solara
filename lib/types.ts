import type { Activity, RecommendationWindow } from '@solara/core'

// Preference types are inferred from the zod schema in @solara/core (packages/core/src/prefs.ts),
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
  tempF: number
  condition: string
  cloudCover?: number // % cloud cover (0–100); used by cloud-sensitive exposure
}

export interface DayWeather {
  dateStr: string
  label: string
  hourly: HourlyForecast[]
}

export interface WeatherResponse {
  current: { uv: number; tempF: number; condition: string }
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
