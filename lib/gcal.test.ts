import { afterEach, describe, it, expect, vi } from 'vitest'
import type { BusyPeriod } from '@/lib/gcal'
import {
  busyIntervalsForDay,
  buildEventBody,
  buildEventDescription,
  CALENDAR_BOOKING_SCOPE,
  CALENDAR_FREEBUSY_SCOPE,
  CalendarAuthError,
  deleteCalendarEvent,
  eventTimes,
  getCalendarEvent,
  hasScopeToken,
  listCalendarEvents,
  listCalendars,
  listSolaraEvents,
  patchCalendarEventTime,
  requestScopeToken,
  requestWriteToken,
  revokeCalendarAccess,
} from '@/lib/gcal'
import type { SlotRecommendation } from '@solara/core/scheduler'
import type { Activity } from '@/lib/types'

// Busy periods are absolute instants (Google returns them with an offset); days are
// read in the forecast location's zone, so the device zone never matters.
const D = '2026-05-29'
const TZ = 'America/Los_Angeles'

describe('busyIntervalsForDay', () => {
  it('maps an event inside the day to fractional hours', () => {
    const periods: BusyPeriod[] = [{ start: `${D}T09:30:00-07:00`, end: `${D}T10:15:00-07:00` }]
    expect(busyIntervalsForDay(periods, D, TZ)).toEqual([{ start: 9.5, end: 10.25 }])
  })

  it('clips an event that starts the previous day', () => {
    const periods: BusyPeriod[] = [
      { start: '2026-05-28T23:00:00-07:00', end: `${D}T01:30:00-07:00` },
    ]
    expect(busyIntervalsForDay(periods, D, TZ)).toEqual([{ start: 0, end: 1.5 }])
  })

  it('clips an event that runs past midnight', () => {
    const periods: BusyPeriod[] = [
      { start: `${D}T23:00:00-07:00`, end: '2026-05-30T02:00:00-07:00' },
    ]
    expect(busyIntervalsForDay(periods, D, TZ)).toEqual([{ start: 23, end: 24 }])
  })

  it('treats a multi-day event as busy all day', () => {
    const periods: BusyPeriod[] = [
      { start: '2026-05-27T00:00:00-07:00', end: '2026-05-31T00:00:00-07:00' },
    ]
    expect(busyIntervalsForDay(periods, D, TZ)).toEqual([{ start: 0, end: 24 }])
  })

  it('drops events on other days', () => {
    const periods: BusyPeriod[] = [
      { start: '2026-05-30T09:00:00-07:00', end: '2026-05-30T10:00:00-07:00' },
    ]
    expect(busyIntervalsForDay(periods, D, TZ)).toEqual([])
  })

  it('keeps multiple same-day events (engine sorts/merges later)', () => {
    const periods: BusyPeriod[] = [
      { start: `${D}T14:00:00-07:00`, end: `${D}T15:00:00-07:00` },
      { start: `${D}T08:00:00-07:00`, end: `${D}T09:00:00-07:00` },
    ]
    expect(busyIntervalsForDay(periods, D, TZ)).toEqual([
      { start: 14, end: 15 },
      { start: 8, end: 9 },
    ])
  })

  it('skips malformed timestamps and handles empties', () => {
    expect(busyIntervalsForDay([{ start: 'nonsense', end: `${D}T10:00:00-07:00` }], D, TZ)).toEqual(
      [],
    )
    expect(busyIntervalsForDay([], D, TZ)).toEqual([])
    expect(
      busyIntervalsForDay(
        [{ start: `${D}T09:00:00-07:00`, end: `${D}T10:00:00-07:00` }],
        'bad-date',
        TZ,
      ),
    ).toEqual([])
  })

  it('reads the day in the location zone, not the device zone', () => {
    // 9:30-10:15 in Los Angeles is 16:30-17:15 UTC and 01:30-02:15 next day in Tokyo.
    const periods: BusyPeriod[] = [{ start: '2026-05-29T16:30:00Z', end: '2026-05-29T17:15:00Z' }]
    expect(busyIntervalsForDay(periods, D, TZ)).toEqual([{ start: 9.5, end: 10.25 }])
    expect(busyIntervalsForDay(periods, '2026-05-30', 'Asia/Tokyo')).toEqual([
      { start: 1.5, end: 2.25 },
    ])
  })

  it('clips to a 23-hour spring-forward day', () => {
    const periods: BusyPeriod[] = [
      { start: '2026-03-07T00:00:00-08:00', end: '2026-03-10T00:00:00-07:00' },
    ]
    expect(busyIntervalsForDay(periods, '2026-03-08', TZ)).toEqual([{ start: 0, end: 23 }])
  })
})

const run: Activity = {
  id: 'run',
  name: 'Running',
  icon: '🏃',
  durationMins: 60,
  maxUV: 4,
  sunscreen: false,
}
const rec: SlotRecommendation = {
  start: 17,
  end: 18,
  earliestStart: 17,
  latestStart: 20,
  windowLabel: 'Afternoon',
  peakUV: 5,
  avgUV: 4,
  reason: 'Earliest free spot in your afternoon window',
}

