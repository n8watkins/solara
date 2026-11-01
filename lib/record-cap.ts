// The error a save throws when the account already holds the most records a collection
// may keep (lib/key-index.ts, REVIEW4 M4). Kept apart from key-index.ts so a screen can
// recognise it without loading the Firestore code.

import type { CappedCollection } from '@solara/core/key-lists'
import { formatNumber } from '@solara/core/i18n'
import m from '@/messages/editor'

/** Collections with a per-account cap. */
export type { CappedCollection }

/** "You have 500 scheduled activities, the most an account can keep. …" */
export function capMessage(collection: CappedCollection, cap: number): string {
  return collection === 'events'
    ? m.capEvents(formatNumber(cap))
    : m.capScheduled(formatNumber(cap))
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
