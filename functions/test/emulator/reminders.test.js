// The reapply reminder push and the Free daily UV push against the real Firestore
// emulator (run by `npm run test:rules`):
// - a reminder the browser schedules is counted and enqueued once, delivered once by its
//   task or, if the task never runs, by the alerts job's sweep (never both), not after a
//   Stop or a newer schedule, and held to the per-account caps;
// - a simulated day of alerts runs every 15 minutes sends each enrolled Free account one
//   daily UV push in its own morning across time zones, none to Pro, to accounts that
//   turned it off, or on a low-UV day, and looks at each account only about twice a day.
const { after, afterEach, before, describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { deleteApp, initializeApp } = require('firebase-admin/app')
const { Timestamp, getFirestore } = require('firebase-admin/firestore')

const { localTime } = require('../../core')
const { tokenOwnerId } = require('../../lib/notifications/devices')
const {
  REAPPLY_SCHEDULES_PER_DAY,
  REAPPLY_SENDS_PER_DAY,
  REMINDER_SWEEP_GRACE_MS,
  deliverReapplyReminder,
  reminderWritten,
  sweepReapplyReminders,
} = require('../../lib/notifications/reminders')
const { runDailyUv } = require('../../lib/notifications/daily-uv')
const { dailyUvScheduleRef } = require('../../lib/notifications/schedule')

const projectId = 'demo-solara-reminders'
let app
let db

const MINUTE = 60_000
const QUARTER_HOUR = 15 * MINUTE
const NOW = Date.parse('2026-06-15T17:00:00Z')
const ID = '0123456789abcdef0123456789abcdef'
const OTHER_ID = 'fedcba9876543210fedcba9876543210'

const PLACES = {
  'America/Los_Angeles': { lat: 34.05, lon: -118.24, city: 'Los Angeles' },
  'Asia/Tokyo': { lat: 35.68, lon: 139.69, city: 'Tokyo' },
  'Asia/Kolkata': { lat: 19.08, lon: 72.88, city: 'Mumbai' },
  'Europe/London': { lat: 51.51, lon: -0.13, city: 'London' },
}

class FakeMessaging {
  constructor() {
    this.batches = []
  }

  async sendEach(messages) {
    this.batches.push({ at: this.now, messages })
    const responses = messages.map(() => ({ success: true, messageId: 'id' }))
    return { responses, successCount: responses.length, failureCount: 0 }
  }

  sentTo(uid) {
    return this.batches.filter(batch =>
      batch.messages.some(message => message.token.startsWith(`${uid}-token-`)),
    )
  }
}

async function addUser(uid, { zone = 'America/Los_Angeles', devices = 1, ...fields } = {}) {
  const userRef = db.collection('users').doc(uid)
  await userRef.set({
    uid,
    tier: 'free',
    skinType: 'fair',
    notificationHour: 7,
    activities: [],
    location: { ...PLACES[zone], region: '', timezone: zone },
    ...fields,
  })
  for (let index = 0; index < devices; index++) {
    const deviceId = `${String(index).repeat(36)}`.slice(0, 36)
    const token = `${uid}-token-${index}`
    await userRef
      .collection('notificationDevices')
      .doc(deviceId)
      .set({ token, enabled: true, platform: 'web' })
    await db.collection('notificationTokenOwners').doc(tokenOwnerId(token)).set({ uid, deviceId })
  }
  return userRef
}

/** The record the browser writes (lib/reapply-reminder.ts), as the rules accept it. */
function reminder({ id = ID, mode = 'standard', appliedAt = NOW } = {}) {
  const remindAt = appliedAt + (mode === 'water' ? 80 : 120) * MINUTE
  return {
    id,
    mode,
    appliedAt: Timestamp.fromMillis(appliedAt),
    remindAt: Timestamp.fromMillis(remindAt),
    dueAt: Timestamp.fromMillis(remindAt),
    expireAt: Timestamp.fromMillis(remindAt + 1440 * MINUTE),
  }
}

const reminderRef = uid => db.doc(`users/${uid}/reminders/reapply`)

/** Writes a record and runs the trigger on it, as Firestore would; returns what was enqueued. */
async function schedule(uid, data, nowMs = NOW) {
  const before = (await reminderRef(uid).get()).data()
  await reminderRef(uid).set(data)
  const enqueued = []
  const outcome = await reminderWritten({
    db,
    uid,
    before,
    after: data,
    enabled: true,
    nowMs,
    enqueue: async (task, at) => {
      enqueued.push({ ...task, at: at.getTime() })
    },
  })
  return { outcome, enqueued }
}

function deps(messaging, now) {
  return { db, messaging, appUrl: 'https://solara.example', now: () => now }
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
  app = initializeApp({ projectId }, 'reminders-emulator-test')
  db = getFirestore(app)
})

