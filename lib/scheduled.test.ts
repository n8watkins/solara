import { describe, expect, it } from 'vitest'
import { parseScheduledActivity, type ScheduledActivity } from '@solara/core'
import type { GoogleEvent } from './gcal'
import {
  planReconcile,
  recordFromEvent,
  scheduledOn,
  scheduledSpan,
  startOptions,
  upcomingScheduled,
} from './scheduled'

const TZ = 'America/Los_Angeles'
const NOW = '2026-06-15T17:30:00.000Z'

function record(overrides: Partial<ScheduledActivity> = {}): ScheduledActivity {
  return {
    eventId: 'evt1',
    calendarId: 'primary',
    activityId: 'run',
    title: '🏃 Running: lower-UV window',
    icon: '🏃',
    // 6:00-6:45pm PDT
    start: '2026-06-16T01:00:00.000Z',
    end: '2026-06-16T01:45:00.000Z',
    timeZone: TZ,
    htmlLink: 'https://www.google.com/calendar/event?eid=evt1',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function event(overrides: Partial<GoogleEvent> = {}): GoogleEvent {
  return {
    id: 'evt1',
    status: 'confirmed',
    htmlLink: 'https://www.google.com/calendar/event?eid=evt1',
    summary: '🏃 Running: lower-UV window',
    start: { dateTime: '2026-06-15T18:00:00-07:00', timeZone: TZ },
    end: { dateTime: '2026-06-15T18:45:00-07:00', timeZone: TZ },
    extendedProperties: { private: { solara: '1', solaraActivityId: 'run' } },
    ...overrides,
  }
}

const context = { timeZone: TZ, now: '2026-06-15T18:00:00.000Z', activities: [] }

describe('scheduledSpan', () => {
  it('places an event on its local date and hours', () => {
    expect(scheduledSpan(record(), TZ)).toEqual({ date: '2026-06-15', from: 18, to: 18.75 })
  })

  it('reads the same instant in another zone', () => {
    expect(scheduledSpan(record(), 'America/New_York')).toEqual({
      date: '2026-06-15',
      from: 21,
      to: 21.75,
    })
  })

  it('clips an event that runs past midnight at the end of its day', () => {
    const late = record({ start: '2026-06-16T06:30:00.000Z', end: '2026-06-16T08:00:00.000Z' })
    expect(scheduledSpan(late, TZ)).toEqual({ date: '2026-06-15', from: 23.5, to: 24 })
  })
})

describe('scheduledOn and upcomingScheduled', () => {
  const items = [
    record({ eventId: 'b', start: '2026-06-16T02:00:00.000Z', end: '2026-06-16T03:00:00.000Z' }),
    record({ eventId: 'a' }),
    record({ eventId: 'c', activityId: 'hike' }),
    record({ eventId: 'd', start: '2026-06-17T01:00:00.000Z', end: '2026-06-17T02:00:00.000Z' }),
  ]

  it('picks one activity on one local date, by start', () => {
    expect(scheduledOn(items, 'run', '2026-06-15', TZ).map(x => x.item.eventId)).toEqual(['a', 'b'])
  })

  it('keeps only items that have not ended, soonest first', () => {
    const now = Date.parse('2026-06-16T02:30:00.000Z')
    expect(upcomingScheduled(items, now).map(i => i.eventId)).toEqual(['b', 'd'])
  })
})

describe('startOptions', () => {
  it('offers 15-minute starts where the whole activity fits in a window', () => {
    expect(startOptions([{ from: 18, to: 20 }], 0.75)).toEqual([18, 18.25, 18.5, 18.75, 19, 19.25])
  })

  it('starts no earlier than now on today, on the next step', () => {
    expect(startOptions([{ from: 16, to: 18 }], 1, 16.6)).toEqual([16.75, 17])
  })

  it('covers several windows and returns nothing when none fits', () => {
    expect(
      startOptions(
        [
          { from: 6, to: 7 },
          { from: 18, to: 19 },
        ],
        1,
      ),
    ).toEqual([6, 18])
    expect(startOptions([{ from: 6, to: 6.5 }], 1)).toEqual([])
  })
})

describe('recordFromEvent', () => {
  it('stores the event in UTC with its link, zone and activity', () => {
    expect(
      recordFromEvent(event(), { ...context, activities: [{ id: 'run', icon: '🏃' } as never] }),
    ).toEqual(record({ createdAt: context.now, updatedAt: context.now }))
  })

  it('keeps the activity, icon and creation time of the record it updates', () => {
    const previous = record({ icon: '⭐', createdAt: '2026-06-01T00:00:00.000Z' })
    const next = recordFromEvent(event({ extendedProperties: undefined }), { ...context, previous })
    expect(next).toMatchObject({ icon: '⭐', activityId: 'run', createdAt: previous.createdAt })
  })

  it('reads an all-day date as local midnight', () => {
    const allDay = event({ start: { date: '2026-06-15' }, end: { date: '2026-06-16' } })
    expect(recordFromEvent(allDay, context)).toMatchObject({
      start: '2026-06-15T07:00:00.000Z',
      end: '2026-06-16T07:00:00.000Z',
    })
  })

  it('refuses links that are not Google Calendar links, and backwards times', () => {
    expect(recordFromEvent(event({ htmlLink: 'https://evil.example/x' }), context)).toBeNull()
    expect(recordFromEvent(event({ htmlLink: 'javascript:alert(1)' }), context)).toBeNull()
    expect(
      recordFromEvent(event({ end: { dateTime: '2026-06-15T17:00:00-07:00' } }), context),
    ).toBeNull()
  })
})

describe('planReconcile', () => {
  it('updates a record whose event moved in Google', () => {
    const moved = event({
      start: { dateTime: '2026-06-15T19:00:00-07:00', timeZone: TZ },
      end: { dateTime: '2026-06-15T19:45:00-07:00', timeZone: TZ },
    })
    const plan = planReconcile([record()], new Map([['evt1', moved]]), [moved], context)
    expect(plan.removals).toEqual([])
    expect(plan.upserts).toEqual([
      record({
        start: '2026-06-16T02:00:00.000Z',
        end: '2026-06-16T02:45:00.000Z',
        updatedAt: context.now,
      }),
    ])
  })

  it('removes records whose event was deleted or cancelled', () => {
    const records = [record(), record({ eventId: 'evt2' })]
    const found = new Map<string, GoogleEvent | null>([
      ['evt1', null],
      ['evt2', event({ id: 'evt2', status: 'cancelled' })],
    ])
    expect(planReconcile(records, found, [], context)).toEqual({
      upserts: [],
      removals: ['evt1', 'evt2'],
    })
  })

  it('leaves unchanged and unchecked records alone', () => {
    const same = event()
    expect(planReconcile([record()], new Map([['evt1', same]]), [same], context)).toEqual({
      upserts: [],
      removals: [],
    })
    expect(planReconcile([record()], new Map(), [], context)).toEqual({ upserts: [], removals: [] })
  })

  it('adopts a tagged event that has no record, but not a cancelled one', () => {
    const orphan = event({ id: 'evt9', htmlLink: 'https://www.google.com/calendar/event?eid=evt9' })
    const gone = event({ id: 'evt8', status: 'cancelled' })
    const plan = planReconcile([], new Map(), [orphan, gone], context)
    expect(plan.upserts.map(u => u.eventId)).toEqual(['evt9'])
    expect(plan.upserts[0]).toMatchObject({ activityId: 'run', icon: '📅' })
  })
})

describe('the stored record schema', () => {
  it('accepts a valid record and rejects malformed ones', () => {
    expect(parseScheduledActivity(record())).toEqual(record())
    expect(parseScheduledActivity(record({ htmlLink: 'http://www.google.com/x' }))).toBeNull()
    expect(parseScheduledActivity(record({ eventId: 'bad/id' }))).toBeNull()
    expect(parseScheduledActivity(record({ end: record().start }))).toBeNull()
    expect(parseScheduledActivity({ ...record(), title: 'x'.repeat(201) })).toBeNull()
    expect(parseScheduledActivity({ ...record(), calendarId: 'work' })).toBeNull()
  })
})
