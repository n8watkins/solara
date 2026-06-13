const { initializeApp, cert } = require('firebase-admin/app')
const { getFirestore }        = require('firebase-admin/firestore')
const { getMessaging }        = require('firebase-admin/messaging')

// DRY_RUN=1 exercises the whole pipeline (Firestore query, forecast fetch, message
// build) and logs what WOULD be sent, without delivering any push or mutating tokens.
// Use it to test the workflow end-to-end safely. See docs/GO_LIVE.md.
const DRY_RUN  = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true'
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://uv-activity-planner.web.app'

// Initialized lazily in main() so this module can be imported for tests without
// requiring FIREBASE_SERVICE_ACCOUNT or opening a connection.
let db
let messaging

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

function summarizeWindow(hourly, from, to) {
  const samples = hourly.filter(h => h.hour >= from && h.hour < to)
  const peakUV = samples.length ? Math.max(...samples.map(h => h.uv)) : 0
  const avgUV = samples.length
    ? Math.round((samples.reduce((sum, h) => sum + h.uv, 0) / samples.length) * 10) / 10
    : 0
  return { from, to, peakUV, avgUV }
}

function safeWindows(hourly, maxUV, durationMins) {
  let start = null
  const windows = []

  for (let i = 0; i < hourly.length; i++) {
    const { hour, uv } = hourly[i]
    if (uv <= maxUV) {
      if (start === null) start = hour
    } else {
      if (start !== null && (hour - start) * 60 >= durationMins) {
        windows.push(summarizeWindow(hourly, start, hour))
      }
      start = null
    }
  }

  if (start !== null && hourly.length) {
    const last = hourly[hourly.length - 1].hour + 1
    if ((last - start) * 60 >= durationMins) windows.push(summarizeWindow(hourly, start, last))
  }

  return windows
}

function bestWindow(hourly, maxUV, durationMins) {
  return safeWindows(hourly, maxUV, durationMins)
    .sort((a, b) => {
      if (a.avgUV !== b.avgUV) return a.avgUV - b.avgUV
      return (b.to - b.from) - (a.to - a.from)
    })[0] ?? null
}

async function fetchHourly(lat, lon) {
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}&longitude=${lon}` +
    `&hourly=uv_index,temperature_2m,weathercode` +
    `&timezone=auto&forecast_days=1`
  const res  = await fetch(url)
  const data = await res.json()

  // "Today" in the LOCATION's local timezone (Open-Meteo returns its offset when
  // timezone=auto), not the runner's. The cron runs in UTC on CI, so a runner-local
  // date would pick the wrong day for users near the date line (UTC+11/+12).
  const offsetSec = typeof data.utc_offset_seconds === 'number' ? data.utc_offset_seconds : 0
  const todayStr = new Date(Date.now() + offsetSec * 1000).toISOString().slice(0, 10)
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

// Respect an activity's weekday restriction (0=Sun … 6=Sat). Empty/absent = every day.
function runsToday(act) {
  if (!Array.isArray(act.daysOfWeek) || act.daysOfWeek.length === 0) return true
  return act.daysOfWeek.includes(new Date().getDay())
}

function buildMessage(user, hourly) {
  const activities  = (user.activities ?? []).filter(runsToday)
  const skinType    = user.skinType ?? 'fair'
  const city        = user.location?.city ?? 'your area'
  const peakUV      = hourly.length ? Math.max(...hourly.map(h => h.uv)) : null

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
      body:  peakUV === null
        ? `No UV forecast was available for your saved activities today.`
        : `Peak UV ${peakUV} — no safe windows found for your saved activities today. Stay in the shade during peak hours.`,
    }
  }

  const burn = burnMins(bestSafeUV, skinType)
  return {
    title: `☀️ ${bestActivity.name} window: ${fmtHour(bestWin.from)}–${fmtHour(bestWin.to)}`,
    body:  `UV stays ≤${bestSafeUV} in ${city}${bestActivity.sunscreen ? ' assuming SPF 30+' : ''}${burn ? `. Threshold burn est.: ~${burn} min` : ''}.`,
  }
}

// FCM error codes that mean the token is permanently dead — clear it so we stop
// retrying it (and the user's count stays honest) on every run.
const DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
])

async function main() {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
  initializeApp({ credential: cert(serviceAccount) })
  db        = getFirestore()
  messaging = getMessaging()

  console.log(DRY_RUN ? 'DRY RUN — no pushes will be sent.' : 'Fetching users with FCM tokens...')
  const snap = await db.collection('users')
    .where('notificationsEnabled', '==', true)
    .get()

  console.log(`Found ${snap.size} users with notifications enabled`)

  let cleaned = 0
  const results = await Promise.allSettled(
    snap.docs.map(async (userDoc) => {
      const user = userDoc.data()
      if (!user.fcmToken || !user.location?.lat) return

      const hourly  = await fetchHourly(user.location.lat, user.location.lon)
      const { title, body } = buildMessage(user, hourly)

      if (DRY_RUN) {
        console.log(`• ${userDoc.id}: "${title}" — ${body}`)
        return
      }

      try {
        await messaging.send({
          token: user.fcmToken,
          notification: { title, body },
          webpush: {
            notification: {
              title,
              body,
              icon: '/icon-192.png',
              badge: '/icon-192.png',
              tag: 'solara-daily',
              requireInteraction: false,
            },
            fcmOptions: { link: SITE_URL },
          },
        })
        console.log(`✓ Notified ${userDoc.id}: "${title}"`)
      } catch (err) {
        if (DEAD_TOKEN_CODES.has(err.code)) {
          await userDoc.ref.set({ fcmToken: null, notificationsEnabled: false }, { merge: true })
          cleaned++
          console.warn(`⌫ Cleared dead token for ${userDoc.id} (${err.code})`)
          return
        }
        throw err
      }
    })
  )

  const failed = results.filter(r => r.status === 'rejected').length
  const sent   = results.length - failed - cleaned
  console.log(DRY_RUN
    ? `Dry run complete. ${results.length} message(s) built.`
    : `Done. ${sent} sent, ${cleaned} dead token(s) cleared, ${failed} failed.`)
}

module.exports = { buildMessage, bestWindow, safeWindows, effectiveMaxUV, burnMins, runsToday }

if (require.main === module) {
  main().catch(err => { console.error(err); process.exit(1) })
}
