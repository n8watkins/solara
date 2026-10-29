// Per-account record caps (REVIEW4 M4), kept in Firestore. The key-list rules and the
// pure maths (caps, what fits, how to reconcile) are in @solara/core
// (packages/core/src/key-lists.ts), shared with the Functions and a native client; this
// module reads and writes the list document and the records in batched writes.
//
// Records Firestore's TTL policy deletes stay listed until `reconcile` takes their keys
// off, which happens when a save would otherwise not fit; `reconcile` also lists records
// stored before the list existed (the Events section runs it when it sees one). Functions
// write with the Admin SDK, which skips the rules; one that adds or removes these records
// must update the list the same way (phase 2 of docs/integrations/EVENTS.md).
//
// Only the lazily loaded event and scheduled-activity storage imports this; it loads
// Firestore on demand.
import {
  KEY_INDEX_CAPS,
  KEY_INDEX_DOC,
  KEY_INDEX_LIST_LIMITS,
  KEY_INDEX_MAX_REMOVED,
  KEY_INDEX_PUT_BATCH,
  chunks,
  fitToCap,
  listedKeysOf,
  reconcilePlan,
} from '@solara/core/key-lists'
import type { QuerySnapshot } from 'firebase/firestore'
import { loadFirebase } from './firebase'
import { RecordCapError, type CappedCollection } from './record-cap'

export { RecordCapError, type CappedCollection }
export { KEY_INDEX_CAPS, KEY_INDEX_MAX_REMOVED, chunks, fitToCap }

/** The list document and the records of one collection, with the Firestore functions. */
async function open(uid: string, name: CappedCollection) {
  const db = (await loadFirebase())?.db
  if (!db) throw new Error('Firestore is not configured')
  const firestore = await import('firebase/firestore')
  return {
    firestore,
    db,
    index: firestore.doc(db, 'users', uid, 'meta', KEY_INDEX_DOC[name]),
    records: firestore.collection(db, 'users', uid, name),
  }
}

/** The keys listed for a collection. */
export async function listedKeys(uid: string, name: CappedCollection): Promise<Set<string>> {
  const { firestore, index } = await open(uid, name)
  const snapshot = await firestore.getDoc(index)
  return listedKeysOf(snapshot.data())
}

/** Writes records with their keys listed, in batches of KEY_INDEX_PUT_BATCH. */
export async function putRecords(
  uid: string,
  name: CappedCollection,
  records: readonly { key: string; data: Record<string, unknown> }[],
): Promise<void> {
  const { firestore, db, index, records: collection } = await open(uid, name)
  await Promise.all(
    chunks(records, KEY_INDEX_PUT_BATCH).map(slice => {
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
  const pageSize = KEY_INDEX_LIST_LIMITS[name]
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
  const { gone, kept, unlisted } = reconcilePlan(listed, stored, KEY_INDEX_CAPS[name])
  if (gone.length) await removeRecords(uid, name, gone, { deleteRecords: false })
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
