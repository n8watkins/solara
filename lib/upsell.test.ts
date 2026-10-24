import { beforeEach, describe, expect, it } from 'vitest'
import { UPSELL_DISMISSED_KEY, dismissUpsell, isUpsellDismissed } from './upsell'

const storage = new Map<string, string>()

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

describe('upsell dismissal', () => {
  it('is remembered per upsell on this device', () => {
    expect(isUpsellDismissed('save-plan')).toBe(false)
    dismissUpsell('save-plan', new Date('2026-06-15T10:30:00Z'))
    expect(isUpsellDismissed('save-plan')).toBe(true)
    expect(isUpsellDismissed('morning-alert')).toBe(false)
    expect(JSON.parse(storage.get(UPSELL_DISMISSED_KEY)!)).toEqual({
      'save-plan': '2026-06-15T10:30:00.000Z',
    })
  })

  it('treats unreadable storage as nothing dismissed', () => {
    storage.set(UPSELL_DISMISSED_KEY, '[1,2]')
    expect(isUpsellDismissed('save-plan')).toBe(false)
    storage.set(UPSELL_DISMISSED_KEY, 'nope')
    expect(isUpsellDismissed('save-plan')).toBe(false)
    dismissUpsell('morning-alert')
    expect(isUpsellDismissed('morning-alert')).toBe(true)
  })
})
