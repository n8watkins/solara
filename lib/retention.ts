// Deletes an account's records that ended more than 30 days ago: imported, linked, Google
// Calendar and Outlook events (lib/events.ts) and scheduled activities (lib/scheduled.ts).
// components/App.tsx runs it once per signed-in visit, whatever shows on screen, so the
// privacy policy's retention promise (lib/privacy-retention.ts) holds on the free plan,
// where Firestore's TTL policies (infra/firestore-ttl.sh) are not on yet.
import { firestoreEventsStore } from './events'
import { pruneExpiredScheduled } from './scheduled'

export interface PruneSteps {
  events: (uid: string, nowMs: number) => Promise<number>
  scheduled: (uid: string, nowMs: number) => Promise<number>
}

const FIRESTORE_STEPS: PruneSteps = {
  events: (uid, nowMs) => firestoreEventsStore.prune(uid, nowMs),
  scheduled: pruneExpiredScheduled,
}

/**
 * Runs both prunes, each on its own, so one failing (offline, or a rules refusal) never
 * stops the other; resolves with how many records each deleted, or the error it hit.
 */
export async function pruneEndedRecords(
  uid: string,
  nowMs: number,
  steps: PruneSteps = FIRESTORE_STEPS,
): Promise<Record<keyof PruneSteps, number | Error>> {
  const [events, scheduled] = await Promise.allSettled([
    steps.events(uid, nowMs),
    steps.scheduled(uid, nowMs),
  ])
  const outcome = (result: PromiseSettledResult<number>) =>
    result.status === 'fulfilled'
      ? result.value
      : result.reason instanceof Error
        ? result.reason
        : new Error(String(result.reason))
  return { events: outcome(events), scheduled: outcome(scheduled) }
}
