import { describe, expect, it } from 'vitest'
import { briefingDay, dailyBriefing, formatBriefingTime, type BriefingDay } from '@solara/core'

/** A 6am-8pm day: UV by hour from a list starting at 6am. */
function day(date: string, uv: number[]): BriefingDay {
  return { date, hourly: uv.map((value, i) => ({ hour: 6 + i, uv: value })) }
}

// 6am ... 8pm: a summer day that peaks at 10.3 at 1pm.
const SUMMER = [0, 0.6, 2, 3.9, 6, 8, 9.5, 10.3, 10, 9.3, 7.7, 5.5, 3.1, 1.1, 0]
const MILD = [0, 0.3, 0.8, 1.4, 1.9, 2.2, 2.4, 2.4, 2.1, 1.7, 1.2, 0.7, 0.3, 0.1, 0]
const TODAY = day('2026-06-15', SUMMER) // a Monday
const TOMORROW = day(
  '2026-06-16',
  SUMMER.map(uv => Math.round(uv * 9) / 10),
)

const run = { name: 'Running', maxUV: 4, durationMins: 45 }
const tennis = { name: 'Tennis', maxUV: 3, durationMins: 60 }

describe('briefingDay', () => {
  it('briefs today before sunrise and while UV is left', () => {
    expect(briefingDay(TODAY, TOMORROW, 5.5).which).toBe('today')
    expect(briefingDay(TODAY, TOMORROW, 10.5).which).toBe('today')
    // 7pm still has UV 1.1.
    expect(briefingDay(TODAY, TOMORROW, 19.25).which).toBe('today')
  })

  it('briefs tomorrow once no UV is left today', () => {
    const { day: briefed, which } = briefingDay(TODAY, TOMORROW, 20.25)
    expect(which).toBe('tomorrow')
    expect(briefed).toBe(TOMORROW)
  })

  it("follows the place's sunset when it is known, as the dashboard's hero does", () => {
    // 8:15pm with no UV left but the sun still up: today until sunset.
    expect(briefingDay(TODAY, TOMORROW, 20.25, false).which).toBe('today')
    // 7:15pm with UV left but the sun down (a mismatched forecast): tomorrow.
    expect(briefingDay(TODAY, TOMORROW, 19.25, true).which).toBe('tomorrow')
  })

  it('stays on today when there is no tomorrow to brief', () => {
    expect(briefingDay(TODAY, null, 21.5).which).toBe('today')
    expect(briefingDay(TODAY, day('2026-06-16', []), 21.5).which).toBe('today')
  })
})

