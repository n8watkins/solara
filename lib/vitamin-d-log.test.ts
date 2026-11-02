import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const persist = vi.hoisted(() => vi.fn(async () => true))
vi.mock('./persistent-storage', () => ({ requestPersistentStorage: persist }))
import type { VitaminDEntry } from '@solara/core/vitamin-d-log'
import {
  clearVitaminDLog,
  loadVitaminDLog,
  LogStorageError,
  newEntryId,
  saveVitaminDLog,
} from './vitamin-d-log'
import {
  adoptGuestVitaminDLog,
  VITAMIN_D_LOG_KEY,
  vitaminDLogKey,
  vitaminDLogOwner,
} from './vitamin-d-owner'
import { vitaminDLogEnabled } from './vitamin-d-switch'

const TODAY = '2026-06-15'

function entry(overrides: Partial<VitaminDEntry> = {}): VitaminDEntry {
  return {
    id: 'a1',
    date: TODAY,
    start: '10:00',
    minutes: 20,
    exposure: 'arms-legs',
    sunscreen: false,
    skinType: 'fair',
    uvSource: 'forecast',
    uv: [{ minutes: 20, uv: 6 }],
    ...overrides,
  }
}

let store: Map<string, string>
let failWrites: boolean

beforeEach(() => {
  store = new Map()
  failWrites = false
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (failWrites) throw new DOMException('full', 'QuotaExceededError')
      store.set(key, value)
    },
    removeItem: (key: string) => void store.delete(key),
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('the vitamin D log in this browser', () => {
  it('saves and reads back, newest first, under its own key', () => {
    saveVitaminDLog(null, [entry({ id: 'early', start: '08:00' }), entry({ id: 'late' })], TODAY)
    expect(JSON.parse(store.get(VITAMIN_D_LOG_KEY)!)).toMatchObject({ version: 1 })
    expect(loadVitaminDLog(null, TODAY).map(e => e.id)).toEqual(['late', 'early'])
  })

  it('prunes entries more than a year old on read and on save', () => {
    store.set(
      VITAMIN_D_LOG_KEY,
      JSON.stringify({ version: 1, entries: [entry({ id: 'old', date: '2025-06-01' }), entry()] }),
    )
    expect(loadVitaminDLog(null, TODAY).map(e => e.id)).toEqual(['a1'])
    // A year later the same log is empty, and saving it removes the key.
    expect(loadVitaminDLog(null, '2027-06-16')).toEqual([])
    expect(saveVitaminDLog(null, loadVitaminDLog(null, '2027-06-16'), '2027-06-16')).toEqual([])
    expect(store.has(VITAMIN_D_LOG_KEY)).toBe(false)
  })

  it('drops a broken entry, never the whole log', () => {
    store.set(VITAMIN_D_LOG_KEY, JSON.stringify({ version: 1, entries: [{ id: 'x' }, entry()] }))
    expect(loadVitaminDLog(null, TODAY)).toEqual([entry()])
  })

  it('reads a log it cannot parse as empty', () => {
    store.set(VITAMIN_D_LOG_KEY, '{not json')
    expect(loadVitaminDLog(null, TODAY)).toEqual([])
  })

  it('says when the browser refuses to save', () => {
    failWrites = true
    expect(() => saveVitaminDLog(null, [entry()], TODAY)).toThrow(LogStorageError)
  })

  it("asks the browser to keep the site's storage on the log's first save only", () => {
    persist.mockClear()
    saveVitaminDLog(null, [], TODAY)
    expect(persist).not.toHaveBeenCalled()
    saveVitaminDLog(null, [entry()], TODAY)
    saveVitaminDLog(null, [entry(), entry({ id: 'b' })], TODAY)
    expect(persist).toHaveBeenCalledOnce()
  })

  it('clears the log', () => {
    saveVitaminDLog(null, [entry()], TODAY)
    clearVitaminDLog(null)
    expect(store.has(VITAMIN_D_LOG_KEY)).toBe(false)
  })

  it('makes ids an entry accepts, each different', () => {
    const ids = new Set(Array.from({ length: 50 }, newEntryId))
    expect(ids.size).toBe(50)
    for (const id of ids) expect(id).toMatch(/^[\w-]{1,40}$/)
  })
})

describe('one log per owner on this device', () => {
  it("keeps a guest's and each account's apart", () => {
    saveVitaminDLog(null, [entry({ id: 'guest' })], TODAY)
    saveVitaminDLog('u1', [entry({ id: 'one' })], TODAY)
    saveVitaminDLog('u2', [entry({ id: 'two' })], TODAY)
    expect(loadVitaminDLog(null, TODAY).map(e => e.id)).toEqual(['guest'])
    expect(loadVitaminDLog('u1', TODAY).map(e => e.id)).toEqual(['one'])
    expect(loadVitaminDLog('u2', TODAY).map(e => e.id)).toEqual(['two'])
    clearVitaminDLog('u1')
    expect(loadVitaminDLog('u1', TODAY)).toEqual([])
    expect(loadVitaminDLog('u2', TODAY)).toHaveLength(1)
  })

  it('names each key and its owner', () => {
    expect(vitaminDLogKey(null)).toBe(VITAMIN_D_LOG_KEY)
    expect(vitaminDLogOwner(vitaminDLogKey('u1'))).toBe('u1')
    expect(vitaminDLogOwner(VITAMIN_D_LOG_KEY)).toBeNull()
    expect(vitaminDLogOwner(`${VITAMIN_D_LOG_KEY}:`)).toBeUndefined()
    expect(vitaminDLogOwner('solara_guest')).toBeUndefined()
  })

  it("hands a guest's log to the account that signs in", () => {
    saveVitaminDLog(null, [entry({ id: 'guest', start: '09:00' })], TODAY)
    saveVitaminDLog('u1', [entry({ id: 'mine' })], TODAY)
    adoptGuestVitaminDLog('u1')
    expect(loadVitaminDLog('u1', TODAY).map(e => e.id)).toEqual(['mine', 'guest'])
    expect(store.has(VITAMIN_D_LOG_KEY)).toBe(false)
    // Nothing to hand over changes nothing.
    adoptGuestVitaminDLog('u1')
    expect(loadVitaminDLog('u1', TODAY)).toHaveLength(2)
  })
})

describe('the switch', () => {
  it('is on unless the build says 0', () => {
    vi.stubEnv('NEXT_PUBLIC_VITAMIN_D_LOG', '1')
    expect(vitaminDLogEnabled()).toBe(true)
    vi.stubEnv('NEXT_PUBLIC_VITAMIN_D_LOG', '')
    expect(vitaminDLogEnabled()).toBe(true)
    vi.stubEnv('NEXT_PUBLIC_VITAMIN_D_LOG', '0')
    expect(vitaminDLogEnabled()).toBe(false)
  })
})
