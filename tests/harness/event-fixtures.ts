// In-memory imported events for the UI harness (?events=sample). It stands in for the
// Firestore store in lib/events.ts with the same EventsStore shape, so the Events
// section renders deterministically. Without ?events the store starts empty;
// ?events=full adds past events up to the per-account cap.
import { IMPORTED_EVENT_LIMITS, type ImportedEvent } from '@solara/core/event-import'
import type { EventsSnapshot, EventsStore } from '@/lib/events'
import { fitToCap } from '@/lib/key-index'
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

/** A club ride tomorrow morning from a linked calendar (?links=sample). */
export function buildFeedEvent(): ImportedEvent {
  return event(5, {
    title: 'Saturday club ride',
    source: 'feed',
    feedId: 'a'.repeat(32),
    start: at('2026-06-16', 9),
    end: at('2026-06-16', 11),
    where: 'Santa Monica Pier, Santa Monica, CA',
    lat: 34.01,
    lon: -118.5,
    placeLabel: 'Santa Monica Pier',
    activityId: 'run',
  })
}

/**
 * An EventsStore that keeps everything in memory and notifies subscribers at once. It
 * applies the per-account cap like the Firestore store; `pastStored` adds that many
 * stored events which have already ended (they count, but are not listed), so a
 * harness page can show an account at the cap.
 */
export function createMemoryEventsStore(
  initial: ImportedEvent[] = [],
  { pastStored = 0 }: { pastStored?: number } = {},
): EventsStore {
  let items = new Map(initial.map(item => [item.key, item]))
  let past = pastStored
  const listeners = new Set<(snapshot: EventsSnapshot) => void>()
  const listed = () =>
    new Set([...items.keys(), ...Array.from({ length: past }, (_, i) => `past-${i}`)])
  const emit = () => {
    const list = [...items.values()].sort((a, b) => a.end.localeCompare(b.end))
    for (const listener of listeners) {
      listener({ items: list.slice(0, IMPORTED_EVENT_LIMITS.listLimit), stored: items.size + past })
    }
  }
  return {
    subscribe(_uid, _nowMs, onChange) {
      listeners.add(onChange)
      queueMicrotask(emit)
      return () => listeners.delete(onChange)
    },
    async save(_uid, records) {
      const { fit, refused } = fitToCap(
        records,
        r => r.key,
        listed(),
        IMPORTED_EVENT_LIMITS.maxStored,
      )
      items = new Map(items)
      for (const record of fit) items.set(record.key, record)
      emit()
      return refused
    },
    async remove(_uid, keys) {
      items = new Map(items)
      for (const key of keys) items.delete(key)
      emit()
    },
    async removeImported() {
      const kept = [...items.values()].filter(item => item.source !== 'file')
      const count = items.size - kept.length + past
      items = new Map(kept.map(item => [item.key, item]))
      past = 0
      emit()
      return count
    },
    async seriesEvents(_uid, seriesIds) {
      const ids = new Set(seriesIds)
      return [...items.values()].filter(item => ids.has(item.seriesId))
    },
    async sourceEvents(_uid, source) {
      return [...items.values()].filter(item => item.source === source)
    },
    async upcoming(_uid, nowMs) {
      return [...items.values()].filter(item => Date.parse(item.end) > nowMs)
    },
    async countUpcoming(_uid, source, nowMs) {
      return [...items.values()].filter(
        item => item.source === source && Date.parse(item.end) > nowMs,
      ).length
    },
    async storedKeys() {
      return listed()
    },
    async prune() {
      return 0
    },
  }
}
