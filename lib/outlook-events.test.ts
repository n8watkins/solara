import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  OUTLOOK_EVENT_LIMITS,
  importedEventKey,
  newOutlookCalendarLink,
  parseOutlookCalendarLink,
  windowsZoneToIana,
  type ImportedEvent,
} from '@solara/core/event-import'
import type { EventsStore, PlaceLookups } from './events'
import {
  OUTLOOK_EVENT_FIELDS,
  OutlookBusyError,
  calendarViewUrl,
  disconnectOutlook,
  graphInstant,
  outlookAuthProblem,
  outlookCalendarApi,
  outlookCalendarChoices,
  outlookRefreshDue,
  outlookSyncSummary,
  outlookZone,
  ownCalendars,
  parseOutlookEvent,
  refreshOutlookEvents,
  removeOutlookEvents,
  setRetryPause,
  syncOutlookEvents,
  type OutlookCalendarApi,
  type OutlookCalendarLink,
  type OutlookEventsPage,
  type OutlookSyncContext,
} from './outlook-events'
import { MicrosoftAuthError } from './microsoft-auth'
import type { Location } from './types'

// Graph answers below follow Microsoft's documented shapes: List calendarView
// (https://learn.microsoft.com/en-us/graph/api/user-list-calendarview) returns `value` with
// `start` and `end` as dateTimeTimeZone in UTC without a Prefer header, `@odata.nextLink`
// for the next page, and the event resource's `location` with displayName, locationType
// and coordinates (https://learn.microsoft.com/en-us/graph/api/resources/event).

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

/** A calendarView item, as Graph sends it with Solara's $select. */
function graphEvent(
  id: string,
  subject: string,
  startUtc: string,
  endUtc: string,
  extra: Record<string, unknown> = {},
) {
  return {
    '@odata.etag': 'W/"DwAAABYAAAA"',
    id: `AAMkAG${id}`,
    subject,
    start: { dateTime: `${startUtc}.0000000`, timeZone: 'UTC' },
    end: { dateTime: `${endUtc}.0000000`, timeZone: 'UTC' },
    isAllDay: false,
    isCancelled: false,
    isOnlineMeeting: false,
    responseStatus: { response: 'organizer', time: '0001-01-01T00:00:00Z' },
    iCalUId: `040000008200E00074C5B7101A82E008${id}`,
    type: 'singleInstance',
    originalStartTimeZone: 'Pacific Standard Time',
    location: {
      displayName: '',
      locationType: 'default',
      uniqueIdType: 'unknown',
      address: {},
      coordinates: {},
    },
    ...extra,
  }
}

const place = (displayName: string, extra: Record<string, unknown> = {}) => ({
  location: { displayName, locationType: 'default', address: {}, coordinates: {}, ...extra },
})

describe('graphInstant and outlookZone', () => {
  it('reads Graph’s UTC wall-clock times, with or without fractions', () => {
    expect(graphInstant({ dateTime: '2026-06-16T19:00:00.0000000', timeZone: 'UTC' })).toBe(
      Date.parse('2026-06-16T19:00:00Z'),
    )
    expect(graphInstant({ dateTime: '2026-06-16T19:00:00' })).toBe(
      Date.parse('2026-06-16T19:00:00Z'),
    )
    expect(graphInstant({ dateTime: '2026-06-16T19:00:00Z', timeZone: 'UTC' })).toBe(
      Date.parse('2026-06-16T19:00:00Z'),
    )
  })

  it('reads a time in another zone as that zone’s wall clock, Windows names included', () => {
    expect(
      graphInstant({ dateTime: '2026-06-16T12:00:00.0000000', timeZone: 'Pacific Standard Time' }),
    ).toBe(Date.parse('2026-06-16T19:00:00Z'))
    expect(graphInstant({ dateTime: '2026-01-16T12:00:00', timeZone: 'Europe/Berlin' })).toBe(
      Date.parse('2026-01-16T11:00:00Z'),
    )
    expect(graphInstant({ dateTime: '2026-06-16T12:00:00', timeZone: 'Mars Standard Time' })).toBe(
      NaN,
    )
    expect(graphInstant({ dateTime: 'soon' })).toBe(NaN)
    expect(graphInstant(null)).toBe(NaN)
  })

  it('maps Windows zone names to IANA, keeps IANA names, and refuses custom zones', () => {
    expect(windowsZoneToIana('Pacific Standard Time')).toBe('America/Los_Angeles')
    expect(outlookZone('Pacific Standard Time')).toBe('America/Los_Angeles')
    expect(outlookZone('W. Europe Standard Time')).toBe('Europe/Berlin')
    expect(outlookZone('AUS Eastern Standard Time')).toBe('Australia/Sydney')
    expect(outlookZone('America/Denver')).toBe('America/Denver')
    expect(outlookZone('UTC')).toBe('UTC')
    expect(outlookZone('tzone://Microsoft/Custom')).toBeNull()
    expect(outlookZone('')).toBeNull()
    expect(outlookZone(undefined)).toBeNull()
  })
})

