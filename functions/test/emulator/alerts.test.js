// The scheduled Pro alerts against the real Firestore emulator (run by
// `npm run test:rules`): a simulated day of runs every 15 minutes sends exactly one
// morning alert per entitled Pro account in its own local morning, across time zones,
// and nothing to anyone else; the UV alert goes out once, outside quiet hours; dead
// tokens are removed; overlapping runs never send twice.
const { after, afterEach, before, describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { deleteApp, initializeApp } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')

const { localTime } = require('../../core')
const { runAlerts } = require('../../lib/notifications/alerts')
const { tokenOwnerId } = require('../../lib/notifications/devices')

const projectId = 'demo-solara-alerts'
let app
let db

const DAY_START = Date.parse('2026-06-15T00:00:00Z')
const QUARTER_HOUR = 15 * 60 * 1000

const PLACES = {
  'America/Los_Angeles': { lat: 34.05, lon: -118.24, city: 'Los Angeles' },
  'Asia/Tokyo': { lat: 35.68, lon: 139.69, city: 'Tokyo' },
  'Asia/Kolkata': { lat: 19.08, lon: 72.88, city: 'Mumbai' },
  'Europe/London': { lat: 51.51, lon: -0.13, city: 'London' },
}

/** A clear day: UV peaks at 8 at 1pm local, 6.5 at noon and 2pm, 5 at 11am and 3pm. */
function uvAt(hour) {
  return Math.max(0, 8 - Math.abs(hour - 13) * 1.5)
}

function shiftDate(date, days) {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

/** An Open-Meteo response for yesterday, today and tomorrow in the place's own zone. */
function forecastFor(place, now) {
  const timezone = Object.keys(PLACES).find(zone => PLACES[zone].lat === place.lat)
  const today = localTime(new Date(now), timezone).date
  const time = []
  const uv = []
  for (const date of [shiftDate(today, -1), today, shiftDate(today, 1)]) {
    for (let hour = 0; hour < 24; hour++) {
      time.push(`${date}T${String(hour).padStart(2, '0')}:00`)
      uv.push(uvAt(hour))
    }
  }
  return { timezone, hourly: { time, uv_index: uv } }
}

class FakeMessaging {
  constructor() {
    this.batches = []
    this.dead = new Set()
    this.failing = new Map()
  }

  async sendEach(messages) {
    this.batches.push(messages)
    const responses = messages.map(message => {
      if (this.dead.has(message.token)) {
        return { success: false, error: { code: 'messaging/registration-token-not-registered' } }
      }
      const failure = this.failing.get(message.token)
      if (failure) return { success: false, error: { code: failure } }
      return { success: true, messageId: `id-${this.batches.length}` }
    })
    const successCount = responses.filter(r => r.success).length
    return { responses, successCount, failureCount: responses.length - successCount }
  }

  sentTo(uid) {
    return this.batches.filter(batch =>
      batch.some(message => message.token.startsWith(`${uid}-token-`)),
    )
  }
}

async function addUser(uid, { zone = 'America/Los_Angeles', devices = 1, ...fields } = {}) {
  const place = PLACES[zone]
  await db
    .collection('users')
    .doc(uid)
    .set({
      uid,
      tier: 'paid',
      subscriptionStatus: 'active',
      skinType: 'fair',
      notificationHour: 7,
      activities: [{ id: 'run', name: 'Run', icon: '🏃', maxUV: 3, durationMins: 60 }],
      location: { ...place, region: '', timezone: zone },
      ...fields,
    })
  for (let index = 0; index < devices; index++) {
    const deviceId = `${String(index).repeat(36)}`.slice(0, 36)
    const token = `${uid}-token-${index}`
    await db
      .collection('users')
      .doc(uid)
      .collection('notificationDevices')
      .doc(deviceId)
      .set({ token, enabled: true, platform: 'web' })
    await db.collection('notificationTokenOwners').doc(tokenOwnerId(token)).set({ uid, deviceId })
  }
}

function run(messaging, now, limits) {
  return runAlerts({
    db,
    messaging,
    forecast: async place => forecastFor(place, now),
    appUrl: 'https://solara.example',
    now: () => now,
    limits,
  })
}

async function clearFirestore() {
  const response = await fetch(
    `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${projectId}/databases/(default)/documents`,
    { method: 'DELETE' },
  )
  assert.equal(response.ok, true)
}

before(() => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST, 'run with the Firestore emulator')
  app = initializeApp({ projectId }, 'alerts-emulator-test')
  db = getFirestore(app)
})

afterEach(clearFirestore)

after(async () => {
  await deleteApp(app)
})

