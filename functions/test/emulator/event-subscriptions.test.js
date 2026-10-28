// Linked calendars (src/events/subscriptions.ts) against the real Firestore emulator (run
// by `npm run test:rules`): adding, refreshing and removing a link writes its events with
// the per-account key list kept exactly as the rules require, the link never reaches the
// owner-readable summary, failing links back off and pause, the per-account caps hold,
// and an account's deletion takes its links along.
const { after, afterEach, before, describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { deleteApp, initializeApp } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')

const {
  SUBSCRIPTIONS_COLLECTION,
  addSubscription,
  deleteEventSubscriptionsForUser,
  refreshSubscription,
  refreshSubscriptionNow,
  removeSubscription,
  runSubscriptionRefresh,
} = require('../../lib/events/subscriptions')

const projectId = 'demo-solara-event-links'
let app
let db

const NOW = Date.parse('2026-06-15T17:00:00Z')
const HOUR = 3_600_000
const DAY = 24 * HOUR
const LINK = 'https://www.meetup.com/la-trail-runners/events/ical/?token=secret'

function stamp(ms) {
  return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')
}

/** An .ics file with one VEVENT per entry. */
function calendar(events, name = 'LA Trail Runners') {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//test//EN', `X-WR-CALNAME:${name}`]
  for (const { uid, title, start, hours = 1.5, location, geo } of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `SUMMARY:${title}`,
      `DTSTART:${stamp(start)}`,
      `DTEND:${stamp(start + hours * HOUR)}`,
      ...(location ? [`LOCATION:${location}`] : []),
      ...(geo ? [`GEO:${geo}`] : []),
      'END:VEVENT',
    )
  }
  lines.push('END:VCALENDAR')
  return lines.join('\r\n')
}

const RUNS = [
  {
    uid: 'run-1',
    title: 'Griffith Park trail run',
    start: NOW + 20 * HOUR,
    geo: '34.14;-118.29',
    location: 'Griffith Park, Los Angeles',
  },
  { uid: 'run-2', title: 'Sunset run', start: NOW + 2 * DAY, location: 'Santa Monica, CA' },
  { uid: 'run-3', title: 'Beach volleyball', start: NOW + 3 * DAY },
]

/** A fake fetcher: answers from `files` by link, or the given failure. */
function fetcher(files) {
  const calls = []
  const fetchCalendar = async (url, validators) => {
    calls.push({ url, validators })
    const entry = files[url]
    if (!entry) return { ok: false, error: 'unreachable' }
    if (entry.error) return { ok: false, error: entry.error }
    return {
      ok: true,
      notModified: false,
      text: entry.text,
      etag: entry.etag ?? null,
      lastModified: null,
    }
  }
  fetchCalendar.calls = calls
  return fetchCalendar
}

function deps(files, { now = NOW, searchPlace } = {}) {
  return {
    db,
    fetchCalendar: fetcher(files),
    searchPlace:
      searchPlace ??
      (async (_uid, query) =>
        /santa monica/i.test(query)
          ? [{ name: 'Santa Monica', admin1: 'California', latitude: 34.02, longitude: -118.49 }]
          : []),
    now: () => now,
  }
}

async function addUser(uid, fields = {}) {
  await db
    .collection('users')
    .doc(uid)
    .set({
      uid,
      tier: 'free',
      skinType: 'fair',
      activities: [{ id: 'run', name: 'Run', icon: '🏃', maxUV: 3, durationMins: 60 }],
      location: {
        lat: 34.05,
        lon: -118.24,
        city: 'Los Angeles',
        region: 'California',
        timezone: 'America/Los_Angeles',
      },
      ...fields,
    })
}

const userRef = uid => db.collection('users').doc(uid)
async function events(uid) {
  const snapshot = await userRef(uid).collection('events').get()
  return new Map(snapshot.docs.map(doc => [doc.id, doc.data()]))
}
async function listed(uid) {
  return Object.keys((await userRef(uid).collection('meta').doc('events').get()).data()?.ids ?? {})
}
async function summary(uid) {
  return (await userRef(uid).collection('private').doc('eventSubscriptions').get()).data()
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
  app = initializeApp({ projectId }, 'event-links-emulator-test')
  db = getFirestore(app)
})

afterEach(clearFirestore)

after(async () => {
  await deleteApp(app)
})

