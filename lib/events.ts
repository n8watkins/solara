// Imported events (docs/integrations/EVENTS.md, phase 1): an .ics file the person picks
// is parsed in the browser (packages/core/src/ics-parse.ts), each event gets a place,
// and the events are kept in Firestore (users/{uid}/events/{key}) so every device shows
// them. This module holds the pure steps (unit-tested) and the Firestore storage, which
// loads Firestore on demand. It is only ever imported by the lazily loaded Events
// section (components/events/), never by the guest's first load.
import { capText, roundCoordinate } from '@solara/core'
import {
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
  type IcsParseResult,
  type ImportedEvent,
  type ParsedIcsEvent,
} from '@solara/core/event-import'
import { lazySubscription, loadFirebase } from './firebase'
import type { PlaceName, PlaceSuggestion } from './geocoding'
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

/** Most distinct LOCATION texts one import looks up (each takes a second or two). */
export const MAX_PLACE_LOOKUPS = 10

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

const COUNTRY_PART =
  /^(usa|u\.s\.a\.|us|united states( of america)?|uk|united kingdom|canada|australia|new zealand)$/i

/**
 * City-level searches to try for an event's LOCATION text, best first. Street
 * addresses and postal codes are dropped ("Griffith Park, 4730 Crystal Springs Dr,
 * Los Angeles, CA 90027, USA" tries "Los Angeles, CA", then "Los Angeles"), because the
 * place search knows towns, not addresses. Text with no commas is tried as it is only
 * when it is short enough to be a town name.
 */
export function locationQueries(where: string): string[] {
  const parts = where
    .split(',')
    .map(part => part.replace(/\b\d{4,6}(-\d{4})?\b/g, '').trim())
    .filter(Boolean)
  if (parts.length > 1 && COUNTRY_PART.test(parts[parts.length - 1]!)) parts.pop()
  // Town names only: no house numbers, and within the place search's 2-80 characters.
  const named = parts.filter(part => !/\d/.test(part) && part.length >= 2 && part.length <= 60)
  if (parts.length <= 1) {
    const only = named[0]
    return only && only.split(/\s+/).length <= 4 ? [only] : []
  }
  const last = named[named.length - 1]
  const beforeLast = named[named.length - 2]
  const queries: string[] = []
  // "City, ST": a short last part is a region qualifier for the part before it.
  if (last && beforeLast && last.length <= 3) queries.push(`${beforeLast}, ${last}`, beforeLast)
  else if (last) queries.push(last)
  return [...new Set(queries)].slice(0, 2)
}

/** Great-circle distance in km, to pick the right one of several same-named towns. */
function distanceKm(a: Pick<Location, 'lat' | 'lon'>, b: Pick<Location, 'lat' | 'lon'>): number {
  const rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad
  const dLon = (b.lon - a.lon) * rad
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2
  return 12_742 * Math.asin(Math.min(1, Math.sqrt(h)))
}

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
 * are (named by the LOCATION text, else by a reverse lookup); LOCATION text is searched
 * at city level, at most MAX_PLACE_LOOKUPS distinct texts. `known` holds places from
 * earlier imports of the same events, which are reused without a lookup. Events with
 * neither, or whose place is not found, get the person's place, marked as guessed.
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
  // GEO needs no search; LOCATION text is searched for the first MAX_PLACE_LOOKUPS texts.
  let searches = 0
  const work = [...pending].filter(([, event]) => !!event.geo || searches++ < MAX_PLACE_LOOKUPS)
  let done = 0
  for (const [key, event] of work) {
    onProgress?.(done, work.length)
    if (event.geo) {
      const lat = roundCoordinate(event.geo.lat)
      const lon = roundCoordinate(event.geo.lon)
      let label = event.location?.split(',')[0]?.trim() ?? ''
      if (!label) {
        const name = await lookups.reverse(lat, lon)
        // The lookup answers "Your location" when it cannot name the spot.
        label = name.region ? placeLabel(name) : 'Event location'
      }
      places.set(key, {
        lat,
        lon,
        label: capText(label, IMPORTED_EVENT_LIMITS.placeLabelLength),
        guessed: false,
      })
    } else if (event.location) {
      const found = await findPlace(event.location, home, lookups.search)
      if (found) places.set(key, found)
    }
    done += 1
  }
  onProgress?.(work.length, work.length)
  return places
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
}

