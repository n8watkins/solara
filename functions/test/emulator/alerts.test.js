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

async function addUser(
  uid,
  { zone = 'America/Los_Angeles', devices = 1, platforms = [], ...fields } = {},
) {
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
      .set({ token, enabled: true, platform: platforms[index] ?? 'web' })
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
      // The sun rises in Mumbai at about 6:04am: no window before it, though UV is low.
      'pro-mumbai': ['Asia/Kolkata', 5, 1, '🏃 Run: 6:05am to 10am'],
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
        assert.match(send.messages[0].data.body, /Lowest-UV window: Run /)
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

  test('plans a group by its most sensitive person, as the dashboard does', async () => {
    // A family in group mode: the dark-skinned parent is the active profile (so the live
    // skinType is theirs), and the very fair child is in the group.
    const family = {
      skinType: 'dark',
      activeProfileId: 'me',
      profiles: [
        { id: 'me', name: 'Me', skinType: 'dark' },
        { id: 'kid', name: 'Kid', skinType: 'very-fair' },
      ],
    }
    await addUser('group', { ...family, groupMode: true })
    await addUser('single', family)
    const messaging = new FakeMessaging()
    await run(messaging, Date.parse('2026-06-15T14:30:00Z')) // 7:30 in Los Angeles
    const body = uid => messaging.sentTo(uid)[0][0].data.body
    // UV peaks at 8: about 13 minutes for very fair skin, 63 for dark.
    assert.match(body('group'), /burn in about 13 min/)
    assert.match(body('single'), /burn in about 63 min/)
  })

  test('reads activities and profiles through the app schema and skips invalid ones', async () => {
    await addUser('odd', {
      skinType: 'purple',
      profiles: 'everyone',
      groupMode: true,
      activities: [
        {
          id: 'run',
          name: 'Run',
          icon: '🏃'.repeat(2000),
          maxUV: 3,
          durationMins: 60,
          shade: 'toString',
        },
        'not an activity',
        { id: 7, name: 'Bad id' },
      ],
    })
    const messaging = new FakeMessaging()
    const result = await run(messaging, Date.parse('2026-06-15T14:30:00Z'))
    assert.equal(result.sent.morning, 1)
    const [message] = messaging.sentTo('odd')[0]
    // The over-long icon falls back to the default, the unknown shade to open sun, and an
    // unknown skin type to fair (about 19 minutes at UV 8).
    assert.equal(message.data.title, '☀️ Run: 7am to 10am')
    assert.match(message.data.body, /burn in about 19 min/)
    assert.doesNotMatch(message.data.body, /NaN/)
  })
})

describe('UV alerts', () => {
  test('once a day when the UV reaches the threshold, outside quiet hours, apart from the morning alert', async () => {
    await addUser('uv', { uvAlertThreshold: 6, notificationHour: 10 })
    // Quiet until noon: the UV reaches 6 (5.5, between 11am's 5 and noon's 6.5) at 11:20am,
    // so the alert may go from 10:20, but waits.
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
    assert.ok(at >= 10 && at < 14, `uv at ${at}`)
    // The morning alert (10:00) and the UV alert never go out in the same run.
    const morning = sends.find(
      send =>
        send.messages[0].token.startsWith('uv-token-') &&
        send.messages[0].data.deliveryKey.startsWith('morning-'),
    )
    assert.notEqual(morning.at, first.at)
    assert.equal(first.messages[0].data.title, '☀️ UV reaches 6 around 11:20am')

    const [quiet] = uvSends('uv-quiet')
    assert.equal(uvSends('uv-quiet').length, 1)
    assert.equal(localTime(new Date(quiet.at), 'America/Los_Angeles').hour, 12)
    assert.equal(quiet.messages[0].data.title, '☀️ UV is 6 or higher now')

    assert.equal(uvSends('uv-never').length, 0)
  })
})

describe('push payloads by platform', () => {
  test('an Android device gets a high-priority notification, the web stays data-only', async () => {
    await addUser('mixed', { devices: 2, platforms: ['web', 'android'], uvAlertThreshold: 6 })
    const messaging = new FakeMessaging()
    const sends = recording(messaging)
    await runRecordedDay(messaging)

    const mine = sends.filter(send => send.messages[0].token.startsWith('mixed-token-'))
    const kinds = mine.map(send => send.messages[0].data.deliveryKey.split('-')[0]).sort()
    assert.deepEqual(kinds, ['morning', 'uv'])
    for (const { messages } of mine) {
      const web = messages.find(message => message.token === 'mixed-token-0')
      const android = messages.find(message => message.token === 'mixed-token-1')
      const key = web.data.deliveryKey
      // The web push worker shows the message itself, so it carries no notification.
      assert.equal(web.notification, undefined)
      assert.deepEqual(web.android, { collapseKey: key, ttl: 3_600_000 })
      assert.equal(web.webpush.headers.TTL, '3600')
      // Android shows it from the system tray, on time through Doze, replacing a resent copy.
      assert.deepEqual(android.android, {
        collapseKey: key,
        ttl: 3_600_000,
        priority: 'high',
        notification: {
          title: web.data.title,
          body: web.data.body,
          channelId: 'solara-alerts',
          tag: key,
        },
      })
      assert.equal(android.webpush, undefined)
      assert.deepEqual(android.data, web.data)
    }
  })
})

