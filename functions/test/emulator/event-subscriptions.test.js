// Linked calendars (src/events/subscriptions.ts) against the real Firestore emulator (run
// by `npm run test:rules`): adding, refreshing and removing a link writes its events with
// the per-account key list kept exactly as the rules require, the link never reaches the
// owner-readable summary, failing links back off and pause, the per-account caps hold,
// and an account's deletion takes its links along. REVIEW5: a hanging or crashing link
// cannot hold the scheduled run (H1), an unchanged calendar writes nothing (M2), the run
// pages through every due link and reports how far behind it is (M4), a removal can be
// finished after it stops halfway (L2), and nothing is written under a deleted account (L3).
const { after, afterEach, before, describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { deleteApp, initializeApp } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')

const {
  CLAIM_HOLD_MS,
  REMOVAL_RETRY_MS,
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
  const searches = []
  return {
    db,
    fetchCalendar: fetcher(files),
    searchPlace:
      searchPlace ??
      (async (_uid, query) => {
        searches.push(query)
        return /santa monica/i.test(query)
          ? [{ name: 'Santa Monica', admin1: 'California', latitude: 34.02, longitude: -118.49 }]
          : []
      }),
    searches,
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
    assert.deepEqual(result, {
      due: 2,
      taken: 1,
      // The same body as when it was added: nothing to write.
      outcomes: { 'not-modified': 1 },
      backlog: true,
      behindMinutes: 60,
    })
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
    // Nothing is written under the deleted account (REVIEW5 L3).
    assert.equal(
      (await userRef('alice').collection('private').doc('eventSubscriptions').get()).exists,
      false,
    )
    assert.equal((await userRef('alice').collection('events').get()).size, 0)
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

const linkDoc = async id => (await db.collection(SUBSCRIPTIONS_COLLECTION).doc(id).get()).data()

describe('a hanging or crashing link cannot hold the refresh (REVIEW5 H1)', () => {
  test('the run gives up on a link that hangs, refreshes the others, and the link is claimed', async () => {
    const files = {}
    const ids = {}
    for (const name of ['evil', 'a', 'b', 'c']) {
      await addUser(name)
      files[`https://${name}.example.com/cal.ics`] = { text: calendar(RUNS.slice(0, 1)) }
    }
    // The hostile link was added first, so it is the oldest due.
    for (const [i, name] of ['evil', 'a', 'b', 'c'].entries()) {
      ids[name] = (
        await addSubscription(
          deps(files, { now: NOW + i * 60_000 }),
          name,
          `https://${name}.example.com/cal.ics`,
          '',
        )
      ).id
    }
    const later = NOW + 7 * HOUR
    const run = deps(files, { now: later })
    const fetchOthers = run.fetchCalendar
    run.fetchCalendar = (url, validators) =>
      url.includes('evil') ? new Promise(() => {}) : fetchOthers(url, validators)

    const started = Date.now()
    const result = await runSubscriptionRefresh(run, { concurrency: 1, linkMs: 300 })
    assert.ok(Date.now() - started < 20_000)
    assert.equal(result.due, 4)
    // The others answer with the same body as when they were added: nothing to write.
    assert.deepEqual(result.outcomes, { timeout: 1, 'not-modified': 3 })
    assert.equal(result.backlog, false)
    assert.deepEqual(
      fetchOthers.calls.map(call => new URL(call.url).host),
      ['a.example.com', 'b.example.com', 'c.example.com'],
    )
    // Claimed before the fetch: no longer at the head of the queue.
    const evil = await linkDoc(ids.evil)
    assert.equal(evil.claimedAt.toMillis(), later)
    assert.equal(evil.due.toMillis(), later + 6 * HOUR)
    assert.equal((await runSubscriptionRefresh(deps(files, { now: later + HOUR }))).due, 0)

    // The next attempt finds the claim abandoned and counts it as a failure.
    const retry = await refreshSubscription(
      deps(
        { [`https://evil.example.com/cal.ics`]: { text: calendar(RUNS) } },
        {
          now: later + 6 * HOUR,
        },
      ),
      ids.evil,
    )
    assert.equal(retry.outcome, 'refreshed')
    const healed = await linkDoc(ids.evil)
    assert.equal(healed.claimedAt, undefined)
    assert.equal(healed.status, 'active')
  })

  test('a link that crashes every attempt backs off and is paused after a week', async () => {
    await addUser('alice')
    const added = await addSubscription(
      deps({ [LINK]: { text: calendar(RUNS) } }),
      'alice',
      LINK,
      '',
    )
    const crashing = now => ({
      ...deps({}, { now }),
      fetchCalendar: async () => {
        throw new Error('the instance died here')
      },
    })
    let now = NOW + 6 * HOUR
    const waits = []
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const result = await refreshSubscription(crashing(now), added.id).catch(error => error)
      if (!(result instanceof Error)) {
        assert.equal(result.outcome, 'paused')
        break
      }
      const link = await linkDoc(added.id)
      assert.ok(link.due.toMillis() > now, 'claimed before the fetch')
      waits.push((link.due.toMillis() - now) / HOUR)
      now = link.due.toMillis()
    }
    // Each crash counts as a failure at the next attempt, so the waits grow like a failing
    // link's: 6, 12, 24, then 48 hours.
    assert.deepEqual(waits.slice(0, 5), [6, 12, 24, 48, 48])
    const link = await linkDoc(added.id)
    assert.equal(link.status, 'paused')
    assert.equal(link.due, undefined)
    assert.equal(link.claimedAt, undefined)
    const shown = (await summary('alice')).items[added.id]
    assert.equal(shown.status, 'paused')
    assert.equal(shown.error, 'timeout')
    // The person can still try it by hand, which works once the site is fixed.
    const resumed = await refreshSubscriptionNow(
      deps({ [LINK]: { text: calendar(RUNS) } }, { now: now + HOUR }),
      'alice',
      added.id,
    )
    assert.equal(resumed.status, 'active')
  })

  test('a manual refresh while an attempt is running is turned away', async () => {
    await addUser('alice')
    const added = await addSubscription(
      deps({ [LINK]: { text: calendar(RUNS) } }),
      'alice',
      LINK,
      '',
    )
    const hanging = {
      ...deps({}, { now: NOW + 6 * HOUR }),
      fetchCalendar: () => new Promise(() => {}),
    }
    void refreshSubscription(hanging, added.id)
    await new Promise(resolve => setTimeout(resolve, 500))
    await assert.rejects(
      refreshSubscriptionNow(
        deps({ [LINK]: { text: calendar(RUNS) } }, { now: NOW + 6 * HOUR + 60_000 }),
        'alice',
        added.id,
      ),
      { code: 'rate-limited', message: /being refreshed/ },
    )
    // Once the claim is older than any attempt can run, the link is free again.
    const later = await refreshSubscriptionNow(
      deps({ [LINK]: { text: calendar(RUNS) } }, { now: NOW + 6 * HOUR + CLAIM_HOLD_MS + 60_000 }),
      'alice',
      added.id,
    )
    assert.equal(later.status, 'active')
  })
})

describe('refresh cost (REVIEW5 M1, M2)', () => {
  const MANY = Array.from({ length: 150 }, (_, i) => ({
    uid: `e${i}`,
    title: `Race ${i}`,
    start: NOW + (i + 1) * DAY,
    geo: '34.14;-118.29',
    location: 'Griffith Park',
  }))

  test('a refresh of an unchanged calendar writes no event, a changed one only what changed', async () => {
    await addUser('alice')
    const added = await addSubscription(
      deps({ [LINK]: { text: calendar(MANY) } }),
      'alice',
      LINK,
      '',
    )
    const stamps = async () =>
      new Map([...(await events('alice'))].map(([key, value]) => [key, value.updatedAt]))
    const before = await stamps()
    assert.equal(before.size, 150)

    // The site answers in full, with a new etag each time (no 304).
    const result = await refreshSubscription(
      deps({ [LINK]: { text: calendar(MANY), etag: '"v2"' } }, { now: NOW + 6 * HOUR }),
      added.id,
    )
    assert.equal(result.outcome, 'not-modified')
    assert.deepEqual(await stamps(), before)

    // A day later the same body is parsed again; still nothing to write.
    const reparsed = await refreshSubscription(
      deps({ [LINK]: { text: calendar(MANY) } }, { now: NOW + 30 * HOUR }),
      added.id,
    )
    assert.equal(reparsed.outcome, 'refreshed')
    assert.deepEqual(await stamps(), before)

    // One event renamed: only that one is written.
    const renamed = MANY.map((event, i) =>
      i === 7 ? { ...event, title: 'Race 7 (moved)' } : event,
    )
    await refreshSubscription(
      deps({ [LINK]: { text: calendar(renamed) } }, { now: NOW + 36 * HOUR }),
      added.id,
    )
    const after = await stamps()
    const rewritten = [...after].filter(([key, stamp]) => stamp !== before.get(key))
    assert.equal(rewritten.length, 1)
    assert.equal((await events('alice')).get(rewritten[0][0]).title, 'Race 7 (moved)')
    // The first race has ended by now; it stays stored until it expires.
    assert.equal((await linkDoc(added.id)).eventCount, 149)
  })

  test('each LOCATION text is looked up once per link, not on every refresh', async () => {
    await addUser('alice')
    const first = deps({ [LINK]: { text: calendar(RUNS) } })
    const added = await addSubscription(first, 'alice', LINK, '')
    assert.ok(first.searches.length > 0)
    const more = [
      ...RUNS,
      { uid: 'run-9', title: 'Pier run', start: NOW + 4 * DAY, location: 'Santa Monica, CA' },
    ]
    const second = deps({ [LINK]: { text: calendar(more) } }, { now: NOW + 7 * HOUR })
    await refreshSubscription(second, added.id)
    assert.deepEqual(second.searches, [])
    const pier = [...(await events('alice')).values()].find(event => event.title === 'Pier run')
    assert.equal(pier.placeLabel, 'Santa Monica, California')
    assert.equal(pier.placeGuessed, false)
  })

  test('a place found later replaces the guessed one, but never a place the person set', async () => {
    await addUser('alice')
    const failing = async () => {
      throw new Error('budget spent')
    }
    const withPier = [
      ...RUNS,
      { uid: 'run-9', title: 'Pier run', start: NOW + 4 * DAY, location: 'Santa Monica, CA' },
    ]
    const added = await addSubscription(
      deps({ [LINK]: { text: calendar(withPier) } }, { searchPlace: failing }),
      'alice',
      LINK,
      '',
    )
    const byTitle = async () =>
      Object.fromEntries(
        [...(await events('alice'))].map(([key, event]) => [event.title, { key, ...event }]),
      )
    let stored = await byTitle()
    assert.equal(stored['Sunset run'].placeGuessed, true)
    assert.equal(stored['Pier run'].placeGuessed, true)
    // The person sets the pier run's place by hand.
    await userRef('alice').collection('events').doc(stored['Pier run'].key).update({
      lat: 33.77,
      lon: -118.19,
      placeLabel: 'Long Beach, California',
      placeGuessed: false,
    })

    await refreshSubscription(
      deps({ [LINK]: { text: calendar(withPier) } }, { now: NOW + 30 * HOUR }),
      added.id,
    )
    stored = await byTitle()
    assert.equal(stored['Sunset run'].placeLabel, 'Santa Monica, California')
    assert.equal(stored['Sunset run'].placeGuessed, false)
    assert.equal(stored['Pier run'].placeLabel, 'Long Beach, California')
  })
})

describe('the scheduled run scales (REVIEW5 M4)', () => {
  test('it pages through every due link, oldest first, and reports how far behind it is', async () => {
    const files = {}
    for (let i = 0; i < 7; i += 1) {
      await addUser(`u${i}`)
      files[`https://cal${i}.example.com/a.ics`] = { text: calendar([]) }
      await addSubscription(
        deps(files, { now: NOW + i * 60_000 }),
        `u${i}`,
        `https://cal${i}.example.com/a.ics`,
        '',
      )
    }
    const late = NOW + 13 * HOUR
    const run = deps(files, { now: late })
    const result = await runSubscriptionRefresh(run, { pageSize: 2, concurrency: 3, maxLinks: 5 })
    assert.equal(result.due, 7)
    assert.equal(result.taken, 5)
    assert.equal(result.outcomes['not-modified'], 5)
    assert.equal(result.backlog, true)
    // The two left have waited 7 hours past their time: more than a refresh period.
    assert.equal(result.behindMinutes, 7 * 60 - 5)
    assert.deepEqual(
      run.fetchCalendar.calls.map(call => new URL(call.url).host).sort(),
      ['cal0', 'cal1', 'cal2', 'cal3', 'cal4'].map(name => `${name}.example.com`),
    )
    const rest = await runSubscriptionRefresh(deps(files, { now: late + 60_000 }), { pageSize: 2 })
    assert.equal(rest.taken, 2)
    assert.equal(rest.backlog, false)
    assert.equal(rest.behindMinutes, 0)
  })
})

describe('removal (REVIEW5 L2, L3)', () => {
  test('a removal that stopped halfway keeps the link listed, and the scheduled run finishes it', async () => {
    await addUser('alice')
    const added = await addSubscription(
      deps({ [LINK]: { text: calendar(RUNS) } }),
      'alice',
      LINK,
      '',
    )
    // The remove call marked the link and then died before deleting anything.
    await db
      .collection(SUBSCRIPTIONS_COLLECTION)
      .doc(added.id)
      .set({ removing: true, due: new Date(NOW + REMOVAL_RETRY_MS) }, { merge: true })
    assert.deepEqual(Object.keys((await summary('alice')).items), [added.id])

    // A refresh racing the removal writes nothing.
    const racing = await refreshSubscriptionNow(
      deps({ [LINK]: { text: calendar([RUNS[0]]) } }, { now: NOW + 10 * 60_000 }),
      'alice',
      added.id,
    ).catch(error => error)
    assert.equal(racing.code, 'not-found')
    assert.equal((await events('alice')).size, 3)

    const run = await runSubscriptionRefresh(deps({}, { now: NOW + REMOVAL_RETRY_MS + 60_000 }))
    assert.deepEqual(run.outcomes, { removed: 1 })
    assert.equal(await linkDoc(added.id), undefined)
    assert.deepEqual((await summary('alice')).items, {})
    assert.equal((await events('alice')).size, 0)
    assert.deepEqual(await listed('alice'), [])
  })

  test('removing again finishes a removal, and events the app removed come back at the next refresh', async () => {
    await addUser('alice')
    const added = await addSubscription(
      deps({ [LINK]: { text: calendar(RUNS) } }),
      'alice',
      LINK,
      '',
    )
    // "Remove all" in the app deletes the stored records with their keys.
    const keys = [...(await events('alice')).keys()]
    const batch = db.batch()
    for (const key of keys) batch.delete(userRef('alice').collection('events').doc(key))
    batch.set(userRef('alice').collection('meta').doc('events'), { ids: {}, removed: keys })
    await batch.commit()
    await refreshSubscription(
      deps({ [LINK]: { text: calendar(RUNS) } }, { now: NOW + 7 * HOUR }),
      added.id,
    )
    assert.deepEqual([...(await events('alice')).keys()].sort(), keys.sort())
    assert.deepEqual((await listed('alice')).sort(), keys.sort())

    await removeSubscription({ db, now: () => NOW + 8 * HOUR }, 'alice', added.id)
    await removeSubscription({ db, now: () => NOW + 8 * HOUR }, 'alice', added.id)
    assert.equal(await linkDoc(added.id), undefined)
    assert.equal((await events('alice')).size, 0)
  })

  test('removing a link of a deleted account writes nothing under it', async () => {
    await addUser('gone')
    const added = await addSubscription(
      deps({ [LINK]: { text: calendar(RUNS) } }),
      'gone',
      LINK,
      '',
    )
    await db.recursiveDelete(userRef('gone'))
    await removeSubscription({ db }, 'gone', added.id)
    assert.equal(await linkDoc(added.id), undefined)
    assert.equal(
      (await userRef('gone').collection('private').doc('eventSubscriptions').get()).exists,
      false,
    )
    assert.equal((await userRef('gone').collection('meta').doc('events').get()).exists, false)
  })
})
