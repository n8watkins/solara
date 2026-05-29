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

messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title || 'Solara'
  const body  = payload.notification?.body  || 'Your sun window update is ready.'
  self.registration.showNotification(title, {
    body,
    icon: '/icon-192.svg',
    badge: '/icon-72.svg',
    tag: 'solara-notification',
  })
})