/** Each batch with the local hour it was sent at, recorded by wrapping the fake. */
function recording(messaging) {
  const sends = []
  const sendEach = messaging.sendEach.bind(messaging)
  messaging.now = 0
  messaging.sendEach = async messages => {
    sends.push({ at: messaging.now, messages })
    return sendEach(messages)
  }
  return sends
}

/** The local dates whose morning (from `hour`, for two hours) starts within the simulated day. */
function localMornings(zone, hour) {
  const dates = []
  for (let now = DAY_START; now < DAY_START + 86_400_000; now += QUARTER_HOUR) {
    const local = localTime(new Date(now), zone)
    if (local.hour >= hour && local.hour < hour + 2 && !dates.includes(local.date)) {
      dates.push(local.date)
    }
  }
  return dates
}

async function runRecordedDay(messaging, hours = 24, limits) {
  for (let now = DAY_START; now < DAY_START + hours * 3_600_000; now += QUARTER_HOUR) {
    messaging.now = now
    await run(messaging, now, limits)
  }
}

describe('morning alerts', () => {
  test('one per entitled Pro account in its own local morning, in every time zone', async () => {
    await addUser('pro-la', { devices: 2 })
    await addUser('pro-tokyo', { zone: 'Asia/Tokyo', subscriptionStatus: 'trialing' })
    await addUser('pro-mumbai', { zone: 'Asia/Kolkata', notificationHour: 5 })
    await addUser('pro-london', { zone: 'Europe/London', notificationHour: 10 })
    await addUser('pro-grace', {
      subscriptionStatus: 'past_due',
      pastDueSince: new Date(DAY_START - 2 * 86_400_000),
    })
    await addUser('pro-comp', { subscriptionStatus: null })
    await addUser('free', { tier: 'free', subscriptionStatus: null })
    await addUser('canceled', { subscriptionStatus: 'canceled' })
    await addUser('grace-over', {
      subscriptionStatus: 'past_due',
      pastDueSince: new Date(DAY_START - 8 * 86_400_000),
    })
    await addUser('deleting', { accountDeletionStartedAt: new Date(DAY_START) })

    const messaging = new FakeMessaging()
    const sends = recording(messaging)
    await runRecordedDay(messaging)

    const expected = {
      'pro-la': ['America/Los_Angeles', 7, 2, '🏃 Run: 7am to 10am'],
      'pro-tokyo': ['Asia/Tokyo', 7, 1, '🏃 Run: 7am to 10am'],
      'pro-mumbai': ['Asia/Kolkata', 5, 1, '🏃 Run: 6am to 10am'],
      // By 10am the UV is above the run's limit until 5pm.
      'pro-london': ['Europe/London', 10, 1, '🏃 Run: 5pm to 8pm'],
      'pro-grace': ['America/Los_Angeles', 7, 1, '🏃 Run: 7am to 10am'],
      'pro-comp': ['America/Los_Angeles', 7, 1, '🏃 Run: 7am to 10am'],
    }
    for (const [uid, [zone, hour, devices, title]] of Object.entries(expected)) {
      const mine = sends.filter(send => send.messages[0].token.startsWith(`${uid}-token-`))
      // The simulated UTC day holds one local morning in most zones and two in some.
      assert.deepEqual(
        mine.map(send => send.messages[0].data.deliveryKey),
        localMornings(zone, hour).map(date => `morning-v1:${date}`),
        `${uid} gets exactly one alert per local morning`,
      )
      for (const send of mine) {
        assert.equal(send.messages.length, devices, `${uid} reaches every device`)
        const local = localTime(new Date(send.at), zone)
        assert.ok(local.hour >= hour && local.hour < hour + 2, `${uid} at ${local.hour}`)
        assert.equal(send.messages[0].data.title, title)
        // The body is the daily briefing, as the dashboard card says it.
        assert.match(
          send.messages[0].data.body,
          /^Today in .+: UV peaks at .+ Recheck current conditions\.$/,
        )
        assert.match(send.messages[0].data.body, /Best lower-UV window: Run /)
        assert.equal(send.messages[0].data.link, 'https://solara.example/app/')
      }
    }
    for (const uid of ['free', 'canceled', 'grace-over', 'deleting']) {
      assert.equal(messaging.sentTo(uid).length, 0, `${uid} gets nothing`)
    }
    const state = await db.doc('users/pro-la/alertState/daily').get()
    assert.equal(state.data().morning.status, 'delivered')
    assert.equal(state.data().morning.devices, 2)
    assert.ok(state.data().expireAt)
  })

  test('overlapping runs send once', async () => {
    await addUser('pro')
    const messaging = new FakeMessaging()
    const now = Date.parse('2026-06-15T14:30:00Z') // 7:30 in Los Angeles
    await Promise.all([run(messaging, now), run(messaging, now), run(messaging, now)])
    assert.equal(messaging.batches.length, 1)
  })

  test('removes devices whose token is dead and keeps the alert for the others', async () => {
    await addUser('pro', { devices: 2 })
    const messaging = new FakeMessaging()
    messaging.dead.add('pro-token-0')
    const now = Date.parse('2026-06-15T14:30:00Z')
    const result = await run(messaging, now)
    assert.equal(result.removedDevices, 1)
    const devices = await db.collection('users/pro/notificationDevices').get()
    assert.deepEqual(
      devices.docs.map(doc => doc.data().token),
      ['pro-token-1'],
    )
    const owner = await db
      .collection('notificationTokenOwners')
      .doc(tokenOwnerId('pro-token-0'))
      .get()
    assert.equal(owner.exists, false)
    assert.equal(
      (await db.doc('users/pro/alertState/daily').get()).data().morning.status,
      'delivered',
    )
  })

  test('retries a send that failed for certain, at most three times, and never an unknown one', async () => {
    await addUser('pro')
    await addUser('pro-unknown')
    const messaging = new FakeMessaging()
    messaging.failing.set('pro-token-0', 'messaging/message-rate-exceeded')
    messaging.failing.set('pro-unknown-token-0', 'messaging/internal-error')
    const start = Date.parse('2026-06-15T14:00:00Z') // 7:00 in Los Angeles
    for (let step = 0; step < 8; step++) await run(messaging, start + step * QUARTER_HOUR)
    assert.equal(messaging.sentTo('pro').length, 3)
    assert.equal(messaging.sentTo('pro-unknown').length, 1)
    assert.equal(
      (await db.doc('users/pro-unknown/alertState/daily').get()).data().morning.status,
      'unknown',
    )
  })

  test('skips accounts without devices, and carries on from where a capped run stopped', async () => {
    for (const uid of ['a', 'b', 'c']) await addUser(uid)
    await addUser('d', { devices: 0 })
    const messaging = new FakeMessaging()
    const now = Date.parse('2026-06-15T14:30:00Z')
    const first = await run(messaging, now, { maxUsers: 2, pageSize: 1 })
    assert.equal(first.completed, false)
    assert.equal(messaging.batches.length, 2)
    const second = await run(messaging, now, { maxUsers: 2, pageSize: 1 })
    assert.equal(second.outcomes['no-devices'], 1)
    assert.equal(messaging.batches.length, 3)
    const third = await run(messaging, now, { maxUsers: 2, pageSize: 1 })
    assert.deepEqual([third.scanned, third.completed], [0, true])
    assert.equal((await db.doc('alertDispatch/state').get()).data().cursor, null)
  })
})

