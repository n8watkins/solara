// Linked calendars for the UI harness (?subscriptions=on&links=sample): an in-memory
// SubscriptionsStore with one working, one failing and one paused link, so every row
// state can be screenshotted without the Functions.
import type { SubscriptionSummary, SubscriptionsStore } from '@/lib/event-subscriptions'
import { normalizeSubscriptionUrl } from '@solara/core/event-import'
import { HARNESS_NOW_MS } from './clock'

const HOUR = 3_600_000
const iso = (ms: number) => new Date(ms).toISOString()

/** Three links: working, failing (backing off) and paused after a week of failures. */
export function buildSubscriptions(): SubscriptionSummary[] {
  return [
    {
      id: 'a'.repeat(32),
      host: 'www.meetup.com',
      label: 'LA Trail Runners',
      status: 'active',
      createdAt: iso(HARNESS_NOW_MS - 30 * 24 * HOUR),
      lastAttemptAt: iso(HARNESS_NOW_MS - 2 * HOUR),
      lastSuccessAt: iso(HARNESS_NOW_MS - 2 * HOUR),
      nextRefreshAt: iso(HARNESS_NOW_MS + 4 * HOUR),
      error: '',
      eventCount: 12,
      refused: 0,
    },
    {
      id: 'b'.repeat(32),
      host: 'races.example.org',
      label: 'SoCal race calendar 2026',
      status: 'failing',
      createdAt: iso(HARNESS_NOW_MS - 20 * 24 * HOUR),
      lastAttemptAt: iso(HARNESS_NOW_MS - 1 * HOUR),
      lastSuccessAt: iso(HARNESS_NOW_MS - 30 * HOUR),
      nextRefreshAt: iso(HARNESS_NOW_MS + 11 * HOUR),
      error: 'timeout',
      eventCount: 5,
      refused: 0,
    },
    {
      id: 'c'.repeat(32),
      host: 'calendar.example.com',
      label: '',
      status: 'paused',
      createdAt: iso(HARNESS_NOW_MS - 15 * 24 * HOUR),
      lastAttemptAt: iso(HARNESS_NOW_MS - 3 * HOUR),
      lastSuccessAt: '',
      nextRefreshAt: '',
      error: 'http-status',
      eventCount: 0,
      refused: 0,
    },
  ]
}

export function createMemorySubscriptionsStore(
  initial: SubscriptionSummary[] = [],
): SubscriptionsStore {
  let items = [...initial]
  const listeners = new Set<(items: SubscriptionSummary[]) => void>()
  const emit = () => {
    for (const listener of listeners) listener([...items])
  }
  return {
    subscribe(_uid, onChange) {
      listeners.add(onChange)
      queueMicrotask(emit)
      return () => listeners.delete(onChange)
    },
    async add(_uid, url) {
      const normalized = normalizeSubscriptionUrl(url)
      if (!normalized.ok) throw new Error('That is not a calendar link.')
      const added: SubscriptionSummary = {
        id: (items.length + 1).toString(16).padStart(32, 'd'),
        host: normalized.host,
        label: 'Club rides',
        status: 'active',
        createdAt: iso(Date.now()),
        lastAttemptAt: iso(Date.now()),
        lastSuccessAt: iso(Date.now()),
        nextRefreshAt: iso(Date.now() + 6 * HOUR),
        error: '',
        eventCount: 3,
        refused: 0,
      }
      items = [...items, added]
      emit()
      return added
    },
    async refresh(_uid, id) {
      const now = iso(Date.now())
      items = items.map(item =>
        item.id === id
          ? { ...item, status: 'active', error: '', lastAttemptAt: now, lastSuccessAt: now }
          : item,
      )
      emit()
      return items.find(item => item.id === id) as SubscriptionSummary
    },
    async remove(_uid, id) {
      items = items.filter(item => item.id !== id)
      emit()
    },
  }
}
