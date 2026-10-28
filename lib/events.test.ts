import { describe, expect, it, vi } from 'vitest'
import type { ParsedIcsEvent } from '@solara/core/event-import'
import {
  eventDocument,
  findPlace,
  importIcsFile,
  importSummary,
  knownPlaces,
  locationQueries,
  MAX_PLACE_LOOKUPS,
  recordsFromImport,
  resolvePlaces,
  samePlace,
  upcomingEvents,
  withPlace,
  type ImportedEvent,
  type PlaceLookups,
} from './events'
import type { Location } from './types'

const NOW = Date.parse('2026-06-15T17:30:00Z')
const HOME: Location = {
  lat: 34.05,
  lon: -118.24,
  city: 'Los Angeles',
  region: 'California',
  timezone: 'America/Los_Angeles',
}
const SAN_DIEGO: Location = {
  lat: 32.72,
  lon: -117.16,
  city: 'San Diego',
  region: 'California',
  timezone: 'America/Los_Angeles',
}
const ACTIVITIES = [
  { id: 'run', name: 'Running' },
  { id: 'hike', name: 'Hiking' },
]

function parsed(overrides: Partial<ParsedIcsEvent> = {}): ParsedIcsEvent {
  return {
    uid: 'u1',
    recurrenceId: null,
    title: 'Saturday 10K',
    start: Date.parse('2026-06-20T15:00:00Z'),
    end: Date.parse('2026-06-20T16:30:00Z'),
    timeZone: 'America/Los_Angeles',
    location: null,
    geo: null,
    url: null,
    ...overrides,
  }
}

function lookups(places: Record<string, Location[]> = {}): PlaceLookups & {
  searched: string[]
} {
  const searched: string[] = []
  return {
    searched,
    search: async query => {
      searched.push(query)
      return (places[query] ?? []).map(location => ({ location, detail: '' }))
    },
    reverse: async () => ({ city: 'Pasadena', region: 'California' }),
  }
}

const ics = (...lines: string[]) =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', ...lines, 'END:VCALENDAR'].join('\r\n')
const file = (text: string, size = text.length) => ({ size, text: async () => text })

describe('locationQueries', () => {
  it.each([
    [
      'Griffith Park, 4730 Crystal Springs Dr, Los Angeles, CA 90027, USA',
      ['Los Angeles, CA', 'Los Angeles'],
    ],
    ['Balboa Park, San Diego', ['San Diego']],
    ['San Diego', ['San Diego']],
    ['Mission Bay Park, San Diego, California, United States', ['California']],
    ['123 Main St', []],
    ['Track 2, X', []],
    ['The big field behind the old school next to the river', []],
    ['', []],
  ])('%j -> %j', (where, queries) => {
    expect(locationQueries(where)).toEqual(queries)
  })
})

describe('findPlace', () => {
  it('picks the same-named town nearest the person', async () => {
    const far = { ...SAN_DIEGO, lat: 10, lon: 10 }
    const place = await findPlace(
      'San Diego',
      HOME,
      lookups({ 'San Diego': [far, SAN_DIEGO] }).search,
    )
    expect(place).toEqual({
      lat: 32.72,
      lon: -117.16,
      label: 'San Diego, California',
      guessed: false,
    })
  })

  it('tries the next query, and gives up on a failed search', async () => {
    const found = lookups({ 'Los Angeles': [HOME] })
    expect(await findPlace('Park, Los Angeles, CA', SAN_DIEGO, found.search)).toMatchObject({
      label: 'Los Angeles, California',
    })
    expect(found.searched).toEqual(['Los Angeles, CA', 'Los Angeles'])
    const failing = async () => Promise.reject(new Error('offline'))
    expect(await findPlace('San Diego', HOME, failing)).toBeNull()
  })
})

