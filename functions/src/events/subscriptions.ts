// Linked calendars (docs/integrations/EVENTS.md, phase 2): adding, refreshing and
// removing an .ics link, and writing its events into users/{uid}/events.
//
// Storage:
// - `eventSubscriptions/{id}` (top level, server-only in firestore.rules) holds the link,
//   which is a credential (it may carry a private token), with the refresh schedule and
//   state. The scheduled refresh finds due links by `due`; a paused link has no `due`.
// - `users/{uid}/private/eventSubscriptions` holds what the app shows (`items`, by id):
//   host, label and how refreshes went, never the link. Written in the same transaction
//   as the link's own document.
// - Events go in `users/{uid}/events/{key}` with `source: 'feed'` and `feedId`, the same
//   records the .ics file import writes. The Admin SDK skips the rules, so this module
//   keeps the per-account key list (`users/{uid}/meta/events`, lib/key-index.ts) itself:
//   every record it writes is listed in the same transaction, a key comes off only with
//   its record, and the list never holds more than IMPORTED_EVENT_LIMITS.maxStored keys
//   (events that do not fit are counted in the summary's `refused`).
//
// A link's events are its own: a refresh replaces its upcoming events with what the link
// now holds (keeping the place and activity the person set), and removing the link
// deletes every event it wrote. Past events stay until they expire like imported ones.

import { type GeocodingResult, capText, parsePlanningPreferences, roundCoordinate } from '#core'
import {
  EVENT_SUBSCRIPTION_LIMITS,
  IMPORTED_EVENT_LIMITS,
  IcsImportError,
  type IcsParseResult,
  type ImportedEvent,
  type ParsedIcsEvent,
  SUBSCRIPTION_ERRORS,
  type SubscriptionError,
  type SubscriptionStatus,
  type SubscriptionSummary,
  distanceKm,
  eventLocationQueries,
  feedEventKey,
  feedSeriesId,
  importedEventExpiry,
  matchActivity,
  nextRefreshDelayMs,
  normalizeSubscriptionUrl,
  parseIcs,
  parseImportedEvent,
  subscriptionLabel,
} from '#core/event-import'
import { createHash, randomBytes } from 'node:crypto'

import {
  type DocumentData,
  type DocumentReference,
  FieldValue,
  type Firestore,
} from 'firebase-admin/firestore'
import { logger } from 'firebase-functions/logger'

import { HttpError, loggableError } from '../shared/errors'
import { toMillis } from '../shared/time'
import type { FetchCalendarResult } from './safe-fetch'

export const SUBSCRIPTIONS_COLLECTION = 'eventSubscriptions'
/** users/{uid}/private/{SUMMARY_DOC}: what the app shows about each link. */
export const SUMMARY_DOC = 'eventSubscriptions'
/** Most LOCATION texts one refresh looks up (like one file import, REVIEW4 L3). */
export const MAX_PLACE_LOOKUPS_PER_REFRESH = 10
/** A GEO point without a name takes the name of a found place this close, in km. */
const NEARBY_PLACE_KM = 10

const DAY_MS = 24 * 60 * 60 * 1000

/** What a subscription refresh needs from the outside world (injected for tests). */
export interface SubscriptionDeps {
  db: Firestore
  /** Fetches a link (safe-fetch.ts `fetchCalendar`). */
  fetchCalendar: (
    url: string,
    validators: { etag?: string | null; lastModified?: string | null },
  ) => Promise<FetchCalendarResult>
  /**
   * Searches a town name for an account (the commercial place search, within its budget
   * and the account's share). Absent or failing: events with only LOCATION text use the
   * person's own place, marked as guessed, as the file import does.
   */
  searchPlace?: (uid: string, query: string) => Promise<GeocodingResult[]>
  now?: () => number
}

/** A home place, as the account stores it. */
interface Home {
  lat: number
  lon: number
  label: string
  timezone: string
}

