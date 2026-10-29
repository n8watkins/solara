// Account export and deletion in the browser, for builds without Cloud Functions (the free
// Spark plan, ROADMAP item 33). When the Functions are deployed they stay the path
// (exportAccountData, deleteAccount): they also see server-only records and end billing.
//
// Export reads every document of users/{uid} the rules let the owner read and builds the
// same file as the Function (@solara/core/account-export). The Pro alert history in
// users/{uid}/alertState is server-only and written only by the Functions, so it is
// empty here.
//
// Deletion, after the account page's confirmation and a fresh Google sign-in:
// 1. Stops before deleting anything when the account holds what only the server may
//    remove (selfDeletionBlocker): a Stripe customer or paid plan, notification
//    devices, or a calendar feed or linked calendar record. Without the Functions none of
//    them is ever written, so this only guards data from an earlier setup.
// 2. Deletes every imported event and scheduled activity with its key taken off the key
//    list in the same batch (lib/key-index.ts), as the rules require, then in one batch
//    the emptied key lists, the Google and Outlook connections and the account document.
// 3. Reads everything back, and runs again if anything reappeared (another open tab
//    can still be saving); only when nothing is left does it delete the Auth user.
// Each step can run again, so a deletion that stopped half way is finished by retrying.
//
// Loaded only by the account page, on demand.
import { SCHEDULED_LIMITS } from '@solara/core'
import {
  buildAccountExport,
  EXPORT_COLLECTION_LIMIT,
  type AccountExport,
  type ExportDocument,
  type TruncatedSection,
} from '@solara/core/account-export'
import {
  GOOGLE_CALENDAR_LINK_DOC,
  IMPORTED_EVENT_LIMITS,
  OUTLOOK_CALENDAR_LINK_DOC,
} from '@solara/core/event-import'
import type { User } from 'firebase/auth'
import type { DocumentData, Firestore, QuerySnapshot } from 'firebase/firestore'
import { loadFirebase } from './firebase'
import { listedKeys, removeRecords, storedKeys, type CappedCollection } from './key-index'

/** Why this browser cannot delete the account itself; the account page offers email. */
export type SelfDeletionBlocker = 'billing' | 'server-records'

/** Server-written records under users/{uid}/private that the owner can read. */
const PRIVATE_DOCS = ['calendarFeed', 'eventSubscriptions'] as const

/** Largest list query the rules allow, per collection. */
const LIST_LIMITS = {
  events: IMPORTED_EVENT_LIMITS.listLimit,
  scheduled: SCHEDULED_LIMITS.listLimit,
  notificationDevices: 10,
} as const

type ListedCollection = keyof typeof LIST_LIMITS

const CAPPED: readonly CappedCollection[] = ['events', 'scheduled']

/** How many times deletion runs before it reports what is left. */
const DELETE_ROUNDS = 3

/** What the account holds that decides whether this browser may delete it. */
export interface AccountRecords {
  account: Readonly<Record<string, unknown>> | null
  devices: number
  privateDocs: number
}

/**
 * PURE. Whether the browser must leave the deletion to the server: billing that only the
 * deleteAccount Function can end (the rules refuse the account document's delete too),
 * or server-only records the rules do not let the owner delete.
 */
export function selfDeletionBlocker({
  account,
  devices,
  privateDocs,
}: AccountRecords): SelfDeletionBlocker | null {
  if (account && (account.tier === 'paid' || 'stripeCustomerId' in account)) return 'billing'
  if (devices > 0 || privateDocs > 0) return 'server-records'
  return null
}

/** A deletion step failed; `stage` says how far it got. */
export class SelfDeletionError extends Error {
  constructor(
    /** blocked: nothing deleted; data: some data deleted; sign-in: data deleted, sign-in left. */
    readonly stage: 'blocked' | 'data' | 'sign-in',
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options)
    this.name = 'SelfDeletionError'
  }
}

async function firestore() {
  const db = (await loadFirebase())?.db
  if (!db) throw new Error('Account services are not available.')
  return { db, sdk: await import('firebase/firestore') }
}

type Sdk = Awaited<ReturnType<typeof firestore>>['sdk']

async function readDoc(sdk: Sdk, db: Firestore, ...path: string[]): Promise<DocumentData | null> {
  const [first, ...rest] = path
  const snapshot = await sdk.getDoc(sdk.doc(db, first!, ...rest))
  return snapshot.exists() ? snapshot.data() : null
}

/**
 * A collection's documents in id order, a page at a time within the rules' list limit,
 * stopping at EXPORT_COLLECTION_LIMIT like the Function.
 */
async function readCollection(
  sdk: Sdk,
  db: Firestore,
  uid: string,
  name: ListedCollection,
): Promise<{ docs: ExportDocument[]; truncated: boolean }> {
  const { collection, documentId, getDocs, limit, orderBy, query, startAfter } = sdk
  const records = collection(db, 'users', uid, name)
  const pageSize = LIST_LIMITS[name]
  const docs: ExportDocument[] = []
  let last: string | null = null
  for (;;) {
    const page: QuerySnapshot = await getDocs(
      query(
        records,
        orderBy(documentId()),
        ...(last === null ? [] : [startAfter(last)]),
        limit(pageSize),
      ),
    )
    for (const d of page.docs) docs.push({ id: d.id, data: d.data() })
    if (docs.length >= EXPORT_COLLECTION_LIMIT) {
      return { docs: docs.slice(0, EXPORT_COLLECTION_LIMIT), truncated: page.size === pageSize }
    }
    if (page.size < pageSize) return { docs, truncated: false }
    last = page.docs[page.size - 1]?.id ?? null
  }
}

