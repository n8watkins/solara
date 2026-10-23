// The Admin SDK app and the Firestore handle every deployed function uses.
//
// Only the function definitions (`*/functions.ts`) import this module; the business logic
// takes `db` and the other services as arguments so tests can pass fakes without
// initializing the Admin SDK.

import { getApps, initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'

if (getApps().length === 0) initializeApp()

export const db = getFirestore()

export const serverTimestamp = (): FieldValue => FieldValue.serverTimestamp()
