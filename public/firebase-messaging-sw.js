importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js')
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js')

firebase.initializeApp({
  "apiKey": "",
  "authDomain": "",
  "projectId": "",
  "storageBucket": "",
  "messagingSenderId": "",
  "appId": ""
})

const messaging = firebase.messaging()

const DELIVERY_CACHE = 'solara-notification-deliveries-v1'

messaging.onBackgroundMessage(async payload => {
  const { title, body, deliveryKey, link } = payload.data || {}
  if (!title || !body || !deliveryKey) return

  const cache = await caches.open(DELIVERY_CACHE)
  const marker = new Request('/notification-delivery/' + encodeURIComponent(deliveryKey))
  if (await cache.match(marker)) return
  await cache.put(marker, new Response('shown'))
  try {
    await self.registration.showNotification(title, {
      body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: deliveryKey,
      renotify: false,
      requireInteraction: false,
      data: { link: link || '/' },
    })
  } catch (error) {
    await cache.delete(marker)
    throw error
  }
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  event.waitUntil(clients.openWindow(event.notification.data?.link || '/'))
})
