const { initializeApp, cert } = require('firebase-admin/app')
const { getFirestore }        = require('firebase-admin/firestore')
const { getMessaging }        = require('firebase-admin/messaging')

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
initializeApp({ credential: cert(serviceAccount) })

const db        = getFirestore()
const messaging = getMessaging()

function weatherLabel(code) {
  if (code === 0) return 'Clear'
  if (code <= 3)  return 'Partly cloudy'
  if (code <= 49) return 'Foggy'
  if (code <= 67) return 'Rainy'
  return 'Cloudy'
}

function fmtHour(h) {
  if (h === 12) return '12pm'
  if (h === 0)  return '12am'
  return h < 12 ? `${h}am` : `${h - 12}pm`
}

function effectiveMaxUV(activity) {
  return activity.sunscreen ? Math.min(Math.round((activity.maxUV ?? 4) * 2.5), 11) : (activity.maxUV ?? 4)
}

function burnMins(uv, skinType) {
  const base = { 'very-fair': 10, fair: 15, medium: 25, olive: 35, dark: 50 }
  if (uv < 0.5) return null
  return Math.round(((base[skinType] ?? 15) * 10) / uv)
}

function bestWindow(hourly, maxUV, durationMins) {
  let start = null
  for (let i = 0; i < hourly.length; i++) {
    const { hour, uv } = hourly[i]
    if (uv <= maxUV) {
      if (start === null) start = hour
    } else {
      if (start !== null && (hour - start) * 60 >= durationMins) {
        return { from: start, to: hour }
      }
      start = null
    }
  }
  if (start !== null) {
    const last = hourly[hourly.length - 1].hour + 1
    if ((last - start) * 60 >= durationMins) return { from: start, to: last }
  }
  return null
}

async function fetchHourly(lat, lon) {
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}&longitude=${lon}` +
    `&hourly=uv_index,temperature_2m,weathercode` +
    `&timezone=auto&forecast_days=1`
  const res  = await fetch(url)
  const data = await res.json()

  const todayStr = new Date().toLocaleDateString('en-CA')
  return data.hourly.time
    .map((t, i) => ({
      date: t.split('T')[0],
      hour: parseInt(t.split('T')[1].split(':')[0]),
      uv:   Math.round(data.hourly.uv_index[i] * 10) / 10,
      tempF: Math.round(data.hourly.temperature_2m[i] * 9 / 5 + 32),
      condition: weatherLabel(data.hourly.weathercode[i]),
    }))
    .filter(h => h.date === todayStr && h.hour >= 6 && h.hour <= 20)
}

function buildMessage(user, hourly) {
  const activities  = user.activities ?? []
  const skinType    = user.skinType ?? 'fair'
  const city        = user.location?.city ?? 'your area'
  const peakUV      = Math.max(...hourly.map(h => h.uv))

  let bestActivity  = null
  let bestWin       = null
  let bestSafeUV    = null

  for (const act of activities) {
    const safeUV = effectiveMaxUV(act)
    const win = bestWindow(hourly, safeUV, act.durationMins ?? 30)
    if (win) { bestActivity = act; bestWin = win; bestSafeUV = safeUV; break }
  }

  if (!bestActivity) {
    return {
      title: `☀️ High UV today in ${city}`,
      body:  `Peak UV ${peakUV} — no safe windows found for your saved activities today. Stay in the shade during peak hours.`,
    }
  }

  const burn = burnMins(bestSafeUV, skinType)
  return {
    title: `☀️ ${bestActivity.name} window: ${fmtHour(bestWin.from)}–${fmtHour(bestWin.to)}`,
    body:  `UV stays ≤${bestSafeUV} in ${city}${bestActivity.sunscreen ? ' assuming SPF 30+' : ''}${burn ? `. Burn limit: ~${burn} min` : ''}.`,
  }
}

async function main() {
  console.log('Fetching users with FCM tokens...')
  const snap = await db.collection('users')
    .where('notificationsEnabled', '==', true)
    .get()

  console.log(`Found ${snap.size} users with notifications enabled`)

  const results = await Promise.allSettled(
    snap.docs.map(async (userDoc) => {
      const user = userDoc.data()
      if (!user.fcmToken || !user.location?.lat) return

      const hourly  = await fetchHourly(user.location.lat, user.location.lon)
      const { title, body } = buildMessage(user, hourly)

      await messaging.send({
        token: user.fcmToken,
        notification: { title, body },
        webpush: {
          notification: {
            title,
            body,
            icon: '/icon-192.svg',
            badge: '/icon-72.svg',
            tag: 'solara-daily',
            requireInteraction: false,
          },
          fcmOptions: { link: 'https://solara.web.app' },
        },
      })

      console.log(`✓ Notified ${userDoc.id}: "${title}"`)
    })
  )

  const failed = results.filter(r => r.status === 'rejected').length
  console.log(`Done. ${results.length - failed} sent, ${failed} failed.`)
}

main().catch(err => { console.error(err); process.exit(1) })
