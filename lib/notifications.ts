import type { FunctionResponse } from '@solara/core'
import type { Messaging } from 'firebase/messaging'
import { deleteToken, getMessaging, getToken, onMessage } from 'firebase/messaging'
import { app, appCheckConfigured, auth } from './firebase'
import { callFunction, functionsApiConfigured } from './functions-api'

interface LocalDeviceSubscription {
  deviceId: string
  token: string
  migrationPending?: boolean
  pendingRemoval?: boolean
}

const REGISTRATION_MIGRATION_ATTEMPTS = 3

let messaging: Messaging | null = null

function getMessagingInstance(): Messaging | null {
  if (typeof window === 'undefined' || !app) return null
  if (!messaging) {
    try {
      messaging = getMessaging(app)
    } catch {
      return null
    }
  }
  return messaging
}

function storageKey(uid: string): string {
  return `solara_notification_device_${uid}`
}

function randomDeviceId(): string {
  const bytes = new Uint8Array(18)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

function readLocalSubscription(uid: string): LocalDeviceSubscription | null {
  try {
    const raw = localStorage.getItem(storageKey(uid))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<LocalDeviceSubscription>
    return typeof parsed.deviceId === 'string' && typeof parsed.token === 'string'
      ? {
          deviceId: parsed.deviceId,
          token: parsed.token,
          migrationPending: parsed.migrationPending === true,
          pendingRemoval: parsed.pendingRemoval === true,
        }
      : null
  } catch {
    return null
  }
}

function writeLocalSubscription(uid: string, subscription: LocalDeviceSubscription): void {
  localStorage.setItem(storageKey(uid), JSON.stringify(subscription))
}

export function notificationRegistrationConfigured(): boolean {
  return functionsApiConfigured() && !!process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY
}

async function mutateRemoteDevice<
  Name extends 'registerNotificationDevice' | 'removeNotificationDevice',
>(
  uid: string,
  path: Name,
  method: 'POST' | 'DELETE',
  body: Record<string, string>,
): Promise<FunctionResponse<Name>> {
  const user = auth?.currentUser
  if (!functionsApiConfigured()) throw new Error('Notification registration is not configured')
  if (!user || user.uid !== uid) throw new Error('Sign in again to manage notifications')

  return callFunction(user, path, {
    method,
    body,
    fallbackMessage: 'Could not update notification registration',
  })
}

async function completeRemoteRegistration(
  uid: string,
  subscription: LocalDeviceSubscription,
): Promise<boolean> {
  writeLocalSubscription(uid, { ...subscription, migrationPending: true })
  for (let attempt = 0; attempt < REGISTRATION_MIGRATION_ATTEMPTS; attempt++) {
    const result = await mutateRemoteDevice(uid, 'registerNotificationDevice', 'POST', {
      deviceId: subscription.deviceId,
      token: subscription.token,
      platform: 'web',
    })
    if (result.migrationPending !== true) return true
    writeLocalSubscription(uid, { ...subscription, migrationPending: true })
  }
  return false
}

export async function requestNotificationPermission(): Promise<string | null> {
  try {
    const vapidKey = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY
    if (!vapidKey || !appCheckConfigured()) return null
    const m = getMessagingInstance()
    if (!m) return null
    const permission = await Notification.requestPermission()
    if (permission !== 'granted') return null
    const token = await getToken(m, { vapidKey })
    return token || null
  } catch (err) {
    console.error('FCM token error:', err)
    return null
  }
}

export function notificationsEnabledLocally(uid: string): boolean {
  const subscription = readLocalSubscription(uid)
  return (
    typeof Notification !== 'undefined' &&
    Notification.permission === 'granted' &&
    !!subscription &&
    subscription.migrationPending !== true &&
    subscription.pendingRemoval !== true
  )
}

export async function enableNotifications(uid: string): Promise<void> {
  if (!notificationRegistrationConfigured())
    throw new Error('Notification registration is not configured')
  const token = await requestNotificationPermission()
  if (!token) throw new Error('Notification permission was not granted')

  const existing = readLocalSubscription(uid)
  const deviceId = existing?.deviceId || randomDeviceId()
  const subscription = { deviceId, token }
  const completed = await completeRemoteRegistration(uid, subscription)
  if (!completed) throw new Error('Notification setup is still being finalized. Try again shortly.')
  writeLocalSubscription(uid, subscription)
  try {
    localStorage.removeItem('solara_fcm_token')
  } catch {}
}

export async function migrateLegacyNotificationToken(uid: string): Promise<boolean> {
  if (!notificationRegistrationConfigured()) return false
  const existing = readLocalSubscription(uid)
  if (existing?.pendingRemoval) {
    await disableNotifications(uid)
    return false
  }
  if (existing?.migrationPending) {
    const completed = await completeRemoteRegistration(uid, existing)
    if (!completed)
      throw new Error('Notification setup is still being finalized. Try again shortly.')
    writeLocalSubscription(uid, { deviceId: existing.deviceId, token: existing.token })
    return true
  }
  if (existing) return false
  let token: string | null = null
  try {
    token = localStorage.getItem('solara_fcm_token')
  } catch {}
  if (!token || Notification.permission !== 'granted') return false

  const deviceId = randomDeviceId()
  const completed = await completeRemoteRegistration(uid, { deviceId, token })
  if (!completed) throw new Error('Notification setup is still being finalized. Try again shortly.')
  writeLocalSubscription(uid, { deviceId, token })
  try {
    localStorage.removeItem('solara_fcm_token')
  } catch {}
  return true
}

export async function disableNotifications(uid: string): Promise<void> {
  const local = readLocalSubscription(uid)
  let removalError: unknown
  if (local) {
    writeLocalSubscription(uid, { ...local, pendingRemoval: true })
    try {
      await mutateRemoteDevice(uid, 'removeNotificationDevice', 'DELETE', {
        deviceId: local.deviceId,
      })
    } catch (error) {
      removalError = error
    }
  }
  const m = getMessagingInstance()
  const tokenRemoved = m ? await deleteToken(m).catch(() => false) : !local
  try {
    if (!removalError) localStorage.removeItem(storageKey(uid))
    localStorage.removeItem('solara_fcm_token')
  } catch {}
  if (removalError && !tokenRemoved) throw removalError
}

export async function clearLocalNotificationState(uid: string): Promise<void> {
  const m = getMessagingInstance()
  if (m) await deleteToken(m).catch(() => false)
  try {
    localStorage.removeItem(storageKey(uid))
    localStorage.removeItem('solara_fcm_token')
  } catch {}
}

export function onForegroundMessage(callback: (payload: unknown) => void): () => void {
  const m = getMessagingInstance()
  return m
    ? onMessage(m, payload => {
        const data = payload.data
        const title = data?.title
        if (
          data &&
          title &&
          data.body &&
          data.deliveryKey &&
          data.deliveryScope &&
          'serviceWorker' in navigator
        ) {
          void (async () => {
            const cache = await caches.open('solara-notification-deliveries-v1')
            const scopedKey = `${data.deliveryScope}:${data.deliveryKey}`
            const marker = new Request(`/notification-delivery/${encodeURIComponent(scopedKey)}`)
            if (await cache.match(marker)) return
            await cache.put(marker, new Response('shown'))
            try {
              const registration = await navigator.serviceWorker.ready
              await registration.showNotification(title, {
                body: data.body,
                icon: '/icon-192.png',
                badge: '/icon-192.png',
                tag: scopedKey,
                data: { link: data.link || '/' },
              })
            } catch (error) {
              await cache.delete(marker)
              throw error
            }
          })().catch(error => console.error('Foreground notification error:', error))
        }
        callback(payload)
      })
    : () => {}
}
