'use client'
import { useEffect, useRef, useState } from 'react'
import type { ScheduledActivity } from '@solara/core'
import {
  buildEventBody,
  CalendarAuthError,
  createCalendarEvent,
  deleteCalendarEvent,
  eventTimes,
  forgetCalendarTokens,
  getCalendarEvent,
  listSolaraEvents,
  patchCalendarEventTime,
  requestWriteToken,
} from '@/lib/gcal'
import { syncWithGoogle } from '@/lib/google-calendar-sync'
import {
  assertScheduledRoom,
  deleteScheduled,
  pruneExpiredScheduled,
  recordFromEvent,
  saveScheduled,
  subscribeScheduled,
} from '@/lib/scheduled'
import type { ScheduledController, SyncChanges, SyncState } from '@/lib/scheduled-context'
import { deviceTimeZone } from '@/lib/time'
import type { Activity } from '@/lib/types'

const GOOGLE = { listSolaraEvents, getCalendarEvent }

/**
 * The scheduled-activities controller for one signed-in account: a live Firestore
 * list of the events Solara created, and Google Calendar calls made with the
 * in-memory `calendar.events.owned` token. Mount it under a component keyed by the
 * uid, so nothing survives an account switch.
 */
export function useGoogleCalendar(
  uid: string,
  activities: readonly Activity[],
): ScheduledController {
  const [items, setItems] = useState<ScheduledActivity[]>([])
  const [sync, setSync] = useState<SyncState>('idle')
  const [lastChanges, setLastChanges] = useState<SyncChanges | null>(null)
  // Read by async actions, so they always see the latest list.
  const itemsRef = useRef<ScheduledActivity[]>([])
  const activitiesRef = useRef(activities)
  const syncing = useRef<Promise<void> | null>(null)

  useEffect(() => {
    activitiesRef.current = activities
  }, [activities])

  useEffect(() => {
    const unsubscribe = subscribeScheduled(
      uid,
      next => {
        itemsRef.current = next
        setItems(next)
      },
      error => console.error('Scheduled activities failed to load:', error),
    )
    // Records that ended over 30 days ago are only history, and the privacy policy says
    // they are deleted; this reaches every one, not only those in the capped live list.
    pruneExpiredScheduled(uid, Date.now()).catch(error =>
      console.error('Pruning scheduled activities failed:', error),
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
    return {
      activities: activitiesRef.current,
      timeZone: deviceTimeZone(),
      now: new Date().toISOString(),
    }
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
      const result = await syncWithGoogle(
        accessToken,
        itemsRef.current,
        context(),
        Date.now(),
        GOOGLE,
      )
      await Promise.all([
        ...result.upserts.map(item => saveScheduled(uid, item)),
        ...result.removals.map(id => deleteScheduled(uid, id)),
      ])
      setLastChanges(result.changes)
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

  return {
    enabled: true,
    items,
    sync,
    lastChanges,
    async schedule({ activity, dateStr, slot, description, timeZone }) {
      // At the per-account cap nothing is added to Google Calendar either.
      await assertScheduledRoom(uid)
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
}
