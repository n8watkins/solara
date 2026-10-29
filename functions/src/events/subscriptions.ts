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
// now holds (keeping the place and activity the person set), writing only the events that
// are new or changed, and removing the link deletes every event it wrote. Past events stay
// until they expire like imported ones.
//
// Robustness (REVIEW5): every attempt claims its link before fetching (lease.ts), so a
// hanging or crashing attempt cannot hold the refresh queue; every write checks, in its
// transaction, that the link is still there and not being removed and that the account
// still exists, so nothing is written for a removed link or under a deleted account; and a
// removal marks the link `removing` first and deletes the link itself last, so it can be
// retried (by the person or by the scheduled run) until it is complete.

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
  type QueryDocumentSnapshot,
  type QuerySnapshot,
  type Transaction,
} from 'firebase-admin/firestore'
import { logger } from 'firebase-functions/logger'

import { hasProEntitlement } from '../billing/entitlement'
import { HttpError, loggableError } from '../shared/errors'
import { toMillis } from '../shared/time'
import { claimFields, claimState, releaseFields } from './lease'
import { type FetchCalendarResult, withDeadline } from './safe-fetch'

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

/**
 * What a place search found for one LOCATION text, kept on the link (`places`) so a text
 * is looked up once, not on every refresh (REVIEW5 M1): `lat`, `lon` and `label` when it
 * was found, null when the search found nothing. Searches that failed (the budget is
 * spent) are not kept, so they are tried again later.
 */
interface CachedPlace {
  where: string
  lat: number | null
  lon: number | null
  label: string
}

/** The LOCATION text as stored on an event and as the place cache's key. */
function whereText(location: string | null | undefined): string {
  return capText(location ?? '', IMPORTED_EVENT_LIMITS.whereLength)
}

function cacheKey(where: string): string {
  return where.toLowerCase()
}

/** The link's place cache, by cacheKey; malformed entries are left out. */
function placeCacheOf(data: DocumentData | undefined): Map<string, CachedPlace> {
  const out = new Map<string, CachedPlace>()
  const raw: unknown = data?.places
  if (!Array.isArray(raw)) return out
  for (const entry of raw as unknown[]) {
    const item = entry as Partial<CachedPlace> | null
    if (!item || typeof item.where !== 'string' || typeof item.label !== 'string') continue
    const found = typeof item.lat === 'number' && typeof item.lon === 'number'
    out.set(cacheKey(item.where), {
      where: item.where,
      lat: found ? (item.lat as number) : null,
      lon: found ? (item.lon as number) : null,
      label: item.label,
    })
  }
  return out
}

function cachedPlace(entry: CachedPlace | undefined): EventPlace | null {
  return entry && entry.lat !== null && entry.lon !== null
    ? { lat: entry.lat, lon: entry.lon, label: entry.label, guessed: false }
    : null
}

