// Imported events (docs/integrations/EVENTS.md, phase 1): an .ics file the person picks
// is parsed in a Web Worker (lib/ics-worker.ts, running packages/core/src/ics-parse.ts),
// each event gets a place, and the events are kept in Firestore (users/{uid}/events/{key})
// so every device shows them. This module holds the pure steps (unit-tested) and the
// Firestore storage, which loads Firestore on demand. It is only ever imported by the
// lazily loaded Events section (components/events/), never by the guest's first load.
import { capText, roundCoordinate } from '@solara/core'
import {
  distanceKm,
  eventLocationQueries,
  ICS_IMPORT_LIMITS,
  IcsImportError,
  IMPORTED_EVENT_LIMITS,
  IMPORTED_EVENT_RETENTION_DAYS,
  IMPORTED_EVENT_TTL_FIELD,
  importedEventExpiry,
  importedEventKey,
  importedSeriesId,
  matchActivity,
  parseIcs,
  parseImportedEvent,
  type IcsParseOptions,
  type ClientEventSource,
  type IcsParseResult,
  type ImportedEvent,
  type ImportedEventSource,
  type ParsedIcsEvent,
} from '@solara/core/event-import'
import type { QuerySnapshot } from 'firebase/firestore'
import { lazySubscription, loadFirebase } from './firebase'
import type { PlaceName, PlaceSuggestion } from './geocoding'
import { capMessage } from './record-cap'
import { resolveTimeZone } from './time'
import type { Activity, Location } from './types'

export type { ImportedEvent }

// ---- Places --------------------------------------------------------------------------

/** Where an event's UV is forecast. */
export interface EventPlace {
  lat: number
  lon: number
  label: string
  /** The person's own place, because the event gave none Solara could find. */
  guessed: boolean
}

/**
 * Most place lookups one import makes, searches of LOCATION text and reverse lookups of
 * GEO points together (REVIEW4 L3). Each is a request to a free geocoding service that
 * allows about one a second and no bulk use, and takes a second or two.
 */
export const MAX_PLACE_LOOKUPS = 10

/** A GEO point past the lookup cap takes the name of a found place this close, in km. */
export const NEARBY_PLACE_KM = 10

/** "San Diego, California" for a saved place. */
export function placeLabel(place: Pick<Location, 'city' | 'region'>): string {
  const label = place.region ? `${place.city}, ${place.region}` : place.city
  return capText(label, IMPORTED_EVENT_LIMITS.placeLabelLength)
}

/** The person's own place, used when an event has no place Solara can find. */
export function homePlace(home: Location): EventPlace {
  return { lat: home.lat, lon: home.lon, label: placeLabel(home), guessed: true }
}

/** Two places are the same forecast when their rounded coordinates match. */
export function samePlace(
  a: Pick<Location, 'lat' | 'lon'>,
  b: Pick<Location, 'lat' | 'lon'>,
): boolean {
  return (
    roundCoordinate(a.lat) === roundCoordinate(b.lat) &&
    roundCoordinate(a.lon) === roundCoordinate(b.lon)
  )
}

/**
 * City-level searches to try for an event's LOCATION text, best first (shared with the
 * linked-calendar Function, so it lives in core).
 */
export const locationQueries = eventLocationQueries

export interface PlaceLookups {
  search: (query: string) => Promise<PlaceSuggestion[]>
  reverse: (lat: number, lon: number) => Promise<PlaceName>
}

/** Loads the real lookups (lib/geocoding.ts, with its rate limit and cache). */
export async function geocodingLookups(): Promise<PlaceLookups> {
  const { reverseGeocode, searchPlaces } = await import('./geocoding')
  return { search: query => searchPlaces(query, { limit: 5 }), reverse: reverseGeocode }
}

/** The place a LOCATION text names, nearest the person among same-named towns, or null. */
export async function findPlace(
  where: string,
  home: Location,
  search: PlaceLookups['search'],
): Promise<EventPlace | null> {
  for (const query of locationQueries(where)) {
    let results: PlaceSuggestion[]
    try {
      results = await search(query)
    } catch {
      return null
    }
    const best = results
      .map(r => r.location)
      .sort((a, b) => distanceKm(home, a) - distanceKm(home, b))[0]
    if (best) return { lat: best.lat, lon: best.lon, label: placeLabel(best), guessed: false }
  }
  return null
}

