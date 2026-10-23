'use client'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { ScheduledActivity } from '@solara/core'
import {
  buildEventBody,
  CalendarAuthError,
  createCalendarEvent,
  deleteCalendarEvent,
  eventTimes,
  forgetCalendarTokens,
  getCalendarEvent,
  isCalendarConfigured,
  listSolaraEvents,
  patchCalendarEventTime,
  requestWriteToken,
  type GoogleEvent,
} from '@/lib/gcal'
import { firebaseEnabled } from '@/lib/firebase'
import {
  deleteScheduled,
  planReconcile,
  recordFromEvent,
  saveScheduled,
  SCHEDULED_RETENTION_MS,
  subscribeScheduled,
} from '@/lib/scheduled'
import {
  DISABLED_SCHEDULED,
  ScheduledContext,
  type ScheduledController,
  type SyncChanges,
  type SyncState,
} from '@/lib/scheduled-context'
import { deviceTimeZone } from '@/lib/time'
import type { Activity } from '@/lib/types'

/** Google is checked for Solara events from a day ago to past the 10-day forecast. */
const SYNC_PAST_MS = 86_400_000
const SYNC_AHEAD_MS = 12 * 86_400_000

interface Props {
  /** The signed-in account, or null. Switching accounts drops everything in memory. */
  uid: string | null
  /** The account's activities, to decorate events found only in Google. */
  activities: readonly Activity[]
  children: ReactNode
}

/**
 * Supplies the scheduled-activities controller (lib/scheduled-context.ts) for one
 * signed-in account: a live Firestore list, and Google Calendar calls made with the
 * in-memory `calendar.events.owned` token.
 */
export default function ScheduledProvider({ uid, activities, children }: Props) {
  const enabled = !!uid && firebaseEnabled && isCalendarConfigured()
  if (!enabled) {
    return <ScheduledContext value={DISABLED_SCHEDULED}>{children}</ScheduledContext>
  }
  // Keyed by account so nothing (state or refs) survives a switch.
  return (
    <AccountScheduled key={uid} uid={uid} activities={activities}>
      {children}
    </AccountScheduled>
  )
}

