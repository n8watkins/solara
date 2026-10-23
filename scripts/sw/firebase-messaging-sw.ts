// Source for public/firebase-messaging-sw.js. scripts/generate-sw.js bundles it
// with the app's own npm Firebase version, so the worker loads no third-party
// script and stays on the same SDK release as the page.
import type { FirebaseOptions } from 'firebase/app'
import { initializeApp } from 'firebase/app'
import type { MessagePayload } from 'firebase/messaging/sw'
import { getMessaging, onBackgroundMessage } from 'firebase/messaging/sw'
import { chooseWindowClient, safeNotificationUrl } from '../../lib/notification-link'

// Replaced at bundle time with the public Firebase web config.
declare const __FIREBASE_CONFIG__: FirebaseOptions

// The root tsconfig compiles with the DOM library, not WebWorker, so the few
// service-worker APIs used here are typed locally.
interface WindowClientLike {
  url: string
  focus(): Promise<unknown>
  navigate(url: string): Promise<unknown>
}
interface NotificationClickEventLike extends Event {
  notification: Notification
  waitUntil(promise: Promise<unknown>): void
}
interface ServiceWorkerScopeLike {
  location: Location
  registration: ServiceWorkerRegistration
  clients: {
    matchAll(options: { type: 'window'; includeUncontrolled: boolean }): Promise<WindowClientLike[]>
    openWindow(url: string): Promise<unknown>
  }
  addEventListener(
    type: 'notificationclick',
    listener: (event: NotificationClickEventLike) => void,
  ): void
}

const sw = self as unknown as ServiceWorkerScopeLike
const DELIVERY_CACHE = 'solara-notification-deliveries-v1'

async function openOrFocus(link: unknown): Promise<void> {
  const origin = sw.location.origin
  const target = safeNotificationUrl(link, origin)
  const windows = await sw.clients.matchAll({ type: 'window', includeUncontrolled: true })
  const index = chooseWindowClient(
    windows.map(client => client.url),
    target,
    origin,
  )
  const existing = index === -1 ? undefined : windows[index]
  if (!existing) {
    await sw.clients.openWindow(target)
    return
  }
  if (existing.url !== target) await existing.navigate(target)
  await existing.focus()
}

// Registered before Firebase so Solara's handler sees clicks first.
sw.addEventListener('notificationclick', event => {
  const data = event.notification.data as { link?: unknown } | null
  event.notification.close()
  event.waitUntil(openOrFocus(data?.link))
})

const messaging = getMessaging(initializeApp(__FIREBASE_CONFIG__))

async function showOnce(payload: MessagePayload): Promise<void> {
  const { title, body, deliveryKey, deliveryScope, link } = payload.data || {}
  if (!title || !body || !deliveryKey || !deliveryScope) return

  const cache = await caches.open(DELIVERY_CACHE)
  const scopedKey = deliveryScope + ':' + deliveryKey
  const marker = new Request('/notification-delivery/' + encodeURIComponent(scopedKey))
  if (await cache.match(marker)) return
  await cache.put(marker, new Response('shown'))
  try {
    await sw.registration.showNotification(title, {
      body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: scopedKey,
      requireInteraction: false,
      data: { link: safeNotificationUrl(link, sw.location.origin) },
    })
  } catch (error) {
    await cache.delete(marker)
    throw error
  }
}

onBackgroundMessage(messaging, payload => {
  void showOnce(payload)
})
