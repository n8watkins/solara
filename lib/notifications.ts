import { deleteToken, getMessaging, getToken, onMessage, Messaging } from 'firebase/messaging'
import { doc, serverTimestamp, setDoc } from 'firebase/firestore'
import { app, db } from './firebase'

const VAPID_KEY = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY

interface LocalDeviceSubscription {
  deviceId: string
  token: string
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
      ? { deviceId: parsed.deviceId, token: parsed.token }
      : null
  } catch {
    return null
  }
}

function writeLocalSubscription(uid: string, subscription: LocalDeviceSubscription): void {
  localStorage.setItem(storageKey(uid), JSON.stringify(subscription))
}

export async function requestNotificationPermission(): Promise<string | null> {
  try {
    const m = getMessagingInstance()
    if (!m) return null
    const permission = await Notification.requestPermission()
    if (permission !== 'granted') return null
    const token = await getToken(m, { vapidKey: VAPID_KEY })
    return token || null
  } catch (err) {
    console.error('FCM token error:', err)
    return null
  }
}

export function notificationsEnabledLocally(uid: string): boolean {
  return typeof Notification !== 'undefined'
    && Notification.permission === 'granted'
    && !!readLocalSubscription(uid)
}

export async function enableNotifications(uid: string): Promise<void> {
  if (!db) throw new Error('Firebase is not configured')
  const token = await requestNotificationPermission()
  if (!token) throw new Error('Notification permission was not granted')

  const existing = readLocalSubscription(uid)
  const deviceId = existing?.deviceId || randomDeviceId()
  await setDoc(doc(db, 'users', uid, 'notificationDevices', deviceId), {
    token,
    enabled: true,
    platform: 'web',
    ...(existing ? {} : { createdAt: serverTimestamp() }),
    updatedAt: serverTimestamp(),
  }, { merge: true })
  writeLocalSubscription(uid, { deviceId, token })
  try { localStorage.removeItem('solara_fcm_token') } catch {}
}

export async function migrateLegacyNotificationToken(uid: string): Promise<boolean> {
  if (!db || readLocalSubscription(uid)) return false
  let token: string | null = null
  try { token = localStorage.getItem('solara_fcm_token') } catch {}
  if (!token || Notification.permission !== 'granted') return false

  const deviceId = randomDeviceId()
  await setDoc(doc(db, 'users', uid, 'notificationDevices', deviceId), {
    token,
    enabled: true,
    platform: 'web',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  writeLocalSubscription(uid, { deviceId, token })
  try { localStorage.removeItem('solara_fcm_token') } catch {}
  return true
}

export async function disableNotifications(uid: string): Promise<void> {
  const local = readLocalSubscription(uid)
  if (db && local) {
    await setDoc(doc(db, 'users', uid, 'notificationDevices', local.deviceId), {
      enabled: false,
      updatedAt: serverTimestamp(),
    }, { merge: true })
  }
  const m = getMessagingInstance()
  if (m) await deleteToken(m).catch(() => false)
  try {
    localStorage.removeItem(storageKey(uid))
    localStorage.removeItem('solara_fcm_token')
  } catch {}
}

export function onForegroundMessage(callback: (payload: unknown) => void): () => void {
  const m = getMessagingInstance()
  return m ? onMessage(m, callback) : () => {}
}