/** The account data file, read from Firestore by its owner. */
export async function exportAccountInBrowser(uid: string): Promise<AccountExport> {
  const { db, sdk } = await firestore()
  const [account, links, google, outlook, devices, scheduled, events] = await Promise.all([
    readDoc(sdk, db, 'users', uid),
    readDoc(sdk, db, 'users', uid, 'private', 'eventSubscriptions'),
    readDoc(sdk, db, 'users', uid, 'meta', GOOGLE_CALENDAR_LINK_DOC),
    readDoc(sdk, db, 'users', uid, 'meta', OUTLOOK_CALENDAR_LINK_DOC),
    readCollection(sdk, db, uid, 'notificationDevices'),
    readCollection(sdk, db, uid, 'scheduled'),
    readCollection(sdk, db, uid, 'events'),
  ])
  const truncated: TruncatedSection[] = []
  if (devices.truncated) truncated.push('notificationDevices')
  if (scheduled.truncated) truncated.push('scheduledActivities')
  if (events.truncated) truncated.push('importedEvents')
  return buildAccountExport(
    {
      account,
      // Server-only, and written only by the Functions.
      alerts: null,
      eventAlerts: null,
      links,
      google,
      outlook,
      devices: devices.docs,
      scheduled: scheduled.docs,
      events: events.docs,
      truncated,
    },
    new Date(),
  )
}

/** Reads what decides whether this browser may delete the account. */
export async function readAccountRecords(uid: string): Promise<AccountRecords> {
  const { db, sdk } = await firestore()
  const [account, devices, ...privateDocs] = await Promise.all([
    readDoc(sdk, db, 'users', uid),
    sdk.getDocs(sdk.query(sdk.collection(db, 'users', uid, 'notificationDevices'), sdk.limit(1))),
    ...PRIVATE_DOCS.map(name => readDoc(sdk, db, 'users', uid, 'private', name)),
  ])
  return {
    account,
    devices: devices.size,
    privateDocs: privateDocs.filter(Boolean).length,
  }
}

/** The documents of users/{uid} that are still there, as paths (empty when none is). */
export async function remainingAccountData(uid: string): Promise<string[]> {
  const { db, sdk } = await firestore()
  const metaDocs = [...CAPPED, GOOGLE_CALENDAR_LINK_DOC, OUTLOOK_CALENDAR_LINK_DOC]
  const [account, meta] = await Promise.all([
    readDoc(sdk, db, 'users', uid),
    Promise.all(metaDocs.map(name => readDoc(sdk, db, 'users', uid, 'meta', name))),
  ])
  const records: string[] = []
  for (const name of CAPPED) {
    for (const key of await storedKeys(uid, name)) records.push(`users/${uid}/${name}/${key}`)
  }
  return [
    ...(account ? [`users/${uid}`] : []),
    ...metaDocs.flatMap((name, i) => (meta[i] ? [`users/${uid}/meta/${name}`] : [])),
    ...records,
  ]
}

/** One pass over every client-deletable document of users/{uid}. */
async function deletePass(uid: string): Promise<void> {
  // Records first, with their keys, so each key list ends up empty.
  for (const name of CAPPED) {
    const keys = [...new Set([...(await listedKeys(uid, name)), ...(await storedKeys(uid, name))])]
    if (keys.length) await removeRecords(uid, name, keys)
  }
  const { db, sdk } = await firestore()
  const batch = sdk.writeBatch(db)
  for (const name of [...CAPPED, GOOGLE_CALENDAR_LINK_DOC, OUTLOOK_CALENDAR_LINK_DOC]) {
    batch.delete(sdk.doc(db, 'users', uid, 'meta', name))
  }
  batch.delete(sdk.doc(db, 'users', uid))
  await batch.commit()
}

/**
 * Deletes every document of users/{uid}, then the Auth user. `user` must have signed in
 * again just before (reauthenticateWithPopup), as deleteUser requires.
 */
export async function deleteAccountInBrowser(user: User): Promise<void> {
  const uid = user.uid
  const records = await readAccountRecords(uid)
  const blocker = selfDeletionBlocker(records)
  if (blocker) throw new SelfDeletionError('blocked', blocker)

  let left: string[] = []
  try {
    for (let round = 0; round < DELETE_ROUNDS; round++) {
      // A pass can fail when another tab saved a record in between; read back and retry.
      await deletePass(uid).catch(error => {
        if (round === DELETE_ROUNDS - 1) throw error
      })
      left = await remainingAccountData(uid)
      if (left.length === 0) break
    }
  } catch (error) {
    throw new SelfDeletionError('data', 'Some account data could not be deleted.', {
      cause: error,
    })
  }
  if (left.length) {
    throw new SelfDeletionError('data', `${left.length} account documents are left.`)
  }

  const { deleteUser } = await import('firebase/auth')
  try {
    await deleteUser(user)
  } catch (error) {
    throw new SelfDeletionError('sign-in', 'The sign-in could not be deleted.', { cause: error })
  }
}
