// Events already in a calendar service the person connects in the browser: Google Calendar
// (lib/google-events.ts, docs/integrations/EVENTS.md, phase 2b) and Outlook
// (lib/outlook-events.ts, docs/integrations/OUTLOOK.md). Each connection reads the chosen
// calendars with its own API and turns their events into the importer's events; what
// they share lives here: the stored connection (which calendars), the rule for which
// location text may reach a place search (REVIEW6 M2), and the refresh that stores the
// events next to imported ones, removes the ones that are gone, skips duplicates of other
// sources and stops when the connection was removed meanwhile (REVIEW6 L4). Only the
// lazily loaded Events section imports this module.
import {
  IMPORTED_EVENT_LIMITS,
  importedEventKey,
  type ClientEventSource,
  type ImportedEvent,
  type ParsedIcsEvent,
} from '@solara/core/event-import'
import { lazySubscription, loadFirebase } from './firebase'
import type { EventsStore, PlaceLookups } from './events'
import { knownPlaces, locationQueries, recordsFromImport, resolvePlaces } from './events'
import { capMessage } from './record-cap'
import type { Activity, Location } from './types'

/** A calendar service whose events the app reads itself. */
export type CalendarSource = Exclude<ClientEventSource, 'file'>

/** One chosen calendar: the service's id (or its stand-in for the main one) and name. */
export interface CalendarChoice {
  id: string
  /** '' for the main calendar, which the app names itself. */
  name: string
}

/** A stored connection: users/{uid}/meta/{googleCalendar,outlookCalendar}. */
export interface CalendarLink {
  calendars: CalendarChoice[]
  connectedAt: string
  /** The last refresh that finished ('' before the first). */
  syncedAt: string
}

/** Why an event from a calendar service is not shown. */
export type CalendarSkip = 'allDay' | 'declined' | 'noPlace' | 'tooLong' | 'other'

/** An event longer than this is not an outing (as for imported files). */
export const MAX_EVENT_MS = 7 * 24 * 3_600_000

// ---- Which location text may be searched (REVIEW6 M2) ----------------------------------

/**
 * Location text that is a meeting rather than a place: a link (a video call, a meeting
 * page), a phone number or dial-in details. It is dropped, never stored: meeting links
 * and dial-ins can carry passcodes (REVIEW6 M2).
 */
export function isMeetingLocation(text: string): boolean {
  return (
    /\bhttps?:\/\/|\bwww\.|\b[a-z0-9-]+\.(com|us|net|org|io|me)\/\S/i.test(text) ||
    /\b(pin|passcode|password|pwd|meeting id|conference id|access code|participant code|dial[- ]?in|join by phone)\b/i.test(
      text,
    ) ||
    // A phone number: "+1 415 555 0100", "(415) 555-0100", "415-555-0100".
    /\+\d[\d\s().-]{6,}\d|\(\d{3}\)\s*\d{3}[\s.-]\d{4}|\b\d{3}[.-]\d{3}[.-]\d{4}\b/.test(text)
  )
}

/**
 * Countries an address may end with (as Google Maps and Outlook write them), which mark
 * the text as an address and are not searched themselves.
 */
const COUNTRIES = new Set([
  'usa',
  'u.s.a.',
  'us',
  'united states',
  'united states of america',
  'uk',
  'united kingdom',
  'england',
  'scotland',
  'wales',
  'northern ireland',
  'ireland',
  'canada',
  'mexico',
  'australia',
  'new zealand',
  'france',
  'germany',
  'deutschland',
  'spain',
  'españa',
  'portugal',
  'italy',
  'italia',
  'netherlands',
  'belgium',
  'switzerland',
  'austria',
  'denmark',
  'sweden',
  'norway',
  'finland',
  'iceland',
  'poland',
  'czechia',
  'greece',
  'turkey',
  'japan',
  'south korea',
  'china',
  'india',
  'singapore',
  'thailand',
  'indonesia',
  'philippines',
  'vietnam',
  'south africa',
  'brazil',
  'argentina',
  'chile',
  'peru',
  'colombia',
  'costa rica',
  'israel',
  'united arab emirates',
  'egypt',
  'morocco',
  'kenya',
])

/** A state or province code ("CA", "NSW"), with or without its postal code. */
const REGION_CODE = /^([A-Z]{2,3})(\s+[A-Z0-9][A-Z0-9 -]{2,8})?$/

