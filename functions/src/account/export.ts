// Data export: the portable account fields, a billing summary, notification devices,
// scheduled activities, imported events, linked calendars (their host and label, never
// the link), the Google and Outlook calendars events are read from and the Pro alert
// history, never billing ids, tokens or internal bookkeeping. The file itself is built by
// @solara/core/account-export, which the account page also uses when Functions are off.
//
// The collections a person can fill from the browser (imported events, scheduled
// activities) are read in pages of EXPORT_PAGE_SIZE documents and kept as plain data
// page by page, so the single 256 MiB instance never holds a whole collection of
// Firestore snapshots, and each is capped at EXPORT_COLLECTION_LIMIT documents with the
// cut-short sections named in `truncated` (REVIEW4 M4).

import {
  buildAccountExport,
  EXPORT_COLLECTION_LIMIT,
  type ExportDocument,
  type TruncatedSection,
} from '#core/account-export'
import { GOOGLE_CALENDAR_LINK_DOC, OUTLOOK_CALENDAR_LINK_DOC } from '#core/event-import'
import type { Auth } from 'firebase-admin/auth'
import {
  type CollectionReference,
  FieldPath,
  type Firestore,
  type Query,
  type QueryDocumentSnapshot,
  type Transaction,
} from 'firebase-admin/firestore'
import type { Request } from 'firebase-functions/v2/https'

import { authenticate, uidLimiter } from '../shared/auth'
import { SUMMARY_DOC as EVENT_SUBSCRIPTIONS_DOC } from '../events/subscriptions'
import {
  ALERT_STATE_COLLECTION,
  ALERT_STATE_DOC,
  EVENT_ALERT_STATE_DOC,
} from '../notifications/alerts'
import { HttpError } from '../shared/errors'

// The file's shape and filtering live in @solara/core/account-export, which the account
// page also uses to build the same file in the browser when Functions are not deployed.
export {
  alertHistory,
  EXPORT_COLLECTION_LIMIT,
  eventHeadsUpHistory,
  exportBillingSummary as billingSummary,
  safeAccountData,
} from '#core/account-export'

/** An export reads every account document, so it is held to a few a minute. */
const exportLimiter = uidLimiter(3)

/** Documents read per query while exporting a collection. */
export const EXPORT_PAGE_SIZE = 200

export interface ExportLimits {
  pageSize: number
  collectionLimit: number
}

const DEFAULT_LIMITS: ExportLimits = {
  pageSize: EXPORT_PAGE_SIZE,
  collectionLimit: EXPORT_COLLECTION_LIMIT,
}

type Docs = readonly QueryDocumentSnapshot[]

/**
 * Reads a collection in document id order, one page at a time, keeping only what
 * `convert` returns for each page. At most `collectionLimit` documents are read (invalid
 * ones count too, so a collection of junk cannot make the export slow); `truncated` says
 * whether more were left.
 */
async function readPaged<T>(
  transaction: Transaction,
  collection: CollectionReference,
  convert: (docs: Docs) => T[],
  { pageSize, collectionLimit }: ExportLimits,
): Promise<{ records: T[]; truncated: boolean }> {
  const records: T[] = []
  const ordered = collection.orderBy(FieldPath.documentId())
  let lastId: string | null = null
  let scanned = 0
  for (;;) {
    const remaining = collectionLimit - scanned
    // One document past the limit, to tell a full collection from a longer one.
    const take = Math.min(pageSize, remaining + 1)
    const query: Query = lastId === null ? ordered : ordered.startAfter(lastId)
    const { docs } = await transaction.get(query.limit(take))
    if (docs.length > remaining) {
      records.push(...convert(docs.slice(0, remaining)))
      return { records, truncated: true }
    }
    records.push(...convert(docs))
    scanned += docs.length
    const last = docs.at(-1)
    if (!last || docs.length < take) return { records, truncated: false }
    lastId = last.id
  }
}

/** Plain id and data of each document, so no page of snapshots is kept. */
function plain(docs: Docs): ExportDocument[] {
  return docs.map(doc => ({ id: doc.id, data: doc.data() }))
}

export async function exportAccountData({
  auth,
  db,
  req,
  limits = DEFAULT_LIMITS,
}: {
  auth: Auth
  db: Firestore
  req: Request
  limits?: ExportLimits
}) {
  const identity = await authenticate(auth, req.headers.authorization, {
    limiter: exportLimiter,
  })
  const userRef = db.collection('users').doc(identity.uid)
  const tombstoneRef = db.collection('accountDeletionTombstones').doc(identity.uid)
  const alertStateRef = userRef.collection(ALERT_STATE_COLLECTION).doc(ALERT_STATE_DOC)
  const eventAlertsRef = userRef.collection(ALERT_STATE_COLLECTION).doc(EVENT_ALERT_STATE_DOC)
  const linksRef = userRef.collection('private').doc(EVENT_SUBSCRIPTIONS_DOC)
  const googleRef = userRef.collection('meta').doc(GOOGLE_CALENDAR_LINK_DOC)
  const outlookRef = userRef.collection('meta').doc(OUTLOOK_CALENDAR_LINK_DOC)
  // A read-only transaction: every page comes from the same snapshot, and nothing is locked.
  const sections = await db.runTransaction(
    async transaction => {
      const tombstone = await transaction.get(tombstoneRef)
      if (tombstone.exists) {
        throw new HttpError('deletion-in-progress', 'Account deletion is in progress')
      }
      const [account, alerts, eventAlerts, links, google, outlook, devices, scheduled, events] =
        await Promise.all([
          transaction.get(userRef),
          transaction.get(alertStateRef),
          transaction.get(eventAlertsRef),
          transaction.get(linksRef),
          transaction.get(googleRef),
          transaction.get(outlookRef),
          readPaged(transaction, userRef.collection('notificationDevices'), plain, limits),
          readPaged(transaction, userRef.collection('scheduled'), plain, limits),
          readPaged(transaction, userRef.collection('events'), plain, limits),
        ])
      return {
        account: account.exists ? (account.data() ?? {}) : null,
        alerts: alerts.exists ? (alerts.data() ?? null) : null,
        eventAlerts: eventAlerts.exists ? (eventAlerts.data() ?? null) : null,
        links: links.exists ? (links.data() ?? null) : null,
        google: google.exists ? (google.data() ?? null) : null,
        outlook: outlook.exists ? (outlook.data() ?? null) : null,
        devices,
        scheduled,
        events,
      }
    },
    { readOnly: true },
  )
  const truncated: TruncatedSection[] = []
  if (sections.devices.truncated) truncated.push('notificationDevices')
  if (sections.scheduled.truncated) truncated.push('scheduledActivities')
  if (sections.events.truncated) truncated.push('importedEvents')
  return buildAccountExport(
    {
      account: sections.account,
      alerts: sections.alerts,
      eventAlerts: sections.eventAlerts,
      links: sections.links,
      google: sections.google,
      outlook: sections.outlook,
      devices: sections.devices.records,
      scheduled: sections.scheduled.records,
      events: sections.events.records,
      truncated,
    },
    new Date(),
  )
}
