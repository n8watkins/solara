import { describe, expect, it, vi } from 'vitest'
import {
  GOOGLE_EVENT_LIMITS,
  importedEventKey,
  newGoogleCalendarLink,
  parseGoogleCalendarLink,
  type ImportedEvent,
} from '@solara/core/event-import'
import type { CalendarEventsPage } from './gcal'
import {
  authProblem,
  calendarChoices,
  calendarsText,
  googleLocationQueries,
  isMeetingLocation,
  parseGoogleEvent,
  disconnectGoogleCalendar,
  refreshDue,
  refreshGoogleEvents,
  removeGoogleEvents,
  syncGoogleEvents,
  syncSummary,
  syncedText,
  type GoogleCalendarApi,
  type GoogleCalendarLink,
  type SyncContext,
  type SyncOutcome,
} from './google-events'
import type { PlaceLookups } from './events'
import type { Location } from './types'

const NOW = Date.parse('2026-06-15T17:30:00Z')
const HOME: Location = {
  lat: 34.05,
  lon: -118.24,
  city: 'Los Angeles',
  region: 'California',
  timezone: 'America/Los_Angeles',
}
const ACTIVITIES = [{ id: 'run', name: 'Running' }]
const CONTEXT = { fallbackTimeZone: 'America/Los_Angeles', activities: ACTIVITIES, nowMs: NOW }

function timed(id: string, summary: string, start: string, end: string, extra = {}) {
  return {
    id,
    iCalUID: `${id}@google.com`,
    status: 'confirmed',
    summary,
    start: { dateTime: start, timeZone: 'America/Los_Angeles' },
    end: { dateTime: end },
    ...extra,
  }
}

describe('parseGoogleEvent', () => {
  it('reads a timed event with a place', () => {
    const read = parseGoogleEvent(
      timed('a', 'Picnic', '2026-06-16T12:00:00-07:00', '2026-06-16T14:00:00-07:00', {
        location: 'Balboa Park, San Diego, CA',
      }),
      CONTEXT,
    )
    expect(read).toEqual({
      event: {
        uid: 'a@google.com',
        recurrenceId: null,
        title: 'Picnic',
        start: Date.parse('2026-06-16T19:00:00Z'),
        end: Date.parse('2026-06-16T21:00:00Z'),
        timeZone: 'America/Los_Angeles',
        location: 'Balboa Park, San Diego, CA',
        geo: null,
        url: null,
      },
    })
  })

  it('keeps an event without a place that matches an activity, at the person’s place', () => {
    const read = parseGoogleEvent(
      timed('r', 'Morning run', '2026-06-17T07:00:00-07:00', '2026-06-17T08:00:00-07:00'),
      CONTEXT,
    )
    expect('event' in read && read.event.location).toBeNull()
  })

  it('skips meetings, all-day, declined, long, cancelled and past events', () => {
    const skip = (raw: unknown) => {
      const read = parseGoogleEvent(raw, CONTEXT)
      return 'skip' in read ? read.skip : 'kept'
    }
    const at = ['2026-06-16T12:00:00-07:00', '2026-06-16T13:00:00-07:00'] as const
    expect(skip(timed('m', '1:1 with Sam', ...at))).toBe('noPlace')
    // A video call link is not a place, and is never kept (it can hold a passcode).
    expect(skip(timed('z', 'Standup', ...at, { location: 'https://zoom.us/j/123?pwd=x' }))).toBe(
      'noPlace',
    )
    expect(skip(timed('g', 'Sync', ...at, { location: 'meet.google.com/abc-defg-hij' }))).toBe(
      'noPlace',
    )
    expect(
      skip({
        id: 'd',
        summary: 'Holiday',
        start: { date: '2026-06-18' },
        end: { date: '2026-06-19' },
      }),
    ).toBe('allDay')
    expect(
      skip(
        timed('x', 'Beach run', ...at, {
          attendees: [{ self: true, responseStatus: 'declined' }],
        }),
      ),
    ).toBe('declined')
    expect(skip(timed('l', 'Run camp', '2026-06-16T12:00:00Z', '2026-06-24T12:00:00Z'))).toBe(
      'tooLong',
    )
    expect(skip(timed('c', 'Run', ...at, { status: 'cancelled' }))).toBe('other')
    expect(
      skip(
        timed('s', 'Running: lower-UV window', ...at, {
          extendedProperties: { private: { solara: '1' } },
        }),
      ),
    ).toBe('other')
    expect(skip(timed('p', 'Run', '2026-06-15T08:00:00Z', '2026-06-15T09:00:00Z'))).toBe('other')
    expect(skip('not an event')).toBe('other')
  })

  it('names an occurrence of a recurring event like an .ics occurrence, so keys match', async () => {
    const read = parseGoogleEvent(
      timed('w_20260616', 'Track run', '2026-06-16T18:00:00-07:00', '2026-06-16T19:00:00-07:00', {
        iCalUID: 'series@example.com',
        recurringEventId: 'w',
        originalStartTime: { dateTime: '2026-06-16T18:00:00-07:00' },
      }),
      CONTEXT,
    )
    expect('event' in read && read.event.uid).toBe('series@example.com')
    expect('event' in read && read.event.recurrenceId).toBe('2026-06-17T01:00:00.000Z')
  })

  it('uses the calendar’s zone, else the person’s, when the event names no valid one', () => {
    const raw = {
      ...timed('t', 'Run', '2026-06-16T12:00:00Z', '2026-06-16T13:00:00Z'),
      start: { dateTime: '2026-06-16T12:00:00Z', timeZone: 'Not/AZone' },
    }
    const withCalendar = parseGoogleEvent(raw, { ...CONTEXT, calendarTimeZone: 'Europe/London' })
    expect('event' in withCalendar && withCalendar.event.timeZone).toBe('Europe/London')
    const fallback = parseGoogleEvent(raw, CONTEXT)
    expect('event' in fallback && fallback.event.timeZone).toBe('America/Los_Angeles')
  })

  it('removes invisible formatting and caps text', () => {
    const read = parseGoogleEvent(
      timed('b', `Run\u202e${'x'.repeat(300)}`, '2026-06-16T12:00:00Z', '2026-06-16T13:00:00Z', {
        location: 'Balboa\u200b Park, San Diego, CA',
      }),
      CONTEXT,
    )
    const title = 'event' in read ? read.event.title : ''
    expect(title).not.toContain('\u202e')
    expect(title.length).toBe(200)
    expect('event' in read && read.event.location).toBe('Balboa Park, San Diego, CA')
  })
})

