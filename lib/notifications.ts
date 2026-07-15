import { getToken as getAppCheckToken } from 'firebase/app-check'
import { deleteToken, getMessaging, getToken, onMessage, Messaging } from 'firebase/messaging'
import { app, appCheck, auth } from './firebase'

interface LocalDeviceSubscription {
  deviceId: string
  token: string
  pendingRemoval?: boolean
}

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
      ? { deviceId: parsed.deviceId, token: parsed.token, pendingRemoval: parsed.pendingRemoval === true }
      : null
  } catch {
    return null
  }
}

function writeLocalSubscription(uid: string, subscription: LocalDeviceSubscription): void {
  localStorage.setItem(storageKey(uid), JSON.stringify(subscription))
}

function functionsUrl(): string | null {
  return process.env.NEXT_PUBLIC_FUNCTIONS_URL?.replace(/\/$/, '') || null
}

export function notificationRegistrationConfigured(): boolean {
  return !!(
    functionsUrl()
    && process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY
    && process.env.NEXT_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY
  )
}

async function mutateRemoteDevice(
  uid: string,
  path: 'registerNotificationDevice' | 'removeNotificationDevice',
  method: 'POST' | 'DELETE',
  body: Record<string, string>,
): Promise<void> {
  const baseUrl = functionsUrl()
  const user = auth?.currentUser
  if (!baseUrl) throw new Error('Notification registration is not configured')
  if (!user || user.uid !== uid) throw new Error('Sign in again to manage notifications')

  const token = await user.getIdToken()
  const appCheckToken = appCheck ? await getAppCheckToken(appCheck) : null
  const response = await fetch(`${baseUrl}/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(appCheckToken ? { 'X-Firebase-AppCheck': appCheckToken.token } : {}),
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const result = await response.json().catch(() => null) as { error?: string } | null
    throw new Error(result?.error || 'Could not update notification registration')
  }
}

export async function requestNotificationPermission(): Promise<string | null> {
  try {
    const vapidKey = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY
    if (!vapidKey || !appCheck) return null
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
  return typeof Notification !== 'undefined'
    && Notification.permission === 'granted'
    && !!subscription
    && subscription.pendingRemoval !== true
}

export async function enableNotifications(uid: string): Promise<void> {
  if (!notificationRegistrationConfigured()) throw new Error('Notification registration is not configured')
  const token = await requestNotificationPermission()
  if (!token) throw new Error('Notification permission was not granted')

  const existing = readLocalSubscription(uid)
  const deviceId = existing?.deviceId || randomDeviceId()
  try {
    await mutateRemoteDevice(uid, 'registerNotificationDevice', 'POST', {
      deviceId,
      token,
      platform: 'web',
    })
  } catch (error) {
    if (!existing) {
      const m = getMessagingInstance()
      if (m) await deleteToken(m).catch(() => false)
    }
    throw error
  }
  writeLocalSubscription(uid, { deviceId, token })
  try { localStorage.removeItem('solara_fcm_token') } catch {}
}

export async function migrateLegacyNotificationToken(uid: string): Promise<boolean> {
  if (!notificationRegistrationConfigured()) return false
  const existing = readLocalSubscription(uid)
  if (existing?.pendingRemoval) {
    await disableNotifications(uid)
    return false
  }
  if (existing) return false
  let token: string | null = null
  try { token = localStorage.getItem('solara_fcm_token') } catch {}
  if (!token || Notification.permission !== 'granted') return false

  const deviceId = randomDeviceId()
  await mutateRemoteDevice(uid, 'registerNotificationDevice', 'POST', {
    deviceId,
    token,
    platform: 'web',
  })
  writeLocalSubscription(uid, { deviceId, token })
  try { localStorage.removeItem('solara_fcm_token') } catch {}
  return true
}

export async function disableNotifications(uid: string): Promise<void> {
  const local = readLocalSubscription(uid)
  let removalError: unknown
  if (local) {
    writeLocalSubscription(uid, { ...local, pendingRemoval: true })
    try {
      await mutateRemoteDevice(
        uid,
        'removeNotificationDevice',
        'DELETE',
        { deviceId: local.deviceId },
      )
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
  return m ? onMessage(m, payload => {
    const data = payload.data
    if (data?.title && data.body && data.deliveryKey && data.deliveryScope && 'serviceWorker' in navigator) {
      void (async () => {
        const cache = await caches.open('solara-notification-deliveries-v1')
        const scopedKey = `${data.deliveryScope}:${data.deliveryKey}`
        const marker = new Request(`/notification-delivery/${encodeURIComponent(scopedKey)}`)
        if (await cache.match(marker)) return
        await cache.put(marker, new Response('shown'))
        try {
          const registration = await navigator.serviceWorker.ready
          await registration.showNotification(data.title, {
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
  }) : () => {}
}