describe('buildEventDescription', () => {
  it('explains the pick, flexibility, peak, and protection', () => {
    const d = buildEventDescription(rec, run, { peakUV: 7.8, peakHour: 15 })
    expect(d).toContain('Recommended for 5pm: earliest free spot in your afternoon window.')
    expect(d).toContain('Flexible: start anytime 5pm–8pm within the estimated lower-UV window.')
    expect(d).toContain('Peak UV 7.8 around 3pm.')
    expect(d).toContain('Planned for no sunscreen.')
    expect(d).toContain('Forecast-based estimate only.')
    expect(d).toContain('Planned by Solara')
  })

  it('omits the flexibility line when there is no wiggle room', () => {
    const tight = { ...rec, earliestStart: 17, latestStart: 17 }
    expect(buildEventDescription(tight, run)).not.toContain('Flexible')
  })

  it('omits the peak line when not provided and notes SPF when on', () => {
    const d = buildEventDescription(rec, { ...run, sunscreen: true })
    expect(d).not.toContain('Peak UV')
    expect(d).toContain('Assumes SPF 30+.')
  })
})

describe('buildEventBody', () => {
  it('builds summary and offset-free local timestamps', () => {
    const body = buildEventBody(run, '2026-05-29', 17, 18, 'desc', 'America/Los_Angeles')
    expect(body.summary).toBe('🏃 Running: lower-UV window')
    expect(body.start).toEqual({ dateTime: '2026-05-29T17:00:00', timeZone: 'America/Los_Angeles' })
    expect(body.end).toEqual({ dateTime: '2026-05-29T18:00:00', timeZone: 'America/Los_Angeles' })
  })

  it("tags the event as Solara's with private extended properties", () => {
    const body = buildEventBody(run, '2026-05-29', 17, 18, 'desc', 'America/Los_Angeles')
    expect(body.extendedProperties).toEqual({
      private: { solara: '1', solaraActivityId: run.id, solaraWindowDate: '2026-05-29' },
    })
  })

  it('renders fractional hours as minutes', () => {
    const body = buildEventBody(run, '2026-05-29', 9.5, 10.25, 'desc', 'UTC')
    expect(body.start.dateTime).toBe('2026-05-29T09:30:00')
    expect(body.end.dateTime).toBe('2026-05-29T10:15:00')
  })

  it('ends at midnight on the next day, never at T24:00:00', () => {
    expect(eventTimes('2026-05-31', 23, 24, 'UTC').end.dateTime).toBe('2026-06-01T00:00:00')
    // A minute that rounds up to the hour carries into the hour, and on past midnight.
    expect(eventTimes('2026-05-29', 9, 23.9999, 'UTC').end.dateTime).toBe('2026-05-30T00:00:00')
    expect(eventTimes('2026-05-29', 9.9999, 11, 'UTC').start.dateTime).toBe('2026-05-29T10:00:00')
  })
})

describe('Google Calendar scopes', () => {
  it('requests availability only, never event read access', () => {
    expect(CALENDAR_FREEBUSY_SCOPE).toBe('https://www.googleapis.com/auth/calendar.freebusy')
    expect(CALENDAR_BOOKING_SCOPE).toBe('https://www.googleapis.com/auth/calendar.events.owned')
    for (const scope of [CALENDAR_FREEBUSY_SCOPE, CALENDAR_BOOKING_SCOPE]) {
      expect(scope).not.toMatch(/calendar(\.readonly|\.events)?$/)
    }
  })
})

