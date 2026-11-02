import { afterEach, describe, expect, it, vi } from 'vitest'
import type * as PrefsModule from '@/lib/prefs'

// lib/cached-account.ts: the account shown before Auth confirms the session. It must
// only ever be the session's own account (FE-3 account isolation).

const session = vi.hoisted(() => ({ user: null as null | { uid: string } }))
// Counts reads through the preferences schema (ROADMAP item 52).
const schema = vi.hoisted(() => ({ reads: 0 }))
vi.mock('@/lib/prefs', async importOriginal => {
  const actual = await importOriginal<typeof PrefsModule>()
  return {
    ...actual,
    loadLocalPrefs: () => {
      schema.reads++
      return actual.loadLocalPrefs()
    },
  }
})

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
  copy,
}: {
  owner?: string
  prefsUid?: string
  sessionUid?: string
  /** The stored copy itself, in place of a minimal one for `prefsUid`. */
  copy?: unknown
}) {
  vi.resetModules()
  vi.stubGlobal('window', {})
  const values: Record<string, string> = {}
  if (owner) values.solara_account_owner = owner
  if (prefsUid !== undefined) {
    values.solara_prefs = JSON.stringify({ uid: prefsUid, location: LOCATION, tier: 'paid' })
  }
  if (copy !== undefined) values.solara_prefs = JSON.stringify(copy)
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

  it('reads a copy in the form the app writes without the preferences schema', async () => {
    const { defaultPrefs } = await import('@/lib/local-prefs')
    const copy = { ...defaultPrefs(LOCATION), uid: 'alice', tier: 'paid' }
    schema.reads = 0
    const cached = await cachedWith({ owner: 'alice', sessionUid: 'alice', copy })
    expect(cached?.prefs).toEqual(copy)
    expect(schema.reads).toBe(0)
  })

  it('repairs any other copy through the schema, as before', async () => {
    schema.reads = 0
    const cached = await cachedWith({
      owner: 'alice',
      sessionUid: 'alice',
      copy: { uid: 'alice', location: { ...LOCATION, lat: 34.0512 }, tier: 'paid', skinType: 9 },
    })
    expect(schema.reads).toBe(1)
    expect(cached?.prefs).toMatchObject({ location: { lat: 34.05 }, skinType: 'fair' })
    expect(
      await cachedWith({
        owner: 'alice',
        sessionUid: 'alice',
        copy: { uid: 'alice', location: 1 },
      }),
    ).toBeNull()
  })
})