function geoKey(geo: { lat: number; lon: number }): string {
  return `geo:${roundCoordinate(geo.lat)},${roundCoordinate(geo.lon)}`
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

interface ResolvedPlaces {
  /** GEO points by geoKey. */
  geo: Map<string, EventPlace>
  /** Every LOCATION text the calendar has that a search has answered, by cacheKey. */
  cache: Map<string, CachedPlace>
}

/**
 * Places for a calendar's events, like the file import (lib/events.ts `resolvePlaces`):
 * GEO as given, named by the LOCATION text's first part or a found place within 10 km,
 * else "Event location" (no reverse lookups on the server); LOCATION text searched at
 * town level, the nearest same-named town to the person. Texts the link's cache already
 * answers are not searched again, and at most MAX_PLACE_LOOKUPS_PER_REFRESH searches run
 * per refresh, so a calendar with many places is placed over a few refreshes.
 */
async function resolvePlaces(
  deps: SubscriptionDeps,
  uid: string,
  events: readonly ParsedIcsEvent[],
  home: Home,
  known: ReadonlyMap<string, CachedPlace>,
): Promise<ResolvedPlaces> {
  const cache = new Map<string, CachedPlace>()
  const geo = new Map<string, EventPlace>()
  const unnamed: [string, { lat: number; lon: number }][] = []
  let lookups = 0
  let searchable = !!deps.searchPlace
  for (const event of events) {
    if (event.geo) {
      const key = geoKey(event.geo)
      if (geo.has(key) || unnamed.some(([seen]) => seen === key)) continue
      const point = { lat: roundCoordinate(event.geo.lat), lon: roundCoordinate(event.geo.lon) }
      const label = geoLabel(event)
      if (label) geo.set(key, { ...point, label, guessed: false })
      else unnamed.push([key, point])
      continue
    }
    const where = whereText(event.location)
    const key = cacheKey(where)
    if (!where || cache.has(key)) continue
    const before = known.get(key)
    if (before) {
      cache.set(key, before)
      continue
    }
    if (!searchable || lookups >= MAX_PLACE_LOOKUPS_PER_REFRESH) continue
    let found: CachedPlace | null = null
    let answered = true
    for (const query of eventLocationQueries(event.location ?? '')) {
      lookups += 1
      let results: GeocodingResult[]
      try {
        results = await (deps.searchPlace as NonNullable<SubscriptionDeps['searchPlace']>)(
          uid,
          query,
        )
      } catch {
        // Place search is off or its budget is spent: the rest use the person's place,
        // and nothing is cached, so a later refresh tries again.
        searchable = false
        answered = false
        break
      }
      const best = results
        .map(result => ({
          result,
          km: distanceKm(home, { lat: result.latitude, lon: result.longitude }),
        }))
        .sort((a, b) => a.km - b.km)[0]?.result
      if (best) {
        found = {
          where,
          lat: roundCoordinate(best.latitude),
          lon: roundCoordinate(best.longitude),
          label: resultLabel(best),
        }
        break
      }
      if (lookups >= MAX_PLACE_LOOKUPS_PER_REFRESH) {
        answered = false
        break
      }
    }
    if (found) cache.set(key, found)
    else if (answered) cache.set(key, { where, lat: null, lon: null, label: '' })
  }
  const named = [...geo.values(), ...[...cache.values()].flatMap(entry => cachedPlace(entry) ?? [])]
  for (const [key, point] of unnamed) {
    const near = named
      .map(place => ({ place, km: distanceKm(point, place) }))
      .filter(({ km }) => km <= NEARBY_PLACE_KM)
      .sort((a, b) => a.km - b.km)[0]
    geo.set(key, { ...point, label: near?.place.label ?? 'Event location', guessed: false })
  }
  return { geo, cache }
}

// ---- Records -------------------------------------------------------------------------

/** A parsed event with its stored key, computed before the write's transaction. */
interface Draft {
  key: string
  seriesId: string
  event: ParsedIcsEvent
}

async function drafts(feedId: string, events: readonly ParsedIcsEvent[]): Promise<Draft[]> {
  const out: Draft[] = []
  const seen = new Set<string>()
  for (const event of events) {
    const key = await feedEventKey(feedId, event.uid, event.recurrenceId)
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ key, seriesId: await feedSeriesId(feedId, event.uid), event })
  }
  return out
}

/**
 * PURE. The records a link's events become. An event whose LOCATION text is unchanged
 * keeps the stored place (which the person may have set), unless that place was the
 * person's own as a guess and the text has since been found. `updatedAt` stays as stored
 * when nothing else changed.
 */
