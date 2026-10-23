// Data export: the portable account fields and notification devices, never billing ids,
// tokens or internal bookkeeping.

import type { Auth } from 'firebase-admin/auth'
import type { DocumentData, Firestore, QuerySnapshot } from 'firebase-admin/firestore'
import type { Request } from 'firebase-functions/v2/https'

import { authenticate } from '../shared/auth'
import { HttpError } from '../shared/errors'

const PORTABLE_ACCOUNT_FIELDS = new Set([
  'activeProfileId',
  'activities',
  'calendarHours',
  'collapsedActivityCategories',
  'hiddenActivitySuggestionIds',
  'location',
  'notificationHour',
  'onboardingComplete',
  'profiles',
  'savedLocations',
  'schemaVersion',
  'showSunPath',
  'skinType',
  'sunscreen',
  'tier',
  'timezone',
  'uid',
  'upgradeInterest',
])

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
  const { userSnapshot, devicesSnapshot } = await db.runTransaction(async transaction => {
    const tombstone = await transaction.get(tombstoneRef)
    if (tombstone.exists) {
      throw new HttpError('deletion-in-progress', 'Account deletion is in progress')
    }
    const [account, devices] = await Promise.all([
      transaction.get(userRef),
      transaction.get(devicesQuery),
    ])
    return { userSnapshot: account, devicesSnapshot: devices }
  })
  return {
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    account: userSnapshot.exists ? safeAccountData(userSnapshot.data() ?? {}) : null,
    notificationDevices: safeDeviceData(devicesSnapshot),
  }
}
