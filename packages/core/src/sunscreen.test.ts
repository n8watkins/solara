import { describe, expect, it } from 'vitest'
import { ACTIVITY_CATEGORIES } from './tiers'
import {
  BODY_AREAS,
  reapplyRule,
  teaspoonRule,
  activityBodyAreas,
  spfAdvice,
  spfAdviceText,
  spfRuleText,
  sunscreenAmount,
  sunscreenAmountShort,
  sunscreenAmountText,
} from './sunscreen'

describe('sunscreenAmount', () => {
  it('counts about a teaspoon per part, 7 (35\u00a0mL) for the whole body', () => {
    expect(sunscreenAmount(BODY_AREAS)).toEqual({
      areas: ['face', 'arms', 'legs', 'torso'],
      teaspoons: 7,
      ml: 35,
      wholeBody: true,
    })
    expect(sunscreenAmount(['face'])).toMatchObject({ teaspoons: 1, ml: 5, wholeBody: false })
    expect(sunscreenAmount(['legs', 'face', 'arms'])).toMatchObject({
      areas: ['face', 'arms', 'legs'],
      teaspoons: 5,
      ml: 25,
    })
    expect(sunscreenAmount(['face', 'face'])).toMatchObject({ teaspoons: 1 })
  })

  it('says it in words, long and short', () => {
    const shorts = sunscreenAmount(['face', 'arms', 'legs'])
    expect(sunscreenAmountText(shorts)).toBe(
      'About 5 teaspoons (25\u00a0mL) for your face, arms and legs',
    )
    expect(sunscreenAmountShort(shorts)).toBe('about 5 tsp for face, arms, legs')
    const tee = sunscreenAmount(['face', 'arms'])
    expect(sunscreenAmountText(tee)).toBe('About 3 teaspoons (15\u00a0mL) for your face and arms')
    expect(sunscreenAmountText(sunscreenAmount(['face']))).toBe(
      'About 1 teaspoon (5\u00a0mL) for your face',
    )
    const whole = sunscreenAmount(BODY_AREAS)
    expect(sunscreenAmountText(whole)).toBe(
      'About 7 teaspoons (35\u00a0mL), a shot glass, for your whole body',
    )
    expect(sunscreenAmountShort(whole)).toBe('about 7 tsp, whole body')
    expect(teaspoonRule()).toContain('About 1 teaspoon (5\u00a0mL) for each part')
  })
})

describe('activityBodyAreas', () => {
  it('follows what people usually wear for each preset', () => {
    expect(activityBodyAreas('swim')).toEqual(BODY_AREAS)
    expect(activityBodyAreas('surf')).toEqual(BODY_AREAS)
    expect(activityBodyAreas('run')).toEqual(['face', 'arms', 'legs'])
    expect(activityBodyAreas('coffee')).toEqual(['face', 'arms'])
    // Custom activities take a T-shirt and shorts, as the vitamin D estimate does.
    expect(activityBodyAreas('custom_1700000000000')).toEqual(['face', 'arms', 'legs'])
    expect(activityBodyAreas(undefined)).toEqual(['face', 'arms', 'legs'])
  })

  it('names only presets that exist', () => {
    const ids = new Set(ACTIVITY_CATEGORIES.flatMap(c => c.activities.map(a => a.id)))
    for (const id of ['swim', 'surf', 'paddle', 'baseball', 'coffee', 'lunch', 'read']) {
      expect(ids.has(id), id).toBe(true)
    }
  })
})

describe('spfAdvice', () => {
  it('needs no SPF under UV 3, on the whole-number index', () => {
    expect(spfAdvice(0, 'very-fair')).toEqual({ spf: null, reason: 'low-uv' })
    expect(spfAdvice(2.4, 'very-fair')).toEqual({ spf: null, reason: 'low-uv' })
    expect(spfAdvice(Number.NaN, 'medium')).toEqual({ spf: null, reason: 'low-uv' })
    expect(spfAdvice(2.5, 'medium')).toEqual({ spf: 30, reason: 'standard' })
  })

  it('asks for SPF 50+ with very high UV or fair skin', () => {
    expect(spfAdvice(7.4, 'dark')).toEqual({ spf: 30, reason: 'standard' })
    expect(spfAdvice(7.5, 'dark')).toEqual({ spf: 50, reason: 'very-high-uv' })
    expect(spfAdvice(11, 'olive')).toEqual({ spf: 50, reason: 'very-high-uv' })
    expect(spfAdvice(3, 'very-fair')).toEqual({ spf: 50, reason: 'fair-skin' })
    expect(spfAdvice(5, 'fair')).toEqual({ spf: 50, reason: 'fair-skin' })
    expect(spfAdvice(5, 'medium')).toEqual({ spf: 30, reason: 'standard' })
  })

  it('says why in one sentence', () => {
    expect(spfAdviceText(spfAdvice(1.8, 'fair'), 1.8, 'fair')).toBe(
      'UV peaks at 1.8 (Low) today: most people need no sunscreen below UV 3.',
    )
    expect(spfAdviceText(spfAdvice(6.2, 'medium'), 6.2, 'medium')).toBe(
      'SPF 30+ broad spectrum: UV reaches 6.2 (High) today.',
    )
    expect(spfAdviceText(spfAdvice(9.1, 'dark'), 9.1, 'dark')).toBe(
      'SPF 50+ broad spectrum: UV reaches 9.1 (Very high) today.',
    )
    expect(spfAdviceText(spfAdvice(4, 'fair'), 4, 'fair')).toBe(
      'SPF 50+ broad spectrum: UV reaches 4.0 (Moderate) today, and type II skin burns easily.',
    )
  })

  it('gives each skin type its rule for Settings', () => {
    expect(spfRuleText('very-fair')).toBe(
      'With type I skin, use SPF 50+ broad spectrum whenever UV is 3 or more.',
    )
    expect(spfRuleText('olive')).toBe(
      'Use SPF 30+ broad spectrum whenever UV is 3 or more, and SPF 50+ when it reaches 8.',
    )
  })
})

describe('reapplyRule', () => {
  it('uses the one duration style', () => {
    expect(reapplyRule()).toBe(
      'Put it on 20\u00a0min before you go out. Reapply every 2\u00a0h, and straight after swimming, sweating or towelling off.',
    )
  })
})
