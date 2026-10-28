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
      window: 'Best lower-UV window: Running 6am–10am',
      burn: 'At the peak, unprotected skin like yours can burn in about 16 min',
      tip: 'Seek shade from 12pm to 4pm, when UV is 8 or more',
    })
    expect(briefing.text).toBe(
      'Tomorrow: UV peaks at 9.3 (Very high) around 1pm. Best lower-UV window: Running 6am–10am. ' +
        'At the peak, unprotected skin like yours can burn in about 16 min. ' +
        'Seek shade from 12pm to 4pm, when UV is 8 or more.',
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
    // 4pm's 7.7 already reads as 8 (Very high) on the whole-number scale.
    expect(briefing.lines.tip).toBe('Seek shade from 11am to 5pm, when UV is 8 or more')
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
    expect(briefing.lines.tip).toBe('Use sun protection until 7pm, when UV is 3 or more')
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
    // 8am's 2.0 is Low; 9am's 3.9 and 6pm's 3.1 read as 4 and 3.
    expect(briefing.window).toEqual({
      activity: null,
      spans: [
        { from: 6, to: 9 },
        { from: 19, to: 20 },
      ],
    })
    expect(briefing.lines.window).toBe('UV is under 3 from 6am to 9am and 7pm to 8pm')
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
    expect(briefing.lines.window).toBe('UV stays under 3 all day')
    expect(briefing.lines.tip).toBe('UV stays low, so most people need little protection')
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
      'Today: UV stays near zero. UV stays under 3 all day. UV stays low, so most people need little protection.',
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
    expect(briefing.lines.window).toBe('Best lower-UV window: Running 06:00–10:00')
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
    expect(plan(true)).toBe('Best lower-UV window: Running 6am–10am')
  })
})