function homeOf(user: DocumentData | undefined): Home | null {
  const location = user?.location as Record<string, unknown> | undefined
  const lat = location?.lat
  const lon = location?.lon
  if (
    typeof lat !== 'number' ||
    typeof lon !== 'number' ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    Math.abs(lat) > 90 ||
    Math.abs(lon) > 180
  ) {
    return null
  }
  const city = typeof location?.city === 'string' ? location.city : ''
  const region = typeof location?.region === 'string' ? location.region : ''
  return {
    lat,
    lon,
    label: capText(region ? `${city}, ${region}` : city, IMPORTED_EVENT_LIMITS.placeLabelLength),
    timezone: typeof location?.timezone === 'string' ? location.timezone : 'UTC',
  }
}

function iso(ms: number | null | undefined): string {
  return typeof ms === 'number' && Number.isFinite(ms) ? new Date(ms).toISOString() : ''
}

function urlHash(url: string): string {
  return createHash('sha256').update(url).digest('hex')
}

/** A new link id: 128 random bits as 32 hex characters (the events' key format). */
export function newSubscriptionId(): string {
  return randomBytes(16).toString('hex')
}

function statusOf(data: DocumentData): SubscriptionStatus {
  return data.status === 'paused' || data.status === 'failing' ? data.status : 'active'
}

/** What the app shows for a stored link (never the link itself). */
export function summaryOf(id: string, data: DocumentData): SubscriptionSummary {
  const count = (value: unknown) =>
    typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0
  return {
    id,
    host: typeof data.host === 'string' ? data.host.slice(0, 253) : '',
    label: typeof data.label === 'string' ? data.label : '',
    status: statusOf(data),
    createdAt: iso(toMillis(data.createdAt)),
    lastAttemptAt: iso(toMillis(data.lastAttemptAt)),
    lastSuccessAt: iso(toMillis(data.lastSuccessAt)),
    nextRefreshAt: iso(toMillis(data.due)),
    error: typeof data.error === 'string' ? data.error.slice(0, 40) : '',
    eventCount: count(data.eventCount),
    refused: count(data.refused),
  }
}

/** A stored document after a merge `update`, with fields the update deletes left out. */
function merged(data: DocumentData | undefined, update: DocumentData): DocumentData {
  const out: DocumentData = { ...data }
  const deleted = FieldValue.delete()
  for (const [key, value] of Object.entries(update)) {
    if (value instanceof FieldValue && deleted.isEqual(value)) delete out[key]
    else out[key] = value
  }
  return out
}

function summaryRef(db: Firestore, uid: string): DocumentReference {
  return db.collection('users').doc(uid).collection('private').doc(SUMMARY_DOC)
}

function tombstoneRef(db: Firestore, uid: string): DocumentReference {
  return db.collection('accountDeletionTombstones').doc(uid)
}

// ---- Places --------------------------------------------------------------------------

interface EventPlace {
  lat: number
  lon: number
  label: string
  guessed: boolean
}

function placeKey(event: Pick<ParsedIcsEvent, 'geo' | 'location'>): string | null {
  if (event.geo) return `geo:${roundCoordinate(event.geo.lat)},${roundCoordinate(event.geo.lon)}`
  if (event.location) return `where:${event.location.toLowerCase()}`
  return null
}

function geoLabel(event: ParsedIcsEvent): string {
  return capText(
    event.location?.split(',')[0]?.trim() ?? '',
    IMPORTED_EVENT_LIMITS.placeLabelLength,
  )
}

/** "San Diego, California" for a place search result. */
function resultLabel(result: GeocodingResult): string {
  const label = result.admin1 ? `${result.name}, ${result.admin1}` : result.name
  return capText(label, IMPORTED_EVENT_LIMITS.placeLabelLength)
}

/**
 * A place for every distinct place among events that need one, like the file import
 * (lib/events.ts `resolvePlaces`): GEO as given, named by the LOCATION text's first
 * part or a found place within 10 km, else "Event location" (no reverse lookups on the
 * server); LOCATION text searched at town level, the nearest same-named town to the
 * person, at most MAX_PLACE_LOOKUPS_PER_REFRESH searches.
 */
