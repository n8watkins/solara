export type SkinType = 'very-fair' | 'fair' | 'medium' | 'olive' | 'dark'
export type TierLevel = 'anonymous' | 'free' | 'paid'

export interface Location {
  lat: number
  lon: number
  city: string
  region: string
}

export interface Activity {
  id: string
  name: string
  icon: string
  durationMins: number
  maxUV: number
  custom?: boolean
}

export interface UserPreferences {
  uid: string
  location: Location
  skinType: SkinType
  sunscreen: boolean
  activities: Activity[]
  tier: TierLevel
  onboardingComplete: boolean
}

export interface HourlyForecast {
  hour: number
  uv: number
  tempF: number
  condition: string
}

export interface WeatherResponse {
  current: { uv: number; tempF: number; condition: string }
  today: HourlyForecast[]
  tomorrow: HourlyForecast[]
}

export interface ActivityWindow {
  activity: Activity
  bestWindow: { from: number; to: number } | null
  safeNow: boolean
  pctDaySafe: number
  burnMins: number | null
}
