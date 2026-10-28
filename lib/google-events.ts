// Events already in Google Calendar (docs/integrations/EVENTS.md, phase 2b): the app's
// side, which is all of it. With the person's consent the browser reads their upcoming
// events (the read-only scope in packages/core/src/google-calendar-events.ts, through
// lib/gcal.ts), keeps those with an address or that match one of their activities, and
// stores them next to imported events (`source: 'google'`), so they get the UV card and
// the Pro heads-ups. Tokens stay in memory, so events refresh only while Solara is open:
// by themselves while this session holds a token, otherwise when the person presses
// Refresh. Only the lazily loaded Events section imports this module.
import { capText, SOLARA_EVENT_TAG } from '@solara/core'
import {
  GOOGLE_CALENDAR_LINK_DOC,
  GOOGLE_EVENT_LIMITS,
  GOOGLE_EVENTS_SCOPE,
  GOOGLE_CALENDAR_LIST_SCOPE,
  IMPORTED_EVENT_LIMITS,
  importedEventKey,
  isIanaTimeZone,
  matchActivity,
  parseGoogleCalendarLink,
  stripInvisibleFormatting,
  type GoogleCalendarChoice,
  type GoogleCalendarLink,
  type ImportedEvent,
  type ParsedIcsEvent,
} from '@solara/core/event-import'
import * as v from 'valibot'
import type * as Gcal from './gcal'
import type { CalendarEventsPage, CalendarListEntry } from './gcal'
import { lazySubscription, loadFirebase } from './firebase'
import type { EventsStore, PlaceLookups } from './events'
import { knownPlaces, locationQueries, recordsFromImport, resolvePlaces } from './events'
import { capMessage } from './record-cap'
import { resolveTimeZone } from './time'
import type { Activity, Location } from './types'

export type { CalendarListEntry, GoogleCalendarChoice, GoogleCalendarLink }
export { GOOGLE_CALENDAR_LIST_SCOPE, GOOGLE_EVENTS_SCOPE }

// ---- Google's side, swappable in the UI harness ----------------------------------------

/** What the feature needs from Google: lib/gcal.ts in the app, a fake in the UI harness. */
export interface GoogleCalendarApi {
  /** True when an unexpired token for `scope` is in memory (no popup needed). */
  hasToken(scope: string): boolean
  /** A token for `scope`; `interactive` opens the consent popup, which needs a click. */
  requestToken(scope: string, options: { interactive: boolean }): Promise<string>
  listCalendars(token: string): Promise<CalendarListEntry[]>
  listEvents(
    token: string,
    calendarId: string,
    timeMin: Date,
    timeMax: Date,
    page: { pageToken?: string; pageSize: number },
  ): Promise<CalendarEventsPage | null>
  /** Ends Solara's Google Calendar grant; false when no token says whose it is. */
  revoke(): Promise<boolean>
}

/** lib/gcal.ts, loaded on first use. */
export const googleCalendarApi: GoogleCalendarApi = {
  hasToken: scope => gcalLoaded?.hasScopeToken(scope) ?? false,
  async requestToken(scope, options) {
    return (await gcal()).requestScopeToken(scope, options)
  },
  async listCalendars(token) {
    return (await gcal()).listCalendars(token, GOOGLE_CALENDAR_LIST_SCOPE)
  },
  async listEvents(token, calendarId, timeMin, timeMax, page) {
    return (await gcal()).listCalendarEvents(
      token,
      GOOGLE_EVENTS_SCOPE,
      calendarId,
      timeMin,
      timeMax,
      page,
    )
  },
  async revoke() {
    return (await gcal()).revokeCalendarAccess()
  },
}

let gcalLoaded: typeof Gcal | null = null
async function gcal() {
  gcalLoaded ??= await import('./gcal')
  return gcalLoaded
}

/**
 * Why a Google call failed in a way the person must fix by connecting again (lib/gcal.ts
 * CalendarAuthError): an expired or refused token, or a consent popup that did not finish.
 * `dismissed` is true when they closed the popup themselves.
 */
export function authProblem(error: unknown): { dismissed: boolean } | null {
  if (!(error instanceof Error) || error.name !== 'CalendarAuthError') return null
  return { dismissed: (error as Error & { reason?: string }).reason === 'popup_closed' }
}

// ---- Reading one Google event ----------------------------------------------------------

/** Why a Google event is not shown. */
export type GoogleSkip = 'allDay' | 'declined' | 'noPlace' | 'tooLong' | 'other'

