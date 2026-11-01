import { describe, expect, it } from 'vitest'
import { burnMins, effectiveMaxUV, outlastsBurnTime } from './recommendation'
import { PRESET_ACTIVITIES } from './tiers'

describe('outlastsBurnTime (REVIEW10 QA M3)', () => {
  const running = { maxUV: 4, durationMins: 45, sunscreen: false }
  const burnAtLimit = (activity: typeof running, skin: 'very-fair' | 'fair' | 'medium') =>
    burnMins(effectiveMaxUV(activity), skin)

  it('is true when unprotected skin burns before the activity ends', () => {
    expect(burnAtLimit(running, 'fair')).toBe(38)
    expect(outlastsBurnTime(running, burnAtLimit(running, 'fair'))).toBe(true)
    expect(outlastsBurnTime(running, burnAtLimit(running, 'very-fair'))).toBe(true)
  })

  it('is false when the burn time is longer, with sunscreen, or without a burn time', () => {
    expect(outlastsBurnTime(running, burnAtLimit(running, 'medium'))).toBe(false)
    expect(outlastsBurnTime({ ...running, durationMins: 38 }, 38)).toBe(false)
    expect(outlastsBurnTime({ ...running, sunscreen: true }, 10)).toBe(false)
    expect(outlastsBurnTime(running, null)).toBe(false)
  })

  it('applies to most ready-made activities for the default fair skin', () => {
    // The verification of REVIEW10 found 18 of 25; each of them now carries the warning.
    const outlasting = PRESET_ACTIVITIES.filter(preset =>
      outlastsBurnTime(preset, burnMins(effectiveMaxUV(preset), 'fair')),
    )
    expect(outlasting.length).toBeGreaterThan(PRESET_ACTIVITIES.length / 2)
  })
})