describe('adding a link', () => {
  test('stores the link server-side, its events and their keys, and a summary without the link', async () => {
    await addUser('alice')
    const added = await addSubscription(
      deps({ [LINK]: { text: calendar(RUNS) } }),
      'alice',
      `  ${LINK.replace('https', 'webcal')}  `,
      '',
    )

    assert.equal(added.label, 'LA Trail Runners')
    assert.equal(added.host, 'www.meetup.com')
    assert.equal(added.status, 'active')
    assert.equal(added.eventCount, 3)
    assert.equal(added.nextRefreshAt, new Date(NOW + 6 * HOUR).toISOString())

    const link = (await db.collection(SUBSCRIPTIONS_COLLECTION).doc(added.id).get()).data()
    assert.equal(link.uid, 'alice')
    assert.equal(link.url, LINK)
    const stored = await summary('alice')
    assert.deepEqual(Object.keys(stored.items), [added.id])
    assert.doesNotMatch(JSON.stringify(stored), /secret|ical\//)

    const saved = await events('alice')
    assert.equal(saved.size, 3)
    assert.deepEqual((await listed('alice')).sort(), [...saved.keys()].sort())
    const byTitle = Object.fromEntries([...saved.values()].map(e => [e.title, e]))
    for (const event of saved.values()) {
      assert.equal(event.source, 'feed')
      assert.equal(event.feedId, added.id)
      assert.ok(event.expireAt.toMillis() > Date.parse(event.end))
    }
    // GEO named by its LOCATION; LOCATION searched; no place uses the person's own.
    assert.equal(byTitle['Griffith Park trail run'].placeLabel, 'Griffith Park')
    assert.equal(byTitle['Griffith Park trail run'].activityId, 'run')
    assert.equal(byTitle['Sunset run'].placeLabel, 'Santa Monica, California')
    assert.equal(byTitle['Beach volleyball'].placeGuessed, true)
    assert.equal(byTitle['Beach volleyball'].placeLabel, 'Los Angeles, California')
  })

  test('refuses a link that cannot be read, a duplicate, and a sixth link', async () => {
    await addUser('alice')
    await assert.rejects(addSubscription(deps({}), 'alice', LINK, ''), {
      code: 'invalid-argument',
      message: /could not be reached/,
    })
    assert.equal((await db.collection(SUBSCRIPTIONS_COLLECTION).get()).size, 0)
    await assert.rejects(addSubscription(deps({}), 'alice', 'http://example.com/a.ics', ''), {
      code: 'invalid-argument',
    })

    const files = {}
    for (let i = 0; i < 6; i++) files[`https://cal${i}.example.com/a.ics`] = { text: calendar([]) }
    for (let i = 0; i < 5; i++) {
      await addSubscription(
        deps(files),
        'alice',
        `https://cal${i}.example.com/a.ics`,
        `Calendar ${i}`,
      )
    }
    await assert.rejects(
      addSubscription(deps(files), 'alice', 'https://cal0.example.com/a.ics', ''),
      {
        code: 'conflict',
        message: /already linked/,
      },
    )
    await assert.rejects(
      addSubscription(deps(files), 'alice', 'https://cal5.example.com/a.ics', ''),
      {
        code: 'conflict',
        message: /up to 5 calendars/,
      },
    )
    assert.equal(Object.keys((await summary('alice')).items).length, 5)
  })

  test('refuses a link while the account is being deleted', async () => {
    await addUser('alice')
    await db.collection('accountDeletionTombstones').doc('alice').set({ cleanupStatus: 'pending' })
    await assert.rejects(
      addSubscription(deps({ [LINK]: { text: calendar(RUNS) } }), 'alice', LINK, ''),
      {
        code: 'deletion-in-progress',
      },
    )
    assert.equal((await events('alice')).size, 0)
  })
})

describe('refreshing', () => {
  test('replaces upcoming events with the link’s, keeping the place and activity the person set', async () => {
    await addUser('alice')
    const added = await addSubscription(
      deps({ [LINK]: { text: calendar(RUNS) } }),
      'alice',
      LINK,
      '',
    )
    const before = await events('alice')
    const volleyball = [...before.entries()].find(([, e]) => e.title === 'Beach volleyball')
    // The person sets the place and activity (the rules allow only these fields).
    await userRef('alice').collection('events').doc(volleyball[0]).update({
      lat: 33.77,
      lon: -118.19,
      placeLabel: 'Long Beach, California',
      placeGuessed: false,
      activityId: 'run',
    })

    const later = NOW + 6 * HOUR
    const changed = calendar([
      RUNS[0],
      RUNS[2],
      { uid: 'run-4', title: 'Track night', start: NOW + 4 * DAY },
    ])
    const result = await refreshSubscription(
      deps({ [LINK]: { text: changed } }, { now: later }),
      added.id,
    )
    assert.equal(result.outcome, 'refreshed')
    assert.equal(result.summary.eventCount, 3)

    const after = await events('alice')
    assert.deepEqual([...after.values()].map(e => e.title).sort(), [
      'Beach volleyball',
      'Griffith Park trail run',
      'Track night',
    ])
    const kept = after.get(volleyball[0])
    assert.equal(kept.placeLabel, 'Long Beach, California')
    assert.equal(kept.activityId, 'run')
    assert.deepEqual((await listed('alice')).sort(), [...after.keys()].sort())
  })

  test('backs off while a link fails, pauses it after a week, and a manual refresh resumes it', async () => {
    await addUser('alice')
    const added = await addSubscription(
      deps({ [LINK]: { text: calendar(RUNS) } }),
      'alice',
      LINK,
      '',
    )
    const failing = deps({ [LINK]: { error: 'timeout' } })

    let now = NOW + 6 * HOUR
    let result = await refreshSubscription({ ...failing, now: () => now }, added.id)
    assert.equal(result.outcome, 'failed')
    assert.equal(result.summary.status, 'failing')
    assert.equal(result.summary.error, 'timeout')
    assert.equal(result.summary.nextRefreshAt, new Date(now + 6 * HOUR).toISOString())
    // Events stay while the link fails.
    assert.equal((await events('alice')).size, 3)

    now += 6 * HOUR
    result = await refreshSubscription({ ...failing, now: () => now }, added.id)
    assert.equal(result.summary.nextRefreshAt, new Date(now + 12 * HOUR).toISOString())

    now = NOW + 6 * HOUR + 7 * DAY
    result = await refreshSubscription({ ...failing, now: () => now }, added.id)
    assert.equal(result.outcome, 'paused')
    assert.equal(result.summary.status, 'paused')
    assert.equal(result.summary.nextRefreshAt, '')
    const link = (await db.collection(SUBSCRIPTIONS_COLLECTION).doc(added.id).get()).data()
    assert.equal(link.due, undefined)

    // A paused link is not due for the scheduled run.
    const run = await runSubscriptionRefresh({ ...failing, now: () => now + 30 * DAY })
    assert.equal(run.due, 0)

    const resumed = await refreshSubscriptionNow(
      deps({ [LINK]: { text: calendar(RUNS) } }, { now: now + HOUR }),
      'alice',
      added.id,
    )
    assert.equal(resumed.status, 'active')
    await assert.rejects(
      refreshSubscriptionNow(
        deps({ [LINK]: { text: calendar(RUNS) } }, { now: now + HOUR + 60_000 }),
        'alice',
        added.id,
      ),
      { code: 'rate-limited' },
    )
    await assert.rejects(refreshSubscriptionNow(deps({}), 'mallory', added.id), {
      code: 'not-found',
    })
  })

  test('the scheduled run takes due links oldest first, within its limit', async () => {
    await addUser('alice')
    await addUser('bob')
    const files = {
      'https://a.example.com/a.ics': { text: calendar(RUNS) },
      'https://b.example.com/b.ics': { text: calendar(RUNS) },
    }
    await addSubscription(deps(files), 'alice', 'https://a.example.com/a.ics', '')
    await addSubscription(
      deps(files, { now: NOW + HOUR }),
      'bob',
      'https://b.example.com/b.ics',
      '',
    )

    assert.equal((await runSubscriptionRefresh(deps(files, { now: NOW + 2 * HOUR }))).due, 0)
    const first = deps(files, { now: NOW + 8 * HOUR })
    const result = await runSubscriptionRefresh(first, { maxLinks: 1 })
    assert.deepEqual(result, { due: 1, outcomes: { refreshed: 1 }, backlog: true })
    assert.equal(first.fetchCalendar.calls[0].url, 'https://a.example.com/a.ics')
  })

  test('removes the link of an account that no longer exists', async () => {
    await addUser('alice')
    const added = await addSubscription(
      deps({ [LINK]: { text: calendar(RUNS) } }),
      'alice',
      LINK,
      '',
    )
    await db.recursiveDelete(userRef('alice'))
    const result = await refreshSubscription(
      deps({ [LINK]: { text: calendar(RUNS) } }, { now: NOW + 7 * HOUR }),
      added.id,
    )
    assert.equal(result.outcome, 'removed-orphan')
    assert.equal((await db.collection(SUBSCRIPTIONS_COLLECTION).doc(added.id).get()).exists, false)
  })
})

describe('the per-account event cap', () => {
  test('a refresh never lists more than 1,000 keys and counts what did not fit', async () => {
    await addUser('alice')
    // 998 events already stored and listed.
    const ids = {}
    for (let start = 0; start < 998; start += 400) {
      const batch = db.batch()
      for (let i = start; i < Math.min(998, start + 400); i++) {
        const key = i.toString(16).padStart(32, '0')
        ids[key] = true
        batch.set(userRef('alice').collection('events').doc(key), {
          key,
          end: '2026-07-01T00:00:00.000Z',
        })
      }
      await batch.commit()
    }
    await userRef('alice').collection('meta').doc('events').set({ ids, removed: [] })

    const added = await addSubscription(
      deps({ [LINK]: { text: calendar(RUNS) } }),
      'alice',
      LINK,
      '',
    )
    assert.equal(added.eventCount, 2)
    assert.equal(added.refused, 1)
    assert.equal((await listed('alice')).length, 1000)
  })

  test('keys of records already deleted by the TTL policy make room', async () => {
    await addUser('alice')
    const ids = {}
    for (let i = 0; i < 1000; i++) ids[i.toString(16).padStart(32, '0')] = true
    await userRef('alice').collection('meta').doc('events').set({ ids, removed: [] })
    const added = await addSubscription(
      deps({ [LINK]: { text: calendar(RUNS) } }),
      'alice',
      LINK,
      '',
    )
    assert.equal(added.eventCount, 3)
    assert.equal(added.refused, 0)
    assert.deepEqual((await listed('alice')).sort(), [...(await events('alice')).keys()].sort())
  })
})

describe('removing', () => {
  test('removing a link deletes it, its summary entry, its events and their keys only', async () => {
    await addUser('alice')
    await userRef('alice')
      .collection('events')
      .doc('f'.repeat(32))
      .set({ key: 'f'.repeat(32), source: 'file' })
    await userRef('alice')
      .collection('meta')
      .doc('events')
      .set({ ids: { ['f'.repeat(32)]: true }, removed: [] })
    const added = await addSubscription(
      deps({ [LINK]: { text: calendar(RUNS) } }),
      'alice',
      LINK,
      '',
    )
    await assert.rejects(removeSubscription({ db }, 'mallory', added.id), { code: 'not-found' })

    await removeSubscription({ db }, 'alice', added.id)
    assert.equal((await db.collection(SUBSCRIPTIONS_COLLECTION).doc(added.id).get()).exists, false)
    assert.deepEqual((await summary('alice')).items, {})
    assert.deepEqual([...(await events('alice')).keys()], ['f'.repeat(32)])
    assert.deepEqual(await listed('alice'), ['f'.repeat(32)])
    // A refresh that was already under way writes nothing once the link is gone.
    const late = await refreshSubscription(
      deps({ [LINK]: { text: calendar(RUNS) } }, { now: NOW + 7 * HOUR }),
      added.id,
    )
    assert.equal(late.outcome, 'gone')
    assert.equal((await events('alice')).size, 1)
  })

  test('account deletion removes every link of the account', async () => {
    await addUser('alice')
    await addUser('bob')
    await addSubscription(deps({ [LINK]: { text: calendar([]) } }), 'alice', LINK, '')
    await addSubscription(deps({ [LINK]: { text: calendar([]) } }), 'bob', LINK, '')
    assert.equal(await deleteEventSubscriptionsForUser(db, 'alice'), 1)
    const left = await db.collection(SUBSCRIPTIONS_COLLECTION).get()
    assert.deepEqual(
      left.docs.map(doc => doc.data().uid),
      ['bob'],
    )
  })
})
