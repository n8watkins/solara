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
  sunscreen: boolean   // whether this recommendation assumes SPF protection
  custom?: boolean
}

export interface CalendarHours {
  from: number   // default 6
  to:   number   // default 20
}

export interface UserPreferences {
  uid: string
  schemaVersion: number
  location: Location
  skinType: SkinType
  sunscreen: boolean    // global sunscreen preference applied to activities
  activities: Activity[]
  tier: TierLevel
  onboardingComplete: boolean
  calendarHours?: CalendarHours
  upgradeInterest?: {
    email?: string
    createdAt: string
  }
}

export interface HourlyForecast {
  date?: string
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