/** Capitals that look like a region code in work locations but are not one. */
const NOT_A_REGION = new Set([
  'HQ',
  'TBD',
  'TBA',
  'ID',
  'PIN',
  'RM',
  'STE',
  'APT',
  'EXT',
  'HR',
  'IT',
  'QA',
  'VP',
  'CEO',
  'CTO',
  'PM',
  'AM',
])

const isRegionCode = (part: string) => {
  const code = REGION_CODE.exec(part)?.[1]
  return !!code && !NOT_A_REGION.has(code)
}

/** A US ZIP code or a Canadian or British postcode inside a part. */
const POSTAL_CODE =
  /\b\d{5}(-\d{4})?\b|\b[A-Z]\d[A-Z] ?\d[A-Z]\d\b|\b[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}\b/

/** A part that names a person ("Dr Patel", "Mrs. Lee"): the text is about someone, not a place. */
const PERSON = /^(dr|doctor|mr|mrs|ms|mx|miss|prof|professor|rev|fr|sir|dame)\.?\s+\S/i

/** Words that make a search about a room, a meeting or someone's home rather than a town. */
const NOT_A_TOWN =
  /\b(room|rm|suite|ste|floor|fl|level|office|desk|building|bldg|conference|meeting|call|zoom|teams|webex|meet|phone|dial|pin|code|ext|hq|headquarters|apt|apartment|unit|home|house|my|our|his|her|their|clinic|hospital)\b|\p{L}'s\b|\p{L}'s\b/iu

/**
 * PURE. The town-level searches a calendar event's location may make, best first, or
 * none (REVIEW6 M2). Work and personal calendars hold locations such as "Dr Patel",
 * "Therapy Room 2" or "Client HQ", which must never reach a place search, so this
 * under-matches on purpose: only text written as an address is searched, that is with at
 * least two comma-separated parts, one of them after the first a state or province code
 * ("CA", "NSW 2000"), a postal code or a country, and none of them naming a person. Only
 * the town part is then searched ("Los Angeles, CA" for "Griffith Park, 4730 Crystal
 * Springs Dr, Los Angeles, CA 90027, USA"), and never a part that names a room, a meeting
 * or a home. Anything else keeps the person's place, which they can set by hand on the
 * event.
 */
export function calendarLocationQueries(where: string): string[] {
  if (isMeetingLocation(where)) return []
  const parts = where
    .split(',')
    .map(part => part.trim())
    .filter(Boolean)
  if (parts.length < 2 || parts.some(part => PERSON.test(part))) return []
  const country = COUNTRIES.has(parts[parts.length - 1]!.toLowerCase())
  const addressed =
    country || parts.slice(1).some(part => isRegionCode(part) || POSTAL_CODE.test(part))
  if (!addressed) return []
  // The country is not a town to search for ("Tiergarten, Berlin, Germany" is Berlin).
  const text = country ? parts.slice(0, -1).join(', ') : where
  return locationQueries(text).filter(query => !NOT_A_TOWN.test(query))
}

// ---- The connection (which calendars) -------------------------------------------------

/**
 * Where the account's connection to one calendar service lives: Firestore, or memory in
 * the harness. The connection is also what lets the app store that service's events: the
 * rules refuse them while it does not exist, so a disconnect on one device wins over a
 * refresh still running on another (REVIEW6 L4).
 */
export interface CalendarLinkStore<Link extends CalendarLink = CalendarLink> {
  subscribe(
    uid: string,
    onChange: (link: Link | null) => void,
    onError: (error: Error) => void,
  ): () => void
  /** The connection as stored now (asked of the server, not a cache), or null. */
  read(uid: string): Promise<Link | null>
  /** Starts a connection, replacing any. Only a click on the panel's "Show my … events" does. */
  save(uid: string, link: Link): Promise<void>
  /**
   * Changes a connection that still exists, and only the fields given; false when it is
   * gone (disconnected, perhaps on another device), which it never brings back.
   */
  update(uid: string, patch: Partial<Pick<Link, 'calendars' | 'syncedAt'>>): Promise<boolean>
  remove(uid: string): Promise<void>
}

/** Firestore's error for a write the rules refused, or for a document that is gone. */
export function errorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' ? code : ''
}