function feedRecords(
  feedId: string,
  items: readonly Draft[],
  {
    places,
    home,
    activities,
    previous,
    now,
  }: {
    places: ResolvedPlaces
    home: Home
    activities: readonly { id: string; name: string }[]
    previous: ReadonlyMap<string, ImportedEvent>
    now: string
  },
): ImportedEvent[] {
  const records: ImportedEvent[] = []
  for (const { key, seriesId, event } of items) {
    const before = previous.get(key)
    const where = whereText(event.location)
    const found = event.geo
      ? places.geo.get(geoKey(event.geo))
      : cachedPlace(places.cache.get(cacheKey(where)))
    const kept =
      before && before.where === where && !(before.placeGuessed && found)
        ? {
            lat: before.lat,
            lon: before.lon,
            label: before.placeLabel,
            guessed: before.placeGuessed,
          }
        : null
    const place: EventPlace = kept ??
      found ?? {
        lat: roundCoordinate(home.lat),
        lon: roundCoordinate(home.lon),
        label: home.label,
        guessed: true,
      }
    const record = parseImportedEvent({
      key,
      source: 'feed',
      feedId,
      seriesId,
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
    if (!record) continue
    records.push(before && sameEvent(before, record) ? before : record)
  }
  return records
}

/** PURE. Whether two records hold the same event, `updatedAt` aside. */
export function sameEvent(a: ImportedEvent, b: ImportedEvent): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  keys.delete('updatedAt')
  for (const key of keys) {
    if (a[key as keyof ImportedEvent] !== b[key as keyof ImportedEvent]) return false
  }
  return true
}

/** Every event document a link wrote. */
function feedEventsQuery(db: Firestore, uid: string, feedId: string) {
  return db.collection('users').doc(uid).collection('events').where('feedId', '==', feedId)
}

function eventDocument(item: ImportedEvent): Record<string, unknown> {
  return { ...item, expireAt: importedEventExpiry(item) }
}

function listedIds(data: DocumentData | undefined): Set<string> {
  const ids: unknown = data?.ids
  return new Set(ids && typeof ids === 'object' ? Object.keys(ids) : [])
}

/**
 * Takes keys off the account's list whose records no longer exist (Firestore's TTL
 * policy deleted them), as the app's `reconcile` does, so a refresh can use the room.
 * It reads every listed record, so it runs at most once a day per link (REVIEW5 M2).
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

/**
 * Reads, inside a transaction, what every write for a link depends on: the link (still
 * there, still the account's, not being removed), the account (still there) and its
 * deletion tombstone (absent). Returns the link's data, or null when nothing may be
 * written: a document written for an account that is gone or going would outlive it
 * (REVIEW5 L3).
 */
async function writableLink(
  transaction: Transaction,
  db: Firestore,
  uid: string,
  id: string,
): Promise<DocumentData | null> {
  const [link, user, tombstone] = await Promise.all([
    transaction.get(db.collection(SUBSCRIPTIONS_COLLECTION).doc(id)),
    transaction.get(db.collection('users').doc(uid)),
    transaction.get(tombstoneRef(db, uid)),
  ])
  const data = link.data()
  if (!link.exists || !data || data.uid !== uid || data.removing === true) return null
  if (!user.exists || tombstone.exists) return null
  return data
}

interface WriteResult {
  /** Upcoming events the link holds now. */
  saved: number
  refused: number
  removed: number
  /** Event documents written (new or changed); unchanged ones are not written. */
  written: number
  /** The link's event documents after the write, past ones included. */
  stored: number
}

/**
 * Stores a link's events in one transaction with the key list, the link's state and its
 * summary: reads the link's stored events once, writes only the records that are new or
 * changed, and deletes upcoming ones the link no longer has (REVIEW5 M2). Returns null
 * when the link was removed meanwhile or the account is gone or going (nothing is written
 * then).
 */
async function writeFeedEvents(
  db: Firestore,
  uid: string,
  feedId: string,
  build: (previous: ReadonlyMap<string, ImportedEvent>) => ImportedEvent[],
  nowMs: number,
  state: (result: WriteResult, full: boolean) => DocumentData,
): Promise<{ result: WriteResult; full: boolean } | null> {
  const userRef = db.collection('users').doc(uid)
  const indexRef = userRef.collection('meta').doc('events')
  const linkRef = db.collection(SUBSCRIPTIONS_COLLECTION).doc(feedId)
  const storedQuery = feedEventsQuery(db, uid, feedId).limit(IMPORTED_EVENT_LIMITS.maxStored)
  return db.runTransaction(async transaction => {
    const data = await writableLink(transaction, db, uid, feedId)
    if (!data) return null
    const [index, stored] = await Promise.all([
      transaction.get(indexRef),
      transaction.get(storedQuery),
    ])
    const previous = new Map<string, ImportedEvent>()
    for (const doc of stored.docs) {
      const item = parseImportedEvent(doc.data())
      if (item && item.key === doc.id) previous.set(doc.id, item)
    }
    const records = build(previous)
    const listedBefore = listedIds(index.data())
    const listed = new Set(listedBefore)
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
    const changed = fit.filter(item => {
      const before = previous.get(item.key)
      return !(before && listedBefore.has(item.key) && sameEvent(before, item))
    })
    for (const key of stale) transaction.delete(userRef.collection('events').doc(key))
    for (const item of changed) {
      transaction.set(userRef.collection('events').doc(item.key), eventDocument(item))
    }
    const ids: Record<string, unknown> = {}
    for (const item of changed) if (!listedBefore.has(item.key)) ids[item.key] = true
    for (const key of stale) ids[key] = FieldValue.delete()
    if (Object.keys(ids).length) {
      transaction.set(indexRef, { ids, removed: [] }, { merge: true })
    }
    const storedIds = new Set(stored.docs.map(doc => doc.id))
    const created = changed.filter(item => !storedIds.has(item.key)).length
    const result = {
      saved: fit.length,
      refused,
      removed: stale.length,
      written: changed.length,
      stored: stored.size - stale.length + created,
    }
    const full = refused > 0
    const update = state(result, full)
    transaction.set(linkRef, update, { merge: true })
    transaction.set(
      summaryRef(db, uid),
      { items: { [feedId]: summaryOf(feedId, merged(data, update)) } },
      { merge: true },
    )
    return { result, full }
  })
}

// ---- Refresh -------------------------------------------------------------------------

export type RefreshOutcome =
  | 'refreshed'
  | 'not-modified'
  | 'failed'
  | 'paused'
  | 'gone'
  | 'removed-orphan'
  | 'removed'
  | 'busy'

/**
 * How long a claim on a link holds (lease.ts): longer than any attempt can run (the
 * endpoint's 120 s and the job's 300 s timeouts), so an older claim was abandoned.
 */
export const CLAIM_HOLD_MS = 10 * 60_000
/** A removal that stopped halfway is finished by the scheduled run after this long. */
export const REMOVAL_RETRY_MS = 60 * 60_000
/** How often a full account's key list may be checked for records already deleted. */
const KEY_CHECK_INTERVAL_MS = DAY_MS
/** A body identical to the last one read is parsed again only after this long. */
const REPARSE_UNCHANGED_MS = DAY_MS
/** Most LOCATION texts kept in a link's place cache. */
const PLACE_CACHE_SIZE = 200

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
    const data = await writableLink(transaction, db, uid, id)
    if (!data) return null
    const update = { ...failureState(data, error, nowMs), ...releaseFields() }
    transaction.set(linkRef, update, { merge: true })
    const summary = summaryOf(id, merged(data, update))
    transaction.set(summaryRef(db, uid), { items: { [id]: summary } }, { merge: true })
    return summary
  })
}

