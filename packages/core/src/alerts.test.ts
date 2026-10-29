import { describe, expect, it } from 'vitest'
import {
  formatAlertTime,
  inQuietHours,
  localTime,
  morningAlertDue,
  morningAlertMessage,
  morningHour,
  planUvAlert,
  quietHours,
  uvAlertDue,
  uvAlertMessage,
  uvAlertThreshold,
} from './alerts'
import { parsePreferences } from './prefs'

const day = (uvs: Record<number, number>) =>
  Object.entries(uvs).map(([hour, uv]) => ({ hour: Number(hour), uv }))

describe('local time', () => {
  it('reads the date and fractional hour in the place’s own zone', () => {
    const now = new Date('2026-06-15T14:30:00Z')
    expect(localTime(now, 'America/Los_Angeles')).toEqual({ date: '2026-06-15', hour: 7.5 })
    expect(localTime(now, 'Asia/Tokyo')).toEqual({ date: '2026-06-15', hour: 23.5 })
    expect(localTime(now, 'Pacific/Kiritimati')).toEqual({ date: '2026-06-16', hour: 4.5 })
  })

  it('is null for an unknown zone', () => {
    expect(localTime(new Date(), 'Mars/Olympus')).toBeNull()
  })
})

describe('morning alert timing', () => {
  it('is due for two hours from the chosen hour', () => {
    expect(morningAlertDue(6.99, 7)).toBe(false)
    expect(morningAlertDue(7, 7)).toBe(true)
    expect(morningAlertDue(8.75, 7)).toBe(true)
    expect(morningAlertDue(9, 7)).toBe(false)
  })

  it('keeps the hour within 5-10 and defaults to 7', () => {
    expect(morningHour(3)).toBe(5)
    expect(morningHour(12)).toBe(10)
    expect(morningHour(8.4)).toBe(8)
    expect(morningHour(undefined)).toBe(7)
    expect(morningHour('8')).toBe(7)
  })
})

describe('quiet hours', () => {
  it('spans midnight when from is after to', () => {
    const quiet = { from: 21, to: 7 }
    expect(inQuietHours(22, quiet)).toBe(true)
    expect(inQuietHours(3, quiet)).toBe(true)
    expect(inQuietHours(6.9, quiet)).toBe(true)
    expect(inQuietHours(7, quiet)).toBe(false)
    expect(inQuietHours(20.9, quiet)).toBe(false)
  })

  it('covers a daytime span and nothing when from equals to', () => {
    expect(inQuietHours(13, { from: 12, to: 14 })).toBe(true)
    expect(inQuietHours(14, { from: 12, to: 14 })).toBe(false)
    expect(inQuietHours(3, { from: 0, to: 0 })).toBe(false)
  })

  it('falls back to 9pm-7am for a missing or malformed value', () => {
    expect(quietHours(undefined)).toEqual({ from: 21, to: 7 })
    expect(quietHours({ from: 22, to: 'x' })).toEqual({ from: 21, to: 7 })
    expect(quietHours({ from: 22, to: 6 })).toEqual({ from: 22, to: 6 })
  })
})

describe('UV alert plan', () => {
  const hourly = day({
    6: 0.4,
    7: 1.2,
    8: 2.6,
    9: 4.4,
    10: 5.6,
    11: 6.8,
    12: 7.2,
    13: 6.4,
    14: 5.1,
    15: 3.3,
  })

  it('starts at the first hour whose UV index reaches the threshold', () => {
    // 5.6 reads as UV index 6, as on the dashboard's scale.
    expect(planUvAlert(hourly, 6)).toEqual({
      threshold: 6,
      from: 10,
      to: 14,
      peak: { uv: 7.2, hour: 12 },
    })
  })

  it('is null when the UV stays below the threshold', () => {
    expect(planUvAlert(hourly, 8)).toBeNull()
    expect(planUvAlert([], 3)).toBeNull()
  })

  it('is due from an hour before the crossing until the last hour above it, outside quiet hours', () => {
    const plan = planUvAlert(hourly, 6)!
    const quiet = { from: 21, to: 7 }
    expect(uvAlertDue(plan, 8.9, quiet)).toBe(false)
    expect(uvAlertDue(plan, 9, quiet)).toBe(true)
    expect(uvAlertDue(plan, 13.9, quiet)).toBe(true)
    expect(uvAlertDue(plan, 14, quiet)).toBe(false)
    // Quiet until 11: the alert waits for the end of quiet hours.
    expect(uvAlertDue(plan, 10, { from: 22, to: 11 })).toBe(false)
    expect(uvAlertDue(plan, 11, { from: 22, to: 11 })).toBe(true)
  })

  it('says when the UV reaches the threshold, or that it already has', () => {
    const plan = planUvAlert(hourly, 6)!
    expect(uvAlertMessage({ plan, city: 'Austin', localHour: 9.25 })).toEqual({
      title: '☀️ UV reaches 6 around 10am',
      body: 'Forecast for Austin: UV 6+ until about 2pm, peaking at 7.2 around 12pm. Plan shade and sun protection, and recheck current conditions.',
    })
    expect(uvAlertMessage({ plan, city: '', localHour: 11, clock: '24h' }).title).toBe(
      '☀️ UV is 6 or higher now',
    )
    expect(uvAlertMessage({ plan, city: '', localHour: 11, clock: '24h' }).body).toContain(
      'your area: UV 6+ until about 14:00',
    )
  })

  it('reads the stored threshold as a whole UV index, or off', () => {
    expect(uvAlertThreshold(undefined)).toBeNull()
    expect(uvAlertThreshold('6')).toBeNull()
    expect(uvAlertThreshold(5.6)).toBe(6)
    expect(uvAlertThreshold(0)).toBeNull()
    expect(uvAlertThreshold(1)).toBe(1)
    expect(uvAlertThreshold(14)).toBe(11)
  })
})