const timeSchema = v.looseObject({
  dateTime: v.optional(v.string()),
  date: v.optional(v.string()),
  timeZone: v.optional(v.string()),
})

const googleEventSchema = v.looseObject({
  id: v.optional(v.string()),
  iCalUID: v.optional(v.string()),
  status: v.optional(v.string()),
  summary: v.optional(v.string()),
  location: v.optional(v.string()),
  start: v.optional(timeSchema),
  end: v.optional(timeSchema),
  recurringEventId: v.optional(v.string()),
  originalStartTime: v.optional(timeSchema),
  extendedProperties: v.optional(
    v.looseObject({ private: v.optional(v.record(v.string(), v.unknown())) }),
  ),
  attendees: v.optional(
    v.array(
      v.looseObject({ self: v.optional(v.boolean()), responseStatus: v.optional(v.string()) }),
    ),
  ),
})

/** An event longer than this is not an outing (as for imported files). */
const MAX_EVENT_MS = 7 * 24 * 3_600_000

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
 * Countries an address may end with (as Google Maps writes them), which mark the text as
 * an address and are not searched themselves.
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
  /\b(room|rm|suite|ste|floor|fl|level|office|desk|building|bldg|conference|meeting|call|zoom|teams|webex|meet|phone|dial|pin|code|ext|hq|headquarters|apt|apartment|unit|home|house|my|our|his|her|their|clinic|hospital)\b|\p{L}'s\b|\p{L}\u2019s\b/iu

/**
 * PURE. The town-level searches a Google Calendar event's location may make, best
 * first, or none (REVIEW6 M2). Work and personal calendars hold locations such as
 * "Dr Patel", "Therapy Room 2" or "Client HQ", which must never reach a place search,
 * so this under-matches on purpose: only text written as an address is searched, that
 * is with at least two comma-separated parts, one of them after the first a state or
 * province code ("CA", "NSW 2000"), a postal code or a country, and none of them naming
 * a person. Only the town part is then searched ("Los Angeles, CA" for "Griffith Park,
 * 4730 Crystal Springs Dr, Los Angeles, CA 90027, USA"), and never a part that names a
 * room, a meeting or a home. Anything else keeps the person's place, which they can set
 * by hand on the event.
 */
export function googleLocationQueries(where: string): string[] {
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

export interface GoogleEventContext {
  /** The calendar's own zone (from the events page), for events that name none. */
  calendarTimeZone?: string
  /** The person's zone, when neither the event nor the calendar names a valid one. */
  fallbackTimeZone: string
  activities: readonly Pick<Activity, 'id' | 'name'>[]
  nowMs: number
}

/**
 * PURE. A Google Calendar event as the importer's event, or why it is skipped. Kept: timed
 * events that have not ended, are not declined, last at most a week, and have a location
 * that reads as a town (googleLocationQueries) or match one of the person's activities by
 * title. Links and dial-in details are never kept as the location.
 */
export function parseGoogleEvent(
  raw: unknown,
  { calendarTimeZone, fallbackTimeZone, activities, nowMs }: GoogleEventContext,
): { event: ParsedIcsEvent } | { skip: GoogleSkip } {
  const parsed = v.safeParse(googleEventSchema, raw)
  if (!parsed.success) return { skip: 'other' }
  const item = parsed.output
  if (item.status === 'cancelled') return { skip: 'other' }
  // A window Solara added itself already shows under Scheduled.
  if (item.extendedProperties?.private?.[SOLARA_EVENT_TAG.key] === SOLARA_EVENT_TAG.value) {
    return { skip: 'other' }
  }
  if (!item.start?.dateTime || !item.end?.dateTime) {
    return item.start?.date ? { skip: 'allDay' } : { skip: 'other' }
  }
  if (item.attendees?.some(a => a.self && a.responseStatus === 'declined')) {
    return { skip: 'declined' }
  }
  const start = Date.parse(item.start.dateTime)
  const end = Date.parse(item.end.dateTime)
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start || end <= nowMs) {
    return { skip: 'other' }
  }
  if (end - start > MAX_EVENT_MS) return { skip: 'tooLong' }
  const uid = item.iCalUID || item.id
  if (!uid) return { skip: 'other' }

  const title = capText(
    stripInvisibleFormatting(item.summary ?? ''),
    IMPORTED_EVENT_LIMITS.titleLength,
  )
  const rawPlace = capText(
    stripInvisibleFormatting(item.location ?? ''),
    IMPORTED_EVENT_LIMITS.whereLength,
  )
  const location = rawPlace && !isMeetingLocation(rawPlace) ? rawPlace : ''
  // Kept when its location reads as a town Solara may search for, or when it is one of
  // the person's activities (whose place they can set by hand).
  if (!googleLocationQueries(location).length && !matchActivity(title, activities)) {
    return { skip: 'noPlace' }
  }

  const zone = [item.start.timeZone, calendarTimeZone].find(
    (z): z is string => !!z && isIanaTimeZone(z),
  )
  const original = item.recurringEventId ? item.originalStartTime?.dateTime : undefined
  const originalMs = original ? Date.parse(original) : NaN
  return {
    event: {
      uid,
      // The same form as an .ics occurrence's RECURRENCE-ID, so the same event imported
      // from a file has the same key (and is not shown twice).
      recurrenceId: Number.isNaN(originalMs) ? null : new Date(originalMs).toISOString(),
      title,
      start,
      end,
      timeZone: zone ?? fallbackTimeZone,
      location: location || null,
      geo: null,
      url: null,
    },
  }
}