/** The lookup key of an event's place: its coordinates, else its LOCATION text. */
export function placeKey(event: Pick<ParsedIcsEvent, 'geo' | 'location'>): string | null {
  if (event.geo) return `geo:${roundCoordinate(event.geo.lat)},${roundCoordinate(event.geo.lon)}`
  if (event.location) return `where:${event.location.toLowerCase()}`
  return null
}

/**
 * A place for every distinct place in the import. GEO coordinates are used as they
 * are, named by the LOCATION text or else by a reverse lookup; LOCATION text alone is
 * searched at city level. Lookups (searches and reverse lookups together) stop at
 * MAX_PLACE_LOOKUPS, soonest events first; a GEO point past the cap takes the name of a
 * found place within NEARBY_PLACE_KM, else "Event location". `known` holds places from
 * earlier imports, reused without a lookup. Events with neither, or whose place is not
 * found, get the person's place, marked as guessed (by the caller).
 */
export async function resolvePlaces(
  events: readonly ParsedIcsEvent[],
  home: Location,
  lookups: PlaceLookups,
  {
    known = new Map(),
    onProgress,
  }: {
    known?: ReadonlyMap<string, EventPlace>
    onProgress?: (done: number, total: number) => void
  } = {},
): Promise<Map<string, EventPlace>> {
  const places = new Map<string, EventPlace>(known)
  const pending = new Map<string, ParsedIcsEvent>()
  for (const event of events) {
    const key = placeKey(event)
    if (key && !places.has(key) && !pending.has(key)) pending.set(key, event)
  }
  const needsLookup = (event: ParsedIcsEvent) => !event.geo || !geoLabel(event)
  const total = Math.min(MAX_PLACE_LOOKUPS, [...pending.values()].filter(needsLookup).length)
  let lookupsMade = 0
  const unnamed: [string, { lat: number; lon: number }][] = []
  for (const [key, event] of pending) {
    if (event.geo) {
      const lat = roundCoordinate(event.geo.lat)
      const lon = roundCoordinate(event.geo.lon)
      let label = geoLabel(event)
      if (!label) {
        if (lookupsMade >= MAX_PLACE_LOOKUPS) {
          unnamed.push([key, { lat, lon }])
          continue
        }
        onProgress?.(lookupsMade, total)
        lookupsMade += 1
        const name = await lookups.reverse(lat, lon)
        // The lookup answers "Your location" when it cannot name the spot.
        label = name.region ? placeLabel(name) : ''
      }
      places.set(key, { lat, lon, label: label || 'Event location', guessed: false })
    } else if (event.location && lookupsMade < MAX_PLACE_LOOKUPS) {
      onProgress?.(lookupsMade, total)
      lookupsMade += 1
      const found = await findPlace(event.location, home, lookups.search)
      if (found) places.set(key, found)
    }
  }
  // Points past the cap: the nearest place this import (or an earlier one) named.
  const named = [...places.values()].filter(place => place.label !== 'Event location')
  for (const [key, point] of unnamed) {
    const near = named
      .map(place => ({ place, km: distanceKm(point, place) }))
      .filter(({ km }) => km <= NEARBY_PLACE_KM)
      .sort((a, b) => a.km - b.km)[0]
    places.set(key, { ...point, label: near?.place.label ?? 'Event location', guessed: false })
  }
  onProgress?.(total, total)
  return places
}

/** The LOCATION text's first part, which names a GEO point without a lookup. */
function geoLabel(event: ParsedIcsEvent): string {
  const label = event.location?.split(',')[0]?.trim() ?? ''
  return capText(label, IMPORTED_EVENT_LIMITS.placeLabelLength)
}

// ---- Records -------------------------------------------------------------------------

export interface RecordOptions {
  places: ReadonlyMap<string, EventPlace>
  home: Location
  activities: readonly Pick<Activity, 'id' | 'name'>[]
  /** Stored events by key: a re-import keeps the person's choices and creation time. */
  previous: ReadonlyMap<string, ImportedEvent>
  /** ISO time of this import. */
  now: string
  /** Where the events come from: a file (default) or the person's Google Calendar. */
  source?: ClientEventSource
}