describe('resolvePlaces', () => {
  it('uses GEO as given, named by LOCATION or a reverse lookup, and searches text once', async () => {
    const api = lookups({ 'San Diego': [SAN_DIEGO] })
    const reverse = vi.spyOn(api, 'reverse')
    const places = await resolvePlaces(
      [
        parsed({ geo: { lat: 34.1366, lon: -118.2942 }, location: 'Griffith Park, LA' }),
        parsed({ geo: { lat: 34.15, lon: -118.14 } }),
        parsed({ location: 'Balboa Park, San Diego' }),
        parsed({ location: 'balboa park, san diego' }),
        parsed(),
      ],
      HOME,
      api,
    )
    expect(Object.fromEntries(places)).toEqual({
      'geo:34.14,-118.29': { lat: 34.14, lon: -118.29, label: 'Griffith Park', guessed: false },
      'geo:34.15,-118.14': {
        lat: 34.15,
        lon: -118.14,
        label: 'Pasadena, California',
        guessed: false,
      },
      'where:balboa park, san diego': {
        lat: 32.72,
        lon: -117.16,
        label: 'San Diego, California',
        guessed: false,
      },
    })
    expect(api.searched).toEqual(['San Diego'])
    expect(reverse).toHaveBeenCalledTimes(1)
  })

  it('caps the searches and reuses known places', async () => {
    const api = lookups()
    const events = Array.from({ length: MAX_PLACE_LOOKUPS + 5 }, (_, i) =>
      parsed({ location: `Town ${String.fromCharCode(65 + i)}` }),
    )
    const known = new Map([['where:town a', { lat: 1, lon: 2, label: 'Known', guessed: false }]])
    const progress: string[] = []
    const places = await resolvePlaces(events, HOME, api, {
      known,
      onProgress: (done, total) => progress.push(`${done}/${total}`),
    })
    expect(api.searched).toHaveLength(MAX_PLACE_LOOKUPS)
    expect(api.searched[0]).toBe('Town B')
    expect(places.get('where:town a')?.label).toBe('Known')
    expect(progress.at(-1)).toBe(`${MAX_PLACE_LOOKUPS}/${MAX_PLACE_LOOKUPS}`)
  })
})

describe('recordsFromImport', () => {
  const base = {
    places: new Map([
      [
        'where:balboa park, san diego',
        { lat: 32.72, lon: -117.16, label: 'San Diego, California', guessed: false },
      ],
    ]),
    home: HOME,
    activities: ACTIVITIES,
    previous: new Map<string, ImportedEvent>(),
    now: '2026-06-15T17:30:00.000Z',
  }

  it('builds valid records with the place, the matched activity and a link', async () => {
    const [found, guessed] = await recordsFromImport(
      [
        parsed({ location: 'Balboa Park, San Diego', url: 'https://example.com/e' }),
        parsed({ uid: 'u2', title: 'Brunch' }),
      ],
      base,
    )
    expect(found).toMatchObject({
      source: 'file',
      title: 'Saturday 10K',
      start: '2026-06-20T15:00:00.000Z',
      end: '2026-06-20T16:30:00.000Z',
      where: 'Balboa Park, San Diego',
      placeLabel: 'San Diego, California',
      placeGuessed: false,
      activityId: 'run',
      url: 'https://example.com/e',
      createdAt: base.now,
    })
    expect(found!.key).toMatch(/^[0-9a-f]{32}$/)
    expect(guessed).toMatchObject({
      where: '',
      lat: HOME.lat,
      placeLabel: 'Los Angeles, California',
      placeGuessed: true,
      activityId: '',
      url: '',
    })
  })

  it('keeps the person’s place and activity when the same event is imported again', async () => {
    const [first] = await recordsFromImport([parsed({ location: 'Somewhere' })], base)
    const edited = {
      ...withPlace(first!, SAN_DIEGO, '2026-06-15T18:00:00.000Z'),
      activityId: 'hike',
    }
    const [again] = await recordsFromImport(
      [parsed({ location: 'Somewhere', title: 'New name' })],
      {
        ...base,
        previous: new Map([[edited.key, edited]]),
        now: '2026-06-16T09:00:00.000Z',
      },
    )
    expect(again).toMatchObject({
      key: first!.key,
      title: 'New name',
      placeLabel: 'San Diego, California',
      placeGuessed: false,
      activityId: 'hike',
      createdAt: base.now,
      updatedAt: '2026-06-16T09:00:00.000Z',
    })
  })
})

