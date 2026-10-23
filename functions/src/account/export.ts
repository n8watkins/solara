// Data export: the portable account fields, notification devices and scheduled
// activities, never billing ids, tokens or internal bookkeeping.

import { parseScheduledActivity, PREFERENCE_FIELDS } from '#core'
import type { Auth } from 'firebase-admin/auth'
import type { DocumentData, Firestore, QuerySnapshot } from 'firebase-admin/firestore'
import type { Request } from 'firebase-functions/v2/https'

import { authenticate } from '../shared/auth'
import { HttpError } from '../shared/errors'

// The preferences schema's fields; never billing ids, tokens or internal bookkeeping.
const PORTABLE_ACCOUNT_FIELDS: ReadonlySet<string> = new Set(PREFERENCE_FIELDS)

export function safeAccountData(data: DocumentData | null | undefined): DocumentData {
  return Object.fromEntries(
    Object.entries(data || {}).filter(([key]) => PORTABLE_ACCOUNT_FIELDS.has(key)),
  )
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

export async function exportAccountData({
  auth,
  db,
  req,
}: {
  auth: Auth
  db: Firestore
  req: Request
}) {
  const identity = await authenticate(auth, req.headers.authorization)
  const userRef = db.collection('users').doc(identity.uid)
  const tombstoneRef = db.collection('accountDeletionTombstones').doc(identity.uid)
  const devicesQuery = userRef.collection('notificationDevices')
  const scheduledQuery = userRef.collection('scheduled')
  const { userSnapshot, devicesSnapshot, scheduledSnapshot } = await db.runTransaction(
    async transaction => {
      const tombstone = await transaction.get(tombstoneRef)
      if (tombstone.exists) {
        throw new HttpError('deletion-in-progress', 'Account deletion is in progress')
      }
      const [account, devices, scheduled] = await Promise.all([
        transaction.get(userRef),
        transaction.get(devicesQuery),
        transaction.get(scheduledQuery),
      ])
      return { userSnapshot: account, devicesSnapshot: devices, scheduledSnapshot: scheduled }
    },
  )
  return {
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    account: userSnapshot.exists ? safeAccountData(userSnapshot.data() ?? {}) : null,
    notificationDevices: safeDeviceData(devicesSnapshot),
    scheduledActivities: safeScheduledData(scheduledSnapshot),
  }
}
