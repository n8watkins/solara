// Deterministic fixtures for the UI harness: a signed-in Pro user in Los Angeles
// and a 10-day Open-Meteo response anchored to the frozen clock (see clock.ts).
//
// The forecast is built as a raw Open-Meteo payload and passed through the real
// `parseForecast`, so the harness exercises the same parsing the live app uses. Its
// live reading (`current`) is the one at the clock's instant, so a screen opened in the
// evening or at night shows that time's UV, as the app would (REVIEW5 L7).
// Everything here is pure: no Date.now, no randomness, no network.
import type { User } from 'firebase/auth'
import { forecastView, parseForecast } from '@/lib/forecast'
import type { Activity, Location, TierLevel, UserPreferences, WeatherResponse } from '@/lib/types'
import { HARNESS_DATE, HARNESS_NOW_MS, HARNESS_TIMEZONE } from './clock'

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

const SYDNEY: Location = {
  lat: -33.87,
  lon: 151.21,
  city: 'Sydney',
  region: 'New South Wales',
  timezone: 'Australia/Sydney',
}

// The header's longest and shortest names in the same zone as Los Angeles, so the
// fixture forecast still fits (dashboard-polish.spec.ts). A typed or reverse-geocoded
// place can carry its region in the name, as here.
const SAN_LUIS_OBISPO: Location = {
  lat: 35.28,
  lon: -120.66,
  city: 'San Luis Obispo, California',
  region: 'California',
  timezone: 'America/Los_Angeles',
}

const OJAI: Location = {
  lat: 34.45,
  lon: -119.24,
  city: 'Ojai',
  region: 'California',
  timezone: 'America/Los_Angeles',
}

/** The places a harness screen can open in (HarnessApp's `place` parameter). */
export const HARNESS_PLACES: Record<string, Location> = {
  'los-angeles': HARNESS_LOCATION,
  sydney: SYDNEY,
  'san-luis-obispo': SAN_LUIS_OBISPO,
  ojai: OJAI,
}

const SAN_DIEGO: Location = {
  lat: 32.72,
  lon: -117.16,
  city: 'San Diego',
  region: 'California',
  timezone: 'America/Los_Angeles',
}

/**
 * Per-day shape: forecast UV peak (with the day's clouds, like Open-Meteo's
 * uv_index), cloud cover %, WMO code and max temperature in C.
 */
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

/** HARNESS_DATE's midnight in HARNESS_TIMEZONE (PDT, UTC-7), as epoch ms. */
const DAY_ZERO_MS = Date.parse(`${HARNESS_DATE}T00:00:00-07:00`)

/**
 * The forecast as Open-Meteo would answer it at `at` (epoch ms, default the harness's
 * frozen 10:30): the hourly days are fixed, and the live reading is the UV and
 * temperature at that instant.
 */
export function buildRawForecast(at: number = HARNESS_NOW_MS): RawForecast {
  const time: string[] = []
  const uv: number[] = []
  const temp: number[] = []
  const codes: number[] = []
  const cloud: number[] = []
  const clearSky: number[] = []

  DAYS.forEach((day, idx) => {
    const date = dateOffset(idx)
    for (let h = 0; h < 24; h++) {
      time.push(`${date}T${String(h).padStart(2, '0')}:00`)
      uv.push(uvAt(h, day.peakUV))
      temp.push(tempAt(h, day.maxC))
      codes.push(day.code)
      cloud.push(day.cloud)
      // A cloudless sky lets more UV through: up to 60% more under full overcast.
      clearSky.push(uvAt(h, day.peakUV * (1 + (0.6 * day.cloud) / 100)))
    }
  })

  const hours = (at - DAY_ZERO_MS) / 3_600_000
  const dayIndex = Math.min(DAYS.length - 1, Math.max(0, Math.floor(hours / 24)))
  const day = DAYS[dayIndex]
  if (!day) throw new Error('Harness fixtures need at least one day')
  const hour = Math.min(24, Math.max(0, hours - dayIndex * 24))

  return {
    timezone: HARNESS_TIMEZONE,
    current: {
      uv_index: uvAt(hour, day.peakUV),
      temperature_2m: tempAt(hour, day.maxC),
      weathercode: day.code,
    },
    hourly: {
      time,
      uv_index: uv,
      uv_index_clear_sky: clearSky,
      temperature_2m: temp,
      weathercode: codes,
      cloudcover: cloud,
    },
  }
}

/** The parsed forecast as seen at `at`. Call in the browser with the clock's time. */
export function buildWeather(at: number = HARNESS_NOW_MS): WeatherResponse {
  return forecastView(
    parseForecast(buildRawForecast(at), { days: DAYS.length }),
    undefined,
    HARNESS_LOCATION,
  )
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
