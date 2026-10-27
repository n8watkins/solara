// Account Cloud Functions: data export and account deletion. The scheduled deletion
// cleanup runs in the maintenance job (ops/functions.ts).

import { getAuth } from 'firebase-admin/auth'
import { onRequest } from 'firebase-functions/v2/https'

import { STRIPE_SECRET_KEY, stripeClient } from '../billing/config'
import { browserApi } from '../shared/browser-api'
import { db } from '../shared/firebase'
import { httpOptions } from '../shared/options'
import { deleteAccount as deleteAccountData } from './deletion'
import { exportAccountData as exportAccount } from './export'

export const exportAccountData = onRequest(
  httpOptions({ maxInstances: 3, timeoutSeconds: 30 }),
  browserApi({
    name: 'exportAccountData',
    method: 'GET',
    appCheckMode: 'standard',
    fallbackMessage: 'Export unavailable',
    handler: async req => ({ body: await exportAccount({ auth: getAuth(), db, req }) }),
  }),
)

export const deleteAccount = onRequest(
  httpOptions({ maxInstances: 3, timeoutSeconds: 60, secrets: [STRIPE_SECRET_KEY] }),
  browserApi({
    name: 'deleteAccount',
    method: 'DELETE',
    appCheckMode: 'limited-use',
    fallbackMessage: 'Deletion unavailable',
    handler: async req => {
      const result = await deleteAccountData({ auth: getAuth(), db, req, stripe: stripeClient() })
      return {
        status: result.completed ? 200 : 202,
        body: { deleted: result.completed, deletionPending: !result.completed },
      }
    },
  }),
)
