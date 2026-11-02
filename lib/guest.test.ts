import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultPrefs } from './local-prefs'
import * as prefsModule from './prefs'
import {
  GUEST_KEY,
  asGuestPrefs,
  clearGuestData,
  isReturningGuest,
  loadGuestPrefs,
  localDay,
  saveGuestPrefs,
} from './guest'
import { requestPersistentStorage } from './persistent-storage'
import { isStoredGuestPlan } from './stored-plan'
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

// The preferences schema, watched: a plan in the form saveGuestPrefs writes is read
// without it (ROADMAP item 52), any other plan through it.
vi.mock('./prefs', async importOriginal => {
  const actual = await importOriginal<typeof prefsModule>()
  return { ...actual, normalizePrefs: vi.fn(actual.normalizePrefs) }
})
const normalizePrefs = vi.mocked(prefsModule.normalizePrefs)

beforeEach(() => {
  normalizePrefs.mockClear()
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
  it('round-trips through this browser on the guest tier', async () => {
    const plan: UserPreferences = {
      ...defaultPrefs(LA),
      skinType: 'olive',
      activities: [activity('custom_run')],
    }
    saveGuestPrefs(plan, '2026-06-15')
    expect(await loadGuestPrefs()).toMatchObject({
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

  it('is absent when nothing (or something unreadable) is stored', async () => {
    expect(await loadGuestPrefs()).toBeNull()
    storage.set(GUEST_KEY, '{not json')
    expect(await loadGuestPrefs()).toBeNull()
    storage.set(GUEST_KEY, JSON.stringify({ prefs: { location: 'nowhere' } }))
    expect(await loadGuestPrefs()).toBeNull()
    storage.set(GUEST_KEY, JSON.stringify({ prefs: { ...defaultPrefs(LA), location: null } }))
    expect(await loadGuestPrefs()).toBeNull()
    storage.set(
      GUEST_KEY,
      JSON.stringify({ prefs: { ...defaultPrefs(LA), location: { ...LA, lat: 999 } } }),
    )
    expect(await loadGuestPrefs()).toBeNull()
  })

  it('clears', async () => {
    saveGuestPrefs(defaultPrefs(LA))
    clearGuestData()
    expect(storage.has(GUEST_KEY)).toBe(false)
    expect(await loadGuestPrefs()).toBeNull()
  })

  it('reads a plan as saveGuestPrefs wrote it without the preferences schema', async () => {
    const run = { ...activity('custom_run'), custom: true } as const
    saveGuestPrefs({ ...defaultPrefs(LA), activities: [run] }, '2026-06-15')
    const stored = JSON.parse(storage.get(GUEST_KEY)!).prefs
    expect(isStoredGuestPlan(stored)).toBe(true)
    expect(await loadGuestPrefs()).toEqual(stored)
    expect(normalizePrefs).not.toHaveBeenCalled()
  })

  it('repairs any other plan through the schema, as before, and keeps it repaired', async () => {
    const written = {
      ...defaultPrefs(LA),
      // Changed outside the app: an account's fields, values out of range, unknown keys.
      uid: 'user-a',
      tier: 'paid',
      skinType: 'purple',
      notificationHour: 99,
      injected: '<script>',
      location: { ...LA, lat: 34.0512345, city: '  Los Angeles  ', extra: 1 },
      activities: [{ ...activity('custom_run'), maxUV: 99, durationMins: 'long' }, activity('b')],
      hiddenActivitySuggestionIds: ['walk', 'walk', 'not-a-preset'],
    }
    storage.set(GUEST_KEY, JSON.stringify({ prefs: written, since: '2026-06-15' }))
    const expected = asGuestPrefs(prefsModule.normalizePrefs(written)!)
    normalizePrefs.mockClear()

    const guest = await loadGuestPrefs()
    expect(normalizePrefs).toHaveBeenCalledOnce()
    expect(guest).toEqual(expected)
    expect(guest).toMatchObject({
      uid: '',
      tier: 'anonymous',
      skinType: 'fair',
      notificationHour: 10,
      location: { lat: 34.05, city: 'Los Angeles' },
      activities: [{ id: 'custom_run', maxUV: 11, durationMins: 30, custom: true }],
      hiddenActivitySuggestionIds: ['walk'],
    })
    expect(guest).not.toHaveProperty('injected')
    expect(guest!.location).not.toHaveProperty('extra')

    // Kept in the repaired form, with its first day, so the next start reads it directly.
    const kept = JSON.parse(storage.get(GUEST_KEY)!)
    expect(kept.since).toBe('2026-06-15')
    expect(isStoredGuestPlan(kept.prefs)).toBe(true)
    normalizePrefs.mockClear()
    expect(await loadGuestPrefs()).toEqual(JSON.parse(JSON.stringify(expected)))
    expect(normalizePrefs).not.toHaveBeenCalled()
  })

  it('reads a plan from a newer version of Solara through the schema and never rewrites it', async () => {
    const newer = JSON.stringify({ prefs: { ...defaultPrefs(LA), schemaVersion: 99, future: 1 } })
    storage.set(GUEST_KEY, newer)
    expect(await loadGuestPrefs()).toMatchObject({ schemaVersion: 99 })
    expect(normalizePrefs).toHaveBeenCalledOnce()
    expect(storage.get(GUEST_KEY)).toBe(newer)
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

describe('requestPersistentStorage (REVIEW10 VERIFY10 N4)', () => {
  const chrome = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/141.0 Safari/537.36'
  const storage = (persisted: boolean, granted: boolean) => ({
    persisted: vi.fn(async () => persisted),
    persist: vi.fn(async () => granted),
  })

  it('asks a browser that decides on its own, once storage is not yet persistent', async () => {
    const s = storage(false, true)
    expect(await requestPersistentStorage({ storage: s, userAgent: chrome } as never)).toBe(true)
    expect(s.persist).toHaveBeenCalledOnce()
  })

  it('does not ask again when storage is already persistent', async () => {
    const s = storage(true, true)
    expect(await requestPersistentStorage({ storage: s, userAgent: chrome } as never)).toBe(true)
    expect(s.persist).not.toHaveBeenCalled()
  })

  it('never asks Firefox, which would prompt, nor a browser without the API', async () => {
    const s = storage(false, true)
    const firefox = 'Mozilla/5.0 (X11; Linux x86_64; rv:144.0) Gecko/20100101 Firefox/144.0'
    expect(await requestPersistentStorage({ storage: s, userAgent: firefox } as never)).toBe(false)
    expect(s.persist).not.toHaveBeenCalled()
    expect(await requestPersistentStorage({ userAgent: chrome } as never)).toBe(false)
  })

  it('reads a refusal or an error as not persistent', async () => {
    const failing = {
      persisted: async () => false,
      persist: async () => Promise.reject(new Error('no')),
    }
    expect(await requestPersistentStorage({ storage: failing, userAgent: chrome } as never)).toBe(
      false,
    )
  })
})