describe('isMeetingLocation', () => {
  it('tells links and dial-ins from places', () => {
    expect(isMeetingLocation('https://teams.microsoft.com/l/meetup')).toBe(true)
    expect(isMeetingLocation('www.example.org')).toBe(true)
    expect(isMeetingLocation('zoom.us/j/123')).toBe(true)
    expect(isMeetingLocation('+1 415 555 0100 PIN 4411#')).toBe(true)
    expect(isMeetingLocation('(415) 555-0100')).toBe(true)
    expect(isMeetingLocation('415.555.0100')).toBe(true)
    expect(isMeetingLocation('Meeting ID 812 3456 7890')).toBe(true)
    expect(isMeetingLocation('Dial-in: see invite')).toBe(true)
    expect(isMeetingLocation('Passcode abc123')).toBe(true)
    expect(isMeetingLocation('Griffith Park, Los Angeles, CA')).toBe(false)
    expect(isMeetingLocation('St. Mary’s Field, 12 Oak St.')).toBe(false)
    expect(
      isMeetingLocation('Griffith Park, 4730 Crystal Springs Dr, Los Angeles, CA 90027, USA'),
    ).toBe(false)
    expect(isMeetingLocation('Pinewood Park, Pinecrest, FL')).toBe(false)
  })
})

