require('dotenv').config({ path: '.env.local' })
const fs = require('fs')
const path = require('path')

const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || '',
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || '',
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || '',
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '',
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || '',
}

const sw = `importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js')
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js')

firebase.initializeApp(${JSON.stringify(config, null, 2)})

const messaging = firebase.messaging()

const DELIVERY_CACHE = 'solara-notification-deliveries-v1'

messaging.onBackgroundMessage(async payload => {
  const { title, body, deliveryKey, deliveryScope, link } = payload.data || {}
  if (!title || !body || !deliveryKey || !deliveryScope) return

  const cache = await caches.open(DELIVERY_CACHE)
  const scopedKey = deliveryScope + ':' + deliveryKey
  const marker = new Request('/notification-delivery/' + encodeURIComponent(scopedKey))
  if (await cache.match(marker)) return
  await cache.put(marker, new Response('shown'))
  try {
    await self.registration.showNotification(title, {
      body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: scopedKey,
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
`

const outPath = path.join(__dirname, '..', 'public', 'firebase-messaging-sw.js')
fs.writeFileSync(outPath, sw)
console.log('✓ firebase-messaging-sw.js generated')
