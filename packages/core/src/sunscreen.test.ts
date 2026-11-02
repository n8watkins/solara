import { describe, expect, it } from 'vitest'
import { ACTIVITY_CATEGORIES } from './tiers'
import { burnFit } from './sun-safety'
import {
  BODY_AREAS,
  reapplyRule,
  teaspoonRule,
  activityBodyAreas,
  spfAdvice,
  spfAdviceText,
  spfRuleText,
  burnFitText,
  sunGearRule,
  sunGearText,
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

// ROADMAP item 56: the activity card's fit line and what else to wear by UV level.
describe('burnFitText', () => {
  const run = { id: 'run', durationMins: 45 }
  it('says plainly whether it fits unprotected, and what makes it fit', () => {
    expect(burnFitText(burnFit(run, 2, 'fair'))).toBe(
      "Fits without sunscreen: you'd burn in about 1\u00a0h 15\u00a0min.",
    )
    // From UV 3 the guidance advises sunscreen whatever the duration.
    expect(burnFitText(burnFit(run, 4, 'medium'))).toBe(
      "Fits without sunscreen (you'd burn in about 1\u00a0h 3\u00a0min), but use SPF\u00a030+ at this UV.",
    )
    expect(burnFitText(burnFit(run, 0.2, 'fair'))).toBe(
      'Fits without sunscreen: the UV is too low to burn.',
    )
    expect(burnFitText(burnFit(run, 4, 'fair'))).toBe(
      'Longer than your burn time (about 38\u00a0min): fits with SPF\u00a050+.',
    )
    expect(burnFitText(burnFit({ id: 'swim', durationMins: 120 }, 3, 'medium'))).toBe(
      'Longer than your burn time (about 1\u00a0h 23\u00a0min): fits with SPF\u00a030+, reapplied every 1\u00a0h 20\u00a0min.',
    )
    const tooLong = burnFit(run, 10, 'fair')
    expect(burnFitText(tooLong, '5pm–5:45pm')).toBe(
      "Too long even with SPF\u00a050+ (you'd burn in about 38\u00a0min): split it, or move it to 5pm–5:45pm.",
    )
    expect(burnFitText(tooLong)).toBe(
      "Too long even with SPF\u00a050+ (you'd burn in about 38\u00a0min): split it into shorter sessions.",
    )
  })

  it('says it in Spanish', async () => {
    const { withLocale } = await import('./i18n')
    const { default: sunscreenEs } = await import('./messages/es/sunscreen')
    const { default: coreEs } = await import('./messages/es/core')
    const lines = withLocale('es', { sunscreen: sunscreenEs, core: coreEs }, () => [
      burnFitText(burnFit(run, 4, 'fair')),
      burnFitText(burnFit(run, 10, 'fair'), '5–5:45\u00a0p.m.'),
      sunGearText(9),
    ])
    expect(lines).toEqual([
      'Dura más que tu tiempo hasta quemarte (unos 38\u00a0min): hazlo con FPS\u00a050+.',
      'Dura demasiado aun con FPS\u00a050+ (te quemarías en unos 38\u00a0min): divídelo o muévelo a 5–5:45\u00a0p.m.',
      'Suma una camiseta, un sombrero y lentes de sol, y quédate a la sombra cerca del mediodía.',
    ])
  })
})

describe('sunGearText', () => {
  it('names only what matters at the UV level', () => {
    expect(sunGearText(2.4)).toBeNull()
    expect(sunGearText(2.5)).toBe('Add a shirt, a hat and sunglasses, and shade at midday.')
    expect(sunGearText(7.4)).toBe('Add a shirt, a hat and sunglasses, and shade at midday.')
    expect(sunGearText(7.5)).toBe(
      'Add a shirt, a hat and sunglasses, and stay in the shade around midday.',
    )
    expect(sunGearRule()).toBe(
      'From UV 3, also wear a shirt, a hat and sunglasses; from UV 8, stay in the shade around midday.',
    )
  })
})