async function resolvePlaces(
  deps: SubscriptionDeps,
  uid: string,
  events: readonly ParsedIcsEvent[],
  home: Home,
): Promise<Map<string, EventPlace>> {
  const places = new Map<string, EventPlace>()
  let lookups = 0
  const unnamed: [string, { lat: number; lon: number }][] = []
  for (const event of events) {
    const key = placeKey(event)
    if (!key || places.has(key)) continue
    if (event.geo) {
      const point = { lat: roundCoordinate(event.geo.lat), lon: roundCoordinate(event.geo.lon) }
      const label = geoLabel(event)
      if (label) places.set(key, { ...point, label, guessed: false })
      else unnamed.push([key, point])
      continue
    }
    if (!event.location || !deps.searchPlace || lookups >= MAX_PLACE_LOOKUPS_PER_REFRESH) continue
    for (const query of eventLocationQueries(event.location)) {
      lookups += 1
      let results: GeocodingResult[]
      try {
        results = await deps.searchPlace(uid, query)
      } catch {
        // Place search is off or its budget is spent: the rest use the person's place.
        lookups = MAX_PLACE_LOOKUPS_PER_REFRESH
        break
      }
      const best = results
        .map(result => ({
          result,
          km: distanceKm(home, { lat: result.latitude, lon: result.longitude }),
        }))
        .sort((a, b) => a.km - b.km)[0]?.result
      if (best) {
        places.set(key, {
          lat: roundCoordinate(best.latitude),
          lon: roundCoordinate(best.longitude),
          label: resultLabel(best),
          guessed: false,
        })
        break
      }
      if (lookups >= MAX_PLACE_LOOKUPS_PER_REFRESH) break
    }
  }
  const named = [...places.values()]
  for (const [key, point] of unnamed) {
    const near = named
      .map(place => ({ place, km: distanceKm(point, place) }))
      .filter(({ km }) => km <= NEARBY_PLACE_KM)
      .sort((a, b) => a.km - b.km)[0]
    places.set(key, { ...point, label: near?.place.label ?? 'Event location', guessed: false })
  }
  return places
}

// ---- Records -------------------------------------------------------------------------

async function feedRecords(
  feedId: string,
  events: readonly ParsedIcsEvent[],
  {
    places,
    home,
    activities,
    previous,
    now,
  }: {
    places: ReadonlyMap<string, EventPlace>
    home: Home
    activities: readonly { id: string; name: string }[]
    previous: ReadonlyMap<string, ImportedEvent>
    now: string
  },
): Promise<ImportedEvent[]> {
  const records: ImportedEvent[] = []
  const seen = new Set<string>()
  for (const event of events) {
    const key = await feedEventKey(feedId, event.uid, event.recurrenceId)
    if (seen.has(key)) continue
    seen.add(key)
    const before = previous.get(key)
    const where = capText(event.location ?? '', IMPORTED_EVENT_LIMITS.whereLength)
    const id = placeKey(event)
    // The same LOCATION text as before keeps the place, which the person may have set.
    const place: EventPlace =
      before && before.where === where
        ? {
            lat: before.lat,
            lon: before.lon,
            label: before.placeLabel,
            guessed: before.placeGuessed,
          }
        : ((id ? places.get(id) : undefined) ?? {
            lat: roundCoordinate(home.lat),
            lon: roundCoordinate(home.lon),
            label: home.label,
            guessed: true,
          })
    const record = parseImportedEvent({
      key,
      source: 'feed',
      feedId,
      seriesId: await feedSeriesId(feedId, event.uid),
      title: capText(event.title, IMPORTED_EVENT_LIMITS.titleLength),
      start: new Date(event.start).toISOString(),
      end: new Date(event.end).toISOString(),
      timeZone: event.timeZone,
      where,
      lat: place.lat,
      lon: place.lon,
      placeLabel: capText(place.label, IMPORTED_EVENT_LIMITS.placeLabelLength),
      placeGuessed: place.guessed,
      activityId: before ? before.activityId : matchActivity(event.title, activities),
      url: event.url ?? '',
      createdAt: before?.createdAt ?? now,
      updatedAt: now,
    })
    if (record) records.push(record)
  }
  return records
}

function eventDocument(item: ImportedEvent): Record<string, unknown> {
  return { ...item, expireAt: importedEventExpiry(item) }
}

