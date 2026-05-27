export type SkinType   = 'very-fair' | 'fair' | 'medium' | 'olive' | 'dark'
export type TierLevel  = 'anonymous' | 'free' | 'paid'

export interface Location {
  lat: number; lon: number; city: string; region: string
}

export interface Activity {
  id: string
  name: string
  icon: string
  durationMins: number
  maxUV: number        // base max UV assuming no sunscreen
  sunscreen: boolean   // does the user wear sunscreen for this activity?
  custom?: boolean
}

export interface CalendarHours {
  from: number   // default 6
  to:   number   // default 20
}

export interface UserPreferences {
  uid: string
  location: Location
  skinType: SkinType
  sunscreen: boolean    // kept for backward compat but per-activity takes precedence
  activities: Activity[]
  tier: TierLevel
  onboardingComplete: boolean
  calendarHours?: CalendarHours
}

export interface HourlyForecast {
  hour: number; uv: number; tempF: number; condition: string
}

export interface DayWeather {
  dateStr:  string
  label:    string
  hourly:   HourlyForecast[]
}

export interface WeatherResponse {
  current:  { uv: number; tempF: number; condition: string }
  today:    HourlyForecast[]
  tomorrow: HourlyForecast[]
  forecast: DayWeather[]    // all available days starting from today
}

export interface ActivityWindow {
  activity:    Activity
  bestWindow:  { from: number; to: number } | null
  safeNow:     boolean
  pctDaySafe:  number
  burnMins:    number | null
}
