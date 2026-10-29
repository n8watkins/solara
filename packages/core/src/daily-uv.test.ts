import { describe, expect, it } from 'vitest'
import {
  dailyUvDue,
  dailyUvMessage,
  dailyUvSendHour,
  nextDailyUvCheck,
  protectionWindow,
} from './daily-uv'
import { wallClockAt } from './zoned-time'

/** A clear summer day: UV rises from 0 at 6am to 8.4 at 1pm and falls to 0 at 8pm. */
const SUMMER = [
  { hour: 6, uv: 0 },
  { hour: 7, uv: 0.4 },
  { hour: 8, uv: 1.2 },
  { hour: 9, uv: 2.2 },
  { hour: 10, uv: 3.8 },
  { hour: 11, uv: 5.6 },
  { hour: 12, uv: 7.4 },
  { hour: 13, uv: 8.4 },
  { hour: 14, uv: 7.6 },
  { hour: 15, uv: 5.4 },
  { hour: 16, uv: 3.1 },
  { hour: 17, uv: 1.6 },
  { hour: 18, uv: 0.6 },
  { hour: 19, uv: 0.1 },
  { hour: 20, uv: 0 },
]

const QUIET = { from: 21, to: 7 }
const minutes = (hours: number) => Math.round(hours * 60)

describe('protectionWindow', () => {
  it('reads when the index reaches 3 between the hourly values, on 5-minute steps', () => {
    const window = protectionWindow(SUMMER)
    // 2.2 at 9:00 and 3.8 at 10:00 reach 2.5 at 9:11, rounded down to 9:10;
    // 3.1 at 16:00 and 1.6 at 17:00 reach it at 16:24, rounded up to 16:25.
    expect(minutes(window!.from)).toBe(9 * 60 + 10)
    expect(minutes(window!.to)).toBe(16 * 60 + 25)
    expect(window!.peak).toEqual({ uv: 8.4, hour: 13 })
  })

  it('is null on a day the UV stays low (an index under 3)', () => {
    expect(protectionWindow(SUMMER.map(h => ({ ...h, uv: Math.min(h.uv, 2.4) })))).toBeNull()
    expect(protectionWindow([])).toBeNull()
  })

  it('counts 2.5 as moderate, as the scale rounds', () => {
    const window = protectionWindow([
      { hour: 11, uv: 2 },
      { hour: 12, uv: 2.5 },
      { hour: 13, uv: 2 },
    ])
    expect(minutes(window!.from)).toBe(12 * 60)
    expect(minutes(window!.to)).toBe(12 * 60 + 5)
  })

  it('keeps one window across a cloudy dip in the middle of the day', () => {
    const dipped = SUMMER.map(h => (h.hour === 12 ? { ...h, uv: 1.5 } : h))
    const window = protectionWindow(dipped)
    expect(minutes(window!.from)).toBe(9 * 60 + 10)
    expect(minutes(window!.to)).toBe(16 * 60 + 25)
  })

  it('starts and ends on the hour at the edges of the forecast', () => {
    const window = protectionWindow([
      { hour: 10, uv: 4 },
      { hour: 11, uv: 5 },
    ])
    expect(window).toMatchObject({ from: 10, to: 12 })
  })

  it('stays inside the daylight it is given', () => {
    const window = protectionWindow(SUMMER, { from: 9.5, to: 16 })
    expect(window).toMatchObject({ from: 9.5, to: 16 })
  })

  it('ignores missing and out-of-order hours', () => {
    const shuffled = [...SUMMER].reverse().concat([{ hour: 22, uv: Number.NaN }])
    expect(protectionWindow(shuffled)).toEqual(protectionWindow(SUMMER))
  })
})

