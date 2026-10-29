import { afterEach, describe, expect, it, vi } from 'vitest'
import { REAPPLY_STORAGE_KEY, loadTimer, saveTimer, startTimer } from './reapply'

const START = Date.parse('2026-06-15T17:00:00Z')
const MINUTE = 60_000

describe('the reapply timer in this browser', () => {
  const store = new Map<string, string>()
  afterEach(() => {
    store.clear()
    vi.unstubAllGlobals()
  })

  it('saves, loads and clears it', () => {
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    })
    const timer = startTimer(START)
    saveTimer(timer)
    expect(store.has(REAPPLY_STORAGE_KEY)).toBe(true)
    expect(loadTimer(START + MINUTE)).toEqual(timer)
    saveTimer(null)
    expect(loadTimer(START + MINUTE)).toBeNull()
  })

  it('keeps working when storage is unavailable', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
      removeItem: () => {
        throw new Error('denied')
      },
    })
    expect(() => saveTimer(startTimer(START))).not.toThrow()
    expect(loadTimer(START)).toBeNull()
  })
})