describe('googleLocationQueries (REVIEW6 M2)', () => {
  it('searches only the town of text written as an address', () => {
    const cases: [string, string[]][] = [
      ['Balboa Park, San Diego, CA', ['San Diego, CA', 'San Diego']],
      [
        'Griffith Park, 4730 Crystal Springs Dr, Los Angeles, CA 90027, USA',
        ['Los Angeles, CA', 'Los Angeles'],
      ],
      ['Rose Bowl, 1001 Rose Bowl Dr, Pasadena, CA 91103', ['Pasadena, CA', 'Pasadena']],
      ['Opera House, Bennelong Point, Sydney NSW 2000, Australia', ['Sydney NSW']],
      ['Tiergarten, Berlin, Germany', ['Berlin']],
      ['Stanley Park, Vancouver, BC V6G 1Z4, Canada', ['Vancouver']],
      ['Portland, OR', ['Portland, OR', 'Portland']],
      ['Boston, MA 02116', ['Boston, MA', 'Boston']],
    ]
    for (const [where, queries] of cases)
      expect(googleLocationQueries(where), where).toEqual(queries)
  })

  it('never searches people, rooms, meetings, homes or bare phrases', () => {
    for (const where of [
      '',
      'Dr Patel',
      'Therapy Room 2',
      'Client HQ',
      'Boston',
      'Lake Merritt',
      'Starbucks',
      'Zoom',
      'Coach Lee',
      'Sarah’s house, upstairs',
      'Starbucks, 123 Main St',
      'Dr Patel, Boston, MA',
      'Dr. Lee, Suite 400, Austin, TX 78701',
      'Mrs Lee, London, UK',
      '+1 415 555 0100 PIN 4411#',
      'https://zoom.us/j/1, San Jose, CA',
      'Room 4, HQ, Springfield',
      'Conference Room B, Office, CA',
      'Mom’s home, Home, CA',
    ]) {
      expect(googleLocationQueries(where), where).toEqual([])
    }
  })

  it('keeps only the town when the text also names a room', () => {
    expect(googleLocationQueries('Room 4, 1 Main St, Springfield, IL 62701')).toEqual([
      'Springfield, IL',
      'Springfield',
    ])
  })
})

describe('the stored connection', () => {
  it('starts with the main calendar and parses only valid records', () => {
    const link = newGoogleCalendarLink('2026-06-15T17:30:00.000Z')
    expect(link).toEqual({
      calendars: [{ id: 'primary', name: '' }],
      connectedAt: '2026-06-15T17:30:00.000Z',
      syncedAt: '',
    })
    expect(parseGoogleCalendarLink(link)).toEqual(link)
    expect(parseGoogleCalendarLink({ ...link, calendars: [] })).toBeNull()
    const many = Array.from({ length: 11 }, (_, i) => ({ id: `c${i}`, name: '' }))
    expect(parseGoogleCalendarLink({ ...link, calendars: many })).toBeNull()
    expect(parseGoogleCalendarLink(undefined)).toBeNull()
  })

  it('offers the main calendar first, by name, without its email address', () => {
    expect(
      calendarChoices([
        { id: 'zed@group', name: 'Zed club', primary: false },
        { id: 'me@example.com', name: 'me@example.com', primary: true },
        { id: 'a@group', name: 'A\u200b team', primary: false },
      ]),
    ).toEqual([
      { id: 'primary', name: '' },
      { id: 'a@group', name: 'A team' },
      { id: 'zed@group', name: 'Zed club' },
    ])
  })

  it('names the chosen calendars', () => {
    expect(calendarsText([{ id: 'primary', name: '' }])).toBe('Your main calendar')
    expect(
      calendarsText([
        { id: 'primary', name: '' },
        { id: 'c', name: 'Running club' },
      ]),
    ).toBe('Your main calendar and Running club')
    expect(
      calendarsText([
        { id: 'primary', name: '' },
        { id: 'c', name: 'A' },
        { id: 'd', name: 'B' },
      ]),
    ).toBe('3 calendars')
  })

  it('says when it last updated and when a refresh is due', () => {
    expect(syncedText('', NOW)).toBe('Not updated yet')
    expect(syncedText(new Date(NOW - 20_000).toISOString(), NOW)).toBe('Updated just now')
    expect(syncedText(new Date(NOW - 2 * 3_600_000).toISOString(), NOW)).toBe('Updated 2 hours ago')
    const link = newGoogleCalendarLink(new Date(NOW).toISOString())
    expect(refreshDue(link, NOW)).toBe(true)
    expect(refreshDue({ ...link, syncedAt: new Date(NOW - 10 * 60_000).toISOString() }, NOW)).toBe(
      false,
    )
    expect(refreshDue({ ...link, syncedAt: new Date(NOW - 31 * 60_000).toISOString() }, NOW)).toBe(
      true,
    )
  })

  it('recognises a token problem, and a closed popup', () => {
    const error = (reason: string) =>
      Object.assign(new Error('x'), { name: 'CalendarAuthError', reason })
    expect(authProblem(error('no_token'))).toEqual({ dismissed: false })
    expect(authProblem(error('popup_closed'))).toEqual({ dismissed: true })
    expect(authProblem(new Error('network'))).toBeNull()
  })
})

