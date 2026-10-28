// Data export: the portable account fields, a billing summary, notification devices,
// scheduled activities, imported events and the Pro alert history, never billing ids,
// tokens or internal bookkeeping.

import { parseScheduledActivity, PREFERENCE_FIELDS } from '#core'
import { parseImportedEvent } from '#core/event-import'
import type { Auth } from 'firebase-admin/auth'
import type { DocumentData, Firestore, QuerySnapshot } from 'firebase-admin/firestore'
import type { Request } from 'firebase-functions/v2/https'

import { authenticate, uidLimiter } from '../shared/auth'
import { ALERT_STATE_COLLECTION, ALERT_STATE_DOC } from '../notifications/alerts'
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

function safeDeviceData(snapshot: QuerySnapshot) {
  return snapshot.docs.map(doc => {
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
export function safeScheduledData(snapshot: QuerySnapshot) {
  return snapshot.docs.flatMap(doc => {
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

/** Events imported from .ics files, as stored (docs/integrations/EVENTS.md). */
export function safeImportedEventData(snapshot: QuerySnapshot) {
  return snapshot.docs.flatMap(doc => {
    const event = parseImportedEvent(doc.data())
    return event && event.key === doc.id ? [event] : []
  })
}

export async function exportAccountData({
  auth,
  db,
  req,
}: {
  auth: Auth
  db: Firestore
  req: Request
}) {
  const identity = await authenticate(auth, req.headers.authorization, {
    limiter: exportLimiter,
  })
  const userRef = db.collection('users').doc(identity.uid)
  const tombstoneRef = db.collection('accountDeletionTombstones').doc(identity.uid)
  const devicesQuery = userRef.collection('notificationDevices')
  const scheduledQuery = userRef.collection('scheduled')
  const alertStateRef = userRef.collection(ALERT_STATE_COLLECTION).doc(ALERT_STATE_DOC)
  const eventsQuery = userRef.collection('events')
  const { userSnapshot, devicesSnapshot, scheduledSnapshot, alertSnapshot, eventsSnapshot } =
    await db.runTransaction(async transaction => {
      const tombstone = await transaction.get(tombstoneRef)
      if (tombstone.exists) {
        throw new HttpError('deletion-in-progress', 'Account deletion is in progress')
      }
      const [account, devices, scheduled, alerts, events] = await Promise.all([
        transaction.get(userRef),
        transaction.get(devicesQuery),
        transaction.get(scheduledQuery),
        transaction.get(alertStateRef),
        transaction.get(eventsQuery),
      ])
      return {
        userSnapshot: account,
        devicesSnapshot: devices,
        scheduledSnapshot: scheduled,
        alertSnapshot: alerts,
        eventsSnapshot: events,
      }
    })
  return {
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    account: userSnapshot.exists ? safeAccountData(userSnapshot.data() ?? {}) : null,
    billing: billingSummary(userSnapshot.exists ? userSnapshot.data() : null),
    notificationDevices: safeDeviceData(devicesSnapshot),
    scheduledActivities: safeScheduledData(scheduledSnapshot),
    alerts: alertHistory(alertSnapshot.exists ? alertSnapshot.data() : null),
    importedEvents: safeImportedEventData(eventsSnapshot),
  }
}
