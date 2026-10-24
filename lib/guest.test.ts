import { beforeEach, describe, expect, it } from 'vitest'
import { defaultPrefs } from './prefs'
import {
  GUEST_KEY,
  asGuestPrefs,
  clearGuestData,
  isReturningGuest,
  loadGuestPrefs,
  localDay,
  saveGuestPrefs,
} from './guest'
import type { Activity, Location, UserPreferences } from './types'

const storage = new Map<string, string>()
const LA: Location = { lat: 34.05, lon: -118.24, city: 'Los Angeles', region: 'CA' }
const activity = (id: string): Activity => ({
  id,
  name: id,
  icon: '🏃',
  durationMins: 30,
  maxUV: 4,
  sunscreen: false,
})

beforeEach(() => {
  storage.clear()
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} })
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => void storage.set(key, value),
      removeItem: (key: string) => void storage.delete(key),
    },
  })
})

describe('the guest plan', () => {
  it('round-trips through this browser on the guest tier', () => {
    const plan: UserPreferences = {
      ...defaultPrefs(LA),
      skinType: 'olive',
      activities: [activity('custom_run')],
    }
    saveGuestPrefs(plan, '2026-06-15')
    expect(loadGuestPrefs()).toMatchObject({
      uid: '',
      tier: 'anonymous',
      skinType: 'olive',
      location: { city: 'Los Angeles' },
      activities: [{ id: 'custom_run' }],
    })
  })

  it('never holds account data: owner, tier, profiles or more than the guest plan allows', () => {
    const account: UserPreferences = {
      ...defaultPrefs(LA),
      uid: 'user-a',
      tier: 'paid',
      savedLocations: [LA],
      profiles: [{ id: 'kid', name: 'Kid', skinType: 'fair' }],
      activeProfileId: 'kid',
      activities: [activity('custom_a'), activity('custom_b')],
      upgradeInterest: { email: 'a@example.com', createdAt: '2026-06-01T00:00:00.000Z' },
    }
    const guest = asGuestPrefs(account)
    expect(guest).toMatchObject({ uid: '', tier: 'anonymous', savedLocations: [] })
    expect(guest.activities).toHaveLength(1)
    expect(guest.profiles).toBeUndefined()
    expect(guest.upgradeInterest).toBeUndefined()

    saveGuestPrefs(account)
    expect(storage.get(GUEST_KEY)).not.toContain('user-a')
    expect(storage.get(GUEST_KEY)).not.toContain('a@example.com')
  })

  it('is absent when nothing (or something unreadable) is stored', () => {
    expect(loadGuestPrefs()).toBeNull()
    storage.set(GUEST_KEY, '{not json')
    expect(loadGuestPrefs()).toBeNull()
    storage.set(GUEST_KEY, JSON.stringify({ prefs: { location: 'nowhere' } }))
    expect(loadGuestPrefs()).toBeNull()
  })

  it('clears', () => {
    saveGuestPrefs(defaultPrefs(LA))
    clearGuestData()
    expect(storage.has(GUEST_KEY)).toBe(false)
    expect(loadGuestPrefs()).toBeNull()
  })
})

describe('isReturningGuest', () => {
  it('is true from the day after the guest first set Solara up', () => {
    saveGuestPrefs(defaultPrefs(LA), '2026-06-14')
    expect(isReturningGuest('2026-06-14')).toBe(false)
    expect(isReturningGuest('2026-06-15')).toBe(true)
  })

  it('keeps the first day when the plan is saved again', () => {
    saveGuestPrefs(defaultPrefs(LA), '2026-06-14')
    saveGuestPrefs({ ...defaultPrefs(LA), skinType: 'dark' }, '2026-06-20')
    expect(JSON.parse(storage.get(GUEST_KEY)!)).toMatchObject({ since: '2026-06-14' })
  })

  it('is false without a guest plan', () => {
    expect(isReturningGuest('2026-06-15')).toBe(false)
  })
})

describe('localDay', () => {
  it('is the device-local date', () => {
    expect(localDay(new Date(2026, 5, 9, 23, 59))).toBe('2026-06-09')
  })
})