type Claim =
  | { kind: 'gone' }
  | { kind: 'orphan' }
  | { kind: 'removing'; uid: string; abandoned: boolean }
  | { kind: 'busy'; uid: string; data: DocumentData }
  | { kind: 'paused'; summary: SubscriptionSummary }
  | { kind: 'claimed'; uid: string; data: DocumentData; user: DocumentData | undefined }

/**
 * Claims a link before fetching it (lease.ts, REVIEW5 H1): in one transaction, checks the
 * link and its account and moves `due` to the retry time this attempt would get if it
 * failed, so an attempt that hangs or crashes cannot hold the head of the queue. A claim
 * left by an attempt that never reported back counts as a failed attempt ('timeout'), so
 * a link that crashes every time backs off and pauses like one that fails; a scheduled
 * attempt then leaves a link paused, while a manual one (`resume`) tries it anyway.
 */
async function claimLink(
  db: Firestore,
  id: string,
  now: number,
  { resume }: { resume: boolean },
): Promise<Claim> {
  const linkRef = db.collection(SUBSCRIPTIONS_COLLECTION).doc(id)
  return db.runTransaction(async (transaction): Promise<Claim> => {
    const link = await transaction.get(linkRef)
    const data = link.data()
    if (!link.exists || !data || typeof data.uid !== 'string' || typeof data.url !== 'string') {
      return { kind: 'gone' }
    }
    const uid = data.uid
    const [user, tombstone] = await Promise.all([
      transaction.get(db.collection('users').doc(uid)),
      transaction.get(tombstoneRef(db, uid)),
    ])
    if (!user.exists || tombstone.exists) {
      // The account is gone or going: the link goes with it, and nothing is written under
      // the account, which its deletion is removing (REVIEW5 L3).
      transaction.delete(linkRef)
      return { kind: 'orphan' }
    }
    if (data.removing === true) {
      const due = toMillis(data.due)
      return { kind: 'removing', uid, abandoned: !Number.isFinite(due) || due <= now }
    }
    if (!hasProEntitlement(user.data(), now)) {
      // Linked calendars are Pro-only (REVIEW8 SEC L3): the link of an account that is no
      // longer Pro is paused without a fetch and leaves the refresh queue; its events stay
      // until they end, and a refresh once the account is Pro again resumes it.
      const update: DocumentData = {
        status: 'paused',
        error: 'pro-required',
        due: FieldValue.delete(),
        ...releaseFields(),
      }
      transaction.set(linkRef, update, { merge: true })
      const summary = summaryOf(id, merged(data, update))
      transaction.set(summaryRef(db, uid), { items: { [id]: summary } }, { merge: true })
      return { kind: 'paused', summary }
    }
    const claim = claimState(data, now, CLAIM_HOLD_MS)
    if (claim === 'held') return { kind: 'busy', uid, data }
    let update: DocumentData = claim === 'abandoned' ? failureState(data, 'timeout', now) : {}
    const base = merged(data, update)
    if (base.status === 'paused' && !resume) {
      update = { ...update, ...releaseFields() }
      transaction.set(linkRef, update, { merge: true })
      const summary = summaryOf(id, merged(data, update))
      transaction.set(summaryRef(db, uid), { items: { [id]: summary } }, { merge: true })
      return { kind: 'paused', summary }
    }
    const failures = typeof base.failures === 'number' ? base.failures : 0
    update = { ...update, ...claimFields(now, now + nextRefreshDelayMs(failures + 1)) }
    transaction.set(linkRef, update, { merge: true })
    const claimed = merged(data, update)
    if (claim === 'abandoned') {
      transaction.set(
        summaryRef(db, uid),
        { items: { [id]: summaryOf(id, claimed) } },
        { merge: true },
      )
    }
    return { kind: 'claimed', uid, data: claimed, user: user.data() }
  })
}