describe('view helpers', () => {
  it('lists events that have not ended, soonest first', () => {
    const at = (start: string, end: string, key: string) => ({ start, end, key }) as ImportedEvent
    const items = [
      at('2026-06-20T15:00:00.000Z', '2026-06-20T16:00:00.000Z', 'b'),
      at('2026-06-15T17:00:00.000Z', '2026-06-15T18:00:00.000Z', 'a'),
      at('2026-06-14T15:00:00.000Z', '2026-06-14T16:00:00.000Z', 'c'),
    ]
    expect(upcomingEvents(items, NOW).map(i => i.key)).toEqual(['a', 'b'])
  })

  it('compares places by rounded coordinates', () => {
    expect(samePlace(HOME, { lat: 34.0512, lon: -118.2449 })).toBe(true)
    expect(samePlace(HOME, SAN_DIEGO)).toBe(false)
  })

  it('stores an expiry 30 days after the end', async () => {
    const [record] = await recordsFromImport([parsed()], {
      places: new Map(),
      home: HOME,
      activities: [],
      previous: new Map(),
      now: '2026-06-15T17:30:00.000Z',
    })
    expect(eventDocument(record!).expireAt.toISOString()).toBe('2026-07-20T16:30:00.000Z')
  })

  it('remembers places found by earlier imports, not guessed ones', async () => {
    const [found, guessed] = await recordsFromImport(
      [parsed({ location: 'Balboa Park, San Diego' }), parsed({ uid: 'u2', location: 'Nowhere' })],
      {
        places: new Map([
          [
            'where:balboa park, san diego',
            { lat: 32.72, lon: -117.16, label: 'San Diego', guessed: false },
          ],
        ]),
        home: HOME,
        activities: [],
        previous: new Map(),
        now: '2026-06-15T17:30:00.000Z',
      },
    )
    expect([...knownPlaces([found!, guessed!]).keys()]).toEqual(['where:balboa park, san diego'])
  })
})

describe('importIcsFile', () => {
  const context = (save = vi.fn(async () => {})) => ({
    home: HOME,
    activities: ACTIVITIES,
    existing: [],
    nowMs: NOW,
    lookups: async () => lookups(),
    save,
  })

  it('refuses a file over 1 MB before reading it', async () => {
    const text = vi.fn()
    const outcome = await importIcsFile({ size: 2_000_000, text }, context())
    expect(outcome).toEqual({ ok: false, message: expect.stringContaining('larger than 1 MB') })
    expect(text).not.toHaveBeenCalled()
  })

  it('explains a file that is not a calendar', async () => {
    expect(await importIcsFile(file('<html></html>'), context())).toEqual({
      ok: false,
      message: expect.stringContaining('not a calendar'),
    })
  })

  it('stores the upcoming events and summarizes what it skipped', async () => {
    const save = vi.fn(async () => {})
    const outcome = await importIcsFile(
      file(
        ics(
          'BEGIN:VEVENT',
          'UID:a',
          'DTSTART:20260620T150000Z',
          'SUMMARY:Hike',
          'END:VEVENT',
          'BEGIN:VEVENT',
          'UID:b',
          'DTSTART;VALUE=DATE:20260621',
          'END:VEVENT',
          'BEGIN:VEVENT',
          'UID:c',
          'DTSTART:20260601T150000Z',
          'END:VEVENT',
        ),
      ),
      context(save),
    )
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(save).toHaveBeenCalledWith(outcome.saved)
    expect(outcome.saved).toHaveLength(1)
    expect(outcome.saved[0]).toMatchObject({
      title: 'Hike',
      activityId: 'hike',
      placeGuessed: true,
    })
    expect(importSummary(outcome)).toBe(
      'Imported 1 event. Skipped 1 all-day event, 1 past event. 1 event had no place Solara could find; set it on the event.',
    )
  })

  it('says when a file has nothing upcoming, without saving', async () => {
    const save = vi.fn(async () => {})
    const outcome = await importIcsFile(file(ics()), context(save))
    expect(outcome.ok && importSummary(outcome)).toBe(
      'No upcoming events with a start time were found in that file.',
    )
    expect(save).not.toHaveBeenCalled()
  })

  it('reports a failed save', async () => {
    const outcome = await importIcsFile(
      file(ics('BEGIN:VEVENT', 'UID:a', 'DTSTART:20260620T150000Z', 'END:VEVENT')),
      context(vi.fn(async () => Promise.reject(new Error('denied')))),
    )
    expect(outcome).toEqual({ ok: false, message: expect.stringContaining('Could not save') })
  })
})
