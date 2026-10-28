import { describe, expect, it } from 'vitest'
import {
  EVENT_HEADS_UP,
  eventHeadsUpDue,
  eventHeadsUpFrom,
  eventHeadsUpMessage,
  eventHeadsUpWorthy,
} from './event-heads-up'

const ZONE = 'America/Los_Angeles'
const QUIET = { from: 21, to: 7 }
// 2026-06-16 in Los Angeles is UTC-7.
const la = (day: number, hour: number) => Date.UTC(2026, 5, day, hour + 7)

describe('eventHeadsUpFrom', () => {
  it('is the lead time before the start outside quiet hours', () => {
    expect(eventHeadsUpFrom(la(16, 13), ZONE, QUIET)).toBe(la(16, 10))
  })

  it('moves to the last hour before quiet hours for an early start', () => {
    // 8am start: 5am is quiet, so the evening before at 8pm.
    expect(eventHeadsUpFrom(la(16, 8), ZONE, QUIET)).toBe(la(15, 20))
  })
})

describe('eventHeadsUpDue', () => {
  const due = (now: number, start: number) =>
    eventHeadsUpDue({ startMs: start, nowMs: now, timeZone: ZONE, quiet: QUIET })

  it('is due from the lead time until shortly before the start', () => {
    const start = la(16, 13)
    expect(due(la(16, 9.5), start)).toBe(false)
    expect(due(la(16, 10), start)).toBe(true)
    expect(due(la(16, 12.5), start)).toBe(true)
    expect(due(start - EVENT_HEADS_UP.latestMinutes * 60_000, start)).toBe(false)
  })

  it('never goes out in quiet hours', () => {
    const start = la(16, 8)
    expect(due(la(15, 20.5), start)).toBe(true)
    expect(due(la(15, 22), start)).toBe(false)
    expect(due(la(16, 6), start)).toBe(false)
    expect(due(la(16, 7.25), start)).toBe(true)
  })
})

describe('eventHeadsUpWorthy', () => {
  it('reads whole UV numbers from the high band', () => {
    expect(eventHeadsUpWorthy(5.4)).toBe(false)
    expect(eventHeadsUpWorthy(5.5)).toBe(true)
    expect(eventHeadsUpWorthy(Number.NaN)).toBe(false)
  })
})

describe('eventHeadsUpMessage', () => {
  it('names the event, its time, the peak and sunscreen timing', () => {
    const message = eventHeadsUpMessage({
      title: 'Saturday 10K',
      placeLabel: 'Balboa Park',
      startMs: la(16, 8),
      timeZone: ZONE,
      peakUV: 7.24,
      peakAtMs: la(16, 10),
      nowMs: la(15, 20),
      clock: '12h',
    })
    expect(message.title).toBe('🗓️ Saturday 10K tomorrow at 8am: UV up to 7.2')
    expect(message.body).toContain('Forecast for Balboa Park: UV peaks at 7.2 around 10am.')
    expect(message.body).toContain('15 to 30 minutes before')
  })

  it('works without a title or place', () => {
    const message = eventHeadsUpMessage({
      title: ' ',
      placeLabel: '',
      startMs: la(16, 13),
      timeZone: ZONE,
      peakUV: 8,
      peakAtMs: la(16, 13),
      nowMs: la(16, 10),
      clock: '24h',
    })
    expect(message.title).toBe('🗓️ Your event at 13:00: UV up to 8.0')
    expect(message.body.startsWith('UV peaks')).toBe(true)
  })
})