describe('UV alerts', () => {
  test('once a day when the UV reaches the threshold, outside quiet hours, apart from the morning alert', async () => {
    await addUser('uv', { uvAlertThreshold: 6, notificationHour: 10 })
    // Quiet until noon: the UV reaches 6 (6.5) at noon, so the alert may go from 11, but waits.
    await addUser('uv-quiet', { uvAlertThreshold: 6, quietHours: { from: 22, to: 12 } })
    await addUser('uv-never', { uvAlertThreshold: 9 })
    const messaging = new FakeMessaging()
    const sends = recording(messaging)
    await runRecordedDay(messaging)

    const uvSends = uid =>
      sends.filter(
        send =>
          send.messages[0].token.startsWith(`${uid}-token-`) &&
          send.messages[0].data.deliveryKey.startsWith('uv-'),
      )
    const [first] = uvSends('uv')
    assert.equal(uvSends('uv').length, 1)
    const at = localTime(new Date(first.at), 'America/Los_Angeles').hour
    assert.ok(at >= 11 && at < 15, `uv at ${at}`)
    // The morning alert (10:00) and the UV alert never go out in the same run.
    const morning = sends.find(
      send =>
        send.messages[0].token.startsWith('uv-token-') &&
        send.messages[0].data.deliveryKey.startsWith('morning-'),
    )
    assert.notEqual(morning.at, first.at)
    assert.equal(first.messages[0].data.title, '☀️ UV reaches 6 around 12pm')

    const [quiet] = uvSends('uv-quiet')
    assert.equal(uvSends('uv-quiet').length, 1)
    assert.equal(localTime(new Date(quiet.at), 'America/Los_Angeles').hour, 12)
    assert.equal(quiet.messages[0].data.title, '☀️ UV is 6 or higher now')

    assert.equal(uvSends('uv-never').length, 0)
  })
})