describe('dailyBriefing', () => {
  it('briefs a whole day: peak, best window, burn time and advice', () => {
    const briefing = dailyBriefing({
      day: TOMORROW,
      dayLabel: 'Tomorrow',
      activities: [run],
      skinType: 'fair',
    })
    expect(briefing.peak).toEqual({ uv: 9.3, hour: 13, passed: false })
    expect(briefing.window).toEqual({ activity: 'Running', spans: [{ from: 6, to: 10 }] })
    expect(briefing.burnMins).toBe(16)
    expect(briefing.lines).toEqual({
      peak: 'UV peaks at 9.3 (Very high) around 1pm',
      window: 'Lowest-UV window: Running 6am–10am',
      weather: null,
      burn: 'At the peak, unprotected skin like yours can burn in about 16 min',
      tip: 'Seek shade while UV is very high or extreme, from 11:10am\u00a0to\u00a03:40pm',
    })
    expect(briefing.text).toBe(
      'Tomorrow: UV peaks at 9.3 (Very high) around 1pm. Lowest-UV window: Running 6am–10am. ' +
        'At the peak, unprotected skin like yours can burn in about 16 min. ' +
        'Seek shade while UV is very high or extreme, from 11:10am to 3:40pm.',
    )
  })

  it('covers only the rest of today once it is under way', () => {
    const briefing = dailyBriefing({
      day: TODAY,
      dayLabel: 'Today',
      nowHour: 10.5,
      activities: [run],
      skinType: 'fair',
    })
    expect(briefing.peak?.passed).toBe(false)
    // The morning window has passed; the evening one is next.
    expect(briefing.window?.spans).toEqual([{ from: 18, to: 20 }])
    // From 10am's 8.0 (between 9am's 6.0 and 11am's 9.5, 7.5 falls at 10:45) to after
    // 4pm's 7.7 (7.5 falls at 4:06pm, so 4:10pm), as the shared protection times read it.
    expect(briefing.lines.tip).toBe(
      'Seek shade while UV is very high or extreme, from 10:45am\u00a0to\u00a04:10pm',
    )
  })

  it('tells a passed peak in the past tense, without its burn time', () => {
    const briefing = dailyBriefing({
      day: TODAY,
      dayLabel: 'Today',
      nowHour: 17,
      activities: [run],
      skinType: 'fair',
    })
    expect(briefing.lines.peak).toBe('UV peaked at 10.3 (Very high) around 1pm')
    expect(briefing.burnMins).toBeNull()
    expect(briefing.lines.burn).toBeNull()
    expect(briefing.lines.tip).toBe(
      'Use sun protection while UV is moderate or higher, until\u00a06:20pm',
    )
  })

  it('picks the activity with the lowest-UV window', () => {
    const briefing = dailyBriefing({
      day: TOMORROW,
      dayLabel: 'Tomorrow',
      activities: [{ ...run, preferredHours: { from: 16, to: 21 } }, tennis],
      skinType: 'fair',
    })
    expect(briefing.window).toEqual({ activity: 'Tennis', spans: [{ from: 6, to: 9 }] })
  })

  it('says when no window fits, naming the one activity', () => {
    const tooLong = { ...run, durationMins: 600 }
    expect(
      dailyBriefing({ day: TODAY, dayLabel: 'Today', activities: [tooLong], skinType: 'fair' })
        .lines.window,
    ).toBe('No lower-UV window for Running')
    expect(
      dailyBriefing({
        day: TODAY,
        dayLabel: 'Today',
        nowHour: 19.5,
        activities: [tooLong, { ...tooLong, name: 'Hiking' }],
        skinType: 'fair',
      }).lines.window,
    ).toBe('No lower-UV window left for your activities')
  })

  it('gives the low-UV hours when no activity runs that day', () => {
    const weekendOnly = { ...run, daysOfWeek: [0, 6] }
    const briefing = dailyBriefing({
      day: TODAY,
      dayLabel: 'Today',
      activities: [weekendOnly],
      skinType: 'medium',
    })
    // Around the protection window (2.5, which reads as 3, falls at 8:16am and 6:18pm,
    // so 8:15am and 6:20pm on 5-minute steps toward protection).
    expect(briefing.window).toEqual({
      activity: null,
      spans: [
        { from: 6, to: 8.25 },
        { from: 18 + 20 / 60, to: 20 },
      ],
    })
    // A time range never breaks inside on a narrow screen (REVIEW5: "8pm" alone on a line);
    // the shared text has plain spaces.
    expect(briefing.lines.window).toBe(
      'UV is low from 6am\u00a0to\u00a08:15am and 6:20pm\u00a0to\u00a08pm',
    )
    expect(briefing.text).toContain('UV is low from 6am to 8:15am and 6:20pm to 8pm.')
  })

  it('briefs a mild day without advice to hide', () => {
    const briefing = dailyBriefing({
      day: day('2026-12-15', MILD),
      dayLabel: 'Mon, Dec 15',
      activities: [],
      skinType: 'very-fair',
    })
    // 2.4 is still Low on the whole-number scale.
    expect(briefing.lines.peak).toBe('UV peaks at 2.4 (Low) around 12pm')
    expect(briefing.lines.window).toBe('UV stays low all day')
    expect(briefing.lines.tip).toBe('Most people need little sun protection today')
  })

  it('handles a day with no UV at all', () => {
    const briefing = dailyBriefing({
      day: day('2026-12-21', [0, 0, 0.2, 0.1, 0]),
      dayLabel: 'Today',
      activities: [],
      skinType: 'fair',
    })
    expect(briefing.peak).toBeNull()
    expect(briefing.burnMins).toBeNull()
    expect(briefing.text).toBe(
      'Today: UV stays near zero. UV stays low all day. Most people need little sun protection today.',
    )
  })

  it('uses the given clock', () => {
    const pad = (n: number) => String(n).padStart(2, '0')
    const clock24 = (h: number) => `${pad(Math.floor(h))}:${pad(Math.round((h % 1) * 60))}`
    const briefing = dailyBriefing({
      day: TOMORROW,
      dayLabel: 'Tomorrow',
      activities: [run],
      skinType: 'fair',
      formatTime: clock24,
    })
    expect(briefing.lines.window).toBe('Lowest-UV window: Running 06:00–10:00')
  })

  it('is deterministic', () => {
    const input = {
      day: TODAY,
      dayLabel: 'Today',
      nowHour: 9,
      activities: [run],
      skinType: 'olive' as const,
    }
    expect(dailyBriefing(input)).toEqual(dailyBriefing(input))
  })
})

