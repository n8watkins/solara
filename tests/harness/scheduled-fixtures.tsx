'use client'
// In-memory scheduled activities for the UI harness (?scheduled=synced|reconnect).
// It stands in for components/ScheduledProvider.tsx: the same controller shape, no
// Firestore and no Google, so screenshots of Scheduled items are deterministic.
import { useState, type ReactNode } from 'react'
import type { ScheduledActivity } from '@solara/core'
import { recordFromEvent } from '@/lib/scheduled'
import { ScheduledContext, type ScheduledController, type SyncState } from '@/lib/scheduled-context'
import { zonedInstant } from '@/lib/time'
import { HARNESS_DATE, HARNESS_TIMEZONE } from './clock'

const CREATED = '2026-06-14T17:00:00.000Z'

function at(dateStr: string, hours: number): string {
  return new Date(zonedInstant(dateStr, hours, HARNESS_TIMEZONE)).toISOString()
}

function item(
  eventId: string,
  activityId: string,
  icon: string,
  title: string,
  dateStr: string,
  from: number,
  to: number,
): ScheduledActivity {
  return {
    eventId,
    calendarId: 'primary',
    activityId,
    title,
    icon,
    start: at(dateStr, from),
    end: at(dateStr, to),
    timeZone: HARNESS_TIMEZONE,
    htmlLink: `https://www.google.com/calendar/event?eid=${eventId}`,
    createdAt: CREATED,
    updatedAt: CREATED,
  }
}

/** Running today at 6pm (inside its 6pm-8pm window) and hiking tomorrow at 4pm. */
export function buildScheduled(): ScheduledActivity[] {
  return [
    item('harnessrun1', 'run', '🏃', '🏃 Running: lower-UV window', HARNESS_DATE, 18, 18.75),
    item('harnesshike1', 'hike', '🥾', '🥾 Hiking: lower-UV window', '2026-06-16', 16, 18),
  ]
}

export function HarnessScheduledProvider({
  sync,
  children,
}: {
  sync: Extract<SyncState, 'synced' | 'reconnect'>
  children: ReactNode
}) {
  const [items, setItems] = useState(buildScheduled)
  let next = items.length + 1
  const controller: ScheduledController = {
    enabled: true,
    items,
    sync,
    lastChanges: null,
    async schedule({ activity, dateStr, slot, timeZone }) {
      const id = `harnessnew${next++}`
      const record = recordFromEvent(
        {
          id,
          htmlLink: `https://www.google.com/calendar/event?eid=${id}`,
          summary: `${activity.icon} ${activity.name}: lower-UV window`,
          start: { dateTime: at(dateStr, slot.start), timeZone },
          end: { dateTime: at(dateStr, slot.end), timeZone },
          extendedProperties: { private: { solara: '1', solaraActivityId: activity.id } },
        },
        { timeZone, now: CREATED, activities: [activity] },
      )
      if (!record) throw new Error('fixture event is invalid')
      setItems(current => [...current, record])
      return record
    },
    async reschedule(target, { dateStr, start, end }) {
      setItems(current =>
        current.map(i =>
          i.eventId === target.eventId
            ? { ...i, start: at(dateStr, start), end: at(dateStr, end) }
            : i,
        ),
      )
    },
    async remove(target) {
      setItems(current => current.filter(i => i.eventId !== target.eventId))
    },
    refresh: async () => {},
  }
  return <ScheduledContext value={controller}>{children}</ScheduledContext>
}