afterEach(clearFirestore)

after(async () => {
  await deleteApp(app)
})

describe('reapply reminder push', () => {
  test('a new schedule is enqueued once, for its time', async () => {
    await addUser('alice')
    const first = await schedule('alice', reminder())
    assert.equal(first.outcome, 'scheduled')
    assert.deepEqual(first.enqueued, [{ uid: 'alice', id: ID, at: NOW + 120 * MINUTE }])
    // The same record written again (or the server's own writes) enqueues nothing.
    const again = await reminderWritten({
      db,
      uid: 'alice',
      before: reminder(),
      after: reminder(),
      enabled: true,
      nowMs: NOW,
      enqueue: () => assert.fail('enqueued twice'),
    })
    assert.equal(again, 'unchanged')
  })

  test('its task sends one push with the tag the browser uses, then the record is gone', async () => {
    await addUser('alice', { devices: 2 })
    await schedule('alice', reminder({ mode: 'water' }))
    const messaging = new FakeMessaging()
    const due = NOW + 80 * MINUTE
    assert.equal(await deliverReapplyReminder(deps(messaging, due), 'alice', ID), 'sent')
    assert.equal(messaging.batches.length, 1)
    const [message] = messaging.batches[0].messages
    assert.equal(message.data.title, 'Time to reapply sunscreen')
    assert.match(message.data.body, /80 minutes of swimming or sweating/)
    assert.equal(message.data.deliveryKey, `reapply-v1:${ID}`)
    assert.equal(messaging.batches[0].messages.length, 2)
    assert.equal((await reminderRef('alice').get()).exists, false)
    // A retried task finds nothing to send.
    assert.equal(await deliverReapplyReminder(deps(messaging, due), 'alice', ID), 'stale')
    assert.equal(messaging.batches.length, 1)
  })

  test('the reminder does not wait for the tab: with no task, the alerts sweep sends it once', async () => {
    await addUser('alice')
    await schedule('alice', reminder())
    const messaging = new FakeMessaging()
    const due = NOW + 120 * MINUTE
    // Not yet overdue: left to its task.
    let sweep = await sweepReapplyReminders(deps(messaging, due + REMINDER_SWEEP_GRACE_MS - 1))
    assert.equal(sweep.checked, 0)
    sweep = await sweepReapplyReminders(deps(messaging, due + QUARTER_HOUR))
    assert.deepEqual(sweep.outcomes, { sent: 1 })
    sweep = await sweepReapplyReminders(deps(messaging, due + 2 * QUARTER_HOUR))
    assert.equal(sweep.checked, 0)
    assert.equal(messaging.sentTo('alice').length, 1)
  })

  test('the task and the sweep never both send', async () => {
    await addUser('alice')
    await schedule('alice', reminder())
    const messaging = new FakeMessaging()
    const late = NOW + 120 * MINUTE + QUARTER_HOUR
    const [task] = await Promise.all([
      deliverReapplyReminder(deps(messaging, late), 'alice', ID),
      sweepReapplyReminders(deps(messaging, late)),
    ])
    assert.ok(['sent', 'stale'].includes(task))
    assert.equal(messaging.sentTo('alice').length, 1)
  })

  test('Stop, or a newer schedule, means the old one is never sent', async () => {
    await addUser('alice')
    await schedule('alice', reminder())
    await schedule('alice', reminder({ id: OTHER_ID, appliedAt: NOW + 30 * MINUTE }))
    const messaging = new FakeMessaging()
    const due = NOW + 120 * MINUTE
    assert.equal(await deliverReapplyReminder(deps(messaging, due), 'alice', ID), 'stale')
    // The newer one is not due yet.
    assert.equal(await deliverReapplyReminder(deps(messaging, due), 'alice', OTHER_ID), 'early')

    await reminderRef('alice').delete()
    assert.equal(
      await deliverReapplyReminder(deps(messaging, due + 30 * MINUTE), 'alice', OTHER_ID),
      'stale',
    )
    assert.equal((await sweepReapplyReminders(deps(messaging, due + 60 * MINUTE))).checked, 0)
    assert.equal(messaging.batches.length, 0)
  })

  test('an account without notification devices gets nothing, and the record is removed', async () => {
    await addUser('bob', { devices: 0 })
    await schedule('bob', reminder())
    const messaging = new FakeMessaging()
    assert.equal(
      await deliverReapplyReminder(deps(messaging, NOW + 120 * MINUTE), 'bob', ID),
      'no-devices',
    )
    assert.equal(messaging.batches.length, 0)
    assert.equal((await reminderRef('bob').get()).exists, false)
  })

  test('each account is held to its daily caps', async () => {
    await addUser('alice')
    for (let i = 0; i < REAPPLY_SCHEDULES_PER_DAY; i++) {
      const id = i.toString(16).padStart(32, '0')
      assert.equal((await schedule('alice', reminder({ id }))).outcome, 'scheduled')
    }
    const over = await schedule('alice', reminder({ id: 'a'.repeat(32) }))
    assert.equal(over.outcome, 'capped')
    assert.deepEqual(over.enqueued, [])
    assert.equal((await reminderRef('alice').get()).exists, false)

    await addUser('carol')
    const state = db.doc('users/carol/alertState/reapply')
    await state.set({ day: '2026-06-15', sent: REAPPLY_SENDS_PER_DAY, scheduled: 0 })
    await schedule('carol', reminder())
    const messaging = new FakeMessaging()
    // Still 15 June in UTC at 19:00.
    assert.equal(
      await deliverReapplyReminder(deps(messaging, NOW + 120 * MINUTE), 'carol', ID),
      'capped',
    )
    assert.equal(messaging.batches.length, 0)
  })

  test('an invalid record written around the rules is deleted, not sent', async () => {
    await addUser('alice')
    const { outcome, enqueued } = await schedule('alice', {
      ...reminder(),
      remindAt: Timestamp.fromMillis(NOW + 5 * MINUTE),
      dueAt: Timestamp.fromMillis(NOW + 5 * MINUTE),
    })
    assert.equal(outcome, 'invalid')
    assert.deepEqual(enqueued, [])
    assert.equal((await reminderRef('alice').get()).exists, false)
  })
})

