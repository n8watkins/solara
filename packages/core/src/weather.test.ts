import { describe, it, expect } from 'vitest'
import type { HourlyForecast } from './forecast-days'
import type { Activity } from './prefs'
import { getActivityWindow, vitDMins } from './weather'

describe('getActivityWindow — shade and surface', () => {
  // UV 3.6 at 8am, 4.0 at 9am, then 5 and above until 4pm.
  const uvs: Record<number, number> = { 7: 2, 8: 3.6, 9: 4, 10: 5, 16: 3.5, 17: 2 }
  const hourly: HourlyForecast[] = []
  for (let h = 7; h <= 17; h++)
    hourly.push({ hour: h, uv: uvs[h] ?? 6, tempC: 21, condition: 'Clear' })
  const beach: Activity = {
    id: 'b',
    name: 'Beach',
    icon: '🏖️',
    durationMins: 60,
    maxUV: 4,
    sunscreen: false,
  }

  it('plans against the forecast when nothing is set', () => {
    const { allWindows } = getActivityWindow(hourly, beach, -1)
    expect(allWindows.map(w => [w.from, w.to])).toEqual([
      [7, 10],
      [16, 17],
    ])
  })

  it('sand reflection rules out hours that only just fit', () => {
    // 3.6, 4.0 and 3.5 times 1.15 (4.2, 4.6, 4.1 rounded up) are over the limit;
    // 2 x 1.15 = 2.3 is not.
    const { allWindows, safeNow } = getActivityWindow(hourly, { ...beach, surface: 'sand' }, 9)
    expect(allWindows.map(w => [w.from, w.to])).toEqual([[7, 8]])
    expect(safeNow).toBe(false)
    // The window still reports the forecast UV.
    expect(allWindows[0]!.peakUV).toBe(2)
  })

  it('shade opens hours the open sun would not', () => {
    // 5 x 0.75 = 3.75 fits under 4 in some shade.
    const { allWindows } = getActivityWindow(hourly, { ...beach, shade: 'partial' }, -1)
    expect(allWindows.map(w => [w.from, w.to])).toEqual([
      [7, 11],
      [16, 17],
    ])
  })
})

describe('getActivityWindow - clouds counted once', () => {
  // Open-Meteo's uv_index already includes the forecast clouds; clearSkyUV is the same
  // hour under a cloudless sky. Heavy cloud (90%) all morning.
  const day = (uv: number, clearSkyUV: number): HourlyForecast[] =>
    [6, 7, 8, 9, 10].map(hour => ({
      hour,
      uv,
      clearSkyUV,
      tempC: 18,
      condition: 'Cloudy',
      cloudCover: 90,
    }))
  const walk: Activity = {
    id: 'w',
    name: 'Walk',
    icon: '🚶',
    durationMins: 60,
    maxUV: 4,
    sunscreen: false,
  }

  it('with the option on, plans on the forecast UV and does not discount its clouds again', () => {
    // 4.5 with clouds is over the limit of 4; a second cloud discount (to about 3.2)
    // would wrongly let it through.
    const r = getActivityWindow(day(4.5, 7), { ...walk, cloudSensitive: true }, -1)
    expect(r.allWindows).toEqual([])
  })

  it('with the option on, a cloudy hour the forecast puts under the limit fits', () => {
    const r = getActivityWindow(day(3.5, 6), { ...walk, cloudSensitive: true }, -1)
    expect(r.allWindows.map(w => [w.from, w.to])).toEqual([[6, 10]])
  })

  it('with the option off, plans as if the sky were clear', () => {
    // 3.5 with clouds, but 6 if the clouds break: not planned.
    const r = getActivityWindow(day(3.5, 6), walk, 8)
    expect(r.allWindows).toEqual([])
    expect(r.safeNow).toBe(false)
  })

  it('with the option off and no clear-sky value, plans on the forecast UV', () => {
    const hourly = day(3.5, 6).map(({ clearSkyUV: _, ...hour }) => hour)
    const r = getActivityWindow(hourly, walk, -1)
    expect(r.allWindows.map(w => [w.from, w.to])).toEqual([[6, 10]])
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
    hours.push({ hour: h, uv, tempC: 21, condition: 'Clear' })
  }
  return hours
}

const runActivity: Activity = {
  id: 'run',
  name: 'Running',
  icon: '🏃',
  durationMins: 60,
  maxUV: 4,
  sunscreen: false,
}

describe('getActivityWindow', () => {
  it('finds both safe windows and skips the unsafe midday block', () => {
    const w = getActivityWindow(buildDay(), runActivity, 7, 'fair')
    expect(w.allWindows).toHaveLength(2)
    expect(w.allWindows[0]).toMatchObject({ from: 6, to: 10, peakUV: 1 })
    expect(w.allWindows[1]).toMatchObject({ from: 17, to: 20, peakUV: 2 })
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
    expect(w.allWindows[0]).toMatchObject({ from: 6, to: 20 })
  })
})
