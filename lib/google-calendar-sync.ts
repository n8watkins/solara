// One sync of the stored scheduled activities with Google Calendar, without React or
// storage: hooks/useGoogleCalendar.ts supplies the token, the Google calls and the
// writes. Kept here so the decisions can be unit tested with a fake Google.
import type { ScheduledActivity } from '@solara/core'
import type { GoogleEvent } from './gcal'
import type { SyncChanges } from './scheduled-context'
import {
  planReconcile,
  SCHEDULED_RETENTION_MS,
  type RecordContext,
  type ReconcilePlan,
} from './scheduled'

/** Google is checked for Solara events from a day ago to past the 10-day forecast. */
export const SYNC_PAST_MS = 86_400_000
export const SYNC_AHEAD_MS = 12 * 86_400_000

/** The two Google Calendar reads a sync makes (lib/gcal.ts in the app). */
export interface GoogleCalendarReader {
  listSolaraEvents: (token: string, timeMin: Date, timeMax: Date) => Promise<GoogleEvent[]>
  getCalendarEvent: (token: string, eventId: string) => Promise<GoogleEvent | null>
}

export interface SyncResult extends ReconcilePlan {
  /** What the person is told changed, or null when nothing they knew about did. */
  changes: SyncChanges | null
}

/**
 * Compares the records with Google and returns what to write. Solara's events in the
 * sync range are listed; a record the range query did not return was moved out of
 * range or deleted, so it is asked for by id. Long-finished records are left alone.
 */
export async function syncWithGoogle(
  accessToken: string,
  records: readonly ScheduledActivity[],
  context: Omit<RecordContext, 'previous'>,
  nowMs: number,
  google: GoogleCalendarReader,
): Promise<SyncResult> {
  const listed = await google.listSolaraEvents(
    accessToken,
    new Date(nowMs - SYNC_PAST_MS),
    new Date(nowMs + SYNC_AHEAD_MS),
  )
  const found = new Map<string, GoogleEvent | null>(listed.map(e => [e.id, e]))
  for (const record of records) {
    if (found.has(record.eventId) || Date.parse(record.end) < nowMs - SYNC_PAST_MS) continue
    found.set(record.eventId, await google.getCalendarEvent(accessToken, record.eventId))
  }
  const plan = planReconcile(records, found, listed, context)
  const moved = plan.upserts.filter(u => records.some(r => r.eventId === u.eventId)).length
  const removed = plan.removals.length
  return { ...plan, changes: moved || removed ? { moved, removed } : null }
}

/** Records that ended before the retention cutoff: only history, so they are pruned. */
export function expiredRecords(
  records: readonly ScheduledActivity[],
  nowMs: number,
): ScheduledActivity[] {
  const cutoff = nowMs - SCHEDULED_RETENTION_MS
  return records.filter(item => Date.parse(item.end) < cutoff)
}