function contentHash(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

export interface RefreshOptions {
  /** The link's answer, already fetched (adding a link reads it once). */
  prefetched?: FetchCalendarResult
  /** A refresh the person asked for: it tries a paused link too. */
  resume?: boolean
}

/**
 * Fetches one link and stores its events. Never throws for a bad link: failures are
 * recorded on the link (with backoff) and returned as 'failed' or 'paused'.
 */
export async function refreshSubscription(
  deps: SubscriptionDeps,
  id: string,
  { prefetched, resume = false }: RefreshOptions = {},
): Promise<{ outcome: RefreshOutcome; summary: SubscriptionSummary | null }> {
  const { db } = deps
  const now = (deps.now ?? Date.now)()
  const claim = await claimLink(db, id, now, { resume })
  switch (claim.kind) {
    case 'gone':
      return { outcome: 'gone', summary: null }
    case 'orphan':
      return { outcome: 'removed-orphan', summary: null }
    case 'paused':
      return { outcome: 'paused', summary: claim.summary }
    case 'busy':
      return { outcome: 'busy', summary: summaryOf(id, claim.data) }
    case 'removing':
      // A removal that stopped halfway (its call failed) is finished here.
      if (!claim.abandoned) return { outcome: 'gone', summary: null }
      await finishRemoval(db, claim.uid, id)
      return { outcome: 'removed', summary: null }
  }
  const { uid, data, user } = claim
  const home = homeOf(user)
  const fail = async (error: SubscriptionError) => {
    const summary = await recordFailure(db, id, uid, error, now)
    if (!summary) return { outcome: 'gone', summary: null } as const
    return { outcome: summary.status === 'paused' ? 'paused' : 'failed', summary } as const
  }
  if (!home) return fail('no-place')

  const fetched =
    prefetched ??
    (await deps.fetchCalendar(data.url, {
      etag: typeof data.etag === 'string' ? data.etag : null,
      lastModified: typeof data.lastModified === 'string' ? data.lastModified : null,
    }))
  if (!fetched.ok) return fail(fetched.error)

  const success = (extra: DocumentData = {}) => ({
    status: 'active',
    failures: 0,
    failingSince: FieldValue.delete(),
    error: '',
    lastAttemptAt: new Date(now),
    lastSuccessAt: new Date(now),
    due: new Date(now + nextRefreshDelayMs(0)),
    ...releaseFields(),
    ...extra,
  })
  const unchanged = async () => {
    // Unchanged at the source: recurring events still move forward with time, so the
    // stored ones are kept and only the schedule changes. A changed file (or a day
    // later, the same file parsed again) brings the rest.
    const summary = await db.runTransaction(async transaction => {
      const current = await writableLink(transaction, db, uid, id)
      if (!current) return null
      const update = success()
      transaction.set(db.collection(SUBSCRIPTIONS_COLLECTION).doc(id), update, { merge: true })
      const next = summaryOf(id, merged(current, update))
      transaction.set(summaryRef(db, uid), { items: { [id]: next } }, { merge: true })
      return next
    })
    return { outcome: summary ? 'not-modified' : 'gone', summary } as const
  }
  if (fetched.notModified) return unchanged()

  // Many sites answer every request in full; the same bytes as last time need no parse
  // and no event reads (REVIEW5 M2), until a day has passed and recurrences moved on, as
  // long as every event the last write stored is still there (one count: the app's
  // "Remove all" may have deleted them, and they come back).
  const hash = contentHash(fetched.text)
  const parsedAt = toMillis(data.parsedAt)
  if (
    !prefetched &&
    data.contentHash === hash &&
    Number.isFinite(parsedAt) &&
    now - parsedAt < REPARSE_UNCHANGED_MS &&
    typeof data.storedCount === 'number' &&
    (await feedEventsQuery(db, uid, id).count().get()).data().count === data.storedCount
  ) {
    return unchanged()
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

  const items = await drafts(id, parsed.events)
  const places = await resolvePlaces(deps, uid, parsed.events, home, placeCacheOf(data))
  const activities = parsePlanningPreferences(user).activities
  const label = data.customLabel ? data.label : subscriptionLabel(parsed.calendarName, data.host)
  const nowIso = new Date(now).toISOString()
  const build = (previous: ReadonlyMap<string, ImportedEvent>) =>
    feedRecords(id, items, { places, home, activities, previous, now: nowIso })
  const write = (extra: DocumentData = {}) =>
    writeFeedEvents(db, uid, id, build, now, (written, full) =>
      success({
        label,
        etag: fetched.etag ?? FieldValue.delete(),
        lastModified: fetched.lastModified ?? FieldValue.delete(),
        // A full account is written again after its key check, so the hash waits.
        contentHash: full ? FieldValue.delete() : hash,
        parsedAt: new Date(now),
        places: [...places.cache.values()].slice(0, PLACE_CACHE_SIZE),
        eventCount: written.saved,
        refused: written.refused,
        storedCount: written.stored,
        ...extra,
      }),
    )
  let outcome = await write()
  const checked = toMillis(data.keysCheckedAt)
  if (outcome?.full && !(Number.isFinite(checked) && now - checked < KEY_CHECK_INTERVAL_MS)) {
    // The list may hold keys of records Firestore's TTL policy already deleted. Reading
    // every listed record costs up to 1,000 reads, so at most once a day per link.
    await dropDanglingKeys(db, uid)
    outcome = await write({ keysCheckedAt: new Date(now) })
  }
  if (!outcome) return { outcome: 'gone', summary: null }
  const after = (await db.collection(SUBSCRIPTIONS_COLLECTION).doc(id).get()).data()
  return { outcome: 'refreshed', summary: after ? summaryOf(id, after) : null }
}

// ---- Add and remove ------------------------------------------------------------------

/**
 * Links a calendar for a Pro account: checks the link, the plan, the account's cap and
 * duplicates, fetches it once (a link that cannot be read is refused, so nothing is
 * stored for it), stores it and writes its events.
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
  const proRequired = () => {
    throw new HttpError('permission-denied', SUBSCRIPTION_ERRORS['pro-required'])
  }
  const normalized = normalizeSubscriptionUrl(rawUrl)
  if (!normalized.ok) return refuse(normalized.error)
  // Pro-only (REVIEW8 SEC L3): checked before the link is fetched, and again when it is
  // stored.
  if (!hasProEntitlement((await db.collection('users').doc(uid).get()).data(), now)) {
    return proRequired()
  }
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
    const [tombstone, user, current] = await Promise.all([
      transaction.get(tombstoneRef(db, uid)),
      transaction.get(db.collection('users').doc(uid)),
      transaction.get(owned.limit(EVENT_SUBSCRIPTION_LIMITS.maxPerAccount + 1)),
    ])
    if (tombstone.exists || !user.exists) {
      throw new HttpError('deletion-in-progress', 'Account deletion is in progress')
    }
    if (!hasProEntitlement(user.data(), now)) proRequired()
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
      // Due now: the refresh below claims it, writes the events and sets the next time.
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
    // Each page's records and their keys go in one atomic write.
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

/**
 * The end of a removal: the link's events and keys, then the link and its summary entry
 * last, so a removal that stops halfway leaves the link listed for the person to retry
 * (and for the scheduled run to finish). The summary is touched only while the account
 * exists (REVIEW5 L3).
 */
async function finishRemoval(db: Firestore, uid: string, id: string): Promise<void> {
  await deleteFeedEvents(db, uid, id)
  const linkRef = db.collection(SUBSCRIPTIONS_COLLECTION).doc(id)
  await db.runTransaction(async transaction => {
    const [link, user] = await Promise.all([
      transaction.get(linkRef),
      transaction.get(db.collection('users').doc(uid)),
    ])
    if (link.exists && link.data()?.uid !== uid) return
    if (link.exists) transaction.delete(linkRef)
    if (user.exists) {
      transaction.set(
        summaryRef(db, uid),
        { items: { [id]: FieldValue.delete() } },
        { merge: true },
      )
    }
  })
}

/**
 * Unlinks a calendar (REVIEW5 L2): first marks the link `removing`, which stops every
 * refresh from writing for it, then deletes its events with their keys, then the link
 * and its summary entry. Calling it again finishes a removal that stopped halfway.
 */
export async function removeSubscription(
  deps: Pick<SubscriptionDeps, 'db' | 'now'>,
  uid: string,
  id: string,
): Promise<void> {
  const { db } = deps
  const now = (deps.now ?? Date.now)()
  const linkRef = db.collection(SUBSCRIPTIONS_COLLECTION).doc(id)
  await db.runTransaction(async transaction => {
    const link = await transaction.get(linkRef)
    if (!link.exists) return
    if (link.data()?.uid !== uid) throw new HttpError('not-found', 'That calendar is not linked.')
    transaction.set(
      linkRef,
      { removing: true, due: new Date(now + REMOVAL_RETRY_MS), ...releaseFields() },
      { merge: true },
    )
  })
  await finishRemoval(db, uid, id)
}

/**
 * A refresh the person asked for: Pro only, allowed once per manualRefreshMinutes per
 * link, and it resumes a paused link.
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
    if (!link.exists || data?.uid !== uid || data?.removing === true) {
      throw new HttpError('not-found', 'That calendar is not linked.')
    }
    const user = await transaction.get(db.collection('users').doc(uid))
    if (!hasProEntitlement(user.data(), now)) {
      throw new HttpError('permission-denied', SUBSCRIPTION_ERRORS['pro-required'])
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
  const { outcome, summary } = await refreshSubscription({ ...deps, now: () => now }, id, {
    resume: true,
  })
  if (outcome === 'busy') {
    throw new HttpError('rate-limited', 'That calendar is being refreshed. Try again in a minute.')
  }
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
  /** Most links one run takes, however many are due. */
  maxLinks: number
  /** Links refreshed at once (the work waits on the network). */
  concurrency: number
  /** A run stops starting links after this long. */
  budgetMs: number
  /** One link's attempt is abandoned by the run after this long (its claim stays). */
  linkMs: number
  /** Due links read per query. */
  pageSize: number
}

/**
 * Defaults, owner may change (REVIEW5 M4): every due link, oldest due first, up to 3,000
 * a run and 16 at a time, for 200 s of the job's 300 s timeout; one link may hold a lane
 * for at most 90 s (a 10 s fetch, up to 10 place searches of 5 s, the writes).
 */
export const REFRESH_RUN_LIMITS: RefreshRunLimits = Object.freeze({
  maxLinks: 3_000,
  concurrency: 16,
  budgetMs: 200_000,
  linkMs: 90_000,
  pageSize: 100,
})

/**
 * A link still due this long after its time has waited a whole extra refresh period: the
 * run logs an ERROR (which pages the owner, infra/alerts/errors.json) instead of a
 * WARNING.
 */
export const REFRESH_BEHIND_ALERT_MS = EVENT_SUBSCRIPTION_LIMITS.refreshHours * 60 * 60_000

export interface RefreshRunResult {
  /** Links due when the run started. */
  due: number
  /** Links the run took. */
  taken: number
  outcomes: Partial<Record<RefreshOutcome | 'error' | 'timeout', number>>
  /** True when links are still due after the run. */
  backlog: boolean
  /** How long the oldest link still due has waited past its time, in minutes. */
  behindMinutes: number
}

/**
 * One scheduled run: every link whose refresh is due, oldest due first, within the
 * limits. Each link is claimed before it is fetched and has its own deadline, so no link
 * can hold the queue or a lane (REVIEW5 H1); due links are read a page at a time, so a
 * long queue costs reads only for the links the run gets to (REVIEW5 M4).
 */
export async function runSubscriptionRefresh(
  deps: SubscriptionDeps,
  limits: Partial<RefreshRunLimits> = {},
): Promise<RefreshRunResult> {
  const { maxLinks, concurrency, budgetMs, linkMs, pageSize } = {
    ...REFRESH_RUN_LIMITS,
    ...limits,
  }
  const clock = deps.now ?? Date.now
  const startedAt = clock()
  const dueQuery = deps.db
    .collection(SUBSCRIPTIONS_COLLECTION)
    .where('due', '<=', new Date(startedAt))
    .orderBy('due')
  const due = (await dueQuery.count().get()).data().count

  // A queue of due links read a page at a time; claimed links move past the cursor.
  const queue: string[] = []
  let cursor: QueryDocumentSnapshot | null = null
  let exhausted = due === 0
  let reading: Promise<void> | null = null
  let taken = 0
  const readPage = async () => {
    const page: QuerySnapshot = await (cursor ? dueQuery.startAfter(cursor) : dueQuery)
      .limit(pageSize)
      .get()
    queue.push(...page.docs.map(doc => doc.id))
    cursor = page.docs.at(-1) ?? cursor
    if (page.size < pageSize) exhausted = true
  }
  const next = async (): Promise<string | null> => {
    for (;;) {
      if (taken >= maxLinks) return null
      const id = queue.shift()
      if (id) {
        taken += 1
        return id
      }
      if (exhausted) return null
      reading ??= readPage().finally(() => {
        reading = null
      })
      await reading
    }
  }

  const outcomes: RefreshRunResult['outcomes'] = {}
  const count = (outcome: RefreshOutcome | 'error' | 'timeout') => {
    outcomes[outcome] = (outcomes[outcome] ?? 0) + 1
  }
  const lane = async () => {
    for (;;) {
      if (clock() - startedAt >= budgetMs) return
      const id = await next()
      if (!id) return
      try {
        const result = await withDeadline(
          linkMs,
          () => refreshSubscription(deps, id),
          () => null,
        )
        if (result) count(result.outcome)
        else {
          // The link stays claimed: a later attempt counts this one as failed.
          count('timeout')
          logger.warn('linked calendar refresh took too long; the run moved on', { id })
        }
      } catch (error) {
        count('error')
        logger.error('linked calendar refresh failed', { error: loggableError(error) })
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, due)) }, lane))

  // What is still due now, and how long the oldest of it has waited.
  const left = await dueQuery.limit(1).get()
  const oldest = toMillis(left.docs[0]?.data().due)
  const behindMs = Number.isFinite(oldest) ? Math.max(0, startedAt - oldest) : 0
  const result: RefreshRunResult = {
    due,
    taken,
    outcomes,
    backlog: !left.empty,
    behindMinutes: Math.round(behindMs / 60_000),
  }
  if (behindMs >= REFRESH_BEHIND_ALERT_MS) {
    logger.error('linked calendar refresh is falling behind', result)
  } else if (result.backlog) {
    logger.warn('linked calendar refresh has a backlog; the next run carries on', result)
  } else {
    logger.info('linked calendar refresh completed', result)
  }
  return result
}