describe('morning alert message', () => {
  const hourly = day({ 6: 1, 7: 2, 8: 3, 9: 5, 10: 7, 11: 8, 12: 8, 13: 7, 14: 5, 15: 3 })
  const run = { name: 'Run', icon: '🏃', maxUV: 3, durationMins: 60 }

  it('sends the daily briefing, titled with its lowest-UV window', () => {
    expect(
      morningAlertMessage({
        date: '2026-06-15',
        city: 'Austin',
        hourly,
        activities: [run],
        skinType: 'fair',
      }),
    ).toEqual({
      title: '🏃 Run: 6am to 9am',
      body:
        'Today in Austin: UV peaks at 8.0 (Very high) around 11am. Lowest-UV window: Run 6am–9am. ' +
        'At the peak, unprotected skin like yours can burn in about 19 min. ' +
        'Seek shade while UV is very high or extreme, from 11am to 1pm. Recheck current conditions.',
    })
  })

  it('offers no window before sunrise, as the app does', () => {
    // A winter morning: sunrise at 7:10, so the 6am hour of UV 1 is dark.
    const alert = morningAlertMessage({
      date: '2026-06-15',
      city: 'Austin',
      hourly,
      activities: [run],
      skinType: 'fair',
      daylight: { from: 7 + 10 / 60, to: 17 },
    })
    expect(alert.title).toBe('🏃 Run: 7:10am to 9am')
  })

  it('carries the briefing cloud note: what a clear sky would bring', () => {
    const cloudy = hourly.map(h => ({ ...h, uv: Math.round(h.uv * 5) / 10, clearSkyUV: h.uv }))
    const message = morningAlertMessage({
      date: '2026-06-15',
      city: 'Austin',
      hourly: cloudy,
      activities: [],
      skinType: 'fair',
    })
    expect(message.body).toContain(
      'Today in Austin: UV peaks at 4.0 (Moderate) around 11am, or 8.0 if the sky clears.',
    )
  })

  it('skips an activity that does not run that day', () => {
    const message = morningAlertMessage({
      date: '2026-06-15', // a Monday
      city: 'Austin',
      hourly,
      activities: [{ ...run, daysOfWeek: [0, 6] }],
      skinType: 'fair',
      clock: '24h',
    })
    expect(message.title).toBe('☀️ UV today in Austin')
    // No activity runs on a Monday: the briefing gives the low-UV hours instead.
    expect(message.body).toContain('Today in Austin: UV peaks at 8.0 (Very high) around 11:00.')
    expect(message.body).toContain('UV is low from 06:00 to 08:00.')
  })

  it('counts the forecast clouds once, like the app', () => {
    // 2 with heavy cloud all morning, 6 under a clear sky.
    const cloudy = hourly.map(h => (h.hour < 10 ? { ...h, uv: 2, clearSkyUV: 6 } : h))
    const title = (cloudSensitive: boolean) =>
      morningAlertMessage({
        date: '2026-06-15',
        city: 'Austin',
        hourly: cloudy,
        activities: [{ ...run, cloudSensitive }],
        skinType: 'fair',
      }).title
    expect(title(false)).toBe('☀️ UV today in Austin')
    expect(title(true)).toBe('🏃 Run: 6am to 10am')
  })

  it('never calls a window safe', () => {
    const { title, body } = morningAlertMessage({
      date: '2026-06-15',
      city: 'Austin',
      hourly,
      activities: [run],
      skinType: 'dark',
    })
    expect(`${title} ${body}`).not.toMatch(/\bsafe(?:st)?\b/i)
  })

  it('formats times on either clock', () => {
    expect(formatAlertTime(0)).toBe('12am')
    expect(formatAlertTime(12)).toBe('12pm')
    expect(formatAlertTime(6.5)).toBe('6:30am')
    expect(formatAlertTime(18.25, '24h')).toBe('18:15')
  })
})

describe('alert preferences', () => {
  const location = { lat: 30.27, lon: -97.74, city: 'Austin', region: 'TX' }

  it('keeps a valid threshold and quiet hours, and drops invalid ones', () => {
    const prefs = parsePreferences({
      location,
      uvAlertThreshold: 6,
      quietHours: { from: 22, to: 6 },
    })
    expect(prefs?.uvAlertThreshold).toBe(6)
    expect(prefs?.quietHours).toEqual({ from: 22, to: 6 })

    const odd = parsePreferences({ location, uvAlertThreshold: 'high', quietHours: { from: 22 } })
    expect(odd?.uvAlertThreshold).toBeUndefined()
    expect(odd?.quietHours).toBeUndefined()
  })

  it('rounds and clamps stored values', () => {
    const prefs = parsePreferences({
      location,
      uvAlertThreshold: 13,
      quietHours: { from: 23.6, to: -2 },
    })
    expect(prefs?.uvAlertThreshold).toBe(11)
    expect(parsePreferences({ location, uvAlertThreshold: 0.4 })?.uvAlertThreshold).toBe(0)
    expect(prefs?.quietHours).toEqual({ from: 23, to: 0 })
  })
})
