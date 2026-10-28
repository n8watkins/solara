// Sunrise and sunset at a place, from astronomy rather than the forecast.
//
// The dashboard and setup used to call the sun "down" whenever the forecast UV was
// under 0.5, so on autumn and winter mornings (and under heavy cloud) the sun could be
// up for an hour or more while the app said "Before sunrise" (REVIEW6 L7). The sun's
// times come from NOAA's solar calculator equations (accurate to about a minute
// between the polar circles), for the place's local date in its own time zone.
//
// Daylight also bounds every recommended slot (`daylightHours`, used by `findWindows`):
// UV is 0 before sunrise and after sunset, which would otherwise read as the safest
// time of all.
import { isIanaTimeZone, wallClockAt, zonedDate } from './zoned-time'

/** Today's sun at a place: when it rises and sets (epoch ms), or that it does neither. */
export type SunTimes =
  | { kind: 'rises'; sunrise: number; sunset: number }
  /** Midnight sun: up all day. */
  | { kind: 'polar-day' }
  /** Polar night: down all day. */
  | { kind: 'polar-night' }

const RAD = Math.PI / 180
const DAY_MS = 86_400_000
const MINUTE_MS = 60_000
/** The sun's centre this far below the horizon at sunrise (refraction plus its radius). */
const HORIZON_DEGREES = 90.833

/** The solar declination (radians) and equation of time (minutes) at an instant. */
function solarPosition(epochMs: number): { declination: number; equationOfTime: number } {
  const julianDay = epochMs / DAY_MS + 2_440_587.5
  const t = (julianDay - 2_451_545) / 36_525
  const meanLongitude = (280.46646 + t * (36_000.76983 + t * 0.0003032)) % 360
  const meanAnomaly = 357.52911 + t * (35_999.05029 - 0.0001537 * t)
  const eccentricity = 0.016708634 - t * (0.000042037 + 0.0000001267 * t)
  const m = meanAnomaly * RAD
  const center =
    Math.sin(m) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(2 * m) * (0.019993 - 0.000101 * t) +
    Math.sin(3 * m) * 0.000289
  const omega = (125.04 - 1934.136 * t) * RAD
  const apparentLongitude = (meanLongitude + center - 0.00569 - 0.00478 * Math.sin(omega)) * RAD
  const meanObliquity = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60
  const obliquity = (meanObliquity + 0.00256 * Math.cos(omega)) * RAD
  const declination = Math.asin(Math.sin(obliquity) * Math.sin(apparentLongitude))
  const y = Math.tan(obliquity / 2) ** 2
  const l0 = meanLongitude * RAD
  const equationOfTime =
    (4 / RAD) *
    (y * Math.sin(2 * l0) -
      2 * eccentricity * Math.sin(m) +
      4 * eccentricity * y * Math.sin(m) * Math.cos(2 * l0) -
      0.5 * y * y * Math.sin(4 * l0) -
      1.25 * eccentricity * eccentricity * Math.sin(2 * m))
  return { declination, equationOfTime }
}

/** Sun times around the solar noon nearest to `approxNoonMs`. */
function sunAround(lat: number, lon: number, approxNoonMs: number): SunTimes & { noon: number } {
  const { declination, equationOfTime } = solarPosition(approxNoonMs)
  const utcMidnight = Math.floor(approxNoonMs / DAY_MS) * DAY_MS
  const noon = utcMidnight + (720 - 4 * lon - equationOfTime) * MINUTE_MS
  const phi = lat * RAD
  const cosHourAngle =
    Math.cos(HORIZON_DEGREES * RAD) / (Math.cos(phi) * Math.cos(declination)) -
    Math.tan(phi) * Math.tan(declination)
  if (cosHourAngle > 1) return { kind: 'polar-night', noon }
  if (cosHourAngle < -1) return { kind: 'polar-day', noon }
  const halfDayMs = 4 * (Math.acos(cosHourAngle) / RAD) * MINUTE_MS
  return { kind: 'rises', sunrise: noon - halfDayMs, sunset: noon + halfDayMs, noon }
}

/**
 * `lon` as a longitude in (-180, 180]. The date line has two names, -180 and 180, and the
 * three noons tried below are spaced for longitudes in that range: at exactly -180 they
 * all fell on the wrong local date in a zone such as Pacific/Fiji (REVIEW7 L7.4).
 */