/** PURE apart from hashing. The stored records for an import's events. */
export async function recordsFromImport(
  events: readonly ParsedIcsEvent[],
  { places, home, activities, previous, now, source = 'file' }: RecordOptions,
): Promise<ImportedEvent[]> {
  const records: ImportedEvent[] = []
  for (const event of events) {
    const key = await importedEventKey(source, event.uid, event.recurrenceId)
    const before = previous.get(key)
    const where = capText(event.location ?? '', IMPORTED_EVENT_LIMITS.whereLength)
    const placeId = placeKey(event)
    // The same text as before keeps the place the person may have set by hand.
    const place: EventPlace =
      before && before.where === where
        ? {
            lat: before.lat,
            lon: before.lon,
            label: before.placeLabel,
            guessed: before.placeGuessed,
          }
        : ((placeId ? places.get(placeId) : undefined) ?? homePlace(home))
    const record = parseImportedEvent({
      key,
      source,
      seriesId: await importedSeriesId(source, event.uid),
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

/** PURE. The places earlier imports settled on, by place key, to skip lookups. */
export function knownPlaces(items: readonly ImportedEvent[]): Map<string, EventPlace> {
  const known = new Map<string, EventPlace>()
  for (const item of items) {
    if (!item.where || item.placeGuessed) continue
    known.set(`where:${item.where.toLowerCase()}`, {
      lat: item.lat,
      lon: item.lon,
      label: item.placeLabel,
      guessed: false,
    })
  }
  return known
}

/** PURE. Events that have not ended, soonest first. */
export function upcomingEvents(items: readonly ImportedEvent[], nowMs: number): ImportedEvent[] {
  return items
    .filter(item => Date.parse(item.end) > nowMs)
    .sort((a, b) => a.start.localeCompare(b.start) || a.key.localeCompare(b.key))
}

/** PURE. A record moved to a place the person chose. */
export function withPlace(item: ImportedEvent, place: Location, now: string): ImportedEvent {
  return {
    ...item,
    lat: roundCoordinate(place.lat),
    lon: roundCoordinate(place.lon),
    placeLabel: placeLabel(place),
    placeGuessed: false,
    updatedAt: now,
  }
}

// ---- Re-imports ----------------------------------------------------------------------

/**
 * PURE apart from hashing. Stored events a re-import shows are gone from the source
 * (REVIEW4 L1): upcoming events of a series the file cancels, cancelled occurrences, and
 * occurrences of a series the file was read in full for (IcsParseResult.series) that it
 * no longer produces. Events the import saves are never in the list. One-off events
 * deleted from the source cannot be told apart from events of another file, so they
 * stay until they end.
 */
export async function staleEventKeys(
  result: Pick<IcsParseResult, 'events' | 'cancelled' | 'series'>,
  stored: readonly ImportedEvent[],
  nowMs: number,
): Promise<string[]> {
  const saving = new Set(
    await Promise.all(result.events.map(e => importedEventKey('file', e.uid, e.recurrenceId))),
  )
  const upcoming = stored.filter(item => Date.parse(item.end) > nowMs && !saving.has(item.key))
  const bySeries = new Map<string, ImportedEvent[]>()
  for (const item of upcoming) {
    const list = bySeries.get(item.seriesId)
    if (list) list.push(item)
    else bySeries.set(item.seriesId, [item])
  }
  const stale = new Set<string>()
  const cancelledKeys = new Set<string>()
  for (const { uid, recurrenceId } of result.cancelled) {
    if (recurrenceId === null) {
      for (const item of bySeries.get(await importedSeriesId('file', uid)) ?? []) {
        stale.add(item.key)
      }
    } else cancelledKeys.add(await importedEventKey('file', uid, recurrenceId))
  }
  for (const item of upcoming) if (cancelledKeys.has(item.key)) stale.add(item.key)
  for (const { uid, until } of result.series) {
    for (const item of bySeries.get(await importedSeriesId('file', uid)) ?? []) {
      if (until === null || Date.parse(item.start) < until) stale.add(item.key)
    }
  }
  return [...stale]
}

/** PURE apart from hashing. The series ids a re-import may remove stored events of. */
export async function affectedSeries(
  result: Pick<IcsParseResult, 'cancelled' | 'series'>,
): Promise<string[]> {
  const uids = new Set([...result.cancelled.map(c => c.uid), ...result.series.map(s => s.uid)])
  return Promise.all([...uids].map(uid => importedSeriesId('file', uid)))
}

// ---- Parsing off the main thread -------------------------------------------------------

export type IcsParser = (text: string, options: IcsParseOptions) => Promise<IcsParseResult>

/** A parse still running after this long is stopped (real files take well under a second). */
export const PARSE_TIMEOUT_MS = 20_000

/** The worker took longer than PARSE_TIMEOUT_MS. */
export class IcsTimeoutError extends Error {
  constructor() {
    super('Reading the calendar file took too long')
    this.name = 'IcsTimeoutError'
  }
}

/** What lib/ics-worker.ts posts back. */
export type IcsWorkerReply =
  | { ok: true; result: IcsParseResult }
  | { ok: false; code: IcsImportError['code'] | null; message: string }

/**
 * Parses in a Web Worker so the page stays responsive whatever the file holds, and
 * stops it after PARSE_TIMEOUT_MS. Where a worker cannot run (no Worker, or it fails to
 * load), it parses on the main thread: the parser's work allowance bounds that too.
 */
export const parseIcsOffThread: IcsParser = (text, options) => {
  if (typeof Worker === 'undefined') return Promise.resolve().then(() => parseIcs(text, options))
  return new Promise((resolve, reject) => {
    let worker: Worker
    try {
      worker = new Worker(new URL('./ics-worker.ts', import.meta.url))
    } catch {
      resolve(parseIcs(text, options))
      return
    }
    const timer = setTimeout(() => {
      worker.terminate()
      reject(new IcsTimeoutError())
    }, PARSE_TIMEOUT_MS)
    const finish = () => {
      clearTimeout(timer)
      worker.terminate()
    }
    worker.onmessage = (message: MessageEvent<IcsWorkerReply>) => {
      finish()
      const reply = message.data
      if (reply.ok) resolve(reply.result)
      else
        reject(
          reply.code ? new IcsImportError(reply.code, reply.message) : new Error(reply.message),
        )
    }
    worker.onerror = event => {
      // The worker script did not load or run: parse here instead.
      event.preventDefault()
      finish()
      try {
        resolve(parseIcs(text, options))
      } catch (error) {
        reject(error)
      }
    }
    worker.postMessage({ text, options })
  })
}

// ---- Import --------------------------------------------------------------------------

export type ImportOutcome =
  | {
      ok: true
      saved: ImportedEvent[]
      /** Events not saved because the account holds the most it can keep. */
      refused: number
      /** Stored events removed because the source cancelled or dropped them. */
      removed: number
      result: IcsParseResult
    }
  | { ok: false; message: string }

export interface ImportContext {
  home: Location
  activities: readonly Pick<Activity, 'id' | 'name'>[]
  /** Events already loaded (the soonest upcoming ones). */
  existing: readonly ImportedEvent[]
  nowMs: number
  lookups: () => Promise<PlaceLookups>
  /** Every stored event of these series. */
  seriesEvents: (seriesIds: readonly string[]) => Promise<ImportedEvent[]>
  /** Saves within the account's cap and returns the events that did not fit. */
  save: (events: ImportedEvent[]) => Promise<ImportedEvent[]>
  remove: (keys: readonly string[]) => Promise<void>
  /** Defaults to parseIcsOffThread. */
  parse?: IcsParser
  onProgress?: (message: string) => void
}

const TOO_LARGE = 'That file is larger than 1 MB. Export a shorter range of events.'

/** Reads a picked file and stores its upcoming events. Never throws. */
export async function importIcsFile(
  file: Pick<File, 'size' | 'text'>,
  context: ImportContext,
): Promise<ImportOutcome> {
  if (file.size > ICS_IMPORT_LIMITS.maxBytes) return { ok: false, message: TOO_LARGE }
  let result: IcsParseResult
  try {
    const parse = context.parse ?? parseIcsOffThread
    result = await parse(await file.text(), {
      now: context.nowMs,
      defaultTimeZone: resolveTimeZone(context.home.timezone),
    })
  } catch (error) {
    if (error instanceof IcsImportError) {
      return {
        ok: false,
        message:
          error.code === 'too-large'
            ? TOO_LARGE
            : 'That file is not a calendar (.ics) file. Use "Add to calendar" or "Export" on the event page to get one.',
      }
    }
    if (error instanceof IcsTimeoutError) {
      return { ok: false, message: 'That file took too long to read. Export a shorter range.' }
    }
    return { ok: false, message: 'Could not read that file.' }
  }
  try {
    const seriesIds = await affectedSeries(result)
    const stored = seriesIds.length ? await context.seriesEvents(seriesIds) : []
    const stale = await staleEventKeys(result, stored, context.nowMs)
    if (!result.events.length && !stale.length) {
      return { ok: true, saved: [], refused: 0, removed: 0, result }
    }
    // Removed first, so they make room under the cap.
    if (stale.length) await context.remove(stale)

    const previous = new Map(
      [...context.existing, ...stored].map(item => [item.key, item] as const),
    )
    const keys = await Promise.all(
      result.events.map(e => importedEventKey('file', e.uid, e.recurrenceId)),
    )
    // Events whose stored record keeps its place need no lookup.
    const toPlace = result.events.filter((event, i) => {
      const before = previous.get(keys[i] as string)
      return (
        !before || before.where !== capText(event.location ?? '', IMPORTED_EVENT_LIMITS.whereLength)
      )
    })
    if (toPlace.length) context.onProgress?.('Finding the places…')
    const places = await resolvePlaces(toPlace, context.home, await context.lookups(), {
      known: knownPlaces(context.existing),
      onProgress: (done, total) =>
        total > 1 && context.onProgress?.(`Finding the places… ${done} of ${total}`),
    })
    const records = await recordsFromImport(result.events, {
      places,
      home: context.home,
      activities: context.activities,
      previous,
      now: new Date(context.nowMs).toISOString(),
    })
    context.onProgress?.('Saving…')
    const refused = new Set((await context.save(records)).map(item => item.key))
    const saved = records.filter(item => !refused.has(item.key))
    return { ok: true, saved, refused: refused.size, removed: stale.length, result }
  } catch {
    return { ok: false, message: 'Could not save the events. Try again.' }
  }
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** PURE. What an import did, in a few sentences. */
export function importSummary(outcome: Extract<ImportOutcome, { ok: true }>): string {
  const { saved, result, refused, removed } = outcome
  const { skipped } = result
  const notes: string[] = []
  if (skipped.allDay) notes.push(plural(skipped.allDay, 'all-day event'))
  if (skipped.past) notes.push(plural(skipped.past, 'past event'))
  if (skipped.cancelled) notes.push(plural(skipped.cancelled, 'cancelled event'))
  if (skipped.tooFar) notes.push(`${plural(skipped.tooFar, 'event')} more than a year away`)
  if (skipped.tooLong) notes.push(`${plural(skipped.tooLong, 'event')} longer than a week`)
  if (skipped.invalid) notes.push(plural(skipped.invalid, 'unreadable event'))
  if (skipped.overLimit)
    notes.push(`${skipped.overLimit} more past the ${ICS_IMPORT_LIMITS.maxEvents}-event limit`)
  if (result.tooComplex) {
    notes.push(`${plural(result.tooComplex, 'repeating event')} too complex to read`)
  }
  const head = saved.length
    ? `Imported ${plural(saved.length, 'event')}.`
    : refused
      ? 'No events were imported.'
      : 'No upcoming events with a start time were found in that file.'
  const guessed = saved.filter(e => e.placeGuessed).length
  const tail = [
    removed ? `Removed ${plural(removed, 'event')} cancelled or no longer in the calendar.` : '',
    refused
      ? `${plural(refused, 'event')} did not fit. ${capMessage('events', IMPORTED_EVENT_LIMITS.maxStored)}`
      : '',
    notes.length ? `Skipped ${notes.join(', ')}.` : '',
    guessed
      ? `${plural(guessed, 'event')} had no place Solara could find; set it on the event.`
      : '',
  ]
  return [head, ...tail].filter(Boolean).join(' ')
}

// ---- Storage -------------------------------------------------------------------------

/** What the Events section shows. */
export interface EventsSnapshot {
  /** The soonest-ending events that have not ended (at most IMPORTED_EVENT_LIMITS.listLimit). */
  items: ImportedEvent[]
  /** How many events the account holds, past ones included (its key list). */
  stored: number
}

/** Where the account's events live: Firestore in the app, memory in the UI harness. */
export interface EventsStore {
  /** Live upcoming events from `nowMs` on, and the stored count. */
  subscribe(
    uid: string,
    nowMs: number,
    onChange: (snapshot: EventsSnapshot) => void,
    onError: (error: Error) => void,
  ): () => void
  /** Saves within the account's cap; returns the events that did not fit. */
  save(uid: string, items: readonly ImportedEvent[]): Promise<ImportedEvent[]>
  remove(uid: string, keys: readonly string[]): Promise<void>
  /**
   * Deletes every event imported from a file and returns how many there were. Events from
   * linked calendars and Google Calendar are removed with their calendar instead, since a
   * refresh would bring them back (REVIEW5 L2).
   */
  removeImported(uid: string): Promise<number>
  /** Every stored event of these series. */
  seriesEvents(uid: string, seriesIds: readonly string[]): Promise<ImportedEvent[]>
  /** Every stored event from one source (the Google Calendar refresh replaces its own). */
  sourceEvents(uid: string, source: ImportedEventSource): Promise<ImportedEvent[]>
  /** The key of every stored event (the account's key list), to skip events stored already. */
  storedKeys(uid: string): Promise<Set<string>>
  /** Deletes events that ended more than IMPORTED_EVENT_RETENTION_DAYS ago. */
  prune(uid: string, nowMs: number): Promise<number>
}

export const EVENTS_RETENTION_MS = IMPORTED_EVENT_RETENTION_DAYS * 86_400_000

/** PURE. The stored document: the record plus its expiry for Firestore's TTL policy. */
export function eventDocument(item: ImportedEvent) {
  return { ...item, [IMPORTED_EVENT_TTL_FIELD]: importedEventExpiry(item) }
}

async function eventsCollection(uid: string) {
  const db = (await loadFirebase())?.db
  if (!db) throw new Error('Firestore is not configured')
  const firestore = await import('firebase/firestore')
  return {
    firestore,
    events: firestore.collection(db, 'users', uid, 'events'),
    index: firestore.doc(db, 'users', uid, 'meta', 'events'),
  }
}

/** Valid records of a query snapshot (invalid ones are ignored). */
function recordsOf(docs: readonly { id: string; data: () => unknown }[]): ImportedEvent[] {
  const items: ImportedEvent[] = []
  for (const d of docs) {
    const item = parseImportedEvent(d.data())
    if (item && item.key === d.id) items.push(item)
  }
  return items
}

/** Most series ids one `in` query may name. */
const IN_QUERY_LIMIT = 30

export const firestoreEventsStore: EventsStore = {
  subscribe(uid, nowMs, onChange, onError) {
    return lazySubscription(
      async () => {
        const { firestore, events, index } = await eventsCollection(uid)
        const { limit, onSnapshot, orderBy, query, where } = firestore
        let items: ImportedEvent[] | null = null
        let listed: Set<string> | null = null
        let reconciling = false
        const emit = () => {
          if (!items || !listed) return
          onChange({ items, stored: Math.max(listed.size, items.length) })
          // Events stored before the key list existed are listed once, so the count and
          // the cap include them.
          const known = listed
          if (!reconciling && items.some(item => !known.has(item.key))) {
            reconciling = true
            void import('./key-index')
              .then(({ reconcile }) => reconcile(uid, 'events'))
              .catch(() => {})
          }
        }
        // The soonest-ending events that have not ended: the ones the list shows first,
        // however many later ones the account holds (REVIEW4 M3).
        const upcoming = query(
          events,
          where('end', '>', new Date(nowMs).toISOString()),
          orderBy('end'),
          limit(IMPORTED_EVENT_LIMITS.listLimit),
        )
        const stopItems = onSnapshot(
          upcoming,
          snapshot => {
            items = recordsOf(snapshot.docs)
            emit()
          },
          onError,
        )
        const stopCount = onSnapshot(
          index,
          snapshot => {
            const ids: unknown = snapshot.data()?.ids
            listed = new Set(ids && typeof ids === 'object' ? Object.keys(ids) : [])
            emit()
          },
          onError,
        )
        return () => {
          stopItems()
          stopCount()
        }
      },
      error => onError(error instanceof Error ? error : new Error(String(error))),
    )
  },
  async save(uid, items) {
    const { saveWithinCap } = await import('./key-index')
    const refused = await saveWithinCap(
      uid,
      'events',
      items.map(item => ({ key: item.key, data: eventDocument(item), item })),
    )
    return refused.map(record => record.item)
  },
  async remove(uid, keys) {
    const { removeRecords } = await import('./key-index')
    await removeRecords(uid, 'events', keys)
  },
  async removeImported(uid) {
    const { reconcile, removeRecords } = await import('./key-index')
    const keys = (await this.sourceEvents(uid, 'file')).map(item => item.key)
    await removeRecords(uid, 'events', keys)
    // Keys of events Firestore's TTL policy already deleted come off the list too.
    await reconcile(uid, 'events')
    return keys.length
  },
  async seriesEvents(uid, seriesIds) {
    const { firestore, events } = await eventsCollection(uid)
    const { documentId, getDocs, limit, orderBy, query, startAfter, where } = firestore
    const pageSize = IMPORTED_EVENT_LIMITS.listLimit
    const out: ImportedEvent[] = []
    for (let i = 0; i < seriesIds.length; i += IN_QUERY_LIMIT) {
      const ids = seriesIds.slice(i, i + IN_QUERY_LIMIT)
      let last: string | null = null
      for (;;) {
        const snapshot: QuerySnapshot = await getDocs(
          query(
            events,
            where('seriesId', 'in', ids),
            orderBy(documentId()),
            ...(last === null ? [] : [startAfter(last)]),
            limit(pageSize),
          ),
        )
        out.push(...recordsOf(snapshot.docs))
        if (snapshot.size < pageSize) break
        last = snapshot.docs[snapshot.size - 1]?.id ?? null
      }
    }
    return out
  },
  async sourceEvents(uid, source) {
    const { firestore, events } = await eventsCollection(uid)
    const { documentId, getDocs, limit, orderBy, query, startAfter, where } = firestore
    const pageSize = IMPORTED_EVENT_LIMITS.listLimit
    const out: ImportedEvent[] = []
    let last: string | null = null
    // The account holds at most IMPORTED_EVENT_LIMITS.maxStored events, so this ends.
    for (;;) {
      const snapshot: QuerySnapshot = await getDocs(
        query(
          events,
          where('source', '==', source),
          orderBy(documentId()),
          ...(last === null ? [] : [startAfter(last)]),
          limit(pageSize),
        ),
      )
      out.push(...recordsOf(snapshot.docs))
      if (snapshot.size < pageSize) break
      last = snapshot.docs[snapshot.size - 1]?.id ?? null
    }
    return out
  },
  async storedKeys(uid) {
    // One read of the key list (users/{uid}/meta/events), not of every record.
    const { listedKeys } = await import('./key-index')
    return listedKeys(uid, 'events')
  },
  async prune(uid, nowMs) {
    const cutoff = new Date(nowMs - EVENTS_RETENTION_MS).toISOString()
    const { firestore, events } = await eventsCollection(uid)
    const { getDocs, limit, orderBy, query, where } = firestore
    const { removeRecords } = await import('./key-index')
    let deleted = 0
    // At most a few pages per pass; a larger backlog finishes on a later visit.
    for (let page = 0; page < 5; page += 1) {
      const snapshot = await getDocs(
        query(
          events,
          where('end', '<', cutoff),
          orderBy('end'),
          limit(IMPORTED_EVENT_LIMITS.listLimit),
        ),
      )
      await removeRecords(
        uid,
        'events',
        snapshot.docs.map(d => d.id),
      )
      deleted += snapshot.size
      if (snapshot.size < IMPORTED_EVENT_LIMITS.listLimit) break
    }
    return deleted
  },
}