describe('parseOutlookEvent', () => {
  it('reads a timed event with an address, in the event’s own zone', () => {
    const read = parseOutlookEvent(
      graphEvent('a', 'Picnic', '2026-06-16T19:00:00', '2026-06-16T21:00:00', {
        ...place('Balboa Park, San Diego, CA'),
      }),
      CONTEXT,
    )
    expect(read).toEqual({
      event: {
        uid: '040000008200E00074C5B7101A82E008a',
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

  it('uses the person’s zone for a custom or unknown zone', () => {
    const read = parseOutlookEvent(
      graphEvent('a', 'Morning run', '2026-06-17T14:00:00', '2026-06-17T15:00:00', {
        originalStartTimeZone: 'tzone://Microsoft/Custom',
      }),
      { ...CONTEXT, fallbackTimeZone: 'America/Denver' },
    )
    expect(read).toMatchObject({ event: { timeZone: 'America/Denver' } })
  })

  it('keeps a place picked in Outlook by its coordinates', () => {
    const read = parseOutlookEvent(
      graphEvent('a', 'Lunch', '2026-06-16T19:00:00', '2026-06-16T20:00:00', {
        ...place('Griffith Observatory', {
          locationType: 'localBusiness',
          coordinates: { latitude: 34.1184, longitude: -118.3004 },
        }),
      }),
      CONTEXT,
    )
    expect(read).toMatchObject({
      event: { location: 'Griffith Observatory', geo: { lat: 34.1184, lon: -118.3004 } },
    })
  })

  it('never keeps an office room, a home or a workplace, even with coordinates', () => {
    for (const locationType of ['conferenceRoom', 'homeAddress', 'businessAddress']) {
      const read = parseOutlookEvent(
        graphEvent('a', 'Sync', '2026-06-16T19:00:00', '2026-06-16T20:00:00', {
          ...place('Building 4, Room 2, Redmond, WA', {
            locationType,
            coordinates: { latitude: 47.64, longitude: -122.13 },
          }),
        }),
        CONTEXT,
      )
      expect(read, locationType).toEqual({ skip: 'noPlace' })
    }
  })

  it('drops dial-in details, links and meeting names, and keeps the event only for its activity', () => {
    for (const displayName of [
      'Microsoft Teams Meeting',
      'Skype Meeting',
      'https://teams.microsoft.com/l/meetup-join/19%3ameeting',
      '+1 425-555-0100,,123456789# PIN 4411',
    ]) {
      const read = parseOutlookEvent(
        graphEvent('a', 'Running club sync', '2026-06-16T19:00:00', '2026-06-16T20:00:00', {
          isOnlineMeeting: true,
          ...place(displayName, { coordinates: { latitude: 47.6, longitude: -122.3 } }),
        }),
        CONTEXT,
      )
      expect(read, displayName).toMatchObject({ event: { location: null, geo: null } })
    }
    expect(
      parseOutlookEvent(
        graphEvent('a', 'Standup', '2026-06-16T19:00:00', '2026-06-16T20:00:00', {
          isOnlineMeeting: true,
          ...place('Microsoft Teams Meeting'),
        }),
        CONTEXT,
      ),
    ).toEqual({ skip: 'noPlace' })
  })

  it('never searches a location that is not written as an address (REVIEW6 M2)', () => {
    for (const displayName of ['Dr Patel', 'Therapy Room 2', 'Client HQ', 'Home']) {
      expect(
        parseOutlookEvent(
          graphEvent('a', 'Appointment', '2026-06-16T19:00:00', '2026-06-16T20:00:00', {
            ...place(displayName),
          }),
          CONTEXT,
        ),
        displayName,
      ).toEqual({ skip: 'noPlace' })
    }
  })

  it('skips all-day, cancelled, declined, past and week-long events', () => {
    const at = ['2026-06-16T19:00:00', '2026-06-16T20:00:00'] as const
    const withPlace = place('Balboa Park, San Diego, CA')
    expect(
      parseOutlookEvent(
        graphEvent('a', 'Offsite', '2026-06-18T00:00:00', '2026-06-19T00:00:00', {
          isAllDay: true,
          ...withPlace,
        }),
        CONTEXT,
      ),
    ).toEqual({ skip: 'allDay' })
    expect(
      parseOutlookEvent(
        graphEvent('a', 'Game', ...at, { isCancelled: true, ...withPlace }),
        CONTEXT,
      ),
    ).toEqual({ skip: 'other' })
    expect(
      parseOutlookEvent(
        graphEvent('a', 'Game', ...at, { responseStatus: { response: 'declined' }, ...withPlace }),
        CONTEXT,
      ),
    ).toEqual({ skip: 'declined' })
    expect(
      parseOutlookEvent(
        graphEvent('a', 'Earlier', '2026-06-15T15:00:00', '2026-06-15T16:00:00', withPlace),
        CONTEXT,
      ),
    ).toEqual({ skip: 'other' })
    expect(
      parseOutlookEvent(
        graphEvent('a', 'Trip', '2026-06-16T00:00:00', '2026-06-24T00:00:00', withPlace),
        CONTEXT,
      ),
    ).toEqual({ skip: 'tooLong' })
    expect(parseOutlookEvent(graphEvent('a', 'Bad', ...at, { start: 'soon' }), CONTEXT)).toEqual({
      skip: 'other',
    })
    expect(parseOutlookEvent('not an event', CONTEXT)).toEqual({ skip: 'other' })
  })

  it('keys an occurrence of a recurring event by its original start', () => {
    const read = parseOutlookEvent(
      graphEvent('a', 'Morning run', '2026-06-17T14:00:00', '2026-06-17T15:00:00', {
        type: 'occurrence',
        originalStart: '2026-06-17T14:00:00Z',
      }),
      CONTEXT,
    )
    expect(read).toMatchObject({ event: { recurrenceId: '2026-06-17T14:00:00.000Z' } })
    // A single event has no occurrence, whatever Graph says.
    expect(
      parseOutlookEvent(
        graphEvent('a', 'Morning run', '2026-06-17T14:00:00', '2026-06-17T15:00:00', {
          originalStart: '2026-06-17T14:00:00Z',
        }),
        CONTEXT,
      ),
    ).toMatchObject({ event: { recurrenceId: null } })
  })

  it('tolerates fields Calendars.ReadBasic might withhold (open question in OUTLOOK.md)', () => {
    // Without a subject: kept only for a place; without a location: only for an activity.
    const { subject: _subject, ...noSubject } = graphEvent(
      'a',
      '',
      '2026-06-16T19:00:00',
      '2026-06-16T20:00:00',
      place('Balboa Park, San Diego, CA'),
    )
    expect(parseOutlookEvent(noSubject, CONTEXT)).toMatchObject({
      event: { title: '', location: 'Balboa Park, San Diego, CA' },
    })
    const { location: _location, ...noLocation } = graphEvent(
      'b',
      'Running',
      '2026-06-16T19:00:00',
      '2026-06-16T20:00:00',
    )
    expect(parseOutlookEvent(noLocation, CONTEXT)).toMatchObject({
      event: { title: 'Running', location: null },
    })
    expect(
      parseOutlookEvent(
        { ...noLocation, subject: null, location: null, iCalUId: null, responseStatus: null },
        CONTEXT,
      ),
    ).toEqual({ skip: 'noPlace' })
  })

  it('strips invisible formatting and caps the title', () => {
    const read = parseOutlookEvent(
      graphEvent('a', `Run‮ ${'x'.repeat(300)}`, '2026-06-16T19:00:00', '2026-06-16T20:00:00'),
      { ...CONTEXT, activities: [{ id: 'run', name: 'Run' }] },
    )
    expect('event' in read && read.event.title.length).toBe(200)
    expect('event' in read && read.event.title).not.toContain('‮')
  })
})

describe('the calendar list', () => {
  const DEFAULT = {
    id: 'AAMkAGI2TGuLAAA=',
    name: 'Calendar',
    isDefaultCalendar: true,
    owner: { name: 'Gia Park', address: 'gia@outlook.com' },
  }

  it('keeps the person’s own calendars and leaves out ones other people share', () => {
    const list = ownCalendars([
      DEFAULT,
      { id: 'club', name: 'Running club', isDefaultCalendar: false, owner: DEFAULT.owner },
      { id: 'boss', name: 'Ana’s calendar', owner: { address: 'ana@contoso.com' } },
      { id: 'flagged', name: 'Shared', isSharedWithMe: true },
      { name: 'no id' },
    ])
    expect(list).toEqual([
      { id: DEFAULT.id, name: 'Calendar', isDefault: true },
      { id: 'club', name: 'Running club', isDefault: false },
    ])
  })

  it('lists the default calendar first, as “default”, so its Graph id is never stored', () => {
    expect(
      outlookCalendarChoices([
        { id: 'z', name: 'Zumba', isDefault: false },
        { id: DEFAULT.id, name: 'Calendar', isDefault: true },
        { id: 'a', name: '', isDefault: false },
        {
          id: 'x'.repeat(OUTLOOK_EVENT_LIMITS.calendarIdLength + 1),
          name: 'Long',
          isDefault: false,
        },
      ]),
    ).toEqual([
      { id: 'default', name: '' },
      { id: 'a', name: 'Calendar' },
      { id: 'z', name: 'Zumba' },
    ])
  })

  it('stores a new connection to the default calendar only', () => {
    const link = newOutlookCalendarLink('2026-06-15T17:30:00.000Z')
    expect(link.calendars).toEqual([{ id: 'default', name: '' }])
    expect(parseOutlookCalendarLink(link)).toEqual(link)
    // Anything else is dropped (and the rules refuse it).
    expect(parseOutlookCalendarLink({ ...link, token: 'x' })).toEqual(link)
    expect(parseOutlookCalendarLink({ ...link, calendars: [] })).toBeNull()
  })
})

// ---- Microsoft Graph, with fetch faked ------------------------------------------------

describe('outlookCalendarApi', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    setRetryPause(ms => new Promise(resolve => setTimeout(resolve, ms)))
  })

  function stubFetch(...answers: Response[]) {
    const calls: { url: string; auth: string | null }[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, auth: new Headers(init.headers).get('Authorization') })
        const next = answers.shift()
        if (!next) throw new Error(`unexpected fetch ${url}`)
        return next
      }),
    )
    return calls
  }

  it('reads the default calendar’s view with only the fields Solara needs', async () => {
    const start = new Date(NOW)
    const end = new Date(NOW + 30 * 86_400_000)
    const url = new URL(calendarViewUrl('default', start, end))
    expect(url.origin + url.pathname).toBe(
      'https://graph.microsoft.com/v1.0/me/calendar/calendarView',
    )
    expect(Object.fromEntries(url.searchParams)).toEqual({
      startDateTime: '2026-06-15T17:30:00.000Z',
      endDateTime: '2026-07-15T17:30:00.000Z',
      $select: OUTLOOK_EVENT_FIELDS,
      $top: '100',
    })
    expect(OUTLOOK_EVENT_FIELDS).not.toMatch(/body|attendees|organizer|onlineMeeting\b|Url/)
    expect(new URL(calendarViewUrl('AAMk/GI=', start, end)).pathname).toBe(
      '/v1.0/me/calendars/AAMk%2FGI%3D/calendarView',
    )
  })

  it('follows a Graph next link, and never sends the token anywhere else', async () => {
    const next = 'https://graph.microsoft.com/v1.0/me/calendar/calendarView?$skiptoken=abc'
    const calls = stubFetch(
      Response.json({ value: [{ id: '1' }], '@odata.nextLink': next }),
      Response.json({ value: [], '@odata.nextLink': 'https://evil.example/steal' }),
    )
    const first = await outlookCalendarApi.listEvents(
      'tok',
      'default',
      new Date(NOW),
      new Date(NOW),
    )
    expect(first).toEqual({ items: [{ id: '1' }], nextLink: next })
    const second = await outlookCalendarApi.listEvents(
      'tok',
      'default',
      new Date(),
      new Date(),
      next,
    )
    expect(second).toEqual({ items: [], nextLink: undefined })
    expect(calls.map(c => c.auth)).toEqual(['Bearer tok', 'Bearer tok'])
    await expect(
      outlookCalendarApi.listEvents(
        'tok',
        'default',
        new Date(),
        new Date(),
        'https://evil.example/',
      ),
    ).rejects.toThrow(/Not a Microsoft Graph address/)
  })

  it('reports a calendar it may no longer read, and a refused token', async () => {
    stubFetch(
      Response.json({ error: { code: 'ErrorAccessDenied' } }, { status: 403 }),
      Response.json({ error: { code: 'ErrorItemNotFound' } }, { status: 404 }),
      Response.json({ error: { code: 'InvalidAuthenticationToken' } }, { status: 401 }),
    )
    expect(await outlookCalendarApi.listEvents('t', 'x', new Date(), new Date())).toBeNull()
    expect(await outlookCalendarApi.listEvents('t', 'x', new Date(), new Date())).toBeNull()
    const error = await outlookCalendarApi
      .listEvents('t', 'x', new Date(), new Date())
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(MicrosoftAuthError)
    expect(outlookAuthProblem(error)).toEqual({ reason: 'no_token' })
  })

  it('waits once for Retry-After when Graph is busy, then says so', async () => {
    const waits: number[] = []
    setRetryPause(async ms => void waits.push(ms))
    stubFetch(
      new Response('', { status: 429, headers: { 'Retry-After': '2' } }),
      Response.json({ value: [] }),
      new Response('', { status: 429, headers: { 'Retry-After': '120' } }),
      new Response('', { status: 429 }),
    )
    expect(await outlookCalendarApi.listEvents('t', 'default', new Date(), new Date())).toEqual({
      items: [],
      nextLink: undefined,
    })
    await expect(
      outlookCalendarApi.listEvents('t', 'default', new Date(), new Date()),
    ).rejects.toBeInstanceOf(OutlookBusyError)
    expect(waits).toEqual([2_000, 30_000])
  })

  it('lists calendars with the owner only to compare it, across pages', async () => {
    const calls = stubFetch(
      Response.json({
        value: [{ id: 'd', name: 'Calendar', isDefaultCalendar: true, owner: { address: 'a@b' } }],
        '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/calendars?$skip=1',
      }),
      Response.json({ value: [{ id: 'c', name: 'Club', owner: { address: 'A@B' } }] }),
    )
    expect(await outlookCalendarApi.listCalendars('t')).toEqual([
      { id: 'd', name: 'Calendar', isDefault: true },
      { id: 'c', name: 'Club', isDefault: false },
    ])
    expect(new URL(calls[0]!.url).searchParams.get('$select')).toBe(
      'id,name,isDefaultCalendar,owner',
    )
  })

  it('names the reasons a sign-in did not finish', () => {
    expect(outlookAuthProblem(new MicrosoftAuthError('admin_approval'))).toEqual({
      reason: 'admin_approval',
    })
    expect(outlookAuthProblem(new Error('network'))).toBeNull()
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
      async upcoming(_uid: string, nowMs: number) {
        return [...items.values()].filter(e => Date.parse(e.end) > nowMs)
      },
      async storedKeys() {
        return new Set(items.keys())
      },
    } satisfies OutlookSyncContext['store'] & Pick<EventsStore, 'sourceEvents'>,
  }
}

