import { describe, it, expect } from 'vitest'
import { getActivityWindow } from '@/lib/weather'
import type { Activity, HourlyForecast } from '@/lib/types'

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
