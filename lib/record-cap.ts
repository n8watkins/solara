// The error a save throws when the account already holds the most records a collection
// may keep (lib/key-index.ts, REVIEW4 M4). Kept apart from key-index.ts so a screen can
// recognise it without loading the Firestore code.

import type { CappedCollection } from '@solara/core/key-lists'

/** Collections with a per-account cap. */
export type { CappedCollection }

const NOUNS: Readonly<Record<CappedCollection, string>> = {
  events: 'imported events',
  scheduled: 'scheduled activities',
}

/** "You have 500 scheduled activities, the most an account can keep. …" */
export function capMessage(collection: CappedCollection, cap: number): string {
  const action = collection === 'events' ? 'import more' : 'add more'
  return `You have ${cap.toLocaleString('en-US')} ${NOUNS[collection]}, the most an account can keep. Remove some to ${action}.`
}

export class RecordCapError extends Error {
  constructor(
    readonly collection: CappedCollection,
    readonly cap: number,
  ) {
    super(capMessage(collection, cap))
    this.name = 'RecordCapError'
  }
}