export function normalizeLongitude(lon: number): number {
  const wrapped = ((((lon + 180) % 360) + 360) % 360) - 180
  return wrapped === -180 ? 180 : wrapped
}

/**
 * The sun on `dateStr` (YYYY-MM-DD, the place's local date) at `lat`, `lon` in
 * `timeZone`: the solar noon whose local date is `dateStr`, and the sunrise and sunset
 * around it. Null for coordinates, a date or a time zone it cannot use.
 */
export function sunTimes(
  lat: number,
  lon: number,
  dateStr: string,
  timeZone: string,
): SunTimes | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90) return null
  if (!isIanaTimeZone(timeZone)) return null
  const lng = normalizeLongitude(lon)
  const midnight = Date.parse(`${dateStr}T00:00:00Z`)
  if (!Number.isFinite(midnight)) return null
  // Local noon is near 12:00 at the place's longitude; a zone far from its meridian (or
  // across the date line) can put that noon on the UTC day before or after.
  for (const offset of [0, -1, 1]) {
    const approxNoon = midnight + offset * DAY_MS + (720 - 4 * lng) * MINUTE_MS
    const { noon, ...sun } = sunAround(lat, lng, approxNoon)
    if (zonedDate(noon, timeZone) === dateStr) return sun
  }
  return null
}

/** Where the sun is at an instant, against the local day's sunrise and sunset. */
export type SunPhase = 'before-sunrise' | 'up' | 'after-sunset'

/**
 * The sun's phase at `epochMs` at a place: before today's sunrise, up, or after today's
 * sunset (by the place's local date). Polar night reads as after sunset, midnight sun as
 * up. Null when the place's sun cannot be worked out.
 */
export function sunPhaseAt(
  place: { lat: number; lon: number },
  timeZone: string,
  epochMs: number,
): SunPhase | null {
  const sun = sunTimes(place.lat, place.lon, zonedDate(epochMs, timeZone), timeZone)
  if (!sun) return null
  if (sun.kind === 'polar-day') return 'up'
  if (sun.kind === 'polar-night') return 'after-sunset'
  if (epochMs < sun.sunrise) return 'before-sunrise'
  return epochMs < sun.sunset ? 'up' : 'after-sunset'
}

/** The daylight part of a local day, in fractional local hours: [from, to). */
export interface Daylight {
  from: number
  to: number
}

/** Slots start and end on 5-minute steps (lib/next-slot.ts nowHourOf): 12 an hour. */
const STEPS = 12

/** A local fractional hour on `dateStr` for an instant (24 for the next midnight). */
function localHourOn(epochMs: number, dateStr: string, timeZone: string): number {
  const date = zonedDate(epochMs, timeZone)
  if (date < dateStr) return 0
  if (date > dateStr) return 24
  const wall = wallClockAt(epochMs, timeZone)
  return wall.hour + wall.minute / 60 + wall.second / 3600
}

/**
 * The hours of `dateStr` with the sun up at a place, on the 5-minute steps a slot starts
 * and ends on: from the first step at or after sunrise to the last at or before sunset
 * (sunrise 7:09am and sunset 6:04pm give 7:10 to 18:00). The midnight sun gives the whole
 * day and the polar night none (from = to). Null when the sun cannot be worked out, and
 * then nothing is bounded.
 *
 * Solara plans outdoor time in daylight only: no activity is offered a slot in the dark,
 * where a UV of 0 would otherwise make it the "lowest-UV" time of the day.
 */
export function daylightHours(
  place: { lat: number; lon: number },
  dateStr: string,
  timeZone: string,
): Daylight | null {
  const sun = sunTimes(place.lat, place.lon, dateStr, timeZone)
  if (!sun) return null
  if (sun.kind === 'polar-day') return { from: 0, to: 24 }
  if (sun.kind === 'polar-night') return { from: 0, to: 0 }
  const from = Math.ceil(localHourOn(sun.sunrise, dateStr, timeZone) * STEPS) / STEPS
  const to = Math.floor(localHourOn(sun.sunset, dateStr, timeZone) * STEPS) / STEPS
  return { from, to: Math.max(from, to) }
}
