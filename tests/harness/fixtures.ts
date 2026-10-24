// Deterministic fixtures for the UI harness: a signed-in Pro user in Los Angeles
// and a 10-day Open-Meteo response anchored to the frozen clock (see clock.ts).
//
// The forecast is built as a raw Open-Meteo payload and passed through the real
// `parseForecast`, so the harness exercises the same parsing the live app uses.
// Everything here is pure: no Date.now, no randomness, no network.
import type { User } from 'firebase/auth'
import { forecastView, parseForecast } from '@/lib/forecast'
import type { Activity, Location, TierLevel, UserPreferences, WeatherResponse } from '@/lib/types'
import { HARNESS_DATE, HARNESS_TIMEZONE } from './clock'

/** Unique string the production leak check looks for (scripts/check-no-ui-harness.mjs). */
export const HARNESS_MARKER = 'solara-ui-harness'

type RawForecast = Parameters<typeof parseForecast>[0]

export const HARNESS_LOCATION: Location = {
  lat: 34.05,
  lon: -118.24,
  city: 'Los Angeles',
  region: 'California',
  timezone: 'America/Los_Angeles',
}

const SAN_DIEGO: Location = {
  lat: 32.72,
  lon: -117.16,
  city: 'San Diego',
  region: 'California',
  timezone: 'America/Los_Angeles',
}

/** Per-day shape: clear-sky UV peak, cloud cover %, WMO code and max temperature in C. */
const DAYS: { peakUV: number; cloud: number; code: number; maxC: number }[] = [
  { peakUV: 10.4, cloud: 8, code: 0, maxC: 29 },
  { peakUV: 9.8, cloud: 22, code: 2, maxC: 27 },
  { peakUV: 6.2, cloud: 78, code: 3, maxC: 23 },
  { peakUV: 4.1, cloud: 92, code: 61, maxC: 20 },
  { peakUV: 8.7, cloud: 35, code: 2, maxC: 25 },
  { peakUV: 10.9, cloud: 4, code: 0, maxC: 31 },
  { peakUV: 11.3, cloud: 0, code: 0, maxC: 33 },
  { peakUV: 9.1, cloud: 18, code: 1, maxC: 28 },
  { peakUV: 7.4, cloud: 55, code: 3, maxC: 24 },
  { peakUV: 10.0, cloud: 10, code: 0, maxC: 30 },
]

const round1 = (n: number) => Math.round(n * 10) / 10

/** YYYY-MM-DD for HARNESS_DATE + offset days, computed in UTC so it is zone-independent. */
function dateOffset(days: number): string {
  const base = new Date(`${HARNESS_DATE}T00:00:00Z`)
  base.setUTCDate(base.getUTCDate() + days)
  return base.toISOString().slice(0, 10)
}

/** UV for a fractional local hour: zero outside 6:00-20:00, a smooth peak at 13:00. */
function uvAt(hour: number, peakUV: number): number {
  const sunrise = 6
  const sunset = 20
  if (hour <= sunrise || hour >= sunset) return 0
  const x = (hour - sunrise) / (sunset - sunrise)
  // Skew the peak slightly past solar noon, like Southern California in June.
  const shaped = Math.sin(Math.PI * Math.pow(x, 1.1))
  return round1(Math.max(0, peakUV * Math.pow(shaped, 1.6)))
}

function tempAt(hour: number, maxC: number): number {
  const minC = maxC - 11
  const x = Math.cos(((hour - 15) / 24) * 2 * Math.PI)
  return round1(minC + ((maxC - minC) * (x + 1)) / 2)
}

export function buildRawForecast(): RawForecast {
  const time: string[] = []
  const uv: number[] = []
  const temp: number[] = []
  const codes: number[] = []
  const cloud: number[] = []

  DAYS.forEach((day, idx) => {
    const date = dateOffset(idx)
    for (let h = 0; h < 24; h++) {
      time.push(`${date}T${String(h).padStart(2, '0')}:00`)
      uv.push(uvAt(h, day.peakUV))
      temp.push(tempAt(h, day.maxC))
      codes.push(day.code)
      cloud.push(day.cloud)
    }
  })

  const [today] = DAYS
  if (!today) throw new Error('Harness fixtures need at least one day')

  return {
    timezone: HARNESS_TIMEZONE,
    current: {
      uv_index: uvAt(10.5, today.peakUV),
      temperature_2m: tempAt(10.5, today.maxC),
      weathercode: today.code,
    },
    hourly: {
      time,
      uv_index: uv,
      temperature_2m: temp,
      weathercode: codes,
      cloudcover: cloud,
    },
  }
}

/** The parsed forecast as seen now. Call in the browser after the clock is frozen. */
export function buildWeather(): WeatherResponse {
  return forecastView(parseForecast(buildRawForecast(), { days: DAYS.length }))
}

const ACTIVITIES: Activity[] = [
  {
    id: 'run',
    name: 'Running',
    icon: '🏃',
    durationMins: 45,
    maxUV: 4,
    sunscreen: false,
    timePreference: 'earliest',
  },
  {
    id: 'hike',
    name: 'Hiking',
    icon: '🥾',
    durationMins: 120,
    maxUV: 3,
    sunscreen: true,
    cloudSensitive: true,
  },
  {
    id: 'tennis',
    name: 'Tennis',
    icon: '🎾',
    durationMins: 60,
    maxUV: 4,
    sunscreen: true,
    preferredHours: { from: 16, to: 20 },
    timePreference: 'latest',
  },
  {
    id: 'garden',
    name: 'Gardening',
    icon: '🌱',
    durationMins: 60,
    maxUV: 3,
    sunscreen: false,
    daysOfWeek: [0, 1, 3, 6],
  },
]

export function buildPrefs(tier: TierLevel = 'paid'): UserPreferences {
  if (tier === 'anonymous') {
    // A guest plan as lib/guest.ts keeps it: one activity, no saved places or profiles.
    const { profiles: _profiles, activeProfileId: _active, ...free } = buildPrefs('free')
    return { ...free, uid: '', tier, savedLocations: [], activities: ACTIVITIES.slice(0, 1) }
  }
  return {
    uid: 'harness-user',
    schemaVersion: 2,
    location: HARNESS_LOCATION,
    savedLocations: [HARNESS_LOCATION, SAN_DIEGO],
    skinType: 'fair',
    profiles: [
      { id: 'me', name: 'Me', skinType: 'fair', icon: '🙂' },
      { id: 'kid', name: 'Maya', skinType: 'very-fair', icon: '🧒' },
    ],
    activeProfileId: 'me',
    sunscreen: false,
    activities: tier === 'free' ? ACTIVITIES.slice(0, 3) : ACTIVITIES,
    tier,
    onboardingComplete: true,
    calendarHours: { from: 6, to: 20 },
    showSunPath: true,
    hiddenActivitySuggestionIds: [],
    collapsedActivityCategories: [],
    notificationHour: 7,
  }
}

/**
 * A minimal stand-in for a signed-in Firebase user. Only the fields the UI reads are
 * real; the harness never calls Firebase (it is built without Firebase config).
 */
export function buildUser(): User {
  return {
    uid: 'harness-user',
    displayName: 'Alex Rivera',
    email: 'alex@example.com',
    photoURL: null,
    emailVerified: true,
    isAnonymous: false,
    providerData: [],
    getIdToken: async () => 'harness-id-token',
  } as unknown as User
}
