// Per-account record caps (REVIEW4 M4). Security rules cannot count a collection, so
// users/{uid}/meta/{collection} lists the key of every record in users/{uid}/{collection}
// (`ids`, a map of key to true), and firestore.rules hold the two together:
//
// - a record can be created or rewritten only in a batched write that lists its key;
// - the list holds at most the collection's cap (KEY_INDEX_CAPS);
// - a key leaves the list only in a write that names it in `removed` (at most
//   KEY_INDEX_MAX_REMOVED keys) and after which its record does not exist.
//
// So an account never holds more records than the cap, whatever it writes. Records
// Firestore's TTL policy deletes stay listed until `reconcile` takes their keys off,
// which happens when a save would otherwise not fit; `reconcile` also lists records
// stored before the list existed (the Events section runs it when it sees one). Functions write with the Admin
// SDK, which skips the rules; one that adds or removes these records must update the
// list the same way (phase 2 of docs/integrations/EVENTS.md).
//
// Only the lazily loaded event and scheduled-activity storage imports this; it loads
// Firestore on demand.
import { IMPORTED_EVENT_LIMITS } from '@solara/core/event-import'
import { SCHEDULED_LIMITS } from '@solara/core'
import type { QuerySnapshot } from 'firebase/firestore'
import { loadFirebase } from './firebase'
import { RecordCapError, type CappedCollection } from './record-cap'

export { RecordCapError, type CappedCollection }

/** Most records each collection may hold per account (firestore.rules repeats these). */
export const KEY_INDEX_CAPS: Readonly<Record<CappedCollection, number>> = Object.freeze({
  events: IMPORTED_EVENT_LIMITS.maxStored,
  scheduled: SCHEDULED_LIMITS.maxStored,
})

/** Most keys one write may take off the list (firestore.rules checks each one). */
export const KEY_INDEX_MAX_REMOVED = 8

/** Most record writes in one batch (Firestore allows 500 operations, the list is one). */
const PUT_BATCH = 400

/** Largest list query each collection's rules allow. */
const LIST_LIMITS: Readonly<Record<CappedCollection, number>> = {
  events: IMPORTED_EVENT_LIMITS.listLimit,
  scheduled: SCHEDULED_LIMITS.listLimit,
}

/** PURE. Splits `items` into equal-size chunks (the last may be shorter). */
export function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/**
 * PURE. Which items fit under the cap: every item already listed (a rewrite), then new
 * ones in the order given until the list is full.
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

/** The list document and the records of one collection, with the Firestore functions. */
async function open(uid: string, name: CappedCollection) {
  const db = (await loadFirebase())?.db
  if (!db) throw new Error('Firestore is not configured')
  const firestore = await import('firebase/firestore')
  return {
    firestore,
    db,
    index: firestore.doc(db, 'users', uid, 'meta', name),
    records: firestore.collection(db, 'users', uid, name),
  }
}

/** The keys listed for a collection. */
export async function listedKeys(uid: string, name: CappedCollection): Promise<Set<string>> {
  const { firestore, index } = await open(uid, name)
  const snapshot = await firestore.getDoc(index)
  const ids: unknown = snapshot.data()?.ids
  return new Set(ids && typeof ids === 'object' ? Object.keys(ids) : [])
}

/** Writes records with their keys listed, in batches of PUT_BATCH. */
export async function putRecords(
  uid: string,
  name: CappedCollection,
  records: readonly { key: string; data: Record<string, unknown> }[],
): Promise<void> {
  const { firestore, db, index, records: collection } = await open(uid, name)
  await Promise.all(
    chunks(records, PUT_BATCH).map(slice => {
      const batch = firestore.writeBatch(db)
      for (const { key, data } of slice) batch.set(firestore.doc(collection, key), data)
      const ids = Object.fromEntries(slice.map(({ key }) => [key, true]))
      batch.set(index, { ids, removed: [] }, { merge: true })
      return batch.commit()
    }),
  )
}

/**
 * Deletes records and takes their keys off the list, KEY_INDEX_MAX_REMOVED per batch.
 * The SDK sends the batches in order down one stream, so they need not wait for each
 * other.
 */
export async function removeRecords(
  uid: string,
  name: CappedCollection,
  keys: readonly string[],
  { deleteRecords = true }: { deleteRecords?: boolean } = {},
): Promise<void> {
  const { firestore, db, index, records } = await open(uid, name)
  await Promise.all(
    chunks([...new Set(keys)], KEY_INDEX_MAX_REMOVED).map(slice => {
      const batch = firestore.writeBatch(db)
      if (deleteRecords) for (const key of slice) batch.delete(firestore.doc(records, key))
      const ids = Object.fromEntries(slice.map(key => [key, firestore.deleteField()]))
      batch.set(index, { ids, removed: slice }, { merge: true })
      return batch.commit()
    }),
  )
}

/** Every record key in a collection, read a page at a time. */
export async function storedKeys(uid: string, name: CappedCollection): Promise<Set<string>> {
  const { firestore, records } = await open(uid, name)
  const { documentId, getDocs, limit, orderBy, query, startAfter } = firestore
  const pageSize = LIST_LIMITS[name]
  const keys = new Set<string>()
  let last: string | null = null
  for (;;) {
    const page = query(
      records,
      orderBy(documentId()),
      ...(last === null ? [] : [startAfter(last)]),
      limit(pageSize),
    )
    const snapshot: QuerySnapshot = await getDocs(page)
    for (const d of snapshot.docs) keys.add(d.id)
    if (snapshot.size < pageSize) return keys
    last = snapshot.docs[snapshot.size - 1]?.id ?? null
  }
}

/**
 * Brings the list in line with the stored records: takes off keys whose records are
 * gone (deleted by Firestore's TTL policy) and lists records stored before the list
 * existed, as far as the cap allows. Returns the keys listed afterwards.
 */
export async function reconcile(uid: string, name: CappedCollection): Promise<Set<string>> {
  const [listed, stored] = await Promise.all([listedKeys(uid, name), storedKeys(uid, name)])
  const gone = [...listed].filter(key => !stored.has(key))
  if (gone.length) await removeRecords(uid, name, gone, { deleteRecords: false })
  const kept = [...listed].filter(key => stored.has(key))
  const room = Math.max(0, KEY_INDEX_CAPS[name] - kept.length)
  const unlisted = [...stored].filter(key => !listed.has(key)).slice(0, room)
  if (unlisted.length) {
    const { firestore, index } = await open(uid, name)
    const ids = Object.fromEntries(unlisted.map(key => [key, true]))
    await firestore.setDoc(index, { ids, removed: [] }, { merge: true })
  }
  return new Set([...kept, ...unlisted])
}

/**
 * Saves records within the collection's cap: rewrites always, new records in the order
 * given while there is room. When the list looks full it is reconciled first. Returns
 * the records not saved.
 */
export async function saveWithinCap<T extends { key: string; data: Record<string, unknown> }>(
  uid: string,
  name: CappedCollection,
  records: readonly T[],
): Promise<T[]> {
  const cap = KEY_INDEX_CAPS[name]
  const keyOf = (record: T) => record.key
  let listed = await listedKeys(uid, name)
  let { fit, refused } = fitToCap(records, keyOf, listed, cap)
  if (refused.length) {
    listed = await reconcile(uid, name)
    ;({ fit, refused } = fitToCap(records, keyOf, listed, cap))
  }
  // Records stored before the list existed are listed again by this write.
  await putRecords(uid, name, fit)
  return refused
}