/** Every stored event of a link (a link writes at most a few hundred). */
async function storedFeedEvents(
  db: Firestore,
  uid: string,
  feedId: string,
): Promise<Map<string, ImportedEvent>> {
  const snapshot = await db
    .collection('users')
    .doc(uid)
    .collection('events')
    .where('feedId', '==', feedId)
    .limit(IMPORTED_EVENT_LIMITS.maxStored)
    .get()
  const out = new Map<string, ImportedEvent>()
  for (const doc of snapshot.docs) {
    const item = parseImportedEvent(doc.data())
    if (item && item.key === doc.id) out.set(doc.id, item)
  }
  return out
}

function listedIds(data: DocumentData | undefined): Set<string> {
  const ids: unknown = data?.ids
  return new Set(ids && typeof ids === 'object' ? Object.keys(ids) : [])
}

/**
 * Takes keys off the account's list whose records no longer exist (Firestore's TTL
 * policy deleted them), as the app's `reconcile` does, so a refresh can use the room.
 */
async function dropDanglingKeys(db: Firestore, uid: string): Promise<void> {
  const userRef = db.collection('users').doc(uid)
  const indexRef = userRef.collection('meta').doc('events')
  const listed = listedIds((await indexRef.get()).data())
  if (listed.size === 0) return
  const refs = [...listed].map(key => userRef.collection('events').doc(key))
  const gone: string[] = []
  for (let i = 0; i < refs.length; i += 300) {
    const snapshots = await db.getAll(...refs.slice(i, i + 300))
    for (const snapshot of snapshots) if (!snapshot.exists) gone.push(snapshot.id)
  }
  if (gone.length === 0) return
  await db.runTransaction(async transaction => {
    const current = await transaction.getAll(
      ...gone.map(key => userRef.collection('events').doc(key)),
    )
    const stillGone = current.filter(snapshot => !snapshot.exists).map(snapshot => snapshot.id)
    if (stillGone.length === 0) return
    transaction.set(
      indexRef,
      { ids: Object.fromEntries(stillGone.map(key => [key, FieldValue.delete()])), removed: [] },
      { merge: true },
    )
  })
}

interface WriteResult {
  saved: number
  refused: number
  removed: number
}

/**
 * Replaces a link's upcoming events with `records` in one transaction, with the key list,
 * the link's state and its summary. Returns null when the link was removed meanwhile or
 * the account is being deleted (nothing is written then).
 */
async function writeFeedEvents(
  db: Firestore,
  uid: string,
  feedId: string,
  records: readonly ImportedEvent[],
  nowMs: number,
  state: (result: WriteResult) => DocumentData,
): Promise<WriteResult | null> {
  const userRef = db.collection('users').doc(uid)
  const indexRef = userRef.collection('meta').doc('events')
  const linkRef = db.collection(SUBSCRIPTIONS_COLLECTION).doc(feedId)
  const storedQuery = userRef
    .collection('events')
    .where('feedId', '==', feedId)
    .limit(IMPORTED_EVENT_LIMITS.maxStored)
  const attempt = () =>
    db.runTransaction(async transaction => {
      const [link, tombstone, index, stored] = await Promise.all([
        transaction.get(linkRef),
        transaction.get(tombstoneRef(db, uid)),
        transaction.get(indexRef),
        transaction.get(storedQuery),
      ])
      if (!link.exists || link.data()?.uid !== uid || tombstone.exists) return null
      const listed = listedIds(index.data())
      const keep = new Set(records.map(item => item.key))
      // Upcoming events the link no longer has; past ones expire like imported events.
      const stale = stored.docs
        .filter(doc => !keep.has(doc.id) && Date.parse(String(doc.data().end)) > nowMs)
        .map(doc => doc.id)
      for (const key of stale) listed.delete(key)
      const fit: ImportedEvent[] = []
      let refused = 0
      for (const item of records) {
        if (listed.has(item.key)) fit.push(item)
        else if (listed.size < IMPORTED_EVENT_LIMITS.maxStored) {
          listed.add(item.key)
          fit.push(item)
        } else refused += 1
      }
      for (const key of stale) transaction.delete(userRef.collection('events').doc(key))
      for (const item of fit) {
        transaction.set(userRef.collection('events').doc(item.key), eventDocument(item))
      }
      const ids: Record<string, unknown> = {}
      for (const item of fit) ids[item.key] = true
      for (const key of stale) ids[key] = FieldValue.delete()
      if (fit.length || stale.length) {
        transaction.set(indexRef, { ids, removed: [] }, { merge: true })
      }
      const result = { saved: fit.length, refused, removed: stale.length }
      const update = state(result)
      const next = merged(link.data(), update)
      transaction.set(linkRef, update, { merge: true })
      transaction.set(
        summaryRef(db, uid),
        { items: { [feedId]: summaryOf(feedId, next) } },
        { merge: true },
      )
      return { result, full: refused > 0 }
    })
  let outcome = await attempt()
  if (outcome?.full) {
    // The list may hold keys of records Firestore's TTL policy already deleted.
    await dropDanglingKeys(db, uid)
    outcome = await attempt()
  }
  return outcome?.result ?? null
}

