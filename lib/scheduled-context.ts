// The scheduled-activities controller shared by the dashboard and the calendar.
// components/ScheduledProvider.tsx supplies the real one (Firestore and Google
// Calendar); the UI harness supplies an in-memory one. Without a provider, scheduling
// is off and the app falls back to plain "add to calendar" links.
import { createContext, useContext } from 'react'
import type { ScheduledActivity } from '@solara/core'
import type { SlotRecommendation } from '@solara/core/scheduler'
import type { Activity } from './types'

export type SyncState =
  /** Nothing checked yet in this session. */
  | 'idle'
  | 'syncing'
  /** Matches Google as of the last check. */
  | 'synced'
  /** No usable Google token: stored items show, and a click reconnects. */
  | 'reconnect'
  | 'error'

export interface ScheduleRequest {
  activity: Activity
  /** The local date, YYYY-MM-DD, in `timeZone`. */
  dateStr: string
  slot: Pick<SlotRecommendation, 'start' | 'end'>
  /** Event description (see buildEventDescription). */
  description: string
  /** The forecast location's IANA zone. */
  timeZone: string
}

export interface RescheduleRequest {
  dateStr: string
  /** New start and end, fractional hours in `timeZone`. */
  start: number
  end: number
  timeZone: string
}

/** What a sync changed, to tell the person. */
export interface SyncChanges {
  moved: number
  removed: number
}

export interface ScheduledController {
  /** Scheduling through the Google Calendar API is available (configured and signed in). */
  enabled: boolean
  /** Stored scheduled activities, by start time. */
  items: ScheduledActivity[]
  sync: SyncState
  /** What the last sync changed, if anything. */
  lastChanges: SyncChanges | null
  /** Creates the Google event and the record. */
  schedule: (request: ScheduleRequest) => Promise<ScheduledActivity>
  /** Moves the Google event and updates the record. */
  reschedule: (item: ScheduledActivity, request: RescheduleRequest) => Promise<void>
  /** Deletes the Google event and the record. */
  remove: (item: ScheduledActivity) => Promise<void>
  /**
   * Reconciles the records with Google. `interactive: false` uses only a token already
   * in memory (no popup), so it can run on its own; `true` needs a click.
   */
  refresh: (options: { interactive: boolean }) => Promise<void>
}

async function unavailable(): Promise<never> {
  throw new Error('Scheduling is not available')
}

export const DISABLED_SCHEDULED: ScheduledController = {
  enabled: false,
  items: [],
  sync: 'idle',
  lastChanges: null,
  schedule: unavailable,
  reschedule: unavailable,
  remove: unavailable,
  refresh: async () => {},
}

export const ScheduledContext = createContext<ScheduledController>(DISABLED_SCHEDULED)

export function useScheduled(): ScheduledController {
  return useContext(ScheduledContext)
}
