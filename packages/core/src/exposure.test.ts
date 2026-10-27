import { describe, expect, it } from 'vitest'
import {
  SHADE_FACTORS,
  SHADE_LEVELS,
  SURFACE_REFLECTANCE,
  SURFACES,
  exposedUV,
  exposureFactor,
} from './exposure'

describe('shade and surface exposure', () => {
  it('changes nothing without a setting', () => {
    expect(exposureFactor({})).toBe(1)
    expect(exposedUV(7.3, {})).toBe(7.3)
    expect(exposedUV(7.3, { shade: null, surface: null })).toBe(7.3)
  })

  it('has a factor for every level and surface', () => {
    for (const shade of SHADE_LEVELS) expect(SHADE_FACTORS[shade]).toBeGreaterThan(0)
    for (const surface of SURFACES) expect(SURFACE_REFLECTANCE[surface]).toBeGreaterThan(0)
  })

  it('stays cautious: shade never removes more than half the sky UV', () => {
    for (const shade of SHADE_LEVELS) expect(SHADE_FACTORS[shade]).toBeGreaterThanOrEqual(0.5)
    expect(SURFACE_REFLECTANCE.snow).toBeGreaterThanOrEqual(0.8)
    expect(SURFACE_REFLECTANCE.sand).toBeGreaterThanOrEqual(0.15)
  })

  it('adds reflection to the shaded sky UV', () => {
    expect(exposureFactor({ surface: 'sand' })).toBeCloseTo(1.15)
    expect(exposureFactor({ shade: 'full' })).toBeCloseTo(0.5)
    // Shade overhead does not stop UV reflected from sunlit snow around it.
    expect(exposureFactor({ shade: 'full', surface: 'snow' })).toBeCloseTo(1.35)
    expect(exposureFactor({ shade: 'partial', surface: 'grass' })).toBeCloseTo(0.77)
  })

  it('rounds up, so rounding never makes an hour look safer', () => {
    expect(exposedUV(4, { surface: 'sand' })).toBe(4.6)
    expect(exposedUV(3.33, { shade: 'partial' })).toBe(2.5)
    expect(exposedUV(4, { shade: 'full' })).toBe(2)
    expect(exposedUV(10, { surface: 'snow' })).toBe(18.5)
  })

  it('leaves values that are not finite alone', () => {
    expect(exposedUV(Number.NaN, { surface: 'snow' })).toBeNaN()
  })
})