// ---- A refresh -------------------------------------------------------------------------

function memoryStore(initial: ImportedEvent[] = [], cap = 1000) {
  const items = new Map(initial.map(e => [e.key, e]))
  const saved: ImportedEvent[][] = []
  const removed: string[][] = []
  return {
    items,
    saved,
    removed,
    store: {
      async save(_uid: string, records: readonly ImportedEvent[]) {
        saved.push([...records])
        const refused: ImportedEvent[] = []
        for (const r of records) {
          if (!items.has(r.key) && items.size >= cap) refused.push(r)
          else items.set(r.key, r)
        }
        return refused
      },
      async remove(_uid: string, keys: readonly string[]) {
        removed.push([...keys])
        for (const key of keys) items.delete(key)
      },
      async sourceEvents(_uid: string, source: string) {
        return [...items.values()].filter(e => e.source === source)
      },
      async storedKeys() {
        return new Set(items.keys())
      },
    } satisfies SyncContext['store'],
  }
}

function fakeApi(pages: Record<string, CalendarEventsPage[] | null>): GoogleCalendarApi {
  const served = new Map<string, number>()
  return {
    hasToken: () => true,
    requestToken: async () => 'tok',
    listCalendars: async () => [],
    async listEvents(_token, calendarId, _min, _max, { pageToken }) {
      const list = pages[calendarId]
      if (!list) return null
      const index = pageToken ? Number(pageToken) : 0
      served.set(calendarId, (served.get(calendarId) ?? 0) + 1)
      return list[index] ?? { items: [] }
    },
    revoke: async () => true,
  }
}

const lookups: () => Promise<PlaceLookups> = async () => ({
  search: async query =>
    /san diego/i.test(query)
      ? [
          {
            location: {
              lat: 32.72,
              lon: -117.16,
              city: 'San Diego',
              region: 'California',
              timezone: 'America/Los_Angeles',
            },
            label: 'San Diego, California',
          } as never,
        ]
      : [],
  reverse: async () => ({ city: 'Your location', region: '' }) as never,
})

function context(
  store: SyncContext['store'],
  api: GoogleCalendarApi,
  overrides: Partial<SyncContext> = {},
): SyncContext {
  return {
    uid: 'u1',
    link: {
      calendars: [
        { id: 'primary', name: '' },
        { id: 'club@group', name: 'Club' },
      ],
      connectedAt: '2026-06-01T00:00:00.000Z',
      syncedAt: '',
    },
    api,
    token: 'tok',
    home: HOME,
    activities: ACTIVITIES,
    existing: [],
    nowMs: NOW,
    store,
    lookups,
    ...overrides,
  }
}

const PICNIC = timed('picnic', 'Picnic', '2026-06-16T12:00:00-07:00', '2026-06-16T14:00:00-07:00', {
  location: 'Balboa Park, San Diego, CA',
})
const RUN = timed('run', 'Morning run', '2026-06-17T07:00:00-07:00', '2026-06-17T08:00:00-07:00')
const MEETING = timed('m', '1:1', '2026-06-16T09:00:00-07:00', '2026-06-16T09:30:00-07:00')

/** A refresh with no connection check, which always finishes. */
async function syncOrFail(sync: SyncContext): Promise<SyncOutcome> {
  const outcome = await syncGoogleEvents(sync)
  if (!outcome) throw new Error('the refresh stopped')
  return outcome
}

