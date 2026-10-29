import { describe, expect, it } from 'vitest'
import {
  TIER_LIMITS,
  activityLimitNote,
  canAddActivity,
  canUseCalendar,
  canUseFamilyProfiles,
  canUseNotifications,
  forecastLabel,
  getFutureDays,
  getProfileLimit,
  getSavedLocationLimit,
  isDeviceOnly,
} from './tiers'
import { PREFS_LIMITS } from './prefs'

// The plans decided on 2026-10-23 (D7): Guest = today, 1 activity, this device only;
// Free account = today and tomorrow, 3 activities, synced; Pro = 10 days, 20
// activities, calendar, morning alerts and family profiles. Whether calendar sync
// stays on Free is still the owner's decision; until then Free keeps it.
describe('guest plan', () => {
  it('sees today only', () => {
    expect(getFutureDays('anonymous')).toBe(1)
    expect(forecastLabel('anonymous')).toBe('Today')
  })

  it('plans one activity', () => {
    expect(canAddActivity('anonymous', 0)).toBe(true)
    expect(canAddActivity('anonymous', 1)).toBe(false)
  })

  it('keeps everything on this device', () => {
    expect(isDeviceOnly('anonymous')).toBe(true)
    expect(getSavedLocationLimit('anonymous')).toBe(1)
  })

  it('has no calendar, alerts or family profiles', () => {
    expect(canUseCalendar('anonymous')).toBe(false)
    expect(canUseNotifications('anonymous')).toBe(false)
    expect(canUseFamilyProfiles('anonymous')).toBe(false)
  })
})

describe('free account', () => {
  it('sees today and tomorrow', () => {
    expect(getFutureDays('free')).toBe(2)
    expect(forecastLabel('free')).toBe('Today and tomorrow')
  })

  it('plans three activities', () => {
    expect(canAddActivity('free', 2)).toBe(true)
    expect(canAddActivity('free', 3)).toBe(false)
  })

  it('syncs through the account', () => {
    expect(isDeviceOnly('free')).toBe(false)
  })

  it('keeps calendar sync for now, with no alerts or family profiles', () => {
    expect(canUseCalendar('free')).toBe(true)
    expect(canUseNotifications('free')).toBe(false)
    expect(canUseFamilyProfiles('free')).toBe(false)
    expect(getProfileLimit('free')).toBe(1)
  })
})

describe('Pro', () => {
  it('sees 10 days', () => {
    expect(getFutureDays('paid')).toBe(10)
    expect(forecastLabel('paid')).toBe('10 days')
  })

  it('plans 20 activities, the Firestore rules cap', () => {
    expect(canAddActivity('paid', 19)).toBe(true)
    expect(canAddActivity('paid', 20)).toBe(false)
  })

  it('adds calendar, morning alerts and family profiles', () => {
    expect(isDeviceOnly('paid')).toBe(false)
    expect(canUseCalendar('paid')).toBe(true)
    expect(canUseNotifications('paid')).toBe(true)
    expect(canUseFamilyProfiles('paid')).toBe(true)
  })
})

describe('plan order', () => {
  it('never takes anything away on the way up', () => {
    const order = [TIER_LIMITS.anonymous, TIER_LIMITS.free, TIER_LIMITS.paid]
    for (const key of ['activities', 'futureDays', 'savedLocations', 'profiles'] as const) {
      const values = order.map(limits => limits[key])
      expect([...values].sort((a, b) => a - b)).toEqual(values)
    }
  })
})

describe('activityLimitNote', () => {
  it('points a full plan at the next plan up', () => {
    expect(activityLimitNote('anonymous')).toBe(
      'Guests can plan 1 activity. Sign in free to plan up to 3.',
    )
    expect(activityLimitNote('free')).toBe(
      'Free plan: up to 3 activities. Upgrade to Pro for up to 20.',
    )
    expect(activityLimitNote('paid')).toBeNull()
  })

  it('offers no Pro upgrade in an app store build', () => {
    const store = { offerPro: false }
    expect(activityLimitNote('free', store)).toBe('Free plan: up to 3 activities.')
    expect(activityLimitNote('anonymous', store)).toBe(
      'Guests can plan 1 activity. Sign in free to plan up to 3.',
    )
  })
})

describe('the stored preferences caps', () => {
  it("are Pro's list limits, so a Pro account's lists always fit", () => {
    expect(PREFS_LIMITS.activities).toBe(TIER_LIMITS.paid.activities)
    expect(PREFS_LIMITS.savedLocations).toBe(TIER_LIMITS.paid.savedLocations)
    expect(PREFS_LIMITS.profiles).toBeGreaterThanOrEqual(TIER_LIMITS.paid.profiles)
  })
})