/** The connection in users/{uid}/meta/{doc}, read with `parse` (null when invalid). */
export function firestoreCalendarLinkStore<Link extends CalendarLink>(
  doc: string,
  parse: (raw: unknown) => Link | null,
): CalendarLinkStore<Link> {
  async function linkDoc(uid: string) {
    const db = (await loadFirebase())?.db
    if (!db) throw new Error('Firestore is not configured')
    const firestore = await import('firebase/firestore')
    return { firestore, ref: firestore.doc(db, 'users', uid, 'meta', doc) }
  }
  return {
    subscribe(uid, onChange, onError) {
      return lazySubscription(
        async () => {
          const { firestore, ref } = await linkDoc(uid)
          return firestore.onSnapshot(ref, snapshot => onChange(parse(snapshot.data())), onError)
        },
        error => onError(error instanceof Error ? error : new Error(String(error))),
      )
    },
    async read(uid) {
      const { firestore, ref } = await linkDoc(uid)
      return parse((await firestore.getDocFromServer(ref)).data())
    },
    async save(uid, link) {
      const { firestore, ref } = await linkDoc(uid)
      await firestore.setDoc(ref, link)
    },
    async update(uid, patch) {
      const { firestore, ref } = await linkDoc(uid)
      try {
        await firestore.updateDoc(ref, patch)
        return true
      } catch (error) {
        if (errorCode(error) === 'not-found') return false
        throw error
      }
    },
    async remove(uid) {
      const { firestore, ref } = await linkDoc(uid)
      await firestore.deleteDoc(ref)
    },
  }
}

/** PURE. "Your main calendar", "Your main calendar and Running club", "3 calendars". */
export function calendarsText(calendars: readonly CalendarChoice[]): string {
  const names = calendars.map(c => (c.name ? c.name : 'your main calendar'))
  const text = names.length <= 2 ? names.join(' and ') : `${names.length} calendars`
  return text.charAt(0).toUpperCase() + text.slice(1)
}

// ---- A refresh -------------------------------------------------------------------------

/** What reading a service's calendars found, before anything is stored. */
export interface CalendarRead {
  /** The events to keep, by their stored key (the same event on two calendars once). */
  found: Map<string, ParsedIcsEvent>
  skipped: Record<CalendarSkip, number>
  /** Chosen calendars the service no longer shares. */
  missing: CalendarChoice[]
}

/** An empty CalendarRead to fill. */
export function emptyRead(): CalendarRead {
  return {
    found: new Map(),
    skipped: { allDay: 0, declined: 0, noPlace: 0, tooLong: 0, other: 0 },
    missing: [],
  }
}

/** Adds an event to `read.found` under its stored key, once. */
export async function addFound(
  read: CalendarRead,
  source: CalendarSource,
  event: ParsedIcsEvent,
): Promise<void> {
  const key = await importedEventKey(source, event.uid, event.recurrenceId)
  if (!read.found.has(key)) read.found.set(key, event)
}

/** What storing a refresh needs, whichever service the events came from. */
export interface StoreContext {
  uid: string
  home: Location
  activities: readonly Pick<Activity, 'id' | 'name'>[]
  nowMs: number
  store: Pick<EventsStore, 'save' | 'remove' | 'upcoming' | 'storedKeys'>
  lookups: () => Promise<PlaceLookups>
  onProgress?: (message: string) => void
  /**
   * Asked once the service has answered and before anything is written: false when the
   * connection is gone or its calendars changed meanwhile (on another device), and the
   * refresh then stops without writing (REVIEW6 L4).
   */
  connected?: () => Promise<boolean>
}

export interface SyncOutcome {
  /** Upcoming events from the service now stored (new, changed and unchanged). */
  shown: number
  /** Events that did not fit under the account's cap. */
  refused: number
  /** Stored events gone from the service (deleted, moved out of the window, or declined). */
  removed: number
  /** Events already in Solara from a file, a linked calendar or another service. */
  duplicates: number
  /** Events past the per-refresh limit (the soonest are kept). */
  overLimit: number
  /** Chosen calendars the service no longer shares. */
  missing: CalendarChoice[]
  skipped: Record<CalendarSkip, number>
}

/** The same event in another source: same title, start and end. */
function signature(e: { title: string; start: string | number; end: string | number }): string {
  const iso = (t: string | number) => new Date(t).toISOString()
  return `${e.title.trim().toLowerCase()}\n${iso(e.start)}\n${iso(e.end)}`
}

