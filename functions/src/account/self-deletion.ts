// The browser's own account deletion (lib/account-self-service.ts) marks the account as
// just deleted, `accountSelfDeletions/{uid}` with the server's time, in the batch that
// deletes the account document; for an hour after, firestore.rules (notJustDeleted) let
// nothing of the account be written again, so another open tab cannot bring it back
// (REVIEW9 SEC9 L3). The marker holds only the uid and that time. It carries no TTL
// field, because a device's clock cannot be trusted to set one, so the maintenance job
// removes markers a day old here.

import type { Firestore } from 'firebase-admin/firestore'

export const SELF_DELETIONS_COLLECTION = 'accountSelfDeletions'

/** Markers are kept this long: well past the hour the rules use them for. */
export const SELF_DELETION_KEEP_MS = 24 * 60 * 60 * 1000

/** Most markers one maintenance run removes; the next run takes the rest. */
export const SELF_DELETION_PRUNE_LIMIT = 200

/** Removes the markers older than SELF_DELETION_KEEP_MS. */
export async function pruneSelfDeletionMarkers({
  db,
  nowMs = Date.now(),
  limit = SELF_DELETION_PRUNE_LIMIT,
}: {
  db: Firestore
  nowMs?: number
  limit?: number
}): Promise<{ removed: number }> {
  const old = await db
    .collection(SELF_DELETIONS_COLLECTION)
    .where('deletedAt', '<', new Date(nowMs - SELF_DELETION_KEEP_MS))
    .limit(limit)
    .get()
  if (old.empty) return { removed: 0 }
  const batch = db.batch()
  for (const marker of old.docs) batch.delete(marker.ref)
  await batch.commit()
  return { removed: old.size }
}
