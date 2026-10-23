import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getDoc, updateDoc, runTransaction, txSet } = vi.hoisted(() => ({
  getDoc: vi.fn(),
  updateDoc: vi.fn(),
  runTransaction: vi.fn(),
  txSet: vi.fn(),
}))

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(() => ({ path: 'users/test-user' })),
  getDoc,
  updateDoc,
  runTransaction,
}))

vi.mock('@/lib/firebase', () => ({ db: { kind: 'test-db' } }))

import { FirebaseError } from 'firebase/app'
import {
  defaultPrefs,
  loadFirestorePrefs,
  loadLocalPrefs,
  NewerPreferencesVersionError,
  PREFS_SCHEMA_VERSION,
  saveFirestorePrefs,
  saveLocalPrefs,
} from '@/lib/prefs'
import type { UserPreferences } from '@/lib/types'

const savedPrefs = {
  uid: 'test-user',
  location: { lat: 34.05, lon: -118.24, city: 'Los Angeles', region: 'CA' },
  skinType: 'fair',
  sunscreen: false,
  activities: [],
  tier: 'free',
  onboardingComplete: true,
}

describe('loadFirestorePrefs', () => {
  beforeEach(() => getDoc.mockReset())

  it('distinguishes a missing document from a failed read', async () => {
    getDoc.mockResolvedValueOnce({ exists: () => false })
    await expect(loadFirestorePrefs('test-user')).resolves.toEqual({ status: 'missing' })

    getDoc.mockRejectedValueOnce(new Error('offline'))
    const failed = await loadFirestorePrefs('test-user')
    expect(failed.status).toBe('error')
    if (failed.status === 'error') expect(failed.error.message).toBe('offline')
  })

  it('returns normalized preferences for an existing document', async () => {
    getDoc.mockResolvedValueOnce({ exists: () => true, data: () => savedPrefs })
    const result = await loadFirestorePrefs('test-user')
    expect(result.status).toBe('found')
    if (result.status === 'found') {
      expect(result.prefs.uid).toBe('test-user')
      expect(result.prefs.schemaVersion).toBe(2)
    }
  })

  it('reports malformed saved preferences instead of treating them as new', async () => {
    getDoc.mockResolvedValueOnce({ exists: () => true, data: () => ({ uid: 'test-user' }) })
    const result = await loadFirestorePrefs('test-user')
    expect(result.status).toBe('error')
  })
})

describe('saveFirestorePrefs', () => {
  const LA = { lat: 34.05, lon: -118.24, city: 'Los Angeles', region: 'CA' }
  const prefs: UserPreferences = {
    ...defaultPrefs(LA),
    uid: 'test-user',
    tier: 'free',
    onboardingComplete: true,
    profiles: [{ id: 'me', name: 'Me', skinType: 'fair', icon: '🧑' }],
    activeProfileId: 'me',
  }

  beforeEach(() => {
    getDoc.mockReset()
    updateDoc.mockReset()
    runTransaction.mockReset()
    txSet.mockReset()
    runTransaction.mockImplementation(
      async (_db: unknown, fn: (tx: { get: () => unknown; set: typeof txSet }) => unknown) =>
        fn({ get: () => getDoc(), set: txSet }),
    )
  })

  it('updates the client-owned fields in one write without reading first', async () => {
    updateDoc.mockResolvedValueOnce(undefined)
    await saveFirestorePrefs('test-user', { ...prefs, skinType: 'olive' })
    expect(getDoc).not.toHaveBeenCalled()
    expect(updateDoc).toHaveBeenCalledTimes(1)
    const update = updateDoc.mock.calls[0]?.[1] as Record<string, unknown>
    expect(update.skinType).toBe('olive')
    expect(update.schemaVersion).toBe(PREFS_SCHEMA_VERSION)
    // The server owns uid and tier once the account exists: a stale tier held in memory
    // must not be written (the rules would reject the whole save).
    expect(update).not.toHaveProperty('uid')
    expect(update).not.toHaveProperty('tier')
  })

  it('persists removing the last profile', async () => {
    updateDoc.mockResolvedValueOnce(undefined)
    await saveFirestorePrefs('test-user', {
      ...prefs,
      profiles: undefined,
      activeProfileId: undefined,
    })
    const update = updateDoc.mock.calls[0]?.[1] as Record<string, unknown>
    expect(update.profiles).toEqual([])
  })

  it('creates a missing account from onboarding answers only', async () => {
    updateDoc.mockRejectedValueOnce(new FirebaseError('permission-denied', 'denied'))
    getDoc.mockResolvedValue({ exists: () => false })
    await saveFirestorePrefs('test-user', {
      ...prefs,
      tier: 'paid',
      activities: [
        { id: 'run', name: 'Run', icon: '🏃', durationMins: 30, maxUV: 4, sunscreen: false },
      ],
    })
    expect(txSet).toHaveBeenCalledTimes(1)
    const created = txSet.mock.calls[0]?.[1] as UserPreferences
    expect(created.uid).toBe('test-user')
    expect(created.tier).toBe('free')
    expect(created.activities).toEqual([])
  })

  it('reports a denied update of an existing document', async () => {
    const denied = new FirebaseError('permission-denied', 'denied')
    updateDoc.mockRejectedValueOnce(denied)
    getDoc.mockResolvedValue({ exists: () => true, data: () => savedPrefs })
    await expect(saveFirestorePrefs('test-user', prefs)).rejects.toBe(denied)
    expect(txSet).not.toHaveBeenCalled()
  })

  it('refuses to write preferences read from a newer schema version', async () => {
    await expect(
      saveFirestorePrefs('test-user', { ...prefs, schemaVersion: PREFS_SCHEMA_VERSION + 1 }),
    ).rejects.toBeInstanceOf(NewerPreferencesVersionError)
    expect(updateDoc).not.toHaveBeenCalled()
  })
})

describe('local preferences and newer schema versions', () => {
  const store = new Map<string, string>()
  beforeEach(() => {
    store.clear()
    vi.stubGlobal('window', {})
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    })
  })

  it('never overwrites a copy written by a newer client', () => {
    const newer = JSON.stringify({ ...savedPrefs, schemaVersion: PREFS_SCHEMA_VERSION + 1, x: 1 })
    store.set('solara_prefs', newer)
    const loaded = loadLocalPrefs()
    expect(loaded?.schemaVersion).toBe(PREFS_SCHEMA_VERSION + 1)
    expect(store.get('solara_prefs')).toBe(newer)
    saveLocalPrefs({ ...loaded!, skinType: 'olive' })
    expect(store.get('solara_prefs')).toBe(newer)
  })

  it('rewrites an older copy in the current shape', () => {
    store.set('solara_prefs', JSON.stringify({ ...savedPrefs, schemaVersion: undefined }))
    loadLocalPrefs()
    expect(JSON.parse(store.get('solara_prefs')!).schemaVersion).toBe(PREFS_SCHEMA_VERSION)
  })
})