/** Fields a refresh rewrites; a record with none changed is not written again. */
const COMPARED = [
  'title',
  'start',
  'end',
  'timeZone',
  'where',
  'lat',
  'lon',
  'placeLabel',
  'placeGuessed',
  'activityId',
] as const

function unchanged(a: ImportedEvent, b: ImportedEvent | undefined): boolean {
  return !!b && COMPARED.every(field => a[field] === b[field])
}

/**
 * Makes the stored events of `source` match what a refresh read: new and changed ones
 * saved within the account's cap (the soonest `maxEventsPerSync`), ones gone from the
 * service removed, the person's place and activity kept while the location text is
 * unchanged, and events already in Solara from another source (the same file UID, or the
 * same title and times) counted as duplicates instead. Null when `connected` says the
 * connection is gone or changed, before anything is written.
 */
export async function storeCalendarEvents(
  source: CalendarSource,
  { found, skipped, missing }: CalendarRead,
  context: StoreContext & {
    maxEventsPerSync: number
    queriesFor?: (where: string) => string[]
  },
): Promise<SyncOutcome | null> {
  const { uid, home, activities, nowMs, store } = context
  if (context.connected && !(await context.connected())) return null

  // Every stored event that has not ended, not only the ones the Events section loaded
  // (REVIEW6 L5): the duplicates below and the events of `source` this refresh replaces.
  const upcoming = await store.upcoming(uid, nowMs)

  // Events already in Solara from a file (same UID) or another source (same title and
  // times) are shown once, from there.
  const listed = await store.storedKeys(uid)
  const others = new Set(upcoming.filter(e => e.source !== source).map(signature))
  let duplicates = 0
  const fresh: [string, ParsedIcsEvent][] = []
  for (const [key, event] of found) {
    const fileKey = await importedEventKey('file', event.uid, event.recurrenceId)
    if (listed.has(fileKey) || others.has(signature(event))) duplicates += 1
    else fresh.push([key, event])
  }
  fresh.sort(([, a], [, b]) => a.start - b.start)
  const kept = fresh.slice(0, context.maxEventsPerSync)
  const overLimit = fresh.length - kept.length
  const keptKeys = new Set(kept.map(([key]) => key))

  // Stored events of this source that have not ended and are no longer there go first, so
  // they make room under the cap. Past ones stay until they expire, like imported events.
  const stored = upcoming.filter(item => item.source === source)
  const previous = new Map(stored.map(item => [item.key, item] as const))
  const gone = stored.filter(item => !keptKeys.has(item.key)).map(item => item.key)
  if (gone.length) await store.remove(uid, gone)

  const events = kept.map(([, event]) => event)
  const toPlace = events.filter((event, i) => {
    const before = previous.get(kept[i]![0])
    return !before || before.where !== (event.location ?? '')
  })
  if (toPlace.length) context.onProgress?.('Finding the places…')
  const places = toPlace.length
    ? await resolvePlaces(toPlace, home, await context.lookups(), {
        known: knownPlaces(upcoming),
        onProgress: (done, total) =>
          total > 1 && context.onProgress?.(`Finding the places… ${done} of ${total}`),
        queriesFor: context.queriesFor ?? calendarLocationQueries,
      })
    : new Map()
  const records = await recordsFromImport(events, {
    source,
    places,
    home,
    activities,
    previous,
    now: new Date(nowMs).toISOString(),
  })
  const changed = records.filter(record => !unchanged(record, previous.get(record.key)))
  if (changed.length) context.onProgress?.('Saving…')
  const refused = changed.length ? (await store.save(uid, changed)).length : 0
  return {
    shown: records.length - refused,
    refused,
    removed: gone.length,
    duplicates,
    overLimit,
    missing,
    skipped,
  }
}

const sameCalendars = (a: CalendarLink, b: CalendarLink) =>
  a.calendars.map(c => c.id).join('\n') === b.calendars.map(c => c.id).join('\n')

/**
 * A refresh of `link`, the connection as it was when it started: `sync` (given the check
 * that the connection is unchanged), then the new `syncedAt`. A disconnect or a new
 * calendar choice on another device wins: the refresh writes nothing once it sees either,
 * never brings the connection back, and a write the rules refuse because the connection
 * is gone ends it quietly. Null when it stopped for that reason (REVIEW6 L4).
 */