describe('syncGoogleEvents', () => {
  it('stores events with a place or an activity, once across calendars', async () => {
    const { store, items } = memoryStore()
    const api = fakeApi({
      primary: [
        { timeZone: 'America/Los_Angeles', items: [PICNIC, MEETING], nextPageToken: '1' },
        { items: [RUN] },
      ],
      // The same invitation on a second calendar is one event.
      'club@group': [{ items: [PICNIC] }],
    })
    const outcome = await syncOrFail(context(store, api))
    expect(outcome).toMatchObject({ shown: 2, refused: 0, removed: 0, duplicates: 0 })
    expect(outcome.skipped.noPlace).toBe(1)
    const stored = [...items.values()]
    expect(stored.map(e => e.title).sort()).toEqual(['Morning run', 'Picnic'])
    const picnic = stored.find(e => e.title === 'Picnic')!
    expect(picnic).toMatchObject({
      source: 'google',
      key: await importedEventKey('google', 'picnic@google.com', null),
      placeLabel: 'San Diego, California',
      placeGuessed: false,
      url: '',
    })
    expect(picnic.feedId).toBeUndefined()
    expect(stored.find(e => e.title === 'Morning run')).toMatchObject({
      activityId: 'run',
      placeGuessed: true,
      where: '',
    })
  })

  it('reports a calendar that is no longer shared, and keeps reading the others', async () => {
    const { store } = memoryStore()
    const outcome = await syncOrFail(
      context(store, fakeApi({ primary: [{ items: [PICNIC] }], 'club@group': null })),
    )
    expect(outcome.shown).toBe(1)
    expect(outcome.missing).toEqual([{ id: 'club@group', name: 'Club' }])
  })

  it('shows an event already imported from a file or another source only once', async () => {
    const fileKey = await importedEventKey('file', 'picnic@google.com', null)
    const imported = {
      key: fileKey,
      source: 'file',
      title: 'Picnic',
    } as ImportedEvent
    const linked = {
      key: 'f'.repeat(32),
      source: 'feed',
      title: 'morning run ',
      start: '2026-06-17T14:00:00.000Z',
      end: '2026-06-17T15:00:00.000Z',
    } as ImportedEvent
    const { store, items } = memoryStore([imported])
    const outcome = await syncOrFail(
      context(store, fakeApi({ primary: [{ items: [PICNIC, RUN] }], 'club@group': [] }), {
        existing: [linked],
      }),
    )
    expect(outcome).toMatchObject({ shown: 0, duplicates: 2 })
    expect([...items.values()].filter(e => e.source === 'google')).toEqual([])
  })

  it('removes events gone from Google, keeps the person’s choices, and skips unchanged ones', async () => {
    const { store, items, saved, removed } = memoryStore()
    const api = fakeApi({ primary: [{ items: [PICNIC, RUN] }], 'club@group': [] })
    await syncGoogleEvents(context(store, api))
    const run = [...items.values()].find(e => e.title === 'Morning run')!
    // The person sets the run's place by hand.
    items.set(run.key, {
      ...run,
      lat: 33.77,
      lon: -118.19,
      placeLabel: 'Long Beach',
      placeGuessed: false,
    })
    saved.length = 0

    // The picnic is deleted in Google; the run is unchanged.
    const outcome = await syncOrFail(
      context(store, fakeApi({ primary: [{ items: [RUN] }], 'club@group': [] })),
    )
    expect(outcome).toMatchObject({ shown: 1, removed: 1 })
    expect(removed.at(-1)).toHaveLength(1)
    expect(saved).toEqual([])
    expect(items.get(run.key)).toMatchObject({ placeLabel: 'Long Beach' })
  })

  it('keeps the soonest events within the per-refresh limit and reports what did not fit', async () => {
    const many = Array.from({ length: GOOGLE_EVENT_LIMITS.maxEventsPerSync + 3 }, (_, i) =>
      timed(
        `r${i}`,
        'Run',
        new Date(NOW + (i + 1) * 3_600_000).toISOString(),
        new Date(NOW + (i + 1.5) * 3_600_000).toISOString(),
      ),
    )
    const { store } = memoryStore([], 150)
    const outcome = await syncOrFail(
      context(store, fakeApi({ primary: [{ items: many }], 'club@group': [] })),
    )
    expect(outcome.overLimit).toBe(3)
    expect(outcome.refused).toBe(GOOGLE_EVENT_LIMITS.maxEventsPerSync - 150)
    expect(outcome.shown).toBe(150)
  })

  it('sends a location to the place search only when it reads as a town (REVIEW6 M2)', async () => {
    const queries: string[] = []
    const recording: () => Promise<PlaceLookups> = async () => {
      const real = await lookups()
      return { ...real, search: query => (queries.push(query), real.search(query)) }
    }
    const at = ['2026-06-16T12:00:00-07:00', '2026-06-16T13:00:00-07:00'] as const
    const items = [
      timed('dr', 'Checkup', ...at, { location: 'Dr Patel' }),
      timed('room', 'Session', ...at, { location: 'Therapy Room 2' }),
      timed('hq', 'Review', ...at, { location: 'Client HQ' }),
      timed('dial', 'Call', ...at, { location: '+1 415 555 0100 PIN 4411#' }),
      timed('drtown', 'Visit', ...at, { location: 'Dr Patel, Boston, MA' }),
      // A run with a location that is not a town: kept for the activity, never searched.
      timed('track', 'Track run', ...at, { location: 'Coach Lee' }),
      PICNIC,
    ]
    const { store, items: stored } = memoryStore()
    const outcome = await syncOrFail(
      context(store, fakeApi({ primary: [{ items }], 'club@group': [] }), {
        lookups: recording,
      }),
    )
    expect(queries).toEqual(['San Diego, CA'])
    expect(outcome.shown).toBe(2)
    expect(outcome.skipped.noPlace).toBe(5)
    const run = [...stored.values()].find(e => e.title === 'Track run')!
    expect(run).toMatchObject({ where: 'Coach Lee', placeGuessed: true, activityId: 'run' })
    expect(JSON.stringify([...stored.values()])).not.toMatch(/Patel|Therapy|Client|4411/)
  })

  it('stops at the page limit for each calendar', async () => {
    const { store } = memoryStore()
    const listEvents = vi.fn(async () => ({ items: [], nextPageToken: 'more' }))
    await syncGoogleEvents(
      context(
        store,
        { ...fakeApi({}), listEvents },
        {
          link: { ...context(store, fakeApi({})).link, calendars: [{ id: 'primary', name: '' }] },
        },
      ),
    )
    expect(listEvents).toHaveBeenCalledTimes(GOOGLE_EVENT_LIMITS.maxPagesPerCalendar)
  })
})

