import { describe, expect, it, vi } from 'vitest'
import type { ScheduledActivity } from '@solara/core'
import type { GoogleEvent } from './gcal'
import {
  SYNC_AHEAD_MS,
  SYNC_PAST_MS,
  expiredRecords,
  syncWithGoogle,
  type GoogleCalendarReader,
} from './google-calendar-sync'
import { SCHEDULED_RETENTION_MS } from './scheduled'

const TZ = 'America/Los_Angeles'
const NOW_MS = Date.parse('2026-06-15T17:30:00.000Z')
const context = { timeZone: TZ, now: '2026-06-15T17:30:00.000Z', activities: [] }

function record(eventId: string, overrides: Partial<ScheduledActivity> = {}): ScheduledActivity {
  return {
    eventId,
    calendarId: 'primary',
    activityId: 'run',
    title: '🏃 Running: lower-UV window',
    icon: '🏃',
    // 6:00-6:45pm PDT
    start: '2026-06-16T01:00:00.000Z',
    end: '2026-06-16T01:45:00.000Z',
    timeZone: TZ,
    htmlLink: `https://www.google.com/calendar/event?eid=${eventId}`,
    createdAt: context.now,
    updatedAt: context.now,
    ...overrides,
  }
}

function event(id: string, from = '18:00', to = '18:45', status = 'confirmed'): GoogleEvent {
  return {
    id,
    status,
    htmlLink: `https://www.google.com/calendar/event?eid=${id}`,
    summary: '🏃 Running: lower-UV window',
    start: { dateTime: `2026-06-15T${from}:00-07:00`, timeZone: TZ },
    end: { dateTime: `2026-06-15T${to}:00-07:00`, timeZone: TZ },
    extendedProperties: { private: { solara: '1', solaraActivityId: 'run' } },
  }
}

function fakeGoogle(listed: GoogleEvent[], byId: Record<string, GoogleEvent | null> = {}) {
  return {
    listSolaraEvents: vi.fn<GoogleCalendarReader['listSolaraEvents']>(async () => listed),
    getCalendarEvent: vi.fn<GoogleCalendarReader['getCalendarEvent']>(
      async (_token, id) => byId[id] ?? null,
    ),
  }
}

describe('syncWithGoogle', () => {
  it('lists Solara events from a day ago to past the forecast', async () => {
    const google = fakeGoogle([])
    await syncWithGoogle('tok', [], context, NOW_MS, google)
    expect(google.listSolaraEvents).toHaveBeenCalledWith(
      'tok',
      new Date(NOW_MS - SYNC_PAST_MS),
      new Date(NOW_MS + SYNC_AHEAD_MS),
    )
  })

  it('reports nothing when Google matches the records', async () => {
    const google = fakeGoogle([event('a')])
    const result = await syncWithGoogle('tok', [record('a')], context, NOW_MS, google)
    expect(result).toEqual({ upserts: [], removals: [], changes: null })
    expect(google.getCalendarEvent).not.toHaveBeenCalled()
  })

  it('counts a moved event and a deleted one', async () => {
    const google = fakeGoogle([event('a', '19:00', '19:45')], { b: null })
    const result = await syncWithGoogle('tok', [record('a'), record('b')], context, NOW_MS, google)
    expect(result.upserts.map(u => [u.eventId, u.start])).toEqual([
      ['a', '2026-06-16T02:00:00.000Z'],
    ])
    expect(result.removals).toEqual(['b'])
    expect(result.changes).toEqual({ moved: 1, removed: 1 })
    expect(google.getCalendarEvent).toHaveBeenCalledWith('tok', 'b')
  })

  it('finds an event moved out of range by id and keeps it', async () => {
    const moved = event('a', '20:00', '20:45')
    const google = fakeGoogle([], { a: moved })
    const result = await syncWithGoogle('tok', [record('a')], context, NOW_MS, google)
    expect(result.removals).toEqual([])
    expect(result.changes).toEqual({ moved: 1, removed: 0 })
  })

  it('adopts an event found only in Google without telling the person', async () => {
    const google = fakeGoogle([event('new')])
    const result = await syncWithGoogle('tok', [], context, NOW_MS, google)
    expect(result.upserts.map(u => u.eventId)).toEqual(['new'])
    expect(result.changes).toBeNull()
  })

  it('leaves long-finished records alone', async () => {
    const old = record('old', {
      start: '2026-06-10T01:00:00.000Z',
      end: '2026-06-10T01:45:00.000Z',
    })
    const google = fakeGoogle([])
    const result = await syncWithGoogle('tok', [old], context, NOW_MS, google)
    expect(google.getCalendarEvent).not.toHaveBeenCalled()
    expect(result.removals).toEqual([])
  })
})

describe('expiredRecords', () => {
  it('returns records that ended before the retention cutoff', () => {
    const cutoff = NOW_MS - SCHEDULED_RETENTION_MS
    const old = record('old', { end: new Date(cutoff - 1).toISOString() })
    const recent = record('recent', { end: new Date(cutoff + 1).toISOString() })
    expect(expiredRecords([old, recent], NOW_MS)).toEqual([old])
  })
})
