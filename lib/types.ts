export type SkinType   = 'very-fair' | 'fair' | 'medium' | 'olive' | 'dark'
export type TierLevel  = 'anonymous' | 'free' | 'paid'

export interface Location {
  lat: number; lon: number; city: string; region: string
}

export interface PreferredHours {
  from: number
  to: number
}

/** A person/pet whose skin type drives safety math when selected. */
export interface Profile {
  id: string
  name: string
  skinType: SkinType
  icon?: string
}

// How to choose a start time among the feasible safe+free slots.
export type TimePreference = 'earliest' | 'latest' | 'sunniest'

export interface Activity {
  id: string
  name: string
  icon: string
  durationMins: number
  maxUV: number        // base max UV assuming no sunscreen
  sunscreen: boolean   // whether this recommendation assumes SPF protection
  custom?: boolean
  preferredHours?: PreferredHours
  timePreference?: TimePreference  // default 'earliest'
  daysOfWeek?: number[]            // 0=Sun … 6=Sat; undefined/empty = every day
  cloudSensitive?: boolean         // discount effective UV by cloud cover when planning
}

export interface CalendarHours {
  from: number   // default 6
  to:   number   // default 20
}

export interface UserPreferences {
  uid: string
  schemaVersion: number
  location: Location           // the active location
  savedLocations?: Location[]  // quick-switch list; always includes the active one
  skinType: SkinType           // the live skin type used for all safety math (= active profile's)
  profiles?: Profile[]         // saved people/pets; selecting one sets skinType
  activeProfileId?: string
  sunscreen: boolean    // legacy global sunscreen fallback for old activities
  activities: Activity[]
  tier: TierLevel
  calendarFeedToken?: string   // per-user secret for the live .ics feed (P7b); see lib/feed.ts
  onboardingComplete: boolean
  calendarHours?: CalendarHours
  showSunPath?: boolean        // sun-path arc on the dashboard; default on (Appearance setting)
  hiddenActivitySuggestionIds?: string[]
  collapsedActivityCategories?: string[]
  upgradeInterest?: {
    email?: string
    createdAt: string
  }
}

export interface HourlyForecast {
  date?: string
  hour: number; uv: number; tempF: number; condition: string
  cloudCover?: number   // % cloud cover (0–100); used by cloud-sensitive exposure
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

export interface SafeActivityWindow {
  from: number
  to: number
  label: 'Morning' | 'Midday' | 'Afternoon' | 'Evening' | 'All day'
  peakUV: number
  avgUV: number
}

export interface ActivityWindow {
  activity:    Activity
  bestWindow:  { from: number; to: number } | null
  allWindows:  SafeActivityWindow[]
  safeNow:     boolean
  pctDaySafe:  number
  burnMins:    number | null
}