describe('a disconnect on another device wins (REVIEW6 L4)', () => {
  /** The stored connection, and an events store that refuses Google events without it, as the rules do. */
  function connectedAccount() {
    const memory = memoryStore()
    let link: GoogleCalendarLink | null = context(memory.store, fakeApi({})).link
    const order: string[] = []
    const linkStore = {
      async read() {
        return link
      },
      async update(_uid: string, patch: Partial<GoogleCalendarLink>) {
        if (!link) return false
        link = { ...link, ...patch }
        return true
      },
      async remove() {
        order.push('link')
        link = null
      },
    }
    const store = {
      ...memory.store,
      async save(uid: string, records: readonly ImportedEvent[]) {
        if (!link && records.some(r => r.source === 'google')) {
          throw Object.assign(new Error('Missing or insufficient permissions.'), {
            code: 'permission-denied',
          })
        }
        return memory.store.save(uid, records)
      },
      async remove(uid: string, keys: readonly string[]) {
        order.push('events')
        return memory.store.remove(uid, keys)
      },
    }
    return {
      ...memory,
      store,
      linkStore,
      order,
      link: () => link,
      setLink: (next: GoogleCalendarLink | null) => (link = next),
    }
  }

  /** Google answers only once `release` is called. */
  function heldApi(pages: Record<string, CalendarEventsPage[] | null>) {
    const api = fakeApi(pages)
    let release!: () => void
    const gate = new Promise<void>(resolve => (release = resolve))
    const listEvents: GoogleCalendarApi['listEvents'] = async (...args) => {
      await gate
      return api.listEvents(...args)
    }
    return { api: { ...api, listEvents }, release }
  }

  it('a refresh that was running when the phone disconnected writes nothing back', async () => {
    const account = connectedAccount()
    await refreshGoogleEvents({
      ...context(account.store, fakeApi({ primary: [{ items: [RUN] }], 'club@group': [] })),
      linkStore: account.linkStore,
    })
    expect(account.items.size).toBe(1)
    const started = account.link()!

    // The laptop's refresh is waiting on Google when the phone disconnects.
    const { api, release } = heldApi({ primary: [{ items: [PICNIC, RUN] }], 'club@group': [] })
    const laptop = refreshGoogleEvents({
      ...context(account.store, api, { link: started }),
      linkStore: account.linkStore,
    })
    const revoked = await disconnectGoogleCalendar({
      uid: 'u1',
      linkStore: account.linkStore,
      store: account.store,
      api,
    })
    expect(revoked).toBe(true)
    // The connection goes first, so nothing can be stored after the events are removed.
    expect(account.order).toEqual(['link', 'events'])
    release()

    expect(await laptop).toBeNull()
    expect(account.link()).toBeNull()
    expect([...account.items.values()].filter(e => e.source === 'google')).toEqual([])
  })

  it('stops when the rules refuse a write because the connection just went', async () => {
    const account = connectedAccount()
    const store = {
      ...account.store,
      async sourceEvents(uid: string, source: string) {
        // The phone disconnects after the laptop checked the connection.
        account.setLink(null)
        return account.store.sourceEvents(uid, source)
      },
    }
    const outcome = await refreshGoogleEvents({
      ...context(store, fakeApi({ primary: [{ items: [PICNIC] }], 'club@group': [] })),
      linkStore: account.linkStore,
    })
    expect(outcome).toBeNull()
    expect(account.items.size).toBe(0)
    expect(account.link()).toBeNull()
  })

  it('leaves a calendar choice made on another device during the refresh alone', async () => {
    const account = connectedAccount()
    const started = account.link()!
    const { api, release } = heldApi({ primary: [{ items: [PICNIC] }], 'club@group': [] })
    const laptop = refreshGoogleEvents({
      ...context(account.store, api, { link: started }),
      linkStore: account.linkStore,
    })
    // The phone picks only the main calendar.
    await account.linkStore.update('u1', { calendars: [{ id: 'primary', name: '' }] })
    release()
    expect(await laptop).toBeNull()
    expect(account.items.size).toBe(0)
    expect(account.link()).toMatchObject({ calendars: [{ id: 'primary', name: '' }], syncedAt: '' })
  })

  it('records the refresh time without rewriting the connection', async () => {
    const account = connectedAccount()
    const outcome = await refreshGoogleEvents({
      ...context(account.store, fakeApi({ primary: [{ items: [PICNIC] }], 'club@group': [] })),
      linkStore: account.linkStore,
    })
    expect(outcome?.shown).toBe(1)
    expect(account.link()?.syncedAt).not.toBe('')
    expect(account.link()?.calendars).toHaveLength(2)
  })

  it('removes Google events left without a connection, and nothing else', async () => {
    const google = { key: 'g'.repeat(32), source: 'google', title: 'Picnic' } as ImportedEvent
    const file = { key: 'f'.repeat(32), source: 'file', title: 'Race' } as ImportedEvent
    const { store, items } = memoryStore([google, file])
    expect(await removeGoogleEvents('u1', store)).toBe(1)
    expect([...items.keys()]).toEqual([file.key])
    expect(await removeGoogleEvents('u1', store)).toBe(0)
  })
})

describe('syncSummary', () => {
  const base: SyncOutcome = {
    shown: 0,
    refused: 0,
    removed: 0,
    duplicates: 0,
    overLimit: 0,
    missing: [],
    skipped: { allDay: 0, declined: 0, noPlace: 0, tooLong: 0, other: 0 },
  }
  it('says what a refresh did', () => {
    expect(syncSummary({ ...base, shown: 1 })).toBe(
      'Showing 1 upcoming event from Google Calendar.',
    )
    expect(syncSummary(base)).toBe(
      'No events in the next 30 days have an address or match one of your activities.',
    )
    expect(
      syncSummary({
        ...base,
        shown: 12,
        duplicates: 2,
        refused: 1,
        missing: [{ id: 'c', name: 'Club' }],
      }),
    ).toBe(
      'Showing 12 upcoming events from Google Calendar. 2 events already in Solara are shown once. 1 event did not fit. You have 1,000 imported events, the most an account can keep. Remove some to import more. Club is no longer shared with you.',
    )
  })
})