describe('dailyBriefing in daylight', () => {
  // Sunrise 7:09am and sunset 6:04pm: 6am and the evening after 6pm are dark.
  const daylight = { from: 7 + 10 / 60, to: 18 }

  it("keeps an activity's window inside the day's daylight", () => {
    const b = dailyBriefing({
      day: TODAY,
      dayLabel: 'Today',
      nowHour: 6.5,
      activities: [run],
      skinType: 'fair',
      daylight,
    })
    expect(b.lines.window).toBe('Lowest-UV window: Running 7:10am–10am')
    expect(b.window?.spans).toEqual([{ from: 7 + 10 / 60, to: 10 }])
  })

  it('names low-UV hours only in daylight', () => {
    const b = dailyBriefing({
      day: TODAY,
      dayLabel: 'Today',
      activities: [],
      skinType: 'fair',
      daylight,
    })
    expect(b.window?.spans).toEqual([{ from: 7 + 10 / 60, to: 8.25 }])
  })

  it('has no window left once the rest of the daylight is too short', () => {
    const b = dailyBriefing({
      day: TODAY,
      dayLabel: 'Today',
      nowHour: 17.5,
      activities: [run],
      skinType: 'fair',
      daylight,
    })
    expect(b.lines.window).toBe('No lower-UV window left for Running')
  })
})

describe('formatBriefingTime', () => {
  it('formats a 12-hour clock', () => {
    expect(formatBriefingTime(0)).toBe('12am')
    expect(formatBriefingTime(6.75)).toBe('6:45am')
    expect(formatBriefingTime(12)).toBe('12pm')
    expect(formatBriefingTime(20)).toBe('8pm')
  })
})

describe('dailyBriefing and clouds', () => {
  // 3.5 with heavy cloud all morning, 6 under a clear sky; high UV after 10am.
  const cloudy = {
    date: '2026-06-18',
    hourly: [6, 7, 8, 9, 10, 11].map(hour => ({
      hour,
      uv: hour < 10 ? 3.5 : 8,
      clearSkyUV: hour < 10 ? 6 : 10,
    })),
  }

  it('plans windows like the app: a clear sky unless the activity counts the clouds', () => {
    const plan = (cloudSensitive: boolean) =>
      dailyBriefing({
        day: cloudy,
        dayLabel: 'Thu',
        activities: [{ ...run, cloudSensitive }],
        skinType: 'fair',
      }).lines.window
    expect(plan(false)).toBe('No lower-UV window for Running')
    expect(plan(true)).toBe('Lowest-UV window: Running 6am–10am')
  })

  it('says what a clear sky would bring to a coming peak the clouds lower', () => {
    const overcast = {
      date: '2026-06-18',
      hourly: SUMMER.map((uv, i) => ({
        hour: 6 + i,
        uv: Math.round(uv * 6) / 10,
        clearSkyUV: uv,
      })),
    }
    const briefing = dailyBriefing({
      day: overcast,
      dayLabel: 'Thu',
      activities: [],
      skinType: 'fair',
    })
    expect(briefing.cloud).toEqual({ uv: 6.2, clearSky: 10.3 })
    expect(briefing.lines.peak).toBe('UV peaks at 6.2 (High) around 1pm, or 10.3 if the sky clears')
    expect(briefing.text).toMatch(
      /^Thu: UV peaks at 6\.2 \(High\) around 1pm, or 10\.3 if the sky clears\. /,
    )
    // A passed peak is history: no clear-sky note.
    const later = dailyBriefing({
      day: overcast,
      dayLabel: 'Today',
      nowHour: 16.5,
      activities: [],
      skinType: 'fair',
    })
    expect(later.cloud).toBeNull()
    expect(later.lines.peak).toBe('UV peaked at 6.2 (High) around 1pm')
  })

  it('keeps quiet about a small cloud effect', () => {
    const hazy = {
      date: '2026-06-18',
      hourly: SUMMER.map((uv, i) => ({ hour: 6 + i, uv, clearSkyUV: uv + 0.6 })),
    }
    const briefing = dailyBriefing({ day: hazy, dayLabel: 'Thu', activities: [], skinType: 'fair' })
    expect(briefing.cloud).toBeNull()
    expect(briefing.lines.peak).toBe('UV peaks at 10.3 (Very high) around 1pm')
  })
})

