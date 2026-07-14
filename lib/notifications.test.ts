import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  setDoc: vi.fn(),
  getToken: vi.fn(),
  deleteToken: vi.fn(),
  doc: vi.fn((...parts: unknown[]) => ({ path: parts.slice(1).join('/') })),
}))

vi.mock('firebase/messaging', () => ({
  getMessaging: vi.fn(() => ({ kind: 'messaging' })),
  getToken: mocks.getToken,
  deleteToken: mocks.deleteToken,
  onMessage: vi.fn(() => () => {}),
}))

vi.mock('firebase/firestore', () => ({
  doc: mocks.doc,
  setDoc: mocks.setDoc,
  serverTimestamp: vi.fn(() => 'server-time'),
}))

vi.mock('@/lib/firebase', () => ({
  app: { kind: 'app' },
  db: { kind: 'db' },
}))

import {
  disableNotifications,
  enableNotifications,
  migrateLegacyNotificationToken,
  notificationsEnabledLocally,
} from '@/lib/notifications'

const values = new Map<string, string>()
const localStorageMock = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => values.set(key, value),
  removeItem: (key: string) => values.delete(key),
}

describe('device notification subscriptions', () => {
  beforeEach(() => {
    values.clear()
    vi.clearAllMocks()
    mocks.getToken.mockResolvedValue('new-fcm-token')
    mocks.deleteToken.mockResolvedValue(true)
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: localStorageMock })
    Object.defineProperty(globalThis, 'window', { configurable: true, value: {} })
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent: 'test-browser' } })
    Object.defineProperty(globalThis, 'Notification', {
      configurable: true,
      value: { permission: 'granted', requestPermission: vi.fn().mockResolvedValue('granted') },
    })
  })

  it('registers an account-scoped device and reports it enabled locally', async () => {
    await enableNotifications('user-1')

    expect(mocks.setDoc).toHaveBeenCalledWith(
      expect.objectContaining({ path: expect.stringMatching(/^users\/user-1\/notificationDevices\//) }),
      expect.objectContaining({ token: 'new-fcm-token', enabled: true, platform: 'web' }),
      { merge: true },
    )
    expect(notificationsEnabledLocally('user-1')).toBe(true)
    expect(notificationsEnabledLocally('user-2')).toBe(false)
  })

  it('deactivates the current device and removes its token during sign-out', async () => {
    await enableNotifications('user-1')
    mocks.setDoc.mockClear()

    await disableNotifications('user-1')

    expect(mocks.setDoc).toHaveBeenCalledWith(
      expect.objectContaining({ path: expect.stringMatching(/^users\/user-1\/notificationDevices\//) }),
      expect.objectContaining({ enabled: false }),
      { merge: true },
    )
    expect(mocks.deleteToken).toHaveBeenCalledOnce()
    expect(notificationsEnabledLocally('user-1')).toBe(false)
  })

  it('removes the local token even when remote deactivation fails', async () => {
    await enableNotifications('user-1')
    mocks.setDoc.mockRejectedValueOnce(new Error('offline'))

    await expect(disableNotifications('user-1')).rejects.toThrow('offline')

    expect(mocks.deleteToken).toHaveBeenCalledOnce()
    expect(notificationsEnabledLocally('user-1')).toBe(false)
  })

  it('migrates the legacy token once without requesting another permission', async () => {
    values.set('solara_fcm_token', 'legacy-token')

    await expect(migrateLegacyNotificationToken('user-1')).resolves.toBe(true)
    await expect(migrateLegacyNotificationToken('user-1')).resolves.toBe(false)
    expect(mocks.setDoc).toHaveBeenCalledTimes(1)
    expect(mocks.setDoc.mock.calls[0][1]).toEqual(expect.objectContaining({ token: 'legacy-token', enabled: true }))
    expect(values.has('solara_fcm_token')).toBe(false)
  })
})