describe('daily UV push for Free accounts', () => {
  const DAY_START = Date.parse('2026-06-15T00:00:00Z')

  /** UV peaks at 8 at 1pm local, 6.5 at noon and 2pm; `low` keeps it under 3 all day. */
  function forecastFor(place, now, low = false) {
    const timezone = Object.keys(PLACES).find(zone => PLACES[zone].lat === place.lat)
    const today = localTime(new Date(now), timezone).date
    const time = []
    const uv = []
    for (const offset of [-1, 0, 1]) {
      const [y, m, d] = today.split('-').map(Number)
      const date = new Date(Date.UTC(y, m - 1, d + offset)).toISOString().slice(0, 10)
      for (let hour = 0; hour < 24; hour++) {
        time.push(`${date}T${String(hour).padStart(2, '0')}:00`)
        const value = Math.max(0, 8 - Math.abs(hour - 13) * 1.5)
        uv.push(low ? Math.min(value, 2) : value)
      }
    }
    return { timezone, hourly: { time, uv_index: uv } }
  }

  async function enrol(uid, options) {
    const userRef = await addUser(uid, options)
    await dailyUvScheduleRef(userRef).set({ dueAt: new Date(DAY_START) })
    return userRef
  }

  /** A day of runs every 15 minutes; returns the messaging fake and each run's result. */
  async function simulateDay({ low = new Set(), lookups = [] } = {}) {
    const messaging = new FakeMessaging()
    const results = []
    for (let now = DAY_START; now < DAY_START + 86_400_000; now += QUARTER_HOUR) {
      messaging.now = now
      results.push(
        await runDailyUv({
          db,
          messaging,
          appUrl: 'https://solara.example',
          now: () => now,
          forecast: async (place, uid) => {
            lookups.push(uid)
            return forecastFor(place, now, low.has(uid))
          },
        }),
      )
    }
    return { messaging, results }
  }

  test('one push per enrolled Free account, in its own morning, across time zones', async () => {
    for (const zone of Object.keys(PLACES)) await enrol(zone.split('/')[1], { zone })
    const { messaging } = await simulateDay()
    for (const zone of Object.keys(PLACES)) {
      const uid = zone.split('/')[1]
      const sends = messaging.sentTo(uid)
      assert.ok(sends.length >= 1, `${uid} got none`)
      const dates = sends.map(send => localTime(new Date(send.at), zone).date)
      assert.equal(new Set(dates).size, sends.length, `${uid}: two on one local day`)
      for (const send of sends) {
        const local = localTime(new Date(send.at), zone)
        // At 7am, or (enrolled mid-morning) at once while protection is still needed.
        assert.ok(local.hour >= 7 && local.hour < 16, `${uid} at ${local.hour}`)
        const [message] = send.messages
        assert.match(message.data.title, /^☀️ Protect (from|until) /)
        assert.match(message.data.body, /UV peaks at 8\.0 \(very high\) around 1pm/)
        assert.equal(message.data.deliveryKey, `basic-v1:${local.date}`)
      }
      // Every local 7am inside the simulated day got its push within the quarter hour.
      for (let now = DAY_START; now < DAY_START + 86_400_000; now += QUARTER_HOUR) {
        const local = localTime(new Date(now), zone)
        if (local.hour !== 7 || now + QUARTER_HOUR > DAY_START + 86_400_000) continue
        assert.ok(
          sends.some(send => send.at >= now && send.at < now + QUARTER_HOUR),
          `${uid} on ${local.date} at 7am`,
        )
      }
    }
  })

  test('none to Pro, to an account that turned it off, or on a low-UV day', async () => {
    await enrol('pro', { tier: 'paid', subscriptionStatus: 'active' })
    await enrol('off', { dailyUv: false })
    // A place of its own: a run looks each place up once for every account there.
    await enrol('cloudy', { zone: 'Europe/London' })
    await enrol('sunny')
    const { messaging } = await simulateDay({ low: new Set(['cloudy']) })
    assert.equal(messaging.sentTo('pro').length, 0)
    assert.equal(messaging.sentTo('off').length, 0)
    assert.equal(messaging.sentTo('cloudy').length, 0)
    assert.equal(messaging.sentTo('sunny').length, 1)
  })

  test('waits for quiet hours to end, and follows the chosen hour', async () => {
    await enrol('late', { notificationHour: 9 })
    await enrol('quiet', { notificationHour: 6, quietHours: { from: 22, to: 8 } })
    const { messaging } = await simulateDay()
    const hourOf = uid =>
      localTime(new Date(messaging.sentTo(uid)[0].at), 'America/Los_Angeles').hour
    assert.ok(hourOf('late') >= 9 && hourOf('late') < 9.5)
    assert.ok(hourOf('quiet') >= 8 && hourOf('quiet') < 8.5)
  })

  test('looks at an account about twice a day, not every run', async () => {
    await enrol('alice', { notificationHour: 8 })
    const { results } = await simulateDay()
    const looks = results.reduce((sum, result) => sum + result.checked, 0)
    // The enrolment's first look, then 5am and 8am in Los Angeles: at most 3 in a day.
    assert.ok(looks <= 3, `looked ${looks} times`)
  })

  test('an account without devices leaves the daily UV push', async () => {
    const userRef = await enrol('gone', { devices: 0 })
    const { messaging } = await simulateDay()
    assert.equal(messaging.sentTo('gone').length, 0)
    assert.equal((await dailyUvScheduleRef(userRef).get()).exists, false)
  })

  test('its forecasts are capped per run and come back later', async () => {
    for (let i = 0; i < 3; i++) await enrol(`user${i}`)
    const messaging = new FakeMessaging()
    const at = Date.parse('2026-06-15T14:05:00Z') // 7:05 in Los Angeles
    messaging.now = at
    const first = await runDailyUv({
      db,
      messaging,
      appUrl: 'https://solara.example',
      now: () => at,
      // Every account at the same place: one lookup serves all three.
      forecast: async place => forecastFor(place, at),
      limits: { maxForecasts: 1 },
    })
    assert.equal(first.sent, 3)
    // A place the run cannot look up waits for a later run, never fails the push.
    await enrol('tokyo', { zone: 'Asia/Tokyo' })
    await enrol('london', { zone: 'Europe/London' })
    const second = await runDailyUv({
      db,
      messaging,
      appUrl: 'https://solara.example',
      now: () => at,
      forecast: async () => {
        throw new Error('budget spent')
      },
      limits: { maxForecasts: 0 },
    })
    assert.equal(second.sent, 0)
  })
})