/** PURE apart from hashing. The stored records for an import's events. */
export async function recordsFromImport(
  events: readonly ParsedIcsEvent[],
  { places, home, activities, previous, now }: RecordOptions,
): Promise<ImportedEvent[]> {
  const records: ImportedEvent[] = []
  for (const event of events) {
    const key = await importedEventKey('file', event.uid, event.recurrenceId)
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
      source: 'file',
      seriesId: await importedSeriesId('file', event.uid),
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

// ---- Import --------------------------------------------------------------------------

export type ImportOutcome =
  { ok: true; saved: ImportedEvent[]; result: IcsParseResult } | { ok: false; message: string }

export interface ImportContext {
  home: Location
  activities: readonly Pick<Activity, 'id' | 'name'>[]
  /** Events already stored. */
  existing: readonly ImportedEvent[]
  nowMs: number
  lookups: () => Promise<PlaceLookups>
  save: (events: ImportedEvent[]) => Promise<void>
  onProgress?: (message: string) => void
}

/** Reads a picked file and stores its upcoming events. Never throws. */
export async function importIcsFile(
  file: Pick<File, 'size' | 'text'>,
  context: ImportContext,
): Promise<ImportOutcome> {
  if (file.size > ICS_IMPORT_LIMITS.maxBytes) {
    return {
      ok: false,
      message: 'That file is larger than 1 MB. Export a shorter range of events.',
    }
  }
  let result: IcsParseResult
  try {
    result = parseIcs(await file.text(), {
      now: context.nowMs,
      defaultTimeZone: resolveTimeZone(context.home.timezone),
    })
  } catch (error) {
    if (error instanceof IcsImportError) {
      return {
        ok: false,
        message:
          error.code === 'too-large'
            ? 'That file is larger than 1 MB. Export a shorter range of events.'
            : 'That file is not a calendar (.ics) file. Use "Add to calendar" or "Export" on the event page to get one.',
      }
    }
    return { ok: false, message: 'Could not read that file.' }
  }
  if (!result.events.length) return { ok: true, saved: [], result }
  try {
    context.onProgress?.('Finding the places…')
    const places = await resolvePlaces(result.events, context.home, await context.lookups(), {
      known: knownPlaces(context.existing),
      onProgress: (done, total) =>
        total > 1 && context.onProgress?.(`Finding the places… ${done} of ${total}`),
    })
    const records = await recordsFromImport(result.events, {
      places,
      home: context.home,
      activities: context.activities,
      previous: new Map(context.existing.map(item => [item.key, item])),
      now: new Date(context.nowMs).toISOString(),
    })
    context.onProgress?.('Saving…')
    await context.save(records)
    return { ok: true, saved: records, result }
  } catch {
    return { ok: false, message: 'Could not save the events. Nothing was changed; try again.' }
  }
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** PURE. What an import did, in one or two sentences. */
export function importSummary(outcome: Extract<ImportOutcome, { ok: true }>): string {
  const { saved, result } = outcome
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
  const head = saved.length
    ? `Imported ${plural(saved.length, 'event')}.`
    : 'No upcoming events with a start time were found in that file.'
  const guessed = saved.filter(e => e.placeGuessed).length
  const tail = [
    notes.length ? `Skipped ${notes.join(', ')}.` : '',
    guessed
      ? `${plural(guessed, 'event')} had no place Solara could find; set it on the event.`
      : '',
  ]
  return [head, ...tail].filter(Boolean).join(' ')
}

// ---- Storage -------------------------------------------------------------------------

/** Where the account's events live: Firestore in the app, memory in the UI harness. */
export interface EventsStore {
  subscribe(
    uid: string,
    onItems: (items: ImportedEvent[]) => void,
    onError: (error: Error) => void,
  ): () => void
  save(uid: string, items: readonly ImportedEvent[]): Promise<void>
  remove(uid: string, keys: readonly string[]): Promise<void>
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
  return { firestore, db, events: firestore.collection(db, 'users', uid, 'events') }
}

/** Firestore allows 500 writes per batch. */
const BATCH_SIZE = 400

export const firestoreEventsStore: EventsStore = {
  subscribe(uid, onItems, onError) {
    return lazySubscription(
      async () => {
        const { firestore, events } = await eventsCollection(uid)
        const { limit, onSnapshot, orderBy, query } = firestore
        // The latest-starting events: upcoming ones always make the list.
        const q = query(events, orderBy('start', 'desc'), limit(IMPORTED_EVENT_LIMITS.listLimit))
        return onSnapshot(
          q,
          snapshot => {
            const items: ImportedEvent[] = []
            for (const d of snapshot.docs) {
              const item = parseImportedEvent(d.data())
              if (item && item.key === d.id) items.push(item)
            }
            onItems(items.reverse())
          },
          onError,
        )
      },
      error => onError(error instanceof Error ? error : new Error(String(error))),
    )
  },
  async save(uid, items) {
    const { firestore, db, events } = await eventsCollection(uid)
    for (let i = 0; i < items.length; i += BATCH_SIZE) {
      const batch = firestore.writeBatch(db)
      for (const item of items.slice(i, i + BATCH_SIZE)) {
        batch.set(firestore.doc(events, item.key), eventDocument(item))
      }
      await batch.commit()
    }
  },
  async remove(uid, keys) {
    const { firestore, db, events } = await eventsCollection(uid)
    for (let i = 0; i < keys.length; i += BATCH_SIZE) {
      const batch = firestore.writeBatch(db)
      for (const key of keys.slice(i, i + BATCH_SIZE)) batch.delete(firestore.doc(events, key))
      await batch.commit()
    }
  },
  async prune(uid, nowMs) {
    const cutoff = new Date(nowMs - EVENTS_RETENTION_MS).toISOString()
    const { firestore, events } = await eventsCollection(uid)
    const { deleteDoc, getDocs, limit, orderBy, query, where } = firestore
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
      await Promise.all(snapshot.docs.map(d => deleteDoc(d.ref)))
      deleted += snapshot.size
      if (snapshot.size < IMPORTED_EVENT_LIMITS.listLimit) break
    }
    return deleted
  },
}