describe('dailyBriefing with rain and heat', () => {
  // UV 1 until 9am, 2 from 4pm and high in between: the morning is the lowest.
  const uv = (hour: number) => (hour < 9 ? 1 : hour >= 16 ? 2 : 7)
  const hours = (weather: (hour: number) => object) =>
    Array.from({ length: 15 }, (_, i) => ({ hour: 6 + i, uv: uv(6 + i), ...weather(6 + i) }))
  const walk = { id: 'walk', name: 'Walking', maxUV: 3, durationMins: 60 }

  it('tells the rain that moved the window, and only then', () => {
    // From 7am the morning is wet, so the window moves to the evening.
    const wet = hours(h => ({ rainChance: h < 9 ? 80 : 10 }))
    const briefing = dailyBriefing({
      day: { date: '2026-06-15', hourly: wet },
      dayLabel: 'Today',
      activities: [walk],
      skinType: 'fair',
    })
    expect(briefing.lines.window).toBe('Lowest-UV window: Walking 4pm–8pm')
    expect(briefing.lines.weather).toBe('Rain likely 6am–9am')
    expect(briefing.weather).toEqual({ kind: 'rain', from: 6, to: 9 })
    expect(briefing.text).toContain('Lowest-UV window: Walking 4pm–8pm. Rain likely 6am–9am. ')

    // Rain at midday, when the UV rules the walk out anyway, changes nothing.
    const midday = dailyBriefing({
      day: { date: '2026-06-15', hourly: hours(h => ({ rainChance: h >= 11 && h < 14 ? 90 : 0 })) },
      dayLabel: 'Today',
      activities: [walk],
      skinType: 'fair',
    })
    expect(midday.lines.weather).toBeNull()
    expect(midday.text).not.toMatch(/rain/i)
  })

  it('says when the heat leaves no window, in the display unit', () => {
    const hot = hours(() => ({ feelsC: 39 }))
    const briefing = dailyBriefing({
      day: { date: '2026-06-15', hourly: hot },
      dayLabel: 'Today',
      activities: [walk],
      skinType: 'fair',
      formatTemp: celsius => `${Math.round(celsius)}°C`,
    })
    expect(briefing.window).toBeNull()
    expect(briefing.lines.window).toBe('No lower-UV window for Walking without the heat')
    expect(briefing.lines.weather).toBe('Too hot 6am–9am, feels like 39°C')
  })

  it('reads Fahrenheit by default', () => {
    const briefing = dailyBriefing({
      day: { date: '2026-06-15', hourly: hours(() => ({ feelsC: 39 })) },
      dayLabel: 'Today',
      activities: [walk],
      skinType: 'fair',
    })
    expect(briefing.lines.weather).toBe('Too hot 6am–9am, feels like 102°F')
  })
})