describe('Solara event calls', () => {
  const calls: { url: string; init: RequestInit | undefined }[] = []
  function mockFetch(...responses: Response[]) {
    calls.length = 0
    const queue = [...responses]
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init })
        const next = queue.shift()
        if (!next) throw new Error('unexpected fetch')
        return next
      }),
    )
  }
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  const tagged = { id: 'abc123', extendedProperties: { private: { solara: '1' } } }

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('lists only tagged events, filtered by Google, across pages', async () => {
    mockFetch(
      json({ items: [tagged], nextPageToken: 'p2' }),
      // An untagged event never reaches the app, even if a response included one.
      json({ items: [{ id: 'other1' }, { ...tagged, id: 'abc124' }] }),
    )
    const events = await listSolaraEvents(
      'tok',
      new Date('2026-06-15T00:00:00Z'),
      new Date('2026-06-20T00:00:00Z'),
    )
    expect(events.map(e => e.id)).toEqual(['abc123', 'abc124'])
    const first = new URL(calls[0]!.url)
    expect(first.pathname).toBe('/calendar/v3/calendars/primary/events')
    expect(first.searchParams.get('privateExtendedProperty')).toBe('solara=1')
    expect(first.searchParams.get('showDeleted')).toBe('true')
    expect(new URL(calls[1]!.url).searchParams.get('pageToken')).toBe('p2')
    expect(calls[0]!.init?.headers).toMatchObject({ Authorization: 'Bearer tok' })
  })

  it('treats a missing event as gone, and a deleted one as already deleted', async () => {
    mockFetch(new Response(null, { status: 404 }), new Response(null, { status: 410 }))
    expect(await getCalendarEvent('tok', 'abc123')).toBeNull()
    await expect(deleteCalendarEvent('tok', 'abc123')).resolves.toBeUndefined()
    expect(calls[1]!.init?.method).toBe('DELETE')
  })

  it('patches only the start and end', async () => {
    mockFetch(json(tagged))
    const times = {
      start: { dateTime: '2026-06-15T19:00:00', timeZone: 'UTC' },
      end: { dateTime: '2026-06-15T20:00:00', timeZone: 'UTC' },
    }
    await patchCalendarEventTime('tok', 'abc123', times)
    expect(calls[0]!.init?.method).toBe('PATCH')
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual(times)
  })

  it('reports a refused token as CalendarAuthError', async () => {
    mockFetch(new Response(null, { status: 401 }))
    await expect(getCalendarEvent('tok', 'abc123')).rejects.toBeInstanceOf(CalendarAuthError)
  })

  it('never builds a URL from an unsafe event id', async () => {
    mockFetch()
    await expect(getCalendarEvent('tok', '../calendarList')).rejects.toThrow('Invalid event id')
    expect(calls).toEqual([])
  })

  it('never asks for a token without a click', async () => {
    await expect(requestWriteToken({ interactive: false })).rejects.toBeInstanceOf(
      CalendarAuthError,
    )
  })
})

describe('reading events already in the calendar (phase 2b)', () => {
  const READ = 'https://www.googleapis.com/auth/calendar.events.readonly'
  const LIST = 'https://www.googleapis.com/auth/calendar.calendarlist.readonly'
  const calls: string[] = []
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  function mockFetch(...responses: Response[]) {
    calls.length = 0
    const queue = [...responses]
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(url)
        const next = queue.shift()
        if (!next) throw new Error('unexpected fetch')
        return next
      }),
    )
  }
  afterEach(() => vi.unstubAllGlobals())

  it('asks Google only for the fields the UV card needs', async () => {
    mockFetch(json({ timeZone: 'America/Los_Angeles', items: [{ id: 'e1' }], nextPageToken: 'n' }))
    const page = await listCalendarEvents(
      'tok',
      READ,
      'club@group.calendar.google.com',
      new Date('2026-06-15T00:00:00Z'),
      new Date('2026-07-15T00:00:00Z'),
      { pageSize: 250, pageToken: 'p1' },
    )
    expect(page).toEqual({
      timeZone: 'America/Los_Angeles',
      items: [{ id: 'e1' }],
      nextPageToken: 'n',
    })
    const url = new URL(calls[0]!)
    expect(url.pathname).toBe('/calendar/v3/calendars/club%40group.calendar.google.com/events')
    expect(url.searchParams.get('singleEvents')).toBe('true')
    expect(url.searchParams.get('pageToken')).toBe('p1')
    expect(url.searchParams.get('eventTypes')).toBe('default')
    const fields = url.searchParams.get('fields') ?? ''
    expect(fields).toContain('attendees(self,responseStatus)')
    for (const never of ['description', 'organizer', 'creator', 'email', 'conferenceData']) {
      expect(fields).not.toContain(never)
    }
  })

  it('treats a calendar that is gone as missing, and a refused token as an auth error', async () => {
    mockFetch(new Response(null, { status: 404 }), new Response(null, { status: 401 }))
    const span = [new Date('2026-06-15T00:00:00Z'), new Date('2026-06-16T00:00:00Z')] as const
    expect(await listCalendarEvents('tok', READ, 'primary', ...span, { pageSize: 10 })).toBeNull()
    await expect(
      listCalendarEvents('tok', READ, 'primary', ...span, { pageSize: 10 }),
    ).rejects.toBeInstanceOf(CalendarAuthError)
  })

  it('lists calendars without hidden or deleted ones', async () => {
    mockFetch(
      json({
        items: [
          { id: 'me@example.com', summary: 'me@example.com', primary: true },
          { id: 'club@group', summary: 'Club', summaryOverride: 'Running club' },
          { id: 'old@group', summary: 'Old', hidden: true },
          { id: 'gone@group', summary: 'Gone', deleted: true },
          { summary: 'No id' },
        ],
      }),
    )
    expect(await listCalendars('tok', LIST)).toEqual([
      { id: 'me@example.com', name: 'me@example.com', primary: true },
      { id: 'club@group', name: 'Running club', primary: false },
    ])
    expect(new URL(calls[0]!).pathname).toBe('/calendar/v3/users/me/calendarList')
  })

  it('never asks for a read token without a click, and revokes nothing without one', async () => {
    await expect(requestScopeToken(READ, { interactive: false })).rejects.toBeInstanceOf(
      CalendarAuthError,
    )
    expect(hasScopeToken(READ)).toBe(false)
    await expect(revokeCalendarAccess()).resolves.toBe(false)
  })
})
