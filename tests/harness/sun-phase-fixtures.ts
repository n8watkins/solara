// Forecasts for the sun-phase screens (sun-phase.spec.ts, REVIEW6 L7): a day in late
// October in Los Angeles (autumn, UTC-7) and Sydney (spring, UTC+11), with a UV curve
// that, like the real one, stays under 0.5 for an hour or more after sunrise and before
// sunset. The live site said "Before sunrise" at 8:05am in Los Angeles on such a day.
import type { Raw } from './live-forecast'

export interface SunPhasePlace {
  /** HarnessApp's `place` parameter. */
  param: 'los-angeles' | 'sydney'
  timeZone: string
  /** The zone's UTC offset on DATE, as in an ISO time. */
  offset: string
  /** Sunrise and sunset on DATE in local fractional hours (NOAA's equations). */
  sunrise: number
  sunset: number
  /** The day's UV peak. */
  peakUV: number
}

export const SUN_PHASE_DATE = '2026-10-28'

export const SUN_PHASE_PLACES: SunPhasePlace[] = [
  // Sunrise 7:09am, sunset 6:04pm.
  {
    param: 'los-angeles',
    timeZone: 'America/Los_Angeles',
    offset: '-07:00',
    sunrise: 7.15,
    sunset: 18.07,
    peakUV: 5.5,
  },
  // Sunrise 5:58am, sunset 7:18pm.
  {
    param: 'sydney',
    timeZone: 'Australia/Sydney',
    offset: '+11:00',
    sunrise: 5.97,
    sunset: 19.3,
    peakUV: 9,
  },
]

/** The instant `hhmm` (local) on SUN_PHASE_DATE at `place`. */
export function localInstant(place: SunPhasePlace, hhmm: string): number {
  return Date.parse(`${SUN_PHASE_DATE}T${hhmm}:00${place.offset}`)
}

const round1 = (n: number) => Math.round(n * 10) / 10

/** UV at a local fractional hour: zero while the sun is down, low near either end of the day. */
function uvAt(place: SunPhasePlace, hour: number): number {
  if (hour <= place.sunrise || hour >= place.sunset) return 0
  const x = (hour - place.sunrise) / (place.sunset - place.sunrise)
  return round1(place.peakUV * Math.sin(Math.PI * x) ** 2.5)
}

/** Open-Meteo's answer for `place` as it would be at `at`: three clear days and the live reading. */
export function sunPhaseRaw(place: SunPhasePlace, at: number): Raw {
  const time: string[] = []
  const uv: number[] = []
  for (const day of [28, 29, 30]) {
    for (let h = 0; h < 24; h++) {
      time.push(`2026-10-${day}T${String(h).padStart(2, '0')}:00`)
      uv.push(uvAt(place, h))
    }
  }
  const hour = (at - localInstant(place, '00:00')) / 3_600_000
  const flat = (value: number) => time.map(() => value)
  return {
    timezone: place.timeZone,
    current: { uv_index: uvAt(place, hour), temperature_2m: 19, weathercode: 0 },
    hourly: {
      time,
      uv_index: uv,
      uv_index_clear_sky: uv,
      temperature_2m: flat(19),
      weathercode: flat(0),
      cloudcover: flat(0),
    },
  }
}
