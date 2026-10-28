// Data export: the portable account fields, a billing summary, notification devices,
// scheduled activities, imported events, linked calendars (their host and label, never
// the link) and the Pro alert history, never billing ids, tokens or internal bookkeeping.
//
// The collections a person can fill from the browser (imported events, scheduled
// activities) are read in pages of EXPORT_PAGE_SIZE documents and turned into plain
// records page by page, so the single 256 MiB instance never holds a whole collection
// of Firestore snapshots, and each is capped at EXPORT_COLLECTION_LIMIT documents with
// the cut-short sections named in `truncated` (REVIEW4 M4).

import { parseScheduledActivity, PREFERENCE_FIELDS } from '#core'
import { parseImportedEvent, parseSubscriptionSummaries } from '#core/event-import'
import type { Auth } from 'firebase-admin/auth'
import {
  type CollectionReference,
  type DocumentData,
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
import { toMillis } from '../shared/time'

/** An export reads every account document, so it is held to a few a minute. */
const exportLimiter = uidLimiter(3)

// The preferences schema's fields; never billing ids, tokens or internal bookkeeping.
const PORTABLE_ACCOUNT_FIELDS: ReadonlySet<string> = new Set(PREFERENCE_FIELDS)

export function safeAccountData(data: DocumentData | null | undefined): DocumentData {
  return Object.fromEntries(
    Object.entries(data || {}).filter(([key]) => PORTABLE_ACCOUNT_FIELDS.has(key)),
  )
}

function isoDate(value: unknown): string | null {
  const millis = toMillis(value)
  return Number.isFinite(millis) ? new Date(millis).toISOString() : null
}

/**
 * What the account's subscription is, from the fields billing keeps on the account,
 * without any Stripe identifier: the plan, its state, and the dates that matter.
 */
export function billingSummary(data: DocumentData | null | undefined) {
  const interval = data?.subscriptionPlan
  return {
    plan: data?.tier === 'paid' ? 'pro' : 'free',
    interval: interval === 'monthly' || interval === 'yearly' ? interval : null,
    status: typeof data?.subscriptionStatus === 'string' ? data.subscriptionStatus : null,
    proSince: isoDate(data?.proSince),
    trialEndsAt: isoDate(data?.subscriptionTrialEnd),
    currentPeriodEndsAt: isoDate(data?.subscriptionCurrentPeriodEnd),
    cancelsAtPeriodEnd: data?.subscriptionCancelAtPeriodEnd === true,
    paymentFailedSince: isoDate(data?.pastDueSince),
    freeTrialUsed: data?.stripeTrialUsed === true,
  }
}

/** Documents read per query while exporting a collection. */
export const EXPORT_PAGE_SIZE = 200

/**
 * The most documents exported per collection. Well above what the app lets an account
 * keep, so it only cuts short an account that wrote documents around the app.
 */
export const EXPORT_COLLECTION_LIMIT = 5000

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

export function safeDeviceData(docs: Docs) {
  return docs.map(doc => {
    const data = doc.data()
    return {
      id: doc.id,
      enabled: data.enabled === true,
      platform: data.platform || 'unknown',
      createdAt: data.createdAt || null,
      updatedAt: data.updatedAt || null,
      lastDeliveredAt: data.lastDeliveredAt || null,
      lastError: data.lastError || null,
    }
  })
}

/** Scheduled activities (Google Calendar events Solara created), as stored. */
export function safeScheduledData(docs: Docs) {
  return docs.flatMap(doc => {
    const item = parseScheduledActivity(doc.data())
    return item && item.eventId === doc.id ? [item] : []
  })
}

const ALERT_KINDS = ['morning', 'uv'] as const

/**
 * The Pro alerts sent recently (`alertState/daily`, kept 7 days): for each kind, the
 * last local day it was sent for and how that went, without the internal attempt id.
 */
export function alertHistory(data: DocumentData | null | undefined) {
  return ALERT_KINDS.flatMap(kind => {
    const entry = data?.[kind]
    if (!entry || typeof entry !== 'object' || typeof entry.day !== 'string') return []
    return [
      {
        kind,
        day: entry.day,
        status: typeof entry.status === 'string' ? entry.status : null,
        attempts: typeof entry.attempts === 'number' ? entry.attempts : null,
        devicesReached: typeof entry.devices === 'number' ? entry.devices : null,
        sentAt: isoDate(entry.claimedAt),
        finishedAt: isoDate(entry.finishedAt),
        error: typeof entry.error === 'string' ? entry.error : null,
      },
    ]
  })
}

/**
 * The Pro heads-ups sent before events (`alertState/events`, kept 7 days): the event's
 * key and how the delivery went.
 */
export function eventHeadsUpHistory(data: DocumentData | null | undefined) {
  return Object.entries(data ?? {}).flatMap(([field, entry]) => {
    if (!/^[0-9a-f]{32}$/.test(field) || !entry || typeof entry !== 'object') return []
    return [
      {
        eventKey: field,
        status: typeof entry.status === 'string' ? entry.status : null,
        attempts: typeof entry.attempts === 'number' ? entry.attempts : null,
        devicesReached: typeof entry.devices === 'number' ? entry.devices : null,
        sentAt: isoDate(entry.claimedAt),
        finishedAt: isoDate(entry.finishedAt),
      },
    ]
  })
}

/** Events imported from .ics files, as stored (docs/integrations/EVENTS.md). */
export function safeImportedEventData(docs: Docs) {
  return docs.flatMap(doc => {
    const event = parseImportedEvent(doc.data())
    return event && event.key === doc.id ? [event] : []
  })
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
  // A read-only transaction: every page comes from the same snapshot, and nothing is locked.
  const sections = await db.runTransaction(
    async transaction => {
      const tombstone = await transaction.get(tombstoneRef)
      if (tombstone.exists) {
        throw new HttpError('deletion-in-progress', 'Account deletion is in progress')
      }
      const [account, alerts, eventAlerts, links, devices, scheduled, events] = await Promise.all([
        transaction.get(userRef),
        transaction.get(alertStateRef),
        transaction.get(eventAlertsRef),
        transaction.get(linksRef),
        readPaged(transaction, userRef.collection('notificationDevices'), safeDeviceData, limits),
        readPaged(transaction, userRef.collection('scheduled'), safeScheduledData, limits),
        readPaged(transaction, userRef.collection('events'), safeImportedEventData, limits),
      ])
      return {
        account: account.exists ? (account.data() ?? {}) : null,
        alerts: alerts.exists ? (alerts.data() ?? null) : null,
        eventAlerts: eventAlerts.exists ? (eventAlerts.data() ?? null) : null,
        links: links.exists ? (links.data() ?? null) : null,
        devices,
        scheduled,
        events,
      }
    },
    { readOnly: true },
  )
  const truncated = [
    sections.devices.truncated && 'notificationDevices',
    sections.scheduled.truncated && 'scheduledActivities',
    sections.events.truncated && 'importedEvents',
  ].filter(section => section !== false)
  return {
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    account: sections.account ? safeAccountData(sections.account) : null,
    billing: billingSummary(sections.account),
    notificationDevices: sections.devices.records,
    scheduledActivities: sections.scheduled.records,
    alerts: alertHistory(sections.alerts),
    importedEvents: sections.events.records,
    eventHeadsUps: eventHeadsUpHistory(sections.eventAlerts),
    // Linked calendars without their links, which may hold private tokens.
    linkedCalendars: parseSubscriptionSummaries(sections.links),
    truncated,
  }
}
