import { describe, expect, it } from 'vitest'
import {
  burnMins,
  effectiveMaxUV,
  mostSensitiveSkinType,
  SKIN_TYPES,
  type SkinType,
} from './recommendation'
import { PRESET_ACTIVITIES } from './tiers'
import {
  bestFitIn,
  burnFit,
  isWaterActivity,
  peakUVIn,
  spfAdvice,
  sunSafetyLevel,
  type FitVerdict,
} from './sun-safety'

// Burn times (recommendation.ts SKIN_BURN_BASE, scaled by 10 / UV) at UV 4: very fair 25,
// fair 38, medium 63, olive 88, dark 100 min. With sunscreen (2.5 times): 63, 94, 156, 219
// and 250 min.
describe('burnFit', () => {
  const run = { id: 'run', durationMins: 45 }

  it('fits unprotected while the activity is no longer than the burn time', () => {
    expect(burnFit(run, 4, 'medium')).toEqual({
      verdict: 'fits',
      uv: 4,
      burnMins: 63,
      protectedMins: 156,
      spf: 30,
      reapplyMins: null,
    })
    // Equal to the burn time still fits: fair skin burns in 38 min at UV 4.
    expect(burnFit({ durationMins: 38 }, 4, 'fair').verdict).toBe('fits')
    expect(burnFit({ durationMins: 39 }, 4, 'fair').verdict).toBe('sunscreen')
  })

  it('fits with sunscreen when the burn time with SPF 30+ covers it, and names the SPF', () => {
    // REVIEW10 QA M3: 45 min at UV 4 outlasts fair skin's 38, and fits its 94 with sunscreen.
    expect(burnFit(run, 4, 'fair')).toEqual({
      verdict: 'sunscreen',
      uv: 4,
      burnMins: 38,
      protectedMins: 94,
      spf: 50, // type II burns easily
      reapplyMins: null,
    })
    // Medium skin at UV 6: burns in 42, 104 with sunscreen; SPF 30+.
    expect(burnFit({ durationMins: 90 }, 6, 'medium')).toMatchObject({
      verdict: 'sunscreen',
      spf: 30,
    })
    // At UV 8 or more every skin type gets SPF 50+.
    expect(burnFit({ durationMins: 90 }, 8, 'dark')).toMatchObject({
      verdict: 'sunscreen',
      spf: 50,
    })
  })

  it('names SPF 30+ at least, even when the UV is under 3', () => {
    // Very fair skin at UV 2 burns in 50 min; a 2-hour walk needs sunscreen.
    expect(spfAdvice(2, 'very-fair').spf).toBeNull()
    expect(burnFit({ durationMins: 120 }, 2, 'very-fair')).toMatchObject({
      verdict: 'sunscreen',
      burnMins: 50,
      protectedMins: 125,
      spf: 30,
    })
  })

  it('reapplies every 2 h, or every 80 min in the water, only when it lasts longer', () => {
    expect(burnFit({ durationMins: 150 }, 2, 'fair')).toMatchObject({
      verdict: 'sunscreen',
      reapplyMins: 120,
    })
    expect(burnFit({ durationMins: 120 }, 2, 'fair').reapplyMins).toBeNull()
    expect(burnFit({ id: 'swim', durationMins: 90 }, 3, 'medium')).toMatchObject({
      verdict: 'sunscreen',
      reapplyMins: 80,
    })
    expect(burnFit({ id: 'surf', durationMins: 80 }, 3, 'medium').reapplyMins).toBeNull()
    expect(isWaterActivity('paddle')).toBe(true)
    expect(isWaterActivity('run')).toBe(false)
    expect(isWaterActivity(undefined)).toBe(false)
  })

  it('is too long even with sunscreen past the protected burn time', () => {
    // An activity planned with SPF at UV 10 (4 times 2.5): fair skin burns in 15 min, 38
    // with sunscreen, so a 45 min run is too long even with it.
    expect(burnFit(run, 10, 'fair')).toEqual({
      verdict: 'too-long',
      uv: 10,
      burnMins: 15,
      protectedMins: 38,
      spf: 50,
      reapplyMins: null,
    })
  })

  it('fits whatever the duration when the UV is negligible', () => {
    expect(burnFit({ durationMins: 600 }, 0.4, 'very-fair')).toMatchObject({
      verdict: 'fits',
      burnMins: null,
      protectedMins: null,
    })
    // UV 1: very fair skin burns in 100 min; with sunscreen the UV counts as 0.4, so no burn.
    expect(burnFit({ durationMins: 600 }, 1, 'very-fair')).toMatchObject({
      verdict: 'sunscreen',
      burnMins: 100,
      protectedMins: null,
    })
  })

  it('treats a missing or negative duration as none', () => {
    expect(burnFit({}, 11, 'very-fair').verdict).toBe('fits')
    expect(burnFit({ durationMins: -5 }, 11, 'very-fair').verdict).toBe('fits')
  })

  it('goes from fits to sunscreen to too long as the UV rises, for every skin type', () => {
    const order: FitVerdict[] = ['fits', 'sunscreen', 'too-long']
    for (const skin of SKIN_TYPES) {
      let last = 0
      for (let uv = 0; uv <= 14; uv += 0.5) {
        const rank = order.indexOf(burnFit({ durationMins: 120 }, uv, skin).verdict)
        expect(rank, `${skin} at UV ${uv}`).toBeGreaterThanOrEqual(last)
        last = rank
      }
    }
  })

  it('table: 1 hour at each UV level, for each skin type', () => {
    const table = Object.fromEntries(
      SKIN_TYPES.map(skin => [
        skin,
        [2, 3, 5, 7, 9, 11].map(uv => burnFit({ durationMins: 60 }, uv, skin).verdict),
      ]),
    )
    expect(table).toEqual({
      'very-fair': ['sunscreen', 'sunscreen', 'too-long', 'too-long', 'too-long', 'too-long'],
      fair: ['fits', 'sunscreen', 'sunscreen', 'too-long', 'too-long', 'too-long'],
      medium: ['fits', 'fits', 'sunscreen', 'sunscreen', 'sunscreen', 'too-long'],
      olive: ['fits', 'fits', 'fits', 'sunscreen', 'sunscreen', 'sunscreen'],
      dark: ['fits', 'fits', 'fits', 'sunscreen', 'sunscreen', 'sunscreen'],
    })
  })

  it('in a group, the most sensitive skin type decides', () => {
    const group: SkinType[] = ['dark', 'medium', 'fair']
    const skin = mostSensitiveSkinType(group)!
    expect(skin).toBe('fair')
    // Medium alone fits 45 min at UV 4; with a fair-skinned person along, it needs sunscreen.
    expect(burnFit(run, 4, 'medium').verdict).toBe('fits')
    expect(burnFit(run, 4, skin).verdict).toBe('sunscreen')
  })
})