describe('event heads-ups', () => {
  const at = (iso, hour) => new Date(Date.parse(`${iso}T00:00:00Z`) + (hour + 7) * 3_600_000)

  async function addEvent(uid, key, { title, start, hours = 1.5, ...fields }) {
    await db
      .collection('users')
      .doc(uid)
      .collection('events')
      .doc(key)
      .set({
        key,
        source: 'file',
        seriesId: 'f'.repeat(32),
        title,
        start: start.toISOString(),
        end: new Date(start.getTime() + hours * 3_600_000).toISOString(),
        timeZone: 'America/Los_Angeles',
        where: '',
        lat: 34.05,
        lon: -118.24,
        placeLabel: 'Griffith Park',
        placeGuessed: false,
        // Running: an outdoor activity of the account's (addUser), so it gets heads-ups.
        activityId: 'run',
        url: '',
        createdAt: '2026-06-01T00:00:00.000Z',
        updatedAt: '2026-06-01T00:00:00.000Z',
        ...fields,
      })
  }

  async function runDay(messaging, withEvents = true) {
    const lookups = []
    for (let now = DAY_START; now < DAY_START + 24 * 3_600_000; now += QUARTER_HOUR) {
      messaging.now = now
      await runAlerts({
        db,
        messaging,
        forecast: async place => forecastFor(place, now),
        ...(withEvents
          ? {
              eventForecast: async (place, uid) => {
                lookups.push(uid)
                return forecastFor(place, now)
              },
            }
          : {}),
        appUrl: 'https://solara.example',
        now: () => now,
      })
    }
    return lookups
  }

  const eventSends = (sends, uid) =>
    sends.filter(
      send =>
        send.messages[0].token.startsWith(`${uid}-token-`) &&
        send.messages[0].data.deliveryKey.startsWith('event-v1:'),
    )

  test('one heads-up a few hours before a high-UV event, only for Pro with heads-ups on', async () => {
    const run = 'a'.repeat(32)
    const evening = 'b'.repeat(32)
    for (const uid of ['pro', 'pro-off', 'free']) {
      await addUser(uid, {
        ...(uid === 'pro-off' ? { eventHeadsUp: false } : {}),
        ...(uid === 'free' ? { tier: 'free', subscriptionStatus: null } : {}),
      })
      // UV peaks at 8 at 1pm; the evening event has no UV.
      await addEvent(uid, run, { title: 'Saturday 10K', start: at('2026-06-15', 13) })
      await addEvent(uid, evening, { title: 'Sunset walk', start: at('2026-06-15', 20) })
    }
    const messaging = new FakeMessaging()
    const sends = recording(messaging)
    await runDay(messaging)

    const [heads] = eventSends(sends, 'pro')
    assert.equal(eventSends(sends, 'pro').length, 1)
    assert.equal(localTime(new Date(heads.at), 'America/Los_Angeles').hour, 10)
    assert.equal(heads.messages[0].data.title, '🗓️ UV up to 8.0 during your 1pm event')
    assert.equal(heads.messages[0].data.deliveryKey, `event-v1:${run}`)
    assert.match(
      heads.messages[0].data.body,
      /^Event: “Saturday 10K”\. Forecast for Griffith Park: UV peaks at 8\.0/,
    )
    // The morning alert still came, in another run.
    const morning = sends.filter(
      send =>
        send.messages[0].token.startsWith('pro-token-') &&
        send.messages[0].data.deliveryKey.startsWith('morning-'),
    )
    assert.equal(morning.length, 1)
    assert.notEqual(morning[0].at, heads.at)

    assert.equal(eventSends(sends, 'pro-off').length, 0)
    assert.equal(eventSends(sends, 'free').length, 0)

    const state = (
      await db.collection('users').doc('pro').collection('alertState').doc('events').get()
    ).data()
    assert.equal(state[run].status, 'delivered')
    assert.equal(state[evening], undefined)
  })

  test('an event that starts early gets its heads-up the evening before, outside quiet hours', async () => {
    const early = 'c'.repeat(32)
    await addUser('pro')
    // 7am start: 4am is in quiet hours (9pm-7am), so 8pm the evening before.
    await addEvent('pro', early, { title: 'Dawn run', start: at('2026-06-15', 7), hours: 6 })
    const messaging = new FakeMessaging()
    const sends = recording(messaging)
    await runDay(messaging)
    const [heads] = eventSends(sends, 'pro')
    assert.equal(eventSends(sends, 'pro').length, 1)
    const local = localTime(new Date(heads.at), 'America/Los_Angeles')
    assert.equal(local.date, '2026-06-14')
    assert.equal(local.hour, 20)
    assert.equal(heads.messages[0].data.title, '🗓️ UV up to 6.5 during your event tomorrow at 7am')
  })

  test('nothing is sent while event heads-ups are switched off', async () => {
    await addUser('pro')
    await addEvent('pro', 'd'.repeat(32), { title: 'Saturday 10K', start: at('2026-06-15', 13) })
    const messaging = new FakeMessaging()
    const sends = recording(messaging)
    await runDay(messaging, false)
    assert.equal(eventSends(sends, 'pro').length, 0)
  })

  const key = n => n.toString(16).padStart(32, '0')
  const titlesOf = (sends, uid) =>
    eventSends(sends, uid).map(
      send =>
        `${localTime(new Date(send.at), 'America/Los_Angeles').hour}h ${send.messages[0].data.title}`,
    )

  test('meetings and other events without an outdoor activity get none (REVIEW5 M3)', async () => {
    await addUser('pro')
    // The review's probe: four midday meetings from a linked work calendar.
    for (const [n, hour] of [11, 12, 13, 14].entries()) {
      await addEvent('pro', key(n + 1), {
        title: `Team sync ${hour}`,
        start: at('2026-06-15', hour),
        hours: 0.5,
        activityId: '',
        source: 'feed',
        feedId: 'c'.repeat(32),
      })
    }
    // An event read from Google Calendar with no matching activity (lib/google-events.ts
    // stores it with activityId '' from matchActivity) gets none either, however high
    // the UV.
    await addEvent('pro', key(7), {
      title: 'Client lunch at Balboa Park',
      start: at('2026-06-15', 12),
      activityId: '',
      source: 'google',
    })
    // An activity the person has since removed counts as none, too.
    await addEvent('pro', key(9), {
      title: 'Golf',
      start: at('2026-06-15', 13),
      activityId: 'golf',
    })
    const messaging = new FakeMessaging()
    const sends = recording(messaging)
    await runDay(messaging)
    assert.deepEqual(titlesOf(sends, 'pro'), [])
  })

  test('the same event from a file, a linked calendar and Google Calendar gets one heads-up (REVIEW5 M3)', async () => {
    await addUser('pro')
    await addEvent('pro', key(1), { title: 'Saturday 10K', start: at('2026-06-15', 13) })
    await addEvent('pro', key(2), {
      title: 'SATURDAY 10K!',
      start: new Date(at('2026-06-15', 13).getTime() + 15 * 60_000),
      source: 'feed',
      feedId: 'c'.repeat(32),
    })
    // The same race read from Google Calendar too.
    await addEvent('pro', key(4), {
      title: 'Saturday 10K',
      start: at('2026-06-15', 13),
      source: 'google',
    })
    const messaging = new FakeMessaging()
    const sends = recording(messaging)
    await runDay(messaging)
    assert.deepEqual(titlesOf(sends, 'pro'), ['10h 🗓️ UV up to 8.0 during your 1pm event'])

    // Linking the calendar again stores the event under a new key: still no second push,
    // even with the 3-hour gap long past (the first heads-up moved a day back).
    await db.collection('users').doc('pro').collection('events').doc(key(2)).delete()
    const stateRef = db.collection('users').doc('pro').collection('alertState').doc('events')
    await stateRef.update({ [`${key(1)}.claimedAt`]: new Date(DAY_START - 86_400_000) })
    await addEvent('pro', key(3), {
      title: 'Saturday 10K',
      start: at('2026-06-15', 13),
      source: 'feed',
      feedId: 'd'.repeat(32),
    })
    const again = new FakeMessaging()
    const later = recording(again)
    await runDay(again)
    assert.deepEqual(titlesOf(later, 'pro'), [])
  })

  test('at most one heads-up every 3 hours, standing for the other events due (REVIEW5 M3)', async () => {
    await addUser('pro')
    // Runs at 12, 1, 2 and 3pm (UV 6.5, 8, 6.5 and 5): due from 9, 10, 11am and noon.
    for (const [n, hour] of [12, 13, 14, 15].entries()) {
      await addEvent('pro', key(n + 1), {
        title: `Club run ${hour}`,
        start: at('2026-06-15', hour),
      })
    }
    const messaging = new FakeMessaging()
    const sends = recording(messaging)
    await runDay(messaging)
    const titles = titlesOf(sends, 'pro')
    // 9am: the noon run, the only one due. The 1pm run's heads-up is held back at 10 and
    // 11; at noon, three hours on, it is still due (until 12:45) and named, and the 2pm
    // run (due from 11) is counted with it. The 3pm run peaks at 5: no heads-up.
    assert.equal(titles.length, 2)
    assert.equal(titles[0], '9h 🗓️ UV up to 8.0 during your 12pm event')
    assert.equal(titles[1], '12h 🗓️ UV up to 8.0 during your 1pm event')
    const [, second] = eventSends(sends, 'pro')
    assert.match(
      second.messages[0].data.body,
      / 1 more of your events coming up reaches high UV too\.$/,
    )
    const state = (
      await db.collection('users').doc('pro').collection('alertState').doc('events').get()
    ).data()
    assert.equal(state[key(1)].status, 'delivered')
    assert.equal(state[key(2)].status, 'delivered')
    assert.equal(state[key(3)].status, 'covered')
    assert.equal(state[key(3)].by, key(2))
    // The state names events by key and a hash of the title, never by their text.
    assert.doesNotMatch(JSON.stringify(state), /Club run/)
  })

  test('looks at every event in the window, not just the soonest five (REVIEW5 M3)', async () => {
    await addUser('pro')
    // Ten indoor events start first; the race after them is the one that matters.
    for (let n = 0; n < 10; n += 1) {
      await addEvent('pro', key(n + 1), {
        title: `Meeting ${n}`,
        start: new Date(at('2026-06-15', 12).getTime() + n * 60_000),
        activityId: '',
      })
    }
    await addEvent('pro', key(20), { title: 'Saturday 10K', start: at('2026-06-15', 13) })
    const messaging = new FakeMessaging()
    const sends = recording(messaging)
    await runDay(messaging)
    assert.deepEqual(titlesOf(sends, 'pro'), ['10h 🗓️ UV up to 8.0 during your 1pm event'])
  })

  test("a calendar publisher's title is quoted as the event's name, cleaned and short (REVIEW5 L4)", async () => {
    await addUser('pro')
    await addEvent('pro', key(1), {
      title: 'Run \u202eYour Solara Pro payment failed, update it at evil.example',
      start: at('2026-06-15', 13),
      source: 'feed',
      feedId: 'c'.repeat(32),
    })
    const messaging = new FakeMessaging()
    const sends = recording(messaging)
    await runDay(messaging)
    const [heads] = eventSends(sends, 'pro')
    assert.equal(heads.messages[0].data.title, '🗓️ UV up to 8.0 during your 1pm event')
    assert.match(heads.messages[0].data.body, /^Event: “Run Your Solara Pro payment failed…”\. /)
    assert.doesNotMatch(heads.messages[0].data.body, /evil|\u202e/)
  })

  test('an outdoor event shortly after another is counted in the first push (REVIEW6 L2)', async () => {
    await addUser('pro')
    // A Kids 1K at noon and the Main 10K at 12:15, both with high UV. The 1K's heads-up
    // goes out at 9; the 10K's own would be due only until noon, when the 3-hour gap
    // ends, so the 9am push stands for it.
    await addEvent('pro', key(1), { title: 'Kids 1K', start: at('2026-06-15', 12) })
    await addEvent('pro', key(2), {
      title: 'Main 10K',
      start: new Date(at('2026-06-15', 12).getTime() + 15 * 60_000),
    })
    const messaging = new FakeMessaging()
    const sends = recording(messaging)
    await runDay(messaging)
    assert.deepEqual(titlesOf(sends, 'pro'), ['9h 🗓️ UV up to 8.0 during your 12pm event'])
    const [heads] = eventSends(sends, 'pro')
    assert.match(
      heads.messages[0].data.body,
      /^Event: “Kids 1K”\..* 1 more of your events coming up reaches high UV too\.$/,
    )
    const state = (
      await db.collection('users').doc('pro').collection('alertState').doc('events').get()
    ).data()
    assert.equal(state[key(1)].status, 'delivered')
    assert.equal(state[key(2)].status, 'covered')
    assert.equal(state[key(2)].by, key(1))
  })

  test("an early start due only the evening before is counted in that evening's push (REVIEW6 L2)", async () => {
    await addUser('pro')
    // An overnight trek from 9pm to 1pm (UV 8 in the morning) is due from 6pm; a 7am
    // race the next morning only from 8pm to 9pm (quiet hours until 7am), inside the gap
    // after the 6pm push.
    await addEvent('pro', key(1), {
      title: 'Overnight trek',
      start: at('2026-06-14', 21),
      hours: 16,
    })
    await addEvent('pro', key(2), { title: 'Dawn 5K', start: at('2026-06-15', 7), hours: 6 })
    const messaging = new FakeMessaging()
    const sends = recording(messaging)
    // The evening before, from 5pm to midnight.
    for (let now = DAY_START; now < DAY_START + 7 * 3_600_000; now += QUARTER_HOUR) {
      messaging.now = now
      await runAlerts({
        db,
        messaging,
        forecast: async place => forecastFor(place, now),
        eventForecast: async place => forecastFor(place, now),
        appUrl: 'https://solara.example',
        now: () => now,
      })
    }
    const pushes = eventSends(sends, 'pro')
    assert.equal(pushes.length, 1)
    assert.equal(localTime(new Date(pushes[0].at), 'America/Los_Angeles').hour, 18)
    assert.match(pushes[0].messages[0].data.body, / 1 more of your events coming up reaches/)
    const state = (
      await db.collection('users').doc('pro').collection('alertState').doc('events').get()
    ).data()
    assert.equal(state[key(2)].status, 'covered')
  })

  test("accounts with many outdoor events at new places cannot spend everyone else's lookups (REVIEW6 M1)", async () => {
    // The review's probe: ten accounts with 20 outdoor events each at places nobody else
    // asked for, whose forecasts fail (as when an account's share of the budget is spent,
    // or would be low), so nothing is claimed and every run repeats them; 'zzz' sorts
    // after them and has a high-UV race due at 9am. Homes in London, so no home forecast
    // of Los Angeles is in the run, and no daily alert is due.
    const quietHome = { zone: 'Europe/London', uvAlertThreshold: null }
    await addUser('zzz', quietHome)
    const writes = []
    for (let a = 0; a < 10; a += 1) {
      await addUser(`aa${a}`, quietHome)
      for (let n = 0; n < 20; n += 1) {
        writes.push(
          addEvent(`aa${a}`, key(n + 1), {
            title: `Ride ${n}`,
            start: at('2026-06-15', 11),
            lat: Number((10 + (a * 20 + n) * 0.02).toFixed(2)),
            lon: 20,
          }),
        )
      }
    }
    await Promise.all(writes)
    await addEvent('zzz', key(900), { title: 'Saturday 10K', start: at('2026-06-15', 12) })

    const runAt = async (hour, limits) => {
      const now = DAY_START + (hour + 7) * 3_600_000
      const messaging = new FakeMessaging()
      const sends = recording(messaging)
      messaging.now = now
      const lookups = {}
      const eventForecast = async (place, uid) => {
        lookups[uid] = (lookups[uid] ?? 0) + 1
        if (place.lat < 30) throw new Error('no forecast for this place')
        return forecastFor(place, now)
      }
      const result = await runAlerts({
        db,
        messaging,
        forecast: async place => forecastFor(place, now),
        eventForecast,
        appUrl: 'https://solara.example',
        now: () => now,
        limits,
      })
      return { pushes: eventSends(sends, 'zzz'), lookups, result }
    }

    // With the run's default caps: each account looks up at most 10 places, and the
    // victim gets its heads-up in the first run.
    const first = await runAt(9)
    assert.equal(first.pushes.length, 1)
    assert.equal(first.pushes[0].messages[0].data.title, '🗓️ UV up to 8.0 during your 12pm event')
    for (let a = 0; a < 10; a += 1) assert.equal(first.lookups[`aa${a}`], 10)
    assert.equal(first.result.outcomes.sent, 1)

    // With a run cap smaller than the accounts want (30 places for 11 accounts wanting
    // 101), the lookups go one per account per round, so the victim is still served.
    await db.collection('users').doc('zzz').collection('alertState').doc('events').delete()
    const tight = await runAt(9.25, { maxEventForecasts: 30 })
    assert.equal(tight.pushes.length, 1)
    const total = Object.values(tight.lookups).reduce((sum, n) => sum + n, 0)
    assert.equal(total, 30)
    for (let a = 0; a < 10; a += 1) assert.ok(tight.lookups[`aa${a}`] <= 3)
    assert.equal(tight.result.outcomes['forecast-limit'], 10)
  })
})
