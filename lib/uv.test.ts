import { describe, it, expect } from 'vitest'
import { burnMins, uvLabel, fmtClock, fmtHour, formatUV } from '@/lib/weather'
import { effectiveMaxUV } from '@solara/core/tiers'
import type { Activity } from '@/lib/types'

// ---------------------------------------------------------------------------
// burnMins — time-to-burn estimate. A wrong value here is genuinely unsafe
// advice, so the boundaries matter.
// ---------------------------------------------------------------------------
describe('burnMins', () => {
  it('returns null below the UV 0.5 floor (no meaningful burn risk)', () => {
    expect(burnMins(0, 'fair')).toBeNull()
    expect(burnMins(0.4, 'very-fair')).toBeNull()
  })

  it('scales inversely with UV', () => {
    // base fair = 15 → (15 * 10) / uv
    expect(burnMins(5, 'fair')).toBe(30)
    expect(burnMins(10, 'fair')).toBe(15)
  })

  it('reflects skin type — darker skin burns slower at the same UV', () => {
    expect(burnMins(5, 'very-fair')).toBe(20) // (10*10)/5
    expect(burnMins(5, 'dark')).toBe(100) // (50*10)/5
    expect(burnMins(5, 'dark')!).toBeGreaterThan(burnMins(5, 'very-fair')!)
  })

  it('rounds to whole minutes', () => {
    expect(burnMins(3, 'dark')).toBe(167) // (50*10)/3 = 166.67
  })
})

// ---------------------------------------------------------------------------
// uvLabel — category boundaries must match the WHO-style bands exactly.
// ---------------------------------------------------------------------------
describe('uvLabel', () => {
  it('maps each band at its boundary', () => {
    expect(uvLabel(0)).toBe('Low')
    expect(uvLabel(2)).toBe('Low')
    expect(uvLabel(2.4)).toBe('Low')
    expect(uvLabel(2.5)).toBe('Moderate')
    expect(uvLabel(5)).toBe('Moderate')
    // The bands apply to the rounded index: 5.4 reads 5, Moderate; 5.5 reads 6, High.
    expect(uvLabel(5.4)).toBe('Moderate')
    expect(uvLabel(5.5)).toBe('High')
    expect(uvLabel(7)).toBe('High')
    expect(uvLabel(7.4)).toBe('High')
    expect(uvLabel(10)).toBe('Very high')
    expect(uvLabel(11)).toBe('Extreme')
  })
})

// ---------------------------------------------------------------------------
// fmtHour — 24h → 12h labels, including the midnight/noon edges.
// ---------------------------------------------------------------------------
describe('fmtHour', () => {
  it('handles midnight and noon', () => {
    expect(fmtHour(0)).toBe('12am')
    expect(fmtHour(24)).toBe('12am')
    expect(fmtHour(12)).toBe('12pm')
  })
  it('handles am/pm', () => {
    expect(fmtHour(9)).toBe('9am')
    expect(fmtHour(13)).toBe('1pm')
    expect(fmtHour(20)).toBe('8pm')
  })
})

// ---------------------------------------------------------------------------
// effectiveMaxUV — SPF raises the threshold but is capped at 11.
// ---------------------------------------------------------------------------
describe('effectiveMaxUV', () => {
  const base = (over: Partial<Activity>): Activity => ({
    id: 'x',
    name: 'X',
    icon: '🏃',
    durationMins: 30,
    maxUV: 4,
    sunscreen: false,
    ...over,
  })

  it('returns base maxUV without sunscreen', () => {
    expect(effectiveMaxUV(base({ maxUV: 4 }))).toBe(4)
  })
  it('raises threshold ~2.5x with SPF', () => {
    expect(effectiveMaxUV(base({ maxUV: 4, sunscreen: true }))).toBe(10) // round(10)
  })
  it('caps the effective threshold at 11', () => {
    expect(effectiveMaxUV(base({ maxUV: 5, sunscreen: true }))).toBe(11) // round(12.5)=13 → cap 11
  })
})

describe('formatUV', () => {
  it('writes every UV value with one decimal, double digits included (REVIEW4 L5)', () => {
    expect(formatUV(8.62)).toBe('8.6')
    expect(formatUV(10.3)).toBe('10.3')
    expect(formatUV(10)).toBe('10.0')
    expect(formatUV(6)).toBe('6.0')
    expect(formatUV(-0.01)).toBe('0.0')
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
