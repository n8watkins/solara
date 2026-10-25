import { afterEach, describe, expect, it, vi } from 'vitest'

// lib/cached-account.ts: the account shown before Auth confirms the session. It must
// only ever be the session's own account (FE-3 account isolation).

const session = vi.hoisted(() => ({ user: null as null | { uid: string } }))

vi.mock('@/lib/firebase', () => ({
  storedSessionUser: async () =>
    session.user && { ...session.user, displayName: 'Alice', email: null, photoURL: null },
  loadFirebase: async () => null,
}))

const LOCATION = { lat: 34.05, lon: -118.24, city: 'Los Angeles', region: 'California' }

function memoryStorage(values: Record<string, string>) {
  const map = new Map(Object.entries(values))
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  }
}

async function cachedWith({
  owner,
  prefsUid,
  sessionUid,
}: {
  owner?: string
  prefsUid?: string
  sessionUid?: string
}) {
  vi.resetModules()
  vi.stubGlobal('window', {})
  const values: Record<string, string> = {}
  if (owner) values.solara_account_owner = owner
  if (prefsUid !== undefined) {
    values.solara_prefs = JSON.stringify({ uid: prefsUid, location: LOCATION, tier: 'paid' })
  }
  vi.stubGlobal('localStorage', memoryStorage(values))
  session.user = sessionUid ? { uid: sessionUid } : null
  const { cachedAccount } = await import('@/lib/cached-account')
  return cachedAccount()
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('cachedAccount', () => {
  it('is the account when the marker, the session and the copy agree', async () => {
    const cached = await cachedWith({ owner: 'alice', prefsUid: 'alice', sessionUid: 'alice' })
    expect(cached?.identity).toMatchObject({ uid: 'alice', displayName: 'Alice' })
    expect(cached?.prefs).toMatchObject({ uid: 'alice', tier: 'paid', location: LOCATION })
  })

  it('is null when the session has ended or belongs to another account', async () => {
    expect(await cachedWith({ owner: 'alice', prefsUid: 'alice' })).toBeNull()
    expect(await cachedWith({ owner: 'alice', prefsUid: 'alice', sessionUid: 'bob' })).toBeNull()
  })

  it("is null when the copy is another account's or has no owner", async () => {
    expect(await cachedWith({ owner: 'alice', prefsUid: 'bob', sessionUid: 'alice' })).toBeNull()
    expect(await cachedWith({ owner: 'alice', prefsUid: '', sessionUid: 'alice' })).toBeNull()
    expect(await cachedWith({ owner: 'alice', sessionUid: 'alice' })).toBeNull()
  })

  it('is null without the account marker', async () => {
    expect(await cachedWith({ prefsUid: 'alice', sessionUid: 'alice' })).toBeNull()
  })
})