function AccountScheduled({
  uid,
  activities,
  children,
}: {
  uid: string
  activities: readonly Activity[]
  children: ReactNode
}) {
  const [items, setItems] = useState<ScheduledActivity[]>([])
  const [sync, setSync] = useState<SyncState>('idle')
  const [lastChanges, setLastChanges] = useState<SyncChanges | null>(null)
  // Read by async actions, so they always see the latest list.
  const itemsRef = useRef<ScheduledActivity[]>([])
  const activitiesRef = useRef(activities)
  const syncing = useRef<Promise<void> | null>(null)
  const pruned = useRef(false)

  useEffect(() => {
    activitiesRef.current = activities
  }, [activities])

  useEffect(() => {
    const unsubscribe = subscribeScheduled(
      uid,
      next => {
        itemsRef.current = next
        setItems(next)
        if (!pruned.current) {
          pruned.current = true
          // Long-past records are only history; drop them so the list stays small.
          const cutoff = Date.now() - SCHEDULED_RETENTION_MS
          for (const item of next) {
            if (Date.parse(item.end) < cutoff) {
              deleteScheduled(uid, item.eventId).catch(error =>
                console.error('Pruning a scheduled activity failed:', error),
              )
            }
          }
        }
      },
      error => console.error('Scheduled activities failed to load:', error),
    )
    return () => {
      unsubscribe()
      // The Google token belongs to this account's session only.
      forgetCalendarTokens()
    }
  }, [uid])

  async function token(interactive: boolean): Promise<string> {
    try {
      return await requestWriteToken({ interactive })
    } catch (error) {
      if (error instanceof CalendarAuthError) setSync('reconnect')
      throw error
    }
  }

  /** Runs a Google call; a refused token switches the sync state to "reconnect". */
  async function withGoogle<T>(run: (accessToken: string) => Promise<T>): Promise<T> {
    const accessToken = await token(true)
    try {
      return await run(accessToken)
    } catch (error) {
      if (error instanceof CalendarAuthError) setSync('reconnect')
      throw error
    }
  }

  function context() {
    return { activities: activitiesRef.current, timeZone: deviceTimeZone(), now: nowIso() }
  }

  async function reconcile(interactive: boolean): Promise<void> {
    setSync('syncing')
    let accessToken: string
    try {
      accessToken = await token(interactive)
    } catch (error) {
      if (!(error instanceof CalendarAuthError)) setSync('error')
      return
    }
    try {
      const now = Date.now()
      const listed = await listSolaraEvents(
        accessToken,
        new Date(now - SYNC_PAST_MS),
        new Date(now + SYNC_AHEAD_MS),
      )
      const found = new Map<string, GoogleEvent | null>(listed.map(e => [e.id, e]))
      // A record the range query did not return was moved out of range or deleted;
      // ask for it by id. Long-finished ones are left alone.
      for (const record of itemsRef.current) {
        if (found.has(record.eventId) || Date.parse(record.end) < now - SYNC_PAST_MS) continue
        found.set(record.eventId, await getCalendarEvent(accessToken, record.eventId))
      }
      const plan = planReconcile(itemsRef.current, found, listed, context())
      await Promise.all([
        ...plan.upserts.map(item => saveScheduled(uid, item)),
        ...plan.removals.map(id => deleteScheduled(uid, id)),
      ])
      const moved = plan.upserts.filter(u =>
        itemsRef.current.some(r => r.eventId === u.eventId),
      ).length
      setLastChanges(
        moved || plan.removals.length ? { moved, removed: plan.removals.length } : null,
      )
      setSync('synced')
    } catch (error) {
      if (error instanceof CalendarAuthError) {
        setSync('reconnect')
        return
      }
      console.error('Syncing scheduled activities failed:', error)
      setSync('error')
    }
  }

  const controller: ScheduledController = {
    enabled: true,
    items,
    sync,
    lastChanges,
    async schedule({ activity, dateStr, slot, description, timeZone }) {
      const body = buildEventBody(activity, dateStr, slot.start, slot.end, description, timeZone)
      const event = await withGoogle(accessToken => createCalendarEvent(accessToken, body))
      const record = recordFromEvent(event, { ...context(), timeZone })
      if (!record) throw new Error('Google returned an event Solara cannot store')
      const withIcon = { ...record, icon: activity.icon || record.icon, activityId: activity.id }
      // Shown at once; the snapshot listener confirms it.
      itemsRef.current = [...itemsRef.current.filter(i => i.eventId !== record.eventId), withIcon]
      setItems(itemsRef.current)
      // A failed write is not fatal: the event is tagged, so the next sync adopts it.
      await saveScheduled(uid, withIcon).catch(error =>
        console.error('Saving a scheduled activity failed:', error),
      )
      return withIcon
    },
    async reschedule(item, { dateStr, start, end, timeZone }) {
      const event = await withGoogle(accessToken =>
        patchCalendarEventTime(
          accessToken,
          item.eventId,
          eventTimes(dateStr, start, end, timeZone),
        ),
      )
      const record = recordFromEvent(event, { ...context(), previous: item })
      if (!record) throw new Error('Google returned an event Solara cannot store')
      await saveScheduled(uid, record)
    },
    async remove(item) {
      await withGoogle(accessToken => deleteCalendarEvent(accessToken, item.eventId))
      await deleteScheduled(uid, item.eventId)
    },
    refresh({ interactive }) {
      // One sync at a time; a second caller waits for the one in flight.
      if (!syncing.current) {
        syncing.current = reconcile(interactive).finally(() => {
          syncing.current = null
        })
      }
      return syncing.current
    },
  }

  return <ScheduledContext value={controller}>{children}</ScheduledContext>
}

function nowIso(): string {
  return new Date().toISOString()
}