export async function refreshCalendarLink<Link extends CalendarLink>(
  {
    uid,
    link,
    linkStore,
  }: { uid: string; link: Link; linkStore: Pick<CalendarLinkStore<Link>, 'read' | 'update'> },
  sync: (connected: () => Promise<boolean>) => Promise<SyncOutcome | null>,
): Promise<SyncOutcome | null> {
  const unchangedLink = async () => {
    const now = await linkStore.read(uid)
    return !!now && sameCalendars(now, link)
  }
  try {
    const outcome = await sync(unchangedLink)
    if (!outcome) return null
    return (await linkStore.update(uid, { syncedAt: new Date().toISOString() })) ? outcome : null
  } catch (error) {
    if (errorCode(error) === 'permission-denied' && !(await unchangedLink().catch(() => true))) {
      return null
    }
    throw error
  }
}

/**
 * Removes every stored event of `source`: after a disconnect, and whenever a device finds
 * such events with no connection (a disconnect whose removal stopped halfway).
 */
export async function removeSourceEvents(
  uid: string,
  source: CalendarSource,
  store: Pick<EventsStore, 'sourceEvents' | 'remove'>,
): Promise<number> {
  const keys = (await store.sourceEvents(uid, source)).map(item => item.key)
  if (keys.length) await store.remove(uid, keys)
  return keys.length
}

/**
 * Disconnects a calendar service: the connection goes first, so no refresh on any device
 * can store its events from then on (the rules refuse them), then every stored event of
 * that source.
 */
export async function disconnectCalendar({
  uid,
  source,
  linkStore,
  store,
}: {
  uid: string
  source: CalendarSource
  linkStore: Pick<CalendarLinkStore, 'remove'>
  store: Pick<EventsStore, 'sourceEvents' | 'remove'>
}): Promise<void> {
  await linkStore.remove(uid)
  await removeSourceEvents(uid, source, store)
}

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`

/** PURE. What a refresh did, in a sentence or two ("… from Google Calendar."). */
export function calendarSyncSummary(
  outcome: SyncOutcome,
  { service, windowDays }: { service: string; windowDays: number },
): string {
  const one = outcome.duplicates === 1
  // Every event worth showing is already in Solara from another source: say so, rather
  // than that none has an address (REVIEW7 L2).
  const allDuplicates = !outcome.shown && outcome.duplicates > 0
  const head = outcome.shown
    ? `Showing ${plural(outcome.shown, 'upcoming event')} from ${service}.`
    : allDuplicates
      ? `Your ${plural(outcome.duplicates, 'event')} from ${service} ${one ? 'is' : 'are'} already in Solara, so ${one ? 'it is' : 'they are'} shown once.`
      : `No events in the next ${windowDays} days have an address or match one of your activities.`
  const notes = [
    outcome.duplicates && !allDuplicates
      ? `${plural(outcome.duplicates, 'event')} already in Solara ${one ? 'is' : 'are'} shown once.`
      : '',
    outcome.overLimit
      ? `${plural(outcome.overLimit, 'later event')} will show once sooner ones have passed.`
      : '',
    outcome.refused
      ? `${plural(outcome.refused, 'event')} did not fit. ${capMessage('events', IMPORTED_EVENT_LIMITS.maxStored)}`
      : '',
    outcome.missing.length
      ? `${calendarsText(outcome.missing)} ${outcome.missing.length === 1 ? 'is' : 'are'} no longer shared with you.`
      : '',
  ]
  return [head, ...notes].filter(Boolean).join(' ')
}

/** PURE. "Updated just now", "Updated 3 hours ago", "Updated Jun 14", "Not updated yet". */
export function syncedText(iso: string, nowMs: number): string {
  const at = Date.parse(iso)
  if (!iso || Number.isNaN(at)) return 'Not updated yet'
  const minutes = Math.max(0, Math.round((nowMs - at) / 60_000))
  if (minutes < 1) return 'Updated just now'
  if (minutes < 60) return `Updated ${plural(minutes, 'minute')} ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `Updated ${plural(hours, 'hour')} ago`
  return `Updated ${new Date(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
}

/** True when a refresh is due by itself (the app is open and a token is in memory). */
export function refreshDueAfter(link: CalendarLink, nowMs: number, minutes: number): boolean {
  const at = Date.parse(link.syncedAt)
  return Number.isNaN(at) || nowMs - at >= minutes * 60_000
}
