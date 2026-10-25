import { describe, expect, it } from 'vitest'
import type { DayWeather, HourlyForecast, UserPreferences, WeatherResponse } from './types'
import {
  UPGRADE_COPY,
  busyByDate,
  dashboardAccess,
  dayChips,
  dayPhrase,
  freeBusyRange,
  uvNumberTone,
  uvReadout,
  windowsPassedNote,
  dayOutlook,
  nextHourWhere,
  sunDown,
} from './dashboard-view'
import { burnMins, vitDMins } from './weather'

const hour = (h: number, uv: number, tempC = 20): HourlyForecast => ({
  hour: h,
  uv,
  tempC,
  condition: `c${h}`,
})

const day = (i: number): DayWeather =>
  ({ dateStr: `2026-06-${15 + i}`, label: i === 1 ? 'Tomorrow' : `Day ${i}`, hourly: [] }) as never

function weather(days = 10): WeatherResponse {
  return {
    timezone: 'America/Los_Angeles',
    now: { date: '2026-06-15', hour: 10, minute: 30 } as never,
    current: { uv: 6.4, tempC: 25, condition: 'Clear' },
    today: [],
    tomorrow: [],
    forecast: Array.from({ length: days }, (_, i) => day(i)),
  }
}

const prefs = (tier?: UserPreferences['tier']) => ({ tier }) as UserPreferences

describe('dashboardAccess', () => {
  it('limits the days by tier and offers the plans with locked days an upgrade', () => {
    const free = dashboardAccess(weather(), prefs('free'), undefined, null)
    expect(free.visibleForecast).toHaveLength(2)
    expect(free.lockedForecastCount).toBe(8)
    expect(free.upgradeCopy).toBe(UPGRADE_COPY)
    expect(free.showDayTabs).toBe(true)

    const paid = dashboardAccess(weather(), prefs('paid'), undefined, null)
    expect(paid.visibleForecast).toHaveLength(10)
    expect(paid.lockedForecastCount).toBe(0)
    expect(paid.upgradeCopy).toBeNull()

    // A guest sees today, with the rest of the forecast behind the locked tab.
    const guest = dashboardAccess(weather(), prefs(), undefined, null)
    expect(guest.visibleForecast).toHaveLength(1)
    expect(guest.lockedForecastCount).toBe(9)
    expect(guest.activityTier).toBe('anonymous')
    expect(guest.showDayTabs).toBe(true)
  })

  it('lets a preview tier widen the days but not the activity plan', () => {
    const access = dashboardAccess(weather(), prefs(), 'paid', null)
    expect(access.accessibleDays).toBe(10)
    expect(access.activityTier).toBe('anonymous')
  })

  it('drops a selected day the tier cannot see', () => {
    const fifth = day(5)
    expect(dashboardAccess(weather(), prefs('free'), undefined, fifth).selectedDay).toBeNull()
    expect(dashboardAccess(weather(), prefs('paid'), undefined, fifth).selectedDay).toBe(fifth)
  })
})

describe('dayChips', () => {
  const base = { lockedForecastCount: 0 }

  it('shows More days for later days and names a later selection', () => {
    const days = [day(0), day(1), day(2)]
    expect(dayChips({ ...base, visibleForecast: days, selectedDay: null })).toEqual({
      todayActive: true,
      tomorrow: days[1],
      tomorrowActive: false,
      more: { label: 'More days', active: false },
      lockedDays: 0,
    })
    const later = dayChips({ ...base, visibleForecast: days, selectedDay: days[2]! })
    expect(later.more).toEqual({ label: 'Day 2', active: true })
    expect(later.todayActive).toBe(false)
  })

  it('marks Tomorrow active without claiming More days', () => {
    const days = [day(0), day(1), day(2)]
    const chips = dayChips({ ...base, visibleForecast: days, selectedDay: days[1]! })
    expect(chips.tomorrowActive).toBe(true)
    expect(chips.more).toEqual({ label: 'More days', active: false })
  })

  it('puts locked days behind the locked tab instead of More days', () => {
    const days = [day(0), day(1)]
    expect(dayChips({ ...base, visibleForecast: days, selectedDay: null })).toMatchObject({
      more: null,
      lockedDays: 0,
    })
    expect(
      dayChips({ visibleForecast: days, selectedDay: null, lockedForecastCount: 8 }),
    ).toMatchObject({ more: null, lockedDays: 8 })
    expect(
      dayChips({ visibleForecast: [day(0)], selectedDay: null, lockedForecastCount: 9 }),
    ).toMatchObject({ tomorrow: null, more: null, lockedDays: 9 })
  })
})

describe('dayPhrase', () => {
  it('reads naturally in a sentence', () => {
    expect(dayPhrase(true, 'Today')).toBe('today')
    expect(dayPhrase(false, 'Tomorrow')).toBe('tomorrow')
    expect(dayPhrase(false, 'Wed 17')).toBe('on Wed 17')
  })
})

