import { describe, expect, it } from 'vitest'
import {
  REAPPLY_MAX_AGE_MS,
  dueAt,
  formatDuration,
  isDue,
  markNotified,
  minutesLeft,
  parseTimer,
  reapplied,
  shouldNotify,
  startTimer,
  withMode,
} from './reapply'

const START = Date.parse('2026-06-15T17:00:00Z')
const MINUTE = 60_000

describe('the reapply timer', () => {
  it('reminds 2 hours after you put sunscreen on', () => {
    const timer = startTimer(START)
    expect(dueAt(timer)).toBe(START + 120 * MINUTE)
    expect(isDue(timer, START + 119 * MINUTE)).toBe(false)
    expect(isDue(timer, START + 120 * MINUTE)).toBe(true)
    expect(minutesLeft(timer, START + 30 * MINUTE + 1)).toBe(90)
    expect(minutesLeft(timer, START + 125 * MINUTE)).toBe(0)
  })

  it('reminds after 80 minutes while swimming or sweating, from the last application', () => {
    const timer = withMode(startTimer(START), 'water')
    expect(dueAt(timer)).toBe(START + 80 * MINUTE)
    const again = reapplied(timer, START + 90 * MINUTE)
    expect(again.mode).toBe('water')
    expect(dueAt(again)).toBe(START + 170 * MINUTE)
    expect(dueAt(withMode(again, 'standard'))).toBe(START + 210 * MINUTE)
  })

  it('notifies once per reminder, and again after the next application', () => {
    const timer = startTimer(START)
    const due = START + 121 * MINUTE
    expect(shouldNotify(timer, START + 60 * MINUTE)).toBe(false)
    expect(shouldNotify(timer, due)).toBe(true)
    const notified = markNotified(timer)
    expect(shouldNotify(notified, due + 30 * MINUTE)).toBe(false)
    const next = reapplied(notified, due)
    expect(next.notifiedFor).toBeUndefined()
    expect(shouldNotify(next, due + 121 * MINUTE)).toBe(true)
  })

  it('formats the time left', () => {
    expect(formatDuration(45)).toBe('45 min')
    expect(formatDuration(60)).toBe('1 h')
    expect(formatDuration(80)).toBe('1 h 20 min')
  })
})

describe('the stored timer', () => {
  it('reads back a valid timer', () => {
    const timer = markNotified(withMode(startTimer(START), 'water'))
    expect(parseTimer(JSON.parse(JSON.stringify(timer)), START + MINUTE)).toEqual(timer)
  })

  it('drops malformed, future and day-old timers', () => {
    expect(parseTimer(null, START)).toBeNull()
    expect(parseTimer({ startedAt: START, appliedAt: START, mode: 'sauna' }, START)).toBeNull()
    expect(parseTimer({ startedAt: 'x', appliedAt: START, mode: 'standard' }, START)).toBeNull()
    expect(
      parseTimer({ startedAt: START, appliedAt: START - 1, mode: 'standard' }, START),
    ).toBeNull()
    expect(parseTimer(startTimer(START + MINUTE), START)).toBeNull()
    expect(parseTimer(startTimer(START), START + REAPPLY_MAX_AGE_MS + 1)).toBeNull()
  })

  it('caps an application time from a clock that ran ahead', () => {
    const raw = { startedAt: START, appliedAt: START + 10 * MINUTE, mode: 'standard' }
    expect(parseTimer(raw, START + MINUTE)?.appliedAt).toBe(START + MINUTE)
  })
})
