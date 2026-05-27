import { getMessaging, getToken, onMessage, Messaging } from 'firebase/messaging'
import { doc, updateDoc, getDoc, setDoc } from 'firebase/firestore'
import { app, db } from './firebase'

const VAPID_KEY = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY

let messaging: Messaging | null = null

function getMessagingInstance(): Messaging | null {
  if (typeof window === 'undefined') return null
  if (!messaging) {
    try {
      messaging = getMessaging(app)
    } catch {
      return null
    }
  }
  return messaging
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

export async function saveFCMToken(uid: string, token: string): Promise<void> {
  try {
    const ref = doc(db, 'users', uid)
    const snap = await getDoc(ref)
    if (snap.exists()) {
      await updateDoc(ref, { fcmToken: token, notificationsEnabled: true })
    } else {
      await setDoc(ref, { uid, fcmToken: token, notificationsEnabled: true })
    }
  } catch (err) {
    console.error('Save FCM token error:', err)
  }
}

export function saveFCMTokenLocally(token: string): void {
  try {
    localStorage.setItem('solara_fcm_token', token)
  } catch {}
}

export function getFCMTokenLocally(): string | null {
  try {
    return localStorage.getItem('solara_fcm_token')
  } catch {
    return null
  }
}

export function onForegroundMessage(callback: (payload: unknown) => void): void {
  const m = getMessagingInstance()
  if (!m) return
  onMessage(m, callback)
}
