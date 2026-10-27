import { describe, expect, it } from 'vitest'
import {
  cloudEffect,
  cloudNote,
  confidenceNote,
  forecastConfidence,
  parseHourlyRows,
} from '@solara/core'

describe('forecastConfidence', () => {
  it('stays high for three days, then decays', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 9].map(forecastConfidence)).toEqual([
      'high',
      'high',
      'high',
      'fair',
      'fair',
      'fair',
      'low',
      'low',
    ])
  })

  it('words fair and low days, and says nothing for high ones', () => {
    expect(confidenceNote('high')).toBeNull()
    expect(confidenceNote('fair')).toBe('Fair confidence: UV and the best times can still change')
    expect(confidenceNote('low')).toBe(
      'Low confidence: a rough guide, check again closer to the day',
    )
  })
})

describe('cloudEffect', () => {
  const day = (pairs: [number, number | undefined][]) =>
    pairs.map(([uv, clearSkyUV]) => ({ uv, clearSkyUV }))

  it('compares the peaks in whole numbers', () => {
    const effect = cloudEffect(
      day([
        [2, 3],
        [4.4, 6.6],
        [3.9, 7.2],
      ]),
    )
    expect(effect).toEqual({ uv: 4, clearSky: 7 })
    expect(cloudNote(effect!)).toBe('Clouds may cut UV to 4 from a clear-sky 7')
  })

  it('keeps quiet about a gap under two points', () => {
    expect(cloudEffect(day([[10.4, 10.9]]))).toBeNull()
    expect(cloudEffect(day([[5.6, 7.4]]))).toBeNull()
  })

  it('needs a clear-sky value', () => {
    expect(cloudEffect(day([[3, undefined]]))).toBeNull()
    expect(cloudEffect([{ uv: 3, clearSkyUV: null }])).toBeNull()
    expect(cloudEffect([])).toBeNull()
  })
})

describe('parseHourlyRows', () => {
  it('reads the clear-sky UV when requested', () => {
    const rows = parseHourlyRows({
      hourly: {
        time: ['2026-06-15T12:00', '2026-06-15T13:00'],
        uv_index: [4.04, 5],
        uv_index_clear_sky: [7.26, null],
      },
    })
    expect(rows.map(r => r.clearSkyUV)).toEqual([7.3, null])
  })
})
