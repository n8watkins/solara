import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getDoc } = vi.hoisted(() => ({ getDoc: vi.fn() }))

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(() => ({ path: 'users/test-user' })),
  getDoc,
  setDoc: vi.fn(),
  updateDoc: vi.fn(),
}))

vi.mock('@/lib/firebase', () => ({ db: { kind: 'test-db' } }))

import { loadFirestorePrefs } from '@/lib/prefs'

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