// ---- The connection (which calendars) -------------------------------------------------

/**
 * Where the account's Google Calendar connection lives: Firestore, or memory in the
 * harness. The connection is also what lets the app store Google events: the rules refuse
 * them while it does not exist, so a disconnect on one device wins over a refresh still
 * running on another (REVIEW6 L4).
 */
export interface GoogleLinkStore {
  subscribe(
    uid: string,
    onChange: (link: GoogleCalendarLink | null) => void,
    onError: (error: Error) => void,
  ): () => void
  /** The connection as stored now (asked of the server, not a cache), or null. */
  read(uid: string): Promise<GoogleCalendarLink | null>
  /** Starts a connection, replacing any. Only a click on "Show my Google Calendar events" does. */
  save(uid: string, link: GoogleCalendarLink): Promise<void>
  /**
   * Changes a connection that still exists, and only the fields given; false when it is
   * gone (disconnected, perhaps on another device), which it never brings back.
   */
  update(
    uid: string,
    patch: Partial<Pick<GoogleCalendarLink, 'calendars' | 'syncedAt'>>,
  ): Promise<boolean>
  remove(uid: string): Promise<void>
}

/** Firestore's error for a write the rules refused, or for a document that is gone. */
function errorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' ? code : ''
}

async function linkDoc(uid: string) {
  const db = (await loadFirebase())?.db
  if (!db) throw new Error('Firestore is not configured')
  const firestore = await import('firebase/firestore')
  return { firestore, ref: firestore.doc(db, 'users', uid, 'meta', GOOGLE_CALENDAR_LINK_DOC) }
}