describe('burnFit on the ready-made activities (REVIEW10 QA M3)', () => {
  it('at their UV limits, most need sunscreen for the default fair skin, and none goes unsaid', () => {
    // The verification of REVIEW10 found 18 of 25 outlast fair skin's burn time at their
    // limit; the fit now says what each of them needs.
    const verdicts = PRESET_ACTIVITIES.map(
      preset => burnFit(preset, effectiveMaxUV(preset), 'fair').verdict,
    )
    const unprotected = PRESET_ACTIVITIES.filter(
      preset => preset.durationMins > burnMins(effectiveMaxUV(preset), 'fair')!,
    )
    expect(unprotected.length).toBeGreaterThan(PRESET_ACTIVITIES.length / 2)
    expect(verdicts.filter(v => v !== 'fits')).toHaveLength(unprotected.length)
  })
})

describe('sunSafetyLevel', () => {
  it('follows the WHO categories on the whole-number index', () => {
    expect([0, 2.4, 2.5, 7.4, 7.5, 11].map(sunSafetyLevel)).toEqual([
      'low',
      'low',
      'protect',
      'protect',
      'shade',
      'shade',
    ])
    expect(sunSafetyLevel(Number.NaN)).toBe('low')
  })
})

describe('peakUVIn and bestFitIn', () => {
  // A morning: UV 0.5 at 6am rising by 1 each hour to 6.5 at noon (planning UV a little
  // higher, as under a clear sky).
  const hours = Array.from({ length: 7 }, (_, i) => ({
    hour: 6 + i,
    uv: 0.5 + i,
    planningUV: 0.8 + i,
  }))

  it('reads the highest planning UV over the hours a span touches', () => {
    expect(peakUVIn(hours, 6, 6.75)).toBe(0.8)
    expect(peakUVIn(hours, 6.5, 7.25)).toBe(1.8)
    expect(peakUVIn(hours, 9, 10)).toBe(3.8)
    expect(peakUVIn([{ hour: 9, uv: 3.04 }], 9, 10)).toBe(3)
    // A span of no length still reads its hour.
    expect(peakUVIn(hours, 8, 8)).toBe(2.8)
    expect(peakUVIn(hours, 20, 21)).toBe(0)
  })

  it('places the activity where the UV is lowest in the span', () => {
    const placed = bestFitIn(hours, { from: 6, to: 10 }, { durationMins: 45 }, 'fair')
    expect(placed).toMatchObject({ from: 6, to: 6.75 })
    expect(placed!.fit).toMatchObject({ verdict: 'fits', uv: 0.8 })
    // Starting at 8:30, the span's lowest stretch is 8:30-9:15 (UV 2.8 then 3.8).
    const later = bestFitIn(hours, { from: 8.5, to: 12 }, { durationMins: 45 }, 'very-fair')
    expect(later).toMatchObject({ from: 8.5, to: 9.25 })
    expect(later!.fit).toMatchObject({ uv: 3.8, verdict: 'sunscreen' })
  })

  it('starts later in the span when the UV falls through it, never before the span', () => {
    const evening = [3, 2, 1].map((uv, i) => ({ hour: 16 + i, uv }))
    const placed = bestFitIn(evening, { from: 16.5, to: 19 }, { durationMins: 60 }, 'fair')
    expect(placed).toMatchObject({ from: 18, to: 19 })
    expect(placed!.fit.uv).toBe(1)
    // A span inside one hour starts where it starts.
    expect(
      bestFitIn(evening, { from: 16.25, to: 17.5 }, { durationMins: 60 }, 'fair'),
    ).toMatchObject({ from: 16.25, to: 17.25 })
  })

  it('is null when the span is shorter than the activity', () => {
    expect(bestFitIn(hours, { from: 6, to: 6.5 }, { durationMins: 45 }, 'fair')).toBeNull()
  })
})
