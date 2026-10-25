import { describe, expect, it } from 'vitest'
import { TIPS, TIP_STORAGE_KEY, hideTips, takeTip } from './tips'

function memoryStorage(): Storage {
  const data = new Map<string, string>()
  return {
    get length() {
      return data.size
    },
    clear: () => data.clear(),
    getItem: key => data.get(key) ?? null,
    key: i => [...data.keys()][i] ?? null,
    removeItem: key => void data.delete(key),
    setItem: (key, value) => void data.set(key, value),
  }
}

describe('takeTip', () => {
  it('shows a different tip each visit and wraps around', () => {
    const storage = memoryStorage()
    const seen = TIPS.map(() => takeTip(storage)?.title)
    expect(new Set(seen).size).toBe(TIPS.length)
    expect(takeTip(storage)).toBe(TIPS[0])
  })

  it('stays hidden once dismissed', () => {
    const storage = memoryStorage()
    takeTip(storage)
    hideTips(storage)
    expect(takeTip(storage)).toBeNull()
  })

  it('starts over on unreadable or out-of-range storage', () => {
    const storage = memoryStorage()
    storage.setItem(TIP_STORAGE_KEY, 'not json')
    expect(takeTip(storage)).toBe(TIPS[0])
    storage.setItem(TIP_STORAGE_KEY, JSON.stringify({ next: TIPS.length + 1 }))
    expect(takeTip(storage)).toBe(TIPS[1])
  })
})
