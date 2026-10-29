// Per-account record caps (REVIEW4 M4): the key-list maths every client and Function
// that writes capped records must get exactly right. Security rules cannot count a
// collection, so users/{uid}/meta/{collection} lists the key of every record in
// users/{uid}/{collection} (`ids`, a map of key to true), and firestore.rules hold the
// two together:
//
// - a record can be created or rewritten only in a batched write that lists its key;
// - the list holds at most the collection's cap (KEY_INDEX_CAPS);
// - a key leaves the list only in a write that names it in `removed` (at most
//   KEY_INDEX_MAX_REMOVED keys) and after which its record does not exist.
//
// The caps themselves are in record-caps.ts. This module is pure and imports nothing
// else, so it adds no record schemas to a bundle: the web app's Firestore code
// (lib/key-index.ts), the Functions that write linked calendars' events
// (functions/src/events/subscriptions.ts) and a native client share it. firestore.rules
// repeat the numbers, and lib/firestore-rules.test.ts checks that they match.
import { RECORD_CAPS, RECORD_LIST_LIMITS } from './record-caps'

/** Collections with a per-account cap. */
export type CappedCollection = 'events' | 'scheduled'

/** The document under users/{uid}/meta that lists each collection's keys. */
export const KEY_INDEX_DOC: Readonly<Record<CappedCollection, string>> = Object.freeze({
  events: 'events',
  scheduled: 'scheduled',
})

/** Most records each collection may hold per account (firestore.rules repeats these). */
export const KEY_INDEX_CAPS: Readonly<Record<CappedCollection, number>> = RECORD_CAPS

/** Most keys one write may take off the list (firestore.rules checks each one). */
export const KEY_INDEX_MAX_REMOVED = 8

/** Most record writes in one batch (Firestore allows 500 operations, the list is one). */
export const KEY_INDEX_PUT_BATCH = 400

/** Largest list query each collection's rules allow. */
export const KEY_INDEX_LIST_LIMITS: Readonly<Record<CappedCollection, number>> = RECORD_LIST_LIMITS

/** The keys a stored list document holds (its `ids` map); empty for none or a bad shape. */
export function listedKeysOf(data: { ids?: unknown } | null | undefined): Set<string> {
  const ids = data?.ids
  return new Set(ids && typeof ids === 'object' ? Object.keys(ids) : [])
}

/** Splits `items` into equal-size chunks (the last may be shorter). */
export function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/**
 * Which items fit under the cap: every item already listed (a rewrite), then new ones in
 * the order given until the list is full.
 */
export function fitToCap<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
  listed: ReadonlySet<string>,
  cap: number,
): { fit: T[]; refused: T[] } {
  const fit: T[] = []
  const refused: T[] = []
  const added = new Set<string>()
  for (const item of items) {
    const key = keyOf(item)
    if (listed.has(key) || added.has(key)) fit.push(item)
    else if (listed.size + added.size < cap) {
      added.add(key)
      fit.push(item)
    } else refused.push(item)
  }
  return { fit, refused }
}

/** How to bring a list in line with the stored records (see reconcilePlan). */
export interface ReconcilePlan {
  /** Listed keys whose records are gone (Firestore's TTL policy deleted them): take them off. */
  gone: string[]
  /** Listed keys whose records exist: they stay. */
  kept: string[]
  /** Records stored before the list existed: list them, as far as the cap allows. */
  unlisted: string[]
}

/** The changes that make the list match the stored records within `cap`. */
export function reconcilePlan(
  listed: ReadonlySet<string>,
  stored: ReadonlySet<string>,
  cap: number,
): ReconcilePlan {
  const gone = [...listed].filter(key => !stored.has(key))
  const kept = [...listed].filter(key => stored.has(key))
  const room = Math.max(0, cap - kept.length)
  const unlisted = [...stored].filter(key => !listed.has(key)).slice(0, room)
  return { gone, kept, unlisted }
}
