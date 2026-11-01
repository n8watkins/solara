// Where an account's enrolment in the daily UV push is kept (daily-uv.ts): one document,
// `users/{uid}/alertSchedule/dailyUv`, whose `dueAt` says when the alerts job next looks
// at the account. Device registration (devices.ts) creates it.

import type { DocumentReference } from 'firebase-admin/firestore'

export const ALERT_SCHEDULE_COLLECTION = 'alertSchedule'
export const DAILY_UV_SCHEDULE_DOC = 'dailyUv'

/** The schedule document that enrols an account in the daily UV push. */
export function dailyUvScheduleRef(userRef: DocumentReference): DocumentReference {
  return userRef.collection(ALERT_SCHEDULE_COLLECTION).doc(DAILY_UV_SCHEDULE_DOC)
}

/**
 * `users/{uid}/private/notificationDevices`: written with every device registration and
 * removed only with the account, so firestore.rules can refuse the browser's own
 * account deletion while the account may hold devices and their token owner records,
 * which only the deleteAccount Function removes (rules cannot tell whether a collection
 * is empty; REVIEW9 SEC9 L1).
 */
export const DEVICE_RECORDS_DOC = 'notificationDevices'

/** The marker that the account has (or had) notification devices. */
export function deviceRecordsRef(userRef: DocumentReference): DocumentReference {
  return userRef.collection('private').doc(DEVICE_RECORDS_DOC)
}
