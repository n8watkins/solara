// In-memory imported events for the UI harness (?events=sample). It stands in for the
// Firestore store in lib/events.ts with the same EventsStore shape, so the Events
// section renders deterministically. Without ?events the store starts empty.
import type { ImportedEvent } from '@solara/core/event-import'
import type { EventsStore } from '@/lib/events'
import { zonedInstant } from '@/lib/time'
import { HARNESS_DATE, HARNESS_TIMEZONE } from './clock'

const CREATED = '2026-06-14T17:00:00.000Z'
/** Balboa Park, San Diego: a second place, whose forecast specs answer themselves. */
export const SAN_DIEGO = { lat: 32.73, lon: -117.15 }

function at(dateStr: string, hours: number): string {
  return new Date(zonedInstant(dateStr, hours, HARNESS_TIMEZONE)).toISOString()
}

function event(
  index: number,
  fields: Partial<ImportedEvent> & Pick<ImportedEvent, 'title' | 'start' | 'end'>,
): ImportedEvent {
  const key = index.toString(16).padStart(32, '0')
  return {
    key,
    source: 'file',
    seriesId: key.replace(/^0/, 'f'),
    timeZone: HARNESS_TIMEZONE,
    where: '',
    lat: 34.05,
    lon: -118.24,
    placeLabel: 'Los Angeles, California',
    placeGuessed: false,
    activityId: '',
    url: '',
    createdAt: CREATED,
    updatedAt: CREATED,
    ...fields,
  }
}

/** A trail run this afternoon, an all-day-ish volleyball game with no place, a picnic in San Diego and a race on Sunday. */
export function buildEvents(): ImportedEvent[] {
  return [
    event(1, {
      title: 'Griffith Park trail run',
      start: at(HARNESS_DATE, 16),
      end: at(HARNESS_DATE, 17.5),
      where: 'Griffith Park, Los Angeles, CA',
      activityId: 'run',
      url: 'https://www.meetup.com/la-trail-runners/events/1/',
    }),
    event(2, {
      title: 'Beach volleyball with the office',
      start: at('2026-06-16', 11),
      end: at('2026-06-16', 14),
      placeGuessed: true,
    }),
    event(3, {
      title: 'Balboa Park picnic',
      start: at('2026-06-16', 12),
      end: at('2026-06-16', 13.5),
      where: 'Balboa Park, San Diego',
      ...SAN_DIEGO,
      placeLabel: 'San Diego, California',
    }),
    event(4, {
      title: 'Rose Bowl Half Marathon',
      start: at('2026-06-21', 6.5),
      end: at('2026-06-21', 9),
      where: 'Rose Bowl, Pasadena, CA',
      lat: 34.16,
      lon: -118.17,
      placeLabel: 'Pasadena, California',
      activityId: 'run',
    }),
  ]
}

/** An EventsStore that keeps everything in memory and notifies subscribers at once. */
export function createMemoryEventsStore(initial: ImportedEvent[] = []): EventsStore {
  let items = new Map(initial.map(item => [item.key, item]))
  const listeners = new Set<(items: ImportedEvent[]) => void>()
  const emit = () => {
    const list = [...items.values()].sort((a, b) => a.start.localeCompare(b.start))
    for (const listener of listeners) listener(list)
  }
  return {
    subscribe(_uid, onItems) {
      listeners.add(onItems)
      queueMicrotask(emit)
      return () => listeners.delete(onItems)
    },
    async save(_uid, records) {
      items = new Map(items)
      for (const record of records) items.set(record.key, record)
      emit()
    },
    async remove(_uid, keys) {
      items = new Map(items)
      for (const key of keys) items.delete(key)
      emit()
    },
    async prune() {
      return 0
    },
  }
}