describe('dailyUvSendHour', () => {
  it('is the morning hour outside quiet hours', () => {
    expect(dailyUvSendHour(7, QUIET)).toBe(7)
    expect(dailyUvSendHour(9, QUIET)).toBe(9)
  })

  it('waits for the end of quiet hours that cover the morning hour', () => {
    expect(dailyUvSendHour(5, QUIET)).toBe(7)
    expect(dailyUvSendHour(6, { from: 0, to: 8 })).toBe(8)
  })

  it('uses the default morning hour (7) for a missing or bad value', () => {
    expect(dailyUvSendHour(undefined, { from: 0, to: 0 })).toBe(7)
    expect(dailyUvSendHour('9', { from: 0, to: 0 })).toBe(7)
  })
})

describe('dailyUvDue', () => {
  const window = protectionWindow(SUMMER)!

  it('is due from the send hour until protection is no longer needed', () => {
    expect(dailyUvDue(6.9, 7, window, QUIET)).toBe(false)
    expect(dailyUvDue(7, 7, window, QUIET)).toBe(true)
    expect(dailyUvDue(12, 7, window, QUIET)).toBe(true)
    expect(dailyUvDue(16.5, 7, window, QUIET)).toBe(false)
  })

  it('is never due in quiet hours', () => {
    expect(dailyUvDue(10, 7, window, { from: 9, to: 11 })).toBe(false)
  })
})

describe('dailyUvMessage', () => {
  const window = protectionWindow(SUMMER)!

  it('names the protection times, the peak and the place', () => {
    expect(dailyUvMessage({ window, city: 'Los Angeles', localHour: 7 })).toEqual({
      title: '☀️ Protect from 9:10am to 4:25pm today',
      body: 'UV peaks at 8.4 (very high) around 1pm in Los Angeles. Sunscreen, a hat and shade while the UV is moderate or higher. Recheck current conditions.',
    })
  })

  it('says until when once protection is already needed', () => {
    expect(dailyUvMessage({ window, city: '', localHour: 10 }).title).toBe(
      '☀️ Protect until 4:25pm today',
    )
    expect(dailyUvMessage({ window, city: ' ', localHour: 10 }).body).toContain('in your area.')
  })

  it('follows the 24-hour clock', () => {
    expect(dailyUvMessage({ window, city: 'Berlin', localHour: 7, clock: '24h' }).title).toBe(
      '☀️ Protect from 09:10 to 16:25 today',
    )
  })
})

describe('nextDailyUvCheck', () => {
  const zone = 'America/Los_Angeles'
  const at = (iso: string) => Date.parse(iso)
  const local = (ms: number) => {
    const clock = wallClockAt(ms, zone)
    return `${clock.month}/${clock.day} ${clock.hour}:${String(clock.minute).padStart(2, '0')}`
  }

  it('looks again at the send hour while today is still ahead', () => {
    // 5:00 in Los Angeles on 15 June (PDT, UTC-7).
    const next = nextDailyUvCheck({
      nowMs: at('2026-06-15T12:00:00Z'),
      timeZone: zone,
      sendHour: 8,
      doneToday: false,
    })
    expect(local(next)).toBe('6/15 8:00')
  })

  it('looks again early the next morning once today is done', () => {
    const next = nextDailyUvCheck({
      nowMs: at('2026-06-15T15:00:00Z'),
      timeZone: zone,
      sendHour: 8,
      doneToday: true,
    })
    expect(local(next)).toBe('6/16 5:00')
  })

  it('crosses a change of clocks on the local hour', () => {
    // 7 March 2026, the day before the US moves to daylight time.
    const next = nextDailyUvCheck({
      nowMs: at('2026-03-07T18:00:00Z'),
      timeZone: zone,
      sendHour: 7,
      doneToday: true,
    })
    expect(local(next)).toBe('3/8 5:00')
  })

  it('is at most two looks a day', () => {
    let now = at('2026-06-15T07:00:00Z') // midnight in Los Angeles
    const looks: string[] = []
    for (let i = 0; i < 4; i++) {
      const hour = wallClockAt(now, zone).hour
      now = nextDailyUvCheck({ nowMs: now, timeZone: zone, sendHour: 9, doneToday: hour >= 9 })
      looks.push(local(now))
    }
    expect(looks).toEqual(['6/15 9:00', '6/16 5:00', '6/16 9:00', '6/17 5:00'])
  })
})