/** Graph, faked: pages per calendar, each page's next link naming the next page. */
function fakeApi(pages: Record<string, OutlookEventsPage[] | null>): OutlookCalendarApi {
  return {
    hasToken: () => true,
    requestToken: async () => 'tok',
    listCalendars: async () => [],
    async listEvents(_token, calendarId, _start, _end, nextLink) {
      const list = pages[calendarId]
      if (!list) return null
      const index = nextLink ? Number(nextLink) : 0
      return list[index] ?? { items: [] }
    },
    forget: () => {},
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

const LINK: OutlookCalendarLink = {
  calendars: [
    { id: 'default', name: '' },
    { id: 'club', name: 'Club' },
  ],
  connectedAt: '2026-06-01T00:00:00.000Z',
  syncedAt: '',
}

function context(
  store: OutlookSyncContext['store'],
  api: OutlookCalendarApi,
  overrides: Partial<OutlookSyncContext> = {},
): OutlookSyncContext {
  return {
    uid: 'u1',
    link: LINK,
    api,
    token: 'tok',
    home: HOME,
    activities: ACTIVITIES,
    nowMs: NOW,
    store,
    lookups,
    ...overrides,
  }
}

const PICNIC = graphEvent('picnic', 'Picnic', '2026-06-16T19:00:00', '2026-06-16T21:00:00', {
  ...place('Balboa Park, San Diego, CA'),
})
const RUN = graphEvent('run', 'Morning run', '2026-06-17T14:00:00', '2026-06-17T15:00:00')
const STANDUP = graphEvent('m', 'Standup', '2026-06-16T16:00:00', '2026-06-16T16:15:00', {
  isOnlineMeeting: true,
  ...place('Microsoft Teams Meeting'),
})

async function syncOrFail(sync: OutlookSyncContext) {
  const outcome = await syncOutlookEvents(sync)
  if (!outcome) throw new Error('the refresh stopped')
  return outcome
}

describe('syncOutlookEvents', () => {
  it('stores events with a place or an activity, once across calendars and pages', async () => {
    const { store, items } = memoryStore()
    const outcome = await syncOrFail(
      context(
        store,
        fakeApi({
          default: [{ items: [PICNIC, STANDUP], nextLink: '1' }, { items: [RUN] }],
          // The same invitation on a second calendar is one event.
          club: [{ items: [PICNIC] }],
        }),
      ),
    )
    expect(outcome).toMatchObject({ shown: 2, refused: 0, removed: 0, duplicates: 0 })
    expect(outcome.skipped.noPlace).toBe(1)
    const stored = [...items.values()]
    expect(stored.find(e => e.title === 'Picnic')).toMatchObject({
      source: 'outlook',
      key: await importedEventKey('outlook', PICNIC.iCalUId, null),
      start: '2026-06-16T19:00:00.000Z',
      timeZone: 'America/Los_Angeles',
      placeLabel: 'San Diego, California',
      placeGuessed: false,
      url: '',
    })
    expect(stored.find(e => e.title === 'Morning run')).toMatchObject({
      activityId: 'run',
      placeGuessed: true,
      where: '',
    })
    expect(JSON.stringify(stored)).not.toMatch(/Teams|Standup/)
  })

  it('names a place picked in Outlook without any place search', async () => {
    const search = vi.fn(async () => [])
    const reverse = vi.fn(async () => ({ city: 'x', region: 'y' }) as never)
    const { store, items } = memoryStore()
    await syncOrFail(
      context(
        store,
        fakeApi({
          default: [
            {
              items: [
                graphEvent('obs', 'Stargazing', '2026-06-17T03:00:00', '2026-06-17T05:00:00', {
                  ...place('Griffith Observatory', {
                    locationType: 'localBusiness',
                    coordinates: { latitude: 34.11843, longitude: -118.30041 },
                  }),
                }),
              ],
            },
          ],
          club: [],
        }),
        { lookups: async () => ({ search, reverse }) },
      ),
    )
    expect([...items.values()][0]).toMatchObject({
      lat: 34.12,
      lon: -118.3,
      placeLabel: 'Griffith Observatory',
      placeGuessed: false,
    })
    expect(search).not.toHaveBeenCalled()
    expect(reverse).not.toHaveBeenCalled()
  })

  it('shows an event already in Solara from Google Calendar, a file or a linked calendar once', async () => {
    const google = {
      key: 'e'.repeat(32),
      source: 'google',
      title: 'picnic ',
      start: '2026-06-16T19:00:00.000Z',
      end: '2026-06-16T21:00:00.000Z',
    } as ImportedEvent
    const file = {
      key: await importedEventKey('file', RUN.iCalUId, null),
      source: 'file',
      title: 'Morning run',
    } as ImportedEvent
    const { store, items } = memoryStore([google, file])
    const outcome = await syncOrFail(
      context(store, fakeApi({ default: [{ items: [PICNIC, RUN] }], club: [] })),
    )
    expect(outcome).toMatchObject({ shown: 0, duplicates: 2 })
    expect([...items.values()].filter(e => e.source === 'outlook')).toEqual([])
    expect(outlookSyncSummary(outcome)).toBe(
      'No events in the next 30 days have an address or match one of your activities. 2 events already in Solara are shown once.',
    )
  })

  it('removes events gone from Outlook (deleted, cancelled or declined) and reports a calendar it can no longer read', async () => {
    const { store, items } = memoryStore()
    await syncOrFail(context(store, fakeApi({ default: [{ items: [PICNIC, RUN] }], club: [] })))
    expect(items.size).toBe(2)
    const outcome = await syncOrFail(
      context(
        store,
        fakeApi({
          default: [{ items: [{ ...PICNIC, isCancelled: true }, RUN] }],
          club: null,
        }),
      ),
    )
    expect(outcome).toMatchObject({ shown: 1, removed: 1 })
    expect(outcome.missing).toEqual([{ id: 'club', name: 'Club' }])
    expect(outlookSyncSummary(outcome)).toBe(
      'Showing 1 upcoming event from Outlook. Club is no longer shared with you.',
    )
  })

  it('keeps the soonest events within the per-refresh limit, and stops at the page limit', async () => {
    const many = Array.from({ length: OUTLOOK_EVENT_LIMITS.maxEventsPerSync + 3 }, (_, i) =>
      graphEvent(
        `r${i}`,
        'Run',
        new Date(NOW + (i + 1) * 3_600_000).toISOString().slice(0, 19),
        new Date(NOW + (i + 1.5) * 3_600_000).toISOString().slice(0, 19),
      ),
    )
    const { store } = memoryStore([], 150)
    const outcome = await syncOrFail(
      context(store, fakeApi({ default: [{ items: many }], club: [] })),
    )
    expect(outcome.overLimit).toBe(3)
    expect(outcome.refused).toBe(OUTLOOK_EVENT_LIMITS.maxEventsPerSync - 150)

    const listEvents = vi.fn(async () => ({ items: [], nextLink: 'more' }))
    await syncOutlookEvents(
      context(
        memoryStore().store,
        { ...fakeApi({}), listEvents },
        {
          link: { ...LINK, calendars: [{ id: 'default', name: '' }] },
        },
      ),
    )
    expect(listEvents).toHaveBeenCalledTimes(OUTLOOK_EVENT_LIMITS.maxPagesPerCalendar)
  })
})

describe('the connection, refresh and disconnect (REVIEW6 L4)', () => {
  function connectedAccount() {
    const memory = memoryStore()
    let link: OutlookCalendarLink | null = LINK
    const order: string[] = []
    const linkStore = {
      async read() {
        return link
      },
      async update(_uid: string, patch: Partial<OutlookCalendarLink>) {
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
      async remove(uid: string, keys: readonly string[]) {
        order.push('events')
        return memory.store.remove(uid, keys)
      },
    }
    return { ...memory, store, linkStore, order, link: () => link }
  }

  it('records the refresh time, and writes nothing once another device disconnected', async () => {
    const account = connectedAccount()
    const outcome = await refreshOutlookEvents({
      ...context(account.store, fakeApi({ default: [{ items: [PICNIC] }], club: [] })),
      linkStore: account.linkStore,
    })
    expect(outcome?.shown).toBe(1)
    expect(account.link()?.syncedAt).not.toBe('')

    let release!: () => void
    const gate = new Promise<void>(resolve => (release = resolve))
    const api = fakeApi({ default: [{ items: [PICNIC, RUN] }], club: [] })
    const held: OutlookCalendarApi = {
      ...api,
      listEvents: async (...args) => (await gate, api.listEvents(...args)),
    }
    const laptop = refreshOutlookEvents({
      ...context(account.store, held),
      linkStore: account.linkStore,
    })
    const forget = vi.fn()
    await disconnectOutlook({
      uid: 'u1',
      linkStore: account.linkStore,
      store: account.store,
      api: { forget },
    })
    // The connection goes first, then the events, and the token is forgotten.
    expect(account.order).toEqual(['link', 'events'])
    expect(forget).toHaveBeenCalledOnce()
    release()
    expect(await laptop).toBeNull()
    expect(account.items.size).toBe(0)
  })

  it('removes Outlook events left without a connection, and nothing else', async () => {
    const outlook = { key: 'o'.repeat(32), source: 'outlook', title: 'Picnic' } as ImportedEvent
    const google = { key: 'g'.repeat(32), source: 'google', title: 'Picnic' } as ImportedEvent
    const { store, items } = memoryStore([outlook, google])
    expect(await removeOutlookEvents('u1', store)).toBe(1)
    expect([...items.keys()]).toEqual([google.key])
  })

  it('refreshes by itself every half hour', () => {
    expect(outlookRefreshDue(LINK, NOW)).toBe(true)
    const synced = { ...LINK, syncedAt: new Date(NOW - 29 * 60_000).toISOString() }
    expect(outlookRefreshDue(synced, NOW)).toBe(false)
    expect(outlookRefreshDue(synced, NOW + 60_000)).toBe(true)
  })
})