// ---- Refresh -------------------------------------------------------------------------

export type RefreshOutcome =
  'refreshed' | 'not-modified' | 'failed' | 'paused' | 'gone' | 'removed-orphan'

/** The state stored after a failed attempt: back off, and pause after pauseAfterDays. */
function failureState(data: DocumentData, error: SubscriptionError, nowMs: number): DocumentData {
  const failures = (typeof data.failures === 'number' ? data.failures : 0) + 1
  const since = toMillis(data.failingSince)
  const failingSince = Number.isFinite(since) ? since : nowMs
  const paused = nowMs - failingSince >= EVENT_SUBSCRIPTION_LIMITS.pauseAfterDays * DAY_MS
  return {
    status: paused ? 'paused' : 'failing',
    failures,
    failingSince: new Date(failingSince),
    error,
    lastAttemptAt: new Date(nowMs),
    due: paused ? FieldValue.delete() : new Date(nowMs + nextRefreshDelayMs(failures)),
  }
}

async function recordFailure(
  db: Firestore,
  id: string,
  uid: string,
  error: SubscriptionError,
  nowMs: number,
): Promise<SubscriptionSummary | null> {
  const linkRef = db.collection(SUBSCRIPTIONS_COLLECTION).doc(id)
  return db.runTransaction(async transaction => {
    const link = await transaction.get(linkRef)
    const data = link.data()
    if (!link.exists || data?.uid !== uid) return null
    const update = failureState(data, error, nowMs)
    transaction.set(linkRef, update, { merge: true })
    const summary = summaryOf(id, merged(data, update))
    transaction.set(summaryRef(db, uid), { items: { [id]: summary } }, { merge: true })
    return summary
  })
}

/**
 * Fetches one link and stores its events. Never throws for a bad link: failures are
 * recorded on the link (with backoff) and returned as 'failed' or 'paused'.
 */
