import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getAppCheckToken: vi.fn(),
  getToken: vi.fn(),
  deleteToken: vi.fn(),
  getIdToken: vi.fn(),
}))

vi.mock('firebase/app-check', () => ({
  getToken: mocks.getAppCheckToken,
}))

vi.mock('firebase/messaging', () => ({
  getMessaging: vi.fn(() => ({ kind: 'messaging' })),
  getToken: mocks.getToken,
  deleteToken: mocks.deleteToken,
  onMessage: vi.fn(() => () => {}),
}))

vi.mock('@/lib/firebase', () => ({
  app: { kind: 'app' },
  appCheck: { kind: 'app-check' },
  auth: { currentUser: { uid: 'user-1', getIdToken: mocks.getIdToken } },
}))

import {
  clearLocalNotificationState,
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
    vi.stubEnv('NEXT_PUBLIC_FUNCTIONS_URL', 'https://functions.example.test')
    vi.stubEnv('NEXT_PUBLIC_FIREBASE_VAPID_KEY', 'test-vapid-key')
    vi.stubEnv('NEXT_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY', 'test-app-check-key')
    mocks.getToken.mockResolvedValue('new-fcm-token-that-is-long-enough')
    mocks.getAppCheckToken.mockResolvedValue({ token: 'firebase-app-check-token' })
    mocks.deleteToken.mockResolvedValue(true)
    mocks.getIdToken.mockResolvedValue('firebase-id-token')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: vi.fn() }))
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

    expect(fetch).toHaveBeenCalledWith(
      'https://functions.example.test/registerNotificationDevice',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer firebase-id-token',
          'X-Firebase-AppCheck': 'firebase-app-check-token',
        }),
      }),
    )
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string)).toEqual(expect.objectContaining({
      token: 'new-fcm-token-that-is-long-enough',
      platform: 'web',
    }))
    expect(notificationsEnabledLocally('user-1')).toBe(true)
    expect(notificationsEnabledLocally('user-2')).toBe(false)
  })

  it('deactivates the current device and removes its token during sign-out', async () => {
    await enableNotifications('user-1')
    vi.mocked(fetch).mockClear()

    await disableNotifications('user-1')

    expect(fetch).toHaveBeenCalledWith(
      'https://functions.example.test/removeNotificationDevice',
      expect.objectContaining({ method: 'DELETE' }),
    )
    expect(mocks.deleteToken).toHaveBeenCalledOnce()
    expect(notificationsEnabledLocally('user-1')).toBe(false)
  })

  it('clears account-scoped and legacy local state after server-side account deletion', async () => {
    await enableNotifications('user-1')
    values.set('solara_fcm_token', 'legacy-token')

    await clearLocalNotificationState('user-1')

    expect(mocks.deleteToken).toHaveBeenCalledOnce()
    expect(values.has('solara_notification_device_user-1')).toBe(false)
    expect(values.has('solara_fcm_token')).toBe(false)
  })

  it('preserves a pending removal and retries it after remote deactivation fails', async () => {
    await enableNotifications('user-1')
    vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'))

    await expect(disableNotifications('user-1')).resolves.toBeUndefined()

    expect(mocks.deleteToken).toHaveBeenCalledOnce()
    expect(notificationsEnabledLocally('user-1')).toBe(false)

    await expect(migrateLegacyNotificationToken('user-1')).resolves.toBe(false)
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(mocks.deleteToken).toHaveBeenCalledTimes(2)
    expect(values.has('solara_notification_device_user-1')).toBe(false)
  })

  it('blocks cleanup when neither remote nor local token removal succeeds', async () => {
    await enableNotifications('user-1')
    vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'))
    mocks.deleteToken.mockResolvedValueOnce(false)

    await expect(disableNotifications('user-1')).rejects.toThrow('offline')

    expect(notificationsEnabledLocally('user-1')).toBe(false)
    expect(values.has('solara_notification_device_user-1')).toBe(true)
  })

  it('migrates the legacy token once without requesting another permission', async () => {
    values.set('solara_fcm_token', 'legacy-token')

    await expect(migrateLegacyNotificationToken('user-1')).resolves.toBe(true)
    await expect(migrateLegacyNotificationToken('user-1')).resolves.toBe(false)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string)).toEqual(expect.objectContaining({ token: 'legacy-token' }))
    expect(values.has('solara_fcm_token')).toBe(false)
  })

  it('does not request browser permission when the server endpoint is unavailable', async () => {
    vi.stubEnv('NEXT_PUBLIC_FUNCTIONS_URL', '')

    await expect(enableNotifications('user-1')).rejects.toThrow('not configured')

    expect(Notification.requestPermission).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([
    ['NEXT_PUBLIC_FIREBASE_VAPID_KEY'],
    ['NEXT_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY'],
  ])('does not request browser permission when %s is unavailable', async variable => {
    vi.stubEnv(variable, '')

    await expect(enableNotifications('user-1')).rejects.toThrow('not configured')

    expect(Notification.requestPermission).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })
})
