import { describe, it, expect } from 'vitest'
import { cloudAdjustedUV } from '@/lib/exposure'
import { getActivityWindow } from '@/lib/weather'
import type { Activity, HourlyForecast } from '@/lib/types'

describe('cloudAdjustedUV', () => {
  it('does not change UV when no cloud data', () => {
    expect(cloudAdjustedUV(8)).toBe(8)
    expect(cloudAdjustedUV(8, undefined)).toBe(8)
  })
  it('ignores thin/partial cloud (≤40%)', () => {
    expect(cloudAdjustedUV(8, 0)).toBe(8)
    expect(cloudAdjustedUV(8, 40)).toBe(8)
  })
  it('discounts heavy cloud, capped at 30% and never below input', () => {
    expect(cloudAdjustedUV(10, 100)).toBe(7) // full 30% discount
    expect(cloudAdjustedUV(10, 70)).toBe(8.5) // halfway → 15%
    expect(cloudAdjustedUV(10, 100)).toBeLessThan(10)
  })
  it('never raises UV', () => {
    for (let c = 0; c <= 100; c += 10) expect(cloudAdjustedUV(6, c)).toBeLessThanOrEqual(6)
  })
})

describe('getActivityWindow — cloud sensitivity', () => {
  // UV 6 all day (above the activity's max of 4), but heavily overcast.
  const hourly: HourlyForecast[] = []
  for (let h = 6; h <= 20; h++)
    hourly.push({ hour: h, uv: 6, tempC: 21, condition: 'Cloudy', cloudCover: 100 })

  const base: Activity = {
    id: 'a',
    name: 'Walk',
    icon: '🚶',
    durationMins: 60,
    maxUV: 4,
    sunscreen: false,
  }

  it('finds no window at raw UV when not cloud-sensitive', () => {
    const r = getActivityWindow(hourly, base, -1, 'fair')
    expect(r.allWindows.length).toBe(0) // 6 > 4 every hour
  })

  it('opens a window when cloud-sensitive (6 → 4.2 under 100% cloud)', () => {
    const r = getActivityWindow(hourly, { ...base, cloudSensitive: true, maxUV: 4.5 }, -1, 'fair')
    expect(r.allWindows.length).toBeGreaterThan(0)
    // Reported UV stays the true forecast value, not the discounted one.
    expect(r.allWindows[0]!.peakUV).toBe(6)
  })
})

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
