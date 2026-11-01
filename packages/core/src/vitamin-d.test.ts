import { describe, expect, it } from 'vitest'
import { burnMins, SKIN_BURN_BASE, SKIN_TYPES, SUNSCREEN_UV_FACTOR } from './recommendation'
import {
  burnRisk,
  estimateSession,
  EXPOSURE_FACTOR,
  forecastSpans,
  roundIu,
  SKIN_EXPOSURES,
  VITD_DOSE_IU,
  vitDMins,
  type SkinExposure,
} from './vitamin-d'

const session = (
  minutes: number,
  uv: number,
  {
    skin = 'fair' as const,
    exposure = 'arms-legs' as SkinExposure,
    sunscreen = false,
  }: {
    skin?: (typeof SKIN_TYPES)[number]
    exposure?: SkinExposure
    sunscreen?: boolean
  } = {},
) => estimateSession({ spans: [{ minutes, uv }], skinType: skin, exposure, sunscreen })

describe('vitDMins, the card', () => {
  it('returns null below UV 1, the card\'s "UV too low"', () => {
    expect(vitDMins(0.9, 'fair')).toBeNull()
    expect(vitDMins(1, 'fair')).not.toBeNull()
  })

  it('is 0.3 of the burn time', () => {
    expect(vitDMins(5, 'fair')).toBe(9) // (15 x 0.3 x 10) / 5
  })

  it('never returns less than 1 minute even at extreme UV', () => {
    expect(vitDMins(50, 'fair')).toBe(1)
  })

  it('has no floor above UV 1: a low sun only takes longer', () => {
    expect(vitDMins(1.5, 'fair')).toBe(30)
    expect(vitDMins(2.5, 'fair')).toBe(18)
  })
})

describe('the card and the log agree', () => {
  it("logs the card's minutes on arms and legs as about the card's dose, for every skin type and UV", () => {
    for (const skin of SKIN_TYPES) {
      for (const uv of [1, 2, 3.4, 5, 7.8, 11]) {
        const minutes = vitDMins(uv, skin)!
        // The card rounds to whole minutes; unrounded, the log gives exactly the dose.
        const exact = (SKIN_BURN_BASE[skin] * 0.3 * 10) / uv
        expect(session(exact, uv, { skin }).iu).toBeCloseTo(VITD_DOSE_IU, 6)
        expect(Math.abs(session(minutes, uv, { skin }).iu - VITD_DOSE_IU)).toBeLessThanOrEqual(
          VITD_DOSE_IU / exact / 2 + 1e-9,
        )
      }
    }
  })

  it("burns at the card's burn time", () => {
    for (const skin of SKIN_TYPES) {
      const estimate = session(burnMins(5, skin)!, 5, { skin })
      expect(estimate.burnMinutes).toBe(burnMins(5, skin))
      expect(estimate.burnShare).toBeCloseTo(1, 1)
    }
  })
})

describe('estimateSession', () => {
  it('scales with the uncovered skin', () => {
    const base = session(9, 5).iu
    for (const exposure of SKIN_EXPOSURES) {
      expect(session(9, 5, { exposure }).iu).toBeCloseTo(base * EXPOSURE_FACTOR[exposure], 6)
    }
    expect(EXPOSURE_FACTOR).toEqual({
      'face-hands': 0.25,
      'face-arms': 0.5,
      'arms-legs': 1,
      swimwear: 2,
    })
  })

  it('divides the UV by the sunscreen factor for both the vitamin D and the burn', () => {
    const bare = session(20, 6)
    const covered = session(20, 6, { sunscreen: true })
    expect(covered.iu).toBeCloseTo(bare.iu / SUNSCREEN_UV_FACTOR, 6)
    expect(covered.burnShare).toBeCloseTo(bare.burnShare / SUNSCREEN_UV_FACTOR, 6)
    // Fair skin at UV 6 burns in 25 minutes; with sunscreen counted, in about 63.
    expect(bare.burnMinutes).toBe(25)
    expect(covered.burnMinutes).toBe(63)
  })

  it('counts minutes under UV 1 toward the burn, not the vitamin D', () => {
    const low = session(60, 0.8)
    expect(low.iu).toBe(0)
    expect(low.lowUv).toBe(true)
    expect(low.burnShare).toBeCloseTo((60 * 0.8) / 150, 6)
    const mixed = estimateSession({
      spans: [
        { minutes: 30, uv: 0.5 },
        { minutes: 30, uv: 2 },
      ],
      skinType: 'fair',
      exposure: 'arms-legs',
      sunscreen: false,
    })
    expect(mixed.iu).toBeCloseTo(session(30, 2).iu, 6)
    expect(mixed.meanUv).toBeCloseTo(1.25, 6)
    expect(mixed.minutes).toBe(60)
  })

  it('stops adding vitamin D at one burn dose', () => {
    // Fair skin at UV 5 burns in 30 minutes.
    const atBurn = session(30, 5)
    const past = session(90, 5)
    expect(atBurn.iu).toBeCloseTo(VITD_DOSE_IU / 0.3, 6)
    expect(past.iu).toBeCloseTo(atBurn.iu, 6)
    expect(past.capped).toBe(true)
    expect(atBurn.capped).toBe(false)
    expect(past.burnShare).toBeCloseTo(3, 6)
  })

  it('gives nothing for an empty session, and no burn time with no UV', () => {
    const none = estimateSession({ spans: [], skinType: 'dark', exposure: 'swimwear', sunscreen: true })
    expect(none).toMatchObject({ iu: 0, burnShare: 0, minutes: 0, burnMinutes: null, meanUv: 0 })
    expect(session(30, 0).burnMinutes).toBeNull()
  })
})

describe('burnRisk', () => {
  it('says how close a session came to the burn time', () => {
    expect(burnRisk(0)).toBe('well-under')
    expect(burnRisk(0.49)).toBe('well-under')
    expect(burnRisk(0.5)).toBe('close')
    expect(burnRisk(0.99)).toBe('close')
    expect(burnRisk(1)).toBe('past')
    expect(burnRisk(2.4)).toBe('past')
  })
})

describe('roundIu', () => {
  it('rounds to the nearest 50', () => {
    expect(roundIu(0)).toBe(0)
    expect(roundIu(20)).toBe(0)
    expect(roundIu(30)).toBe(50)
    expect(roundIu(1024)).toBe(1000)
    expect(roundIu(1030)).toBe(1050)
  })
})

describe('forecastSpans', () => {
  const hourly = [
    { hour: 9, uv: 4 },
    { hour: 10, uv: 6 },
    { hour: 11, uv: 7 },
  ]

  it('splits a session at the hours, minute by minute', () => {
    expect(forecastSpans(hourly, 9 + 40 / 60, 50)).toEqual([
      { minutes: expect.closeTo(20, 6), uv: 4 },
      { minutes: expect.closeTo(30, 6), uv: 6 },
    ])
  })

  it('counts hours the forecast lacks as UV 0', () => {
    expect(forecastSpans(hourly, 11.5, 60)).toEqual([
      { minutes: 30, uv: 7 },
      { minutes: 30, uv: 0 },
    ])
  })

  it('stays within one hour for a short session', () => {
    expect(forecastSpans(hourly, 10, 15)).toEqual([{ minutes: 15, uv: 6 }])
    expect(forecastSpans(hourly, 10, 0)).toEqual([])
  })
})
