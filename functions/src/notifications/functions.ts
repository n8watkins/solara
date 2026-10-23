// Notification Cloud Functions: registering and removing a device for morning alerts.

import { getAuth } from 'firebase-admin/auth'
import { onRequest } from 'firebase-functions/v2/https'

import { browserApi } from '../shared/browser-api'
import { db, serverTimestamp } from '../shared/firebase'
import {
  registerNotificationDevice as registerDevice,
  removeNotificationDevice as removeDevice,
} from './devices'

export const registerNotificationDevice = onRequest(
  { timeoutSeconds: 30, maxInstances: 20 },
  browserApi({
    name: 'registerNotificationDevice',
    method: 'POST',
    appCheckMode: 'standard',
    fallbackMessage: 'Registration unavailable',
    handler: async req => ({
      body: await registerDevice({ auth: getAuth(), db, req, serverTimestamp }),
    }),
  }),
)

export const removeNotificationDevice = onRequest(
  { timeoutSeconds: 30, maxInstances: 20 },
  browserApi({
    name: 'removeNotificationDevice',
    method: 'DELETE',
    appCheckMode: 'standard',
    fallbackMessage: 'Removal unavailable',
    handler: async req => ({
      body: await removeDevice({ auth: getAuth(), db, req }),
    }),
  }),
)