export const firestoreGoogleLinkStore: GoogleLinkStore = {
  subscribe(uid, onChange, onError) {
    return lazySubscription(
      async () => {
        const { firestore, ref } = await linkDoc(uid)
        return firestore.onSnapshot(
          ref,
          snapshot => onChange(parseGoogleCalendarLink(snapshot.data())),
          onError,
        )
      },
      error => onError(error instanceof Error ? error : new Error(String(error))),
    )
  },
  async read(uid) {
    const { firestore, ref } = await linkDoc(uid)
    return parseGoogleCalendarLink((await firestore.getDocFromServer(ref)).data())
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

/** PURE. "Your main calendar", "Your main calendar and Running club", "3 calendars". */
export function calendarsText(calendars: readonly GoogleCalendarChoice[]): string {
  const names = calendars.map(c => (c.name ? c.name : 'your main calendar'))
  const text = names.length <= 2 ? names.join(' and ') : `${names.length} calendars`
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/**
 * PURE. The person's calendars as choices, the main one first and named by the app (its
 * Google id is their email address, which is not stored: 'primary' stands for it).
 */
export function calendarChoices(list: readonly CalendarListEntry[]): GoogleCalendarChoice[] {
  const cap = (name: string) => capText(name, GOOGLE_EVENT_LIMITS.calendarNameLength)
  const primary = list.filter(c => c.primary).map(() => ({ id: 'primary', name: '' }))
  const others = list
    .filter(c => !c.primary && c.id.length <= GOOGLE_EVENT_LIMITS.calendarIdLength)
    .map(c => ({ id: c.id, name: cap(stripInvisibleFormatting(c.name)) || 'Calendar' }))
    .sort((a, b) => a.name.localeCompare(b.name))
  return [...(primary.length ? primary.slice(0, 1) : [{ id: 'primary', name: '' }]), ...others]
}

// ---- A refresh -------------------------------------------------------------------------

export interface SyncContext {
  uid: string
  link: GoogleCalendarLink
  api: GoogleCalendarApi
  /** A token for GOOGLE_EVENTS_SCOPE. */
  token: string
  home: Location
  activities: readonly Pick<Activity, 'id' | 'name'>[]
  /** Events the section has loaded (the soonest upcoming ones), to skip duplicates. */
  existing: readonly ImportedEvent[]
  nowMs: number
  store: Pick<EventsStore, 'save' | 'remove' | 'sourceEvents' | 'storedKeys'>
  lookups: () => Promise<PlaceLookups>
  onProgress?: (message: string) => void
  /**
   * Asked once Google has answered and before anything is written: false when the
   * connection is gone or its calendars changed meanwhile (on another device), and the
   * refresh then stops without writing (REVIEW6 L4).
   */
  connected?: () => Promise<boolean>
}

export interface SyncOutcome {
  /** Upcoming events from Google now stored (new, changed and unchanged). */
  shown: number
  /** Events that did not fit under the account's cap. */
  refused: number
  /** Stored events gone from Google (deleted, moved out of the window, or declined). */
  removed: number
  /** Events already in Solara from a file or a linked calendar. */
  duplicates: number
  /** Events past the per-refresh limit (the soonest are kept). */
  overLimit: number
  /** Chosen calendars Google no longer shares. */
  missing: GoogleCalendarChoice[]
  skipped: Record<GoogleSkip, number>
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
 * Reads the chosen calendars' events for the next GOOGLE_EVENT_LIMITS.windowDays days and
 * makes the stored `google` events match: new and changed ones saved within the account's
 * cap, ones gone from Google removed, the person's place and activity kept while the
 * location text is unchanged. Null when `connected` says the connection is gone or
 * changed, before anything is written. Throws Google's errors (an auth problem:
 * authProblem).
 */
export async function syncGoogleEvents(context: SyncContext): Promise<SyncOutcome | null> {
  const { uid, link, api, token, home, activities, existing, nowMs, store } = context
  const timeMin = new Date(nowMs)
  const timeMax = new Date(nowMs + GOOGLE_EVENT_LIMITS.windowDays * 86_400_000)
  const fallbackTimeZone = resolveTimeZone(home.timezone)
  const skipped: Record<GoogleSkip, number> = {
    allDay: 0,
    declined: 0,
    noPlace: 0,
    tooLong: 0,
    other: 0,
  }
  const missing: GoogleCalendarChoice[] = []
  const found = new Map<string, ParsedIcsEvent>()

  context.onProgress?.('Reading your Google Calendar…')
  for (const calendar of link.calendars) {
    let pageToken: string | undefined
    for (let page = 0; page < GOOGLE_EVENT_LIMITS.maxPagesPerCalendar; page++) {
      const answer = await api.listEvents(token, calendar.id, timeMin, timeMax, {
        pageToken,
        pageSize: GOOGLE_EVENT_LIMITS.pageSize,
      })
      if (!answer) {
        missing.push(calendar)
        break
      }
      for (const raw of answer.items) {
        const read = parseGoogleEvent(raw, {
          calendarTimeZone: answer.timeZone,
          fallbackTimeZone,
          activities,
          nowMs,
        })
        if ('skip' in read) {
          skipped[read.skip] += 1
          continue
        }
        // The same event on two chosen calendars (an invitation, a shared calendar) once.
        const key = await importedEventKey('google', read.event.uid, read.event.recurrenceId)
        if (!found.has(key)) found.set(key, read.event)
      }
      pageToken = answer.nextPageToken
      if (!pageToken) break
    }
  }

  if (context.connected && !(await context.connected())) return null

  // Events already in Solara from a file (same UID) or another source (same title and
  // times) are shown once, from there.
  const listed = await store.storedKeys(uid)
  const others = new Set(existing.filter(e => e.source !== 'google').map(signature))
  let duplicates = 0
  const fresh: [string, ParsedIcsEvent][] = []
  for (const [key, event] of found) {
    const fileKey = await importedEventKey('file', event.uid, event.recurrenceId)
    if (listed.has(fileKey) || others.has(signature(event))) duplicates += 1
    else fresh.push([key, event])
  }
  fresh.sort(([, a], [, b]) => a.start - b.start)
  const kept = fresh.slice(0, GOOGLE_EVENT_LIMITS.maxEventsPerSync)
  const overLimit = fresh.length - kept.length
  const keptKeys = new Set(kept.map(([key]) => key))

  // Stored Google events that have not ended and are no longer there go first, so they
  // make room under the cap. Past ones stay until they expire, like imported events.
  const stored = await store.sourceEvents(uid, 'google')
  const previous = new Map(stored.map(item => [item.key, item] as const))
  const gone = stored
    .filter(item => Date.parse(item.end) > nowMs && !keptKeys.has(item.key))
    .map(item => item.key)
  if (gone.length) await store.remove(uid, gone)

  const events = kept.map(([, event]) => event)
  const toPlace = events.filter((event, i) => {
    const before = previous.get(kept[i]![0])
    return !before || before.where !== (event.location ?? '')
  })
  if (toPlace.length) context.onProgress?.('Finding the places…')
  const places = toPlace.length
    ? await resolvePlaces(toPlace, home, await context.lookups(), {
        known: knownPlaces([...existing, ...stored]),
        onProgress: (done, total) =>
          total > 1 && context.onProgress?.(`Finding the places… ${done} of ${total}`),
        queriesFor: googleLocationQueries,
      })
    : new Map()
  const records = await recordsFromImport(events, {
    source: 'google',
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

const sameCalendars = (a: GoogleCalendarLink, b: GoogleCalendarLink) =>
  a.calendars.map(c => c.id).join('\n') === b.calendars.map(c => c.id).join('\n')

/**
 * A refresh of `link`, the connection as it was when it started: syncGoogleEvents, then
 * the new `syncedAt`. A disconnect or a new calendar choice on another device wins: the
 * refresh writes nothing once it sees either, never brings the connection back, and a
 * write the rules refuse because the connection is gone ends it quietly. Null when it
 * stopped for that reason (REVIEW6 L4).
 */
export async function refreshGoogleEvents(
  context: SyncContext & { linkStore: Pick<GoogleLinkStore, 'read' | 'update'> },
): Promise<SyncOutcome | null> {
  const { uid, link, linkStore } = context
  const unchanged = async () => {
    const now = await linkStore.read(uid)
    return !!now && sameCalendars(now, link)
  }
  try {
    const outcome = await syncGoogleEvents({ ...context, connected: unchanged })
    if (!outcome) return null
    return (await linkStore.update(uid, { syncedAt: new Date().toISOString() })) ? outcome : null
  } catch (error) {
    if (errorCode(error) === 'permission-denied' && !(await unchanged().catch(() => true))) {
      return null
    }
    throw error
  }
}

/**
 * Disconnects Google Calendar: the connection goes first, so no refresh on any device can
 * store events from then on (the rules refuse them), then every stored Google event, then
 * Solara's grant at Google. True when Google confirmed the grant ended.
 */
export async function disconnectGoogleCalendar({
  uid,
  linkStore,
  store,
  api,
}: {
  uid: string
  linkStore: Pick<GoogleLinkStore, 'remove'>
  store: Pick<EventsStore, 'sourceEvents' | 'remove'>
  api: Pick<GoogleCalendarApi, 'revoke'>
}): Promise<boolean> {
  await linkStore.remove(uid)
  await removeGoogleEvents(uid, store)
  return api.revoke().catch(() => false)
}

/**
 * Removes every stored Google event: after a disconnect, and whenever a device finds
 * Google events with no connection (a disconnect whose removal stopped halfway).
 */
export async function removeGoogleEvents(
  uid: string,
  store: Pick<EventsStore, 'sourceEvents' | 'remove'>,
): Promise<number> {
  const keys = (await store.sourceEvents(uid, 'google')).map(item => item.key)
  if (keys.length) await store.remove(uid, keys)
  return keys.length
}

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`

/** PURE. What a refresh did, in a sentence or two. */
export function syncSummary(outcome: SyncOutcome): string {
  const head = outcome.shown
    ? `Showing ${plural(outcome.shown, 'upcoming event')} from Google Calendar.`
    : `No events in the next ${GOOGLE_EVENT_LIMITS.windowDays} days have an address or match one of your activities.`
  const notes = [
    outcome.duplicates
      ? `${plural(outcome.duplicates, 'event')} already in Solara ${outcome.duplicates === 1 ? 'is' : 'are'} shown once.`
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
export function refreshDue(link: GoogleCalendarLink, nowMs: number): boolean {
  const at = Date.parse(link.syncedAt)
  return Number.isNaN(at) || nowMs - at >= GOOGLE_EVENT_LIMITS.autoRefreshMinutes * 60_000
}
