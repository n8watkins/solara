import { describe, it, expect } from 'vitest'
import { recommendSlot, BusyInterval } from '@/lib/scheduler'
import { fmtClock } from '@/lib/weather'
import { SafeActivityWindow } from '@/lib/types'

const morning: SafeActivityWindow = { from: 6, to: 10, label: 'Morning', peakUV: 1, avgUV: 1 }
const evening: SafeActivityWindow = { from: 17, to: 21, label: 'Evening', peakUV: 2, avgUV: 2 }

describe('recommendSlot — time preference', () => {
  it('earliest: picks the soonest feasible window (default)', () => {
    const r = recommendSlot([morning, evening], [], 60)!
    expect(r.start).toBe(6)
    expect(r.end).toBe(7)
    expect([r.flexFrom, r.flexTo]).toEqual([6, 10])
  })

  it('latest: starts so the activity ends at the latest safe time', () => {
    const r = recommendSlot([morning, evening], [], 60, 'latest')!
    expect(r.start).toBe(20)
    expect(r.end).toBe(21)
    expect([r.flexFrom, r.flexTo]).toEqual([17, 21])
  })

  it('sunniest: picks the window with the highest average UV', () => {
    const r = recommendSlot([morning, evening], [], 60, 'sunniest')!
    expect(r.windowLabel).toBe('Evening')
    expect(r.start).toBe(17)
  })
})

describe('recommendSlot — calendar busy', () => {
  it('subtracts a busy block and books in the remaining free time', () => {
    const busy: BusyInterval[] = [{ start: 7, end: 8 }]
    const r = recommendSlot([morning], busy, 60, 'earliest')!
    expect(r.start).toBe(6) // [6,7) still fits a 60-min run
    expect(r.end).toBe(7)
  })

  it('skips a free fragment too short for the duration', () => {
    const busy: BusyInterval[] = [{ start: 7, end: 8 }]
    // [6,7) is only 60 min; need 90 → must use [8,10)
    const r = recommendSlot([morning], busy, 90, 'earliest')!
    expect(r.start).toBe(8)
    expect(r.end).toBe(9.5)
  })

  it('falls through to a later window when an earlier one is fully busy', () => {
    const busy: BusyInterval[] = [{ start: 6, end: 10 }]
    const r = recommendSlot([morning, evening], busy, 60, 'earliest')!
    expect(r.windowLabel).toBe('Evening')
  })

  it('merges overlapping/unsorted busy blocks correctly', () => {
    const wide: SafeActivityWindow = { from: 6, to: 12, label: 'Morning', peakUV: 2, avgUV: 2 }
    const busy: BusyInterval[] = [{ start: 9, end: 11 }, { start: 8, end: 10 }]
    const r = recommendSlot([wide], busy, 60, 'earliest')!
    // free = [6,8] and [11,12]; earliest 60-min slot starts at 6
    expect(r.start).toBe(6)
    expect([r.flexFrom, r.flexTo]).toEqual([6, 8])
  })

  it('reproduces the "5pm, flexible 5–9" scenario', () => {
    const afternoon: SafeActivityWindow = { from: 13, to: 21, label: 'Afternoon', peakUV: 5, avgUV: 4 }
    const busy: BusyInterval[] = [{ start: 13, end: 17 }] // busy until 5pm
    const r = recommendSlot([afternoon], busy, 60, 'earliest')!
    expect(r.start).toBe(17)
    expect([r.flexFrom, r.flexTo]).toEqual([17, 21])
    expect(r.reason).toContain('afternoon')
  })
})

describe('recommendSlot — today vs future', () => {
  it('forbids past slots on today via nowHour', () => {
    const r = recommendSlot([morning, evening], [], 60, 'earliest', 8)!
    expect(r.start).toBe(8) // 6 and 7 are in the past; clamp to 8
  })

  it('ignores nowHour for future days (-1)', () => {
    const r = recommendSlot([morning], [], 60, 'earliest', -1)!
    expect(r.start).toBe(6)
  })

  it('returns null when nothing fits', () => {
    const tiny: SafeActivityWindow = { from: 6, to: 7, label: 'Morning', peakUV: 1, avgUV: 1 }
    expect(recommendSlot([tiny], [], 90, 'earliest')).toBeNull()
    expect(recommendSlot([], [], 30)).toBeNull()
  })
})

describe('fmtClock', () => {
  it('formats whole and fractional hours', () => {
    expect(fmtClock(17)).toBe('5pm')
    expect(fmtClock(6.75)).toBe('6:45am')
    expect(fmtClock(9.5)).toBe('9:30am')
    expect(fmtClock(12)).toBe('12pm')
    expect(fmtClock(0)).toBe('12am')
    expect(fmtClock(13)).toBe('1pm')
  })
})