export async function refreshSubscription(
  deps: SubscriptionDeps,
  id: string,
  { prefetched }: { prefetched?: FetchCalendarResult } = {},
): Promise<{ outcome: RefreshOutcome; summary: SubscriptionSummary | null }> {
  const { db } = deps
  const now = (deps.now ?? Date.now)()
  const linkRef = db.collection(SUBSCRIPTIONS_COLLECTION).doc(id)
  const link = await linkRef.get()
  const data = link.data()
  if (!link.exists || !data || typeof data.uid !== 'string' || typeof data.url !== 'string') {
    return { outcome: 'gone', summary: null }
  }
  const uid = data.uid
  const [user, tombstone] = await Promise.all([
    db.collection('users').doc(uid).get(),
    tombstoneRef(db, uid).get(),
  ])
  if (!user.exists || tombstone.exists) {
    // The account is gone or going: the link goes with it.
    await removeSubscriptionDocs(db, uid, id)
    return { outcome: 'removed-orphan', summary: null }
  }
  const home = homeOf(user.data())
  const fail = async (error: SubscriptionError) => {
    const summary = await recordFailure(db, id, uid, error, now)
    return { outcome: summary?.status === 'paused' ? 'paused' : 'failed', summary } as const
  }
  if (!home) return fail('no-place')

  const fetched =
    prefetched ??
    (await deps.fetchCalendar(data.url, {
      etag: typeof data.etag === 'string' ? data.etag : null,
      lastModified: typeof data.lastModified === 'string' ? data.lastModified : null,
    }))
  if (!fetched.ok) return fail(fetched.error)

  const success = (result: WriteResult | null, extra: DocumentData = {}) => ({
    status: 'active',
    failures: 0,
    failingSince: FieldValue.delete(),
    error: '',
    lastAttemptAt: new Date(now),
    lastSuccessAt: new Date(now),
    due: new Date(now + nextRefreshDelayMs(0)),
    ...(result ? { refused: result.refused } : {}),
    ...extra,
  })

  if (fetched.notModified) {
    // Unchanged at the source: recurring events still move forward with time, so the
    // stored ones are kept and only the schedule changes. A changed file brings the rest.
    const summary = await db.runTransaction(async transaction => {
      const current = await transaction.get(linkRef)
      if (!current.exists || current.data()?.uid !== uid) return null
      const update = success(null)
      transaction.set(linkRef, update, { merge: true })
      const next = summaryOf(id, merged(current.data(), update))
      transaction.set(summaryRef(db, uid), { items: { [id]: next } }, { merge: true })
      return next
    })
    return { outcome: summary ? 'not-modified' : 'gone', summary }
  }

  let parsed: IcsParseResult
  try {
    parsed = parseIcs(fetched.text, { now, defaultTimeZone: home.timezone })
  } catch (error) {
    if (error instanceof IcsImportError) {
      return fail(error.code === 'too-large' ? 'too-large' : 'not-calendar')
    }
    logger.warn('linked calendar could not be parsed', { error: loggableError(error) })
    return fail('not-calendar')
  }

  const previous = await storedFeedEvents(db, uid, id)
  const toPlace: ParsedIcsEvent[] = []
  for (const event of parsed.events) {
    const key = await feedEventKey(id, event.uid, event.recurrenceId)
    const before = previous.get(key)
    if (
      !before ||
      before.where !== capText(event.location ?? '', IMPORTED_EVENT_LIMITS.whereLength)
    ) {
      toPlace.push(event)
    }
  }
  const places = await resolvePlaces(deps, uid, toPlace, home)
  const records = await feedRecords(id, parsed.events, {
    places,
    home,
    activities: parsePlanningPreferences(user.data()).activities,
    previous,
    now: new Date(now).toISOString(),
  })
  const label = data.customLabel ? data.label : subscriptionLabel(parsed.calendarName, data.host)
  const result = await writeFeedEvents(db, uid, id, records, now, written =>
    success(written, {
      label,
      etag: fetched.etag ?? FieldValue.delete(),
      lastModified: fetched.lastModified ?? FieldValue.delete(),
      eventCount: written.saved,
    }),
  )
  if (!result) return { outcome: 'gone', summary: null }
  const after = (await linkRef.get()).data()
  return { outcome: 'refreshed', summary: after ? summaryOf(id, after) : null }
}

// ---- Add and remove ------------------------------------------------------------------

/**
 * Links a calendar: checks the link, the account's cap and duplicates, fetches it once
 * (a link that cannot be read is refused, so nothing is stored for it), stores it and
 * writes its events.
 */
