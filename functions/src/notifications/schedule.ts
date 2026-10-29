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