describe('uvReadout', () => {
  const hourly = [hour(9, 3), hour(12, 9.5, 30), hour(15, 6)]
  const fmtHour = (h: number) => `${h}h`

  it('shows the live reading today, with burn and vitamin D at it', () => {
    const r = uvReadout(weather(), hourly, true, null, 'fair', fmtHour)
    expect(r).toMatchObject({
      currentUV: 6.4,
      headUV: 6.4,
      headTemp: 25,
      headCond: 'Clear',
      headSuffix: ' now',
      peakUV: 9.5,
      peakHour: 12,
    })
    expect(r.burn).toBe(burnMins(6.4, 'fair'))
    expect(r.vitD).toBe(vitDMins(6.4, 'fair'))
  })

  it("shows the day's peak on another day", () => {
    const r = uvReadout(weather(), hourly, false, null, 'fair', fmtHour)
    expect(r).toMatchObject({ currentUV: 9.5, headTemp: 30, headCond: 'c12', headSuffix: ' peak' })
  })

  it('shows a focused hour in the head but keeps the metrics at the current UV', () => {
    const r = uvReadout(weather(), hourly, true, hourly[2]!, 'fair', fmtHour)
    expect(r).toMatchObject({ headUV: 6, headSuffix: ' at 15h', currentUV: 6.4 })
    expect(r.headBurn).toBe(burnMins(6, 'fair'))
    expect(r.burn).toBe(burnMins(6.4, 'fair'))
  })

  it('copes with a day without hours', () => {
    const r = uvReadout(weather(), [], false, null, 'fair', fmtHour)
    expect(r).toMatchObject({ currentUV: 0, peakUV: 0, peakHour: 12, headTemp: undefined })
  })
})

describe('uvNumberTone', () => {
  it('follows the UV bands', () => {
    expect([0, 0.5, 2.4, 2.5, 5.4, 6, 7.4, 7.5, 12].map(uvNumberTone)).toEqual([
      'none',
      'success',
      'success',
      'warning',
      'warning',
      'accent',
      'accent',
      'danger',
      'danger',
    ])
  })
})

describe('busyByDate', () => {
  it('is empty until the calendar is connected', () => {
    expect(busyByDate(null, [day(0)], 'UTC')).toEqual({})
  })

  it('splits busy periods into each visible day', () => {
    const periods = [{ start: '2026-06-15T09:00:00Z', end: '2026-06-16T02:00:00Z' }]
    expect(busyByDate(periods, [day(0), day(1)], 'UTC')).toEqual({
      '2026-06-15': [{ start: 9, end: 24 }],
      '2026-06-16': [{ start: 0, end: 2 }],
    })
  })
})

describe('freeBusyRange', () => {
  it('runs from now through the visible days, at least one', () => {
    const now = Date.UTC(2026, 5, 15)
    expect(freeBusyRange(now, 2).timeMax.getTime() - now).toBe(2 * 86_400_000)
    expect(freeBusyRange(now, 0).timeMax.getTime() - now).toBe(86_400_000)
    expect(freeBusyRange(now, 2).timeMin.getTime()).toBe(now)
  })
})

describe('windowsPassedNote', () => {
  const time = (h: number) => `${h}am`
  const slot = { start: 6, end: 7 } as never

  it('names the next slot the plan can see', () => {
    expect(windowsPassedNote({ label: 'Tomorrow', slot }, true, time)).toBe(
      'Next lower-UV slot: tomorrow at 6am.',
    )
    expect(windowsPassedNote({ label: 'Wed, Jun 17', slot }, true, time)).toContain(
      'on Wed, Jun 17 at 6am',
    )
  })

  it('offers sign-in on the guest plan instead of pointing at hidden days', () => {
    const note = windowsPassedNote(null, false, time)
    expect(note).toBe('Sign in free to plan tomorrow.')
    expect(note).not.toMatch(/best day|below/i)
  })

  it('says so when no later visible day has a slot', () => {
    expect(windowsPassedNote(null, true, time)).toBe(
      'No later forecast day has a lower-UV slot for it.',
    )
  })

  it('never repeats that today is over, which the badge says', () => {
    for (const note of [
      windowsPassedNote({ label: 'Tomorrow', slot }, true, time),
      windowsPassedNote(null, false, time),
      windowsPassedNote(null, true, time),
    ])
      expect(note).not.toMatch(/today|passed/i)
  })
})

describe('sunDown and nextHourWhere', () => {
  const day = (peak: number) =>
    [6, 7, 8, 12, 18, 19, 20].map(h => hour(h, h === 6 || h === 20 ? 0 : h === 12 ? peak : 1))
  const weather = (currentUV: number) => ({
    current: { uv: currentUV, tempC: 20, condition: 'Clear' },
    today: day(8),
    tomorrow: day(9),
  })

  it('is after sunset once the day has no UV left', () => {
    expect(sunDown(weather(0), 21.5)).toEqual({
      phase: 'after-sunset',
      uvReturns: { hour: 7, tomorrow: true },
    })
  })

  it('is before sunrise until the first UV', () => {
    expect(sunDown(weather(0), 5)).toEqual({
      phase: 'before-sunrise',
      uvReturns: { hour: 7, tomorrow: false },
    })
  })

  it('is null in daylight, even in a dull hour', () => {
    expect(sunDown(weather(3), 12)).toBeNull()
    expect(sunDown(weather(0.2), 12)).toBeNull()
  })

  it('finds the next hour from now, today first', () => {
    const w = weather(0)
    expect(nextHourWhere(w, 12.5, uv => uv >= 1)).toEqual({ hour: 12, tomorrow: false })
    expect(nextHourWhere(w, 19.5, uv => uv >= 5)).toEqual({ hour: 12, tomorrow: true })
    expect(nextHourWhere(w, 19.5, uv => uv >= 50)).toBeNull()
  })
})

describe('dayOutlook', () => {
  it('gives the peak and how long UV stays below 3 (Moderate starts at 2.5)', () => {
    const hourly = [hour(7, 1), hour(8, 2.4), hour(9, 2.5), hour(13, 9.1), hour(17, 2)]
    expect(dayOutlook(hourly)).toEqual({ peakUV: 9.1, peakHour: 13, lowUntil: 9 })
  })

  it('is null for a day without sun', () => {
    expect(dayOutlook([hour(7, 0), hour(8, 0.2)])).toBeNull()
    expect(dayOutlook([])).toBeNull()
  })
})