export async function addSubscription(
  deps: SubscriptionDeps,
  uid: string,
  rawUrl: string,
  rawLabel: string,
): Promise<SubscriptionSummary> {
  const { db } = deps
  const now = (deps.now ?? Date.now)()
  const refuse = (error: SubscriptionError) => {
    const status = error === 'duplicate' || error === 'too-many' ? 'conflict' : 'invalid-argument'
    throw new HttpError(status, SUBSCRIPTION_ERRORS[error])
  }
  const normalized = normalizeSubscriptionUrl(rawUrl)
  if (!normalized.ok) return refuse(normalized.error)
  const hash = urlHash(normalized.url)
  const owned = db.collection(SUBSCRIPTIONS_COLLECTION).where('uid', '==', uid)
  const existing = await owned.limit(EVENT_SUBSCRIPTION_LIMITS.maxPerAccount + 1).get()
  if (existing.docs.some(doc => doc.data().urlHash === hash)) return refuse('duplicate')
  if (existing.size >= EVENT_SUBSCRIPTION_LIMITS.maxPerAccount) return refuse('too-many')

  const fetched = await deps.fetchCalendar(normalized.url, {})
  if (!fetched.ok) return refuse(fetched.error)
  if (fetched.notModified) return refuse('not-calendar')
  let calendarName: string | null = null
  try {
    calendarName = parseIcs(fetched.text, { now, defaultTimeZone: 'UTC' }).calendarName
  } catch (error) {
    return refuse(
      error instanceof IcsImportError && error.code === 'too-large' ? 'too-large' : 'not-calendar',
    )
  }

  const id = newSubscriptionId()
  const customLabel = subscriptionLabel(rawLabel)
  const linkRef = db.collection(SUBSCRIPTIONS_COLLECTION).doc(id)
  await db.runTransaction(async transaction => {
    const [tombstone, current] = await Promise.all([
      transaction.get(tombstoneRef(db, uid)),
      transaction.get(owned.limit(EVENT_SUBSCRIPTION_LIMITS.maxPerAccount + 1)),
    ])
    if (tombstone.exists) {
      throw new HttpError('deletion-in-progress', 'Account deletion is in progress')
    }
    if (current.docs.some(doc => doc.data().urlHash === hash)) refuse('duplicate')
    if (current.size >= EVENT_SUBSCRIPTION_LIMITS.maxPerAccount) refuse('too-many')
    const data = {
      uid,
      url: normalized.url,
      urlHash: hash,
      host: normalized.host,
      label: customLabel || subscriptionLabel(calendarName, normalized.host),
      customLabel: !!customLabel,
      status: 'active',
      createdAt: new Date(now),
      // Due now: the refresh below writes the events and sets the next time.
      due: new Date(now),
      failures: 0,
      error: '',
      eventCount: 0,
      refused: 0,
    }
    transaction.create(linkRef, data)
    transaction.set(summaryRef(db, uid), { items: { [id]: summaryOf(id, data) } }, { merge: true })
  })
  // The link was just read: its events are stored from that same answer.
  const { summary } = await refreshSubscription({ ...deps, now: () => now }, id, {
    prefetched: fetched,
  })
  const stored = summary ?? summaryOf(id, (await linkRef.get()).data() ?? {})
  return stored
}

/** Deletes a link's own documents (not its events). */
async function removeSubscriptionDocs(db: Firestore, uid: string, id: string): Promise<boolean> {
  const linkRef = db.collection(SUBSCRIPTIONS_COLLECTION).doc(id)
  return db.runTransaction(async transaction => {
    const link = await transaction.get(linkRef)
    if (link.exists && link.data()?.uid !== uid) return false
    if (link.exists) transaction.delete(linkRef)
    transaction.set(summaryRef(db, uid), { items: { [id]: FieldValue.delete() } }, { merge: true })
    return link.exists
  })
}

/** Deletes every event a link wrote, with their keys, a page at a time. */
export async function deleteFeedEvents(
  db: Firestore,
  uid: string,
  feedId: string,
): Promise<number> {
  const userRef = db.collection('users').doc(uid)
  const indexRef = userRef.collection('meta').doc('events')
  let deleted = 0
  for (;;) {
    const page = await userRef.collection('events').where('feedId', '==', feedId).limit(200).get()
    if (page.empty) return deleted
    const batch = db.batch()
    for (const doc of page.docs) batch.delete(doc.ref)
    batch.set(
      indexRef,
      { ids: Object.fromEntries(page.docs.map(doc => [doc.id, FieldValue.delete()])), removed: [] },
      { merge: true },
    )
    await batch.commit()
    deleted += page.size
    if (page.size < 200) return deleted
  }
}

/** Unlinks a calendar: the link first (so no refresh writes again), then its events. */
export async function removeSubscription(
  deps: Pick<SubscriptionDeps, 'db'>,
  uid: string,
  id: string,
): Promise<void> {
  const { db } = deps
  const link = await db.collection(SUBSCRIPTIONS_COLLECTION).doc(id).get()
  if (link.exists && link.data()?.uid !== uid) {
    throw new HttpError('not-found', 'That calendar is not linked.')
  }
  await removeSubscriptionDocs(db, uid, id)
  await deleteFeedEvents(db, uid, id)
}

