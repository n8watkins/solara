import { describe, it, expect } from 'vitest'
import { burnMins, vitDMins, uvLabel, fmtHour, getActivityWindow } from '@/lib/weather'
import { effectiveMaxUV, canAddActivity, getFutureDays } from '@/lib/tiers'
import { HourlyForecast, Activity } from '@/lib/types'

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
    expect(burnMins(5, 'dark')).toBe(100)     // (50*10)/5
    expect(burnMins(5, 'dark')!).toBeGreaterThan(burnMins(5, 'very-fair')!)
  })

  it('rounds to whole minutes', () => {
    expect(burnMins(3, 'dark')).toBe(167) // (50*10)/3 = 166.67
  })
})

// ---------------------------------------------------------------------------
// vitDMins — time to a vitamin D dose. Needs UV >= 1, floored at 1 minute.
// ---------------------------------------------------------------------------
describe('vitDMins', () => {
  it('returns null below UV 1 (no vitamin D synthesis)', () => {
    expect(vitDMins(0.9, 'fair')).toBeNull()
  })

  it('computes a sensible dose time', () => {
    expect(vitDMins(5, 'fair')).toBe(9) // (15*0.3*10)/5 = 9
  })

  it('never returns less than 1 minute even at extreme UV', () => {
    expect(vitDMins(50, 'fair')).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// uvLabel — category boundaries must match the WHO-style bands exactly.
// ---------------------------------------------------------------------------
describe('uvLabel', () => {
  it('maps each band at its boundary', () => {
    expect(uvLabel(0)).toBe('None')
    expect(uvLabel(2)).toBe('Low')
    expect(uvLabel(2.1)).toBe('Moderate')
    expect(uvLabel(5)).toBe('Moderate')
    expect(uvLabel(7)).toBe('High')
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
    id: 'x', name: 'X', icon: '🏃', durationMins: 30, maxUV: 4, sunscreen: false, ...over,
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

// ---------------------------------------------------------------------------
// tier gating
// ---------------------------------------------------------------------------
describe('tier limits', () => {
  it('caps activities per tier', () => {
    expect(canAddActivity('anonymous', 0)).toBe(false) // activities require an account
    expect(canAddActivity('free', 2)).toBe(true)
    expect(canAddActivity('free', 3)).toBe(false)
    expect(canAddActivity('paid', 50)).toBe(true)
  })
  it('exposes future-day horizon per tier', () => {
    expect(getFutureDays('anonymous')).toBe(1)
    expect(getFutureDays('free')).toBe(2)
    expect(getFutureDays('paid')).toBe(10)
  })
})

// ---------------------------------------------------------------------------
// getActivityWindow — the core recommendation. Build a controlled day:
// safe morning (6–9), unsafe midday (10–16), safe evening (17–20).
// ---------------------------------------------------------------------------
function buildDay(): HourlyForecast[] {
  const hours: HourlyForecast[] = []
  for (let h = 6; h <= 20; h++) {
    let uv: number
    if (h <= 9) uv = 1
    else if (h <= 16) uv = 8
    else uv = 2
    hours.push({ hour: h, uv, tempF: 70, condition: 'Clear' })
  }
  return hours
}

const runActivity: Activity = { id: 'run', name: 'Running', icon: '🏃', durationMins: 60, maxUV: 4, sunscreen: false }

describe('getActivityWindow', () => {
  it('finds both safe windows and skips the unsafe midday block', () => {
    const w = getActivityWindow(buildDay(), runActivity, 7, 'fair')
    expect(w.allWindows).toHaveLength(2)
    expect(w.allWindows[0]).toMatchObject({ from: 6, to: 10, peakUV: 1 })
    expect(w.allWindows[1]).toMatchObject({ from: 17, to: 21, peakUV: 2 })
  })

  it('picks the lowest-average-UV window as best', () => {
    const w = getActivityWindow(buildDay(), runActivity, 7, 'fair')
    expect(w.bestWindow).toEqual({ from: 6, to: 10 })
  })

  it('reports safeNow based on the current hour', () => {
    expect(getActivityWindow(buildDay(), runActivity, 7, 'fair').safeNow).toBe(true)
    expect(getActivityWindow(buildDay(), runActivity, 12, 'fair').safeNow).toBe(false)
  })

  it('computes percent of the visible day that is safe', () => {
    // 8 safe hours of 15 → 53%
    expect(getActivityWindow(buildDay(), runActivity, 7, 'fair').pctDaySafe).toBe(53)
  })

  it('uses the selected skin type for burn estimate (not hard-coded fair)', () => {
    const fair = getActivityWindow(buildDay(), runActivity, 7, 'fair').burnMins
    const dark = getActivityWindow(buildDay(), runActivity, 7, 'dark').burnMins
    expect(dark!).toBeGreaterThan(fair!)
  })

  it('drops windows shorter than the activity duration', () => {
    const longActivity: Activity = { ...runActivity, durationMins: 300 } // 5h, neither block fits
    const w = getActivityWindow(buildDay(), longActivity, 7, 'fair')
    expect(w.allWindows).toHaveLength(0)
    expect(w.bestWindow).toBeNull()
  })

  it('respects preferredHours — excludes safe windows outside the preferred range', () => {
    const morningOnly: Activity = { ...runActivity, preferredHours: { from: 6, to: 10 } }
    const w = getActivityWindow(buildDay(), morningOnly, 7, 'fair')
    expect(w.allWindows).toHaveLength(1)
    expect(w.allWindows[0]).toMatchObject({ from: 6, to: 10 })
  })

  it('raises the effective threshold with sunscreen, unlocking the midday block', () => {
    const spf: Activity = { ...runActivity, sunscreen: true } // effectiveMaxUV = 10, so uv 8 is now safe
    const w = getActivityWindow(buildDay(), spf, 12, 'fair')
    expect(w.safeNow).toBe(true)
    // whole 6–20 range is now under threshold → one continuous window
    expect(w.allWindows).toHaveLength(1)
    expect(w.allWindows[0]).toMatchObject({ from: 6, to: 21 })
  })
})
