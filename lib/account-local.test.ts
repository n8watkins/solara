import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  clearLocalNotificationState: vi.fn(async (_uid: string) => undefined),
}))

vi.mock('./notifications', () => ({
  clearLocalNotificationState: mocks.clearLocalNotificationState,
}))

const { clearDeletedAccount, DELIVERY_CACHE, DEVICE_STORAGE_KEYS } = await import('./account-local')

describe('clearDeletedAccount', () => {
  const store = new Map<string, string>()
  const deleted: string[] = []

  beforeEach(() => {
    store.clear()
    deleted.length = 0
    mocks.clearLocalNotificationState.mockClear()
    const backing = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    }
    // Object.keys(localStorage) lists the entries, as in a browser.
    vi.stubGlobal(
      'localStorage',
      new Proxy(backing, {
        ownKeys: () => [...store.keys()],
        getOwnPropertyDescriptor: (_target, key) =>
          store.has(String(key))
            ? { enumerable: true, configurable: true, value: store.get(String(key)) }
            : undefined,
      }),
    )
    vi.stubGlobal('caches', { delete: async (name: string) => deleted.push(name) > 0 })
  })

  afterEach(() => vi.unstubAllGlobals())

  it('keeps only this browser’s own settings', async () => {
    for (const key of [
      'solara_prefs',
      'solara_forecast',
      'solara_account_owner',
      'solara_guest',
      'solara_guest_replaced',
      'solara_upsells_dismissed',
      'solara_reapply',
      'solara_notification_device_u1',
      'solara_fcm_token',
      'solara_theme',
      'solara_install_dismissed',
      'other_site_key',
    ]) {
      store.set(key, '1')
    }
    await clearDeletedAccount('u1')
    expect([...store.keys()].sort()).toEqual([...DEVICE_STORAGE_KEYS, 'other_site_key'].sort())
    expect(mocks.clearLocalNotificationState).toHaveBeenCalledWith('u1')
    expect(deleted).toEqual([DELIVERY_CACHE])
  })

  it('never throws, because the account is already gone', async () => {
    mocks.clearLocalNotificationState.mockRejectedValueOnce(new Error('messaging'))
    vi.stubGlobal('caches', {
      delete: async () => {
        throw new Error('blocked')
      },
    })
    await expect(clearDeletedAccount('u1')).resolves.toBeUndefined()
  })
})