/**
 * A refresh the person asked for: allowed once per manualRefreshMinutes per link, and it
 * resumes a paused link.
 */
export async function refreshSubscriptionNow(
  deps: SubscriptionDeps,
  uid: string,
  id: string,
): Promise<SubscriptionSummary> {
  const { db } = deps
  const now = (deps.now ?? Date.now)()
  const linkRef = db.collection(SUBSCRIPTIONS_COLLECTION).doc(id)
  await db.runTransaction(async transaction => {
    const link = await transaction.get(linkRef)
    const data = link.data()
    if (!link.exists || data?.uid !== uid) {
      throw new HttpError('not-found', 'That calendar is not linked.')
    }
    const last = toMillis(data.manualRefreshAt)
    if (
      Number.isFinite(last) &&
      now - last < EVENT_SUBSCRIPTION_LIMITS.manualRefreshMinutes * 60_000
    ) {
      throw new HttpError(
        'rate-limited',
        'That calendar was refreshed a moment ago. Try again later.',
      )
    }
    transaction.set(linkRef, { manualRefreshAt: new Date(now) }, { merge: true })
  })
  const { summary } = await refreshSubscription({ ...deps, now: () => now }, id)
  if (!summary) throw new HttpError('not-found', 'That calendar is not linked.')
  return summary
}

/** Every link of an account, for account deletion (the events go with users/{uid}). */
export async function deleteEventSubscriptionsForUser(db: Firestore, uid: string): Promise<number> {
  const links = await db.collection(SUBSCRIPTIONS_COLLECTION).where('uid', '==', uid).get()
  await Promise.all(links.docs.map(link => link.ref.delete()))
  return links.size
}

// ---- The scheduled refresh -----------------------------------------------------------

export interface RefreshRunLimits {
  /** Most links refreshed per run. */
  maxLinks: number
  concurrency: number
  /** A run stops starting links after this long. */
  budgetMs: number
}

/**
 * Defaults, owner may change: 100 links a run, 4 at a time, every 30 minutes, so at most
 * 4,800 fetches a day whatever the number of links (docs/COSTS.md).
 */
export const REFRESH_RUN_LIMITS: RefreshRunLimits = Object.freeze({
  maxLinks: 100,
  concurrency: 4,
  budgetMs: 240_000,
})

export interface RefreshRunResult {
  due: number
  outcomes: Partial<Record<RefreshOutcome | 'error', number>>
  /** True when more links were due than this run could take. */
  backlog: boolean
}

/** One scheduled run: the links whose refresh is due, oldest first, within the limits. */
export async function runSubscriptionRefresh(
  deps: SubscriptionDeps,
  limits: Partial<RefreshRunLimits> = {},
): Promise<RefreshRunResult> {
  const { maxLinks, concurrency, budgetMs } = { ...REFRESH_RUN_LIMITS, ...limits }
  const clock = deps.now ?? Date.now
  const startedAt = clock()
  const due = await deps.db
    .collection(SUBSCRIPTIONS_COLLECTION)
    .where('due', '<=', new Date(startedAt))
    .orderBy('due')
    .limit(maxLinks + 1)
    .get()
  const ids = due.docs.slice(0, maxLinks).map(doc => doc.id)
  const outcomes: RefreshRunResult['outcomes'] = {}
  const count = (outcome: RefreshOutcome | 'error') => {
    outcomes[outcome] = (outcomes[outcome] ?? 0) + 1
  }
  let cursor = 0
  let outOfTime = false
  const lane = async () => {
    while (cursor < ids.length) {
      if (clock() - startedAt >= budgetMs) {
        outOfTime = true
        return
      }
      const id = ids[cursor++] as string
      try {
        count((await refreshSubscription(deps, id)).outcome)
      } catch (error) {
        count('error')
        logger.error('linked calendar refresh failed', { error: loggableError(error) })
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, lane))
  const backlog = due.size > maxLinks || outOfTime
  const result = { due: ids.length, outcomes, backlog }
  if (backlog) logger.warn('linked calendar refresh has a backlog; the next run carries on', result)
  else logger.info('linked calendar refresh completed', result)
  return result
}
