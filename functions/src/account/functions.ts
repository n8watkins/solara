// Account Cloud Functions: data export, account deletion and the scheduled deletion cleanup.

import { getAuth } from 'firebase-admin/auth'
import { logger } from 'firebase-functions/logger'
import { onRequest } from 'firebase-functions/v2/https'
import { onSchedule } from 'firebase-functions/v2/scheduler'

import { STRIPE_SECRET_KEY, stripeClient } from '../billing/config'
import { browserApi } from '../shared/browser-api'
import { loggableError } from '../shared/errors'
import { db } from '../shared/firebase'
import { deleteAccount as deleteAccountData, processPendingAccountDeletions } from './deletion'
import { exportAccountData as exportAccount } from './export'

export const exportAccountData = onRequest(
  { timeoutSeconds: 30, maxInstances: 10 },
  browserApi({
    name: 'exportAccountData',
    method: 'GET',
    appCheckMode: 'standard',
    fallbackMessage: 'Export unavailable',
    handler: async req => ({ body: await exportAccount({ auth: getAuth(), db, req }) }),
  }),
)

export const deleteAccount = onRequest(
  { secrets: [STRIPE_SECRET_KEY], timeoutSeconds: 60, maxInstances: 5 },
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

export const cleanupDeletedAccountBilling = onSchedule(
  { schedule: 'every 5 minutes', secrets: [STRIPE_SECRET_KEY], timeoutSeconds: 300 },
  async () => {
    let results
    try {
      results = await processPendingAccountDeletions({
        auth: getAuth(),
        db,
        stripe: stripeClient(),
      })
    } catch (error) {
      const failures = error instanceof AggregateError ? error.errors : [error]
      logger.error('Deleted account billing cleanup failed', {
        failed: failures.length,
        errors: failures.map(failure => ({
          ...loggableError(failure),
          cause: loggableError((failure as { cause?: unknown } | null)?.cause),
        })),
      })
      throw error
    }
    logger.info('Deleted account billing cleanup pages processed', { results })
  },
)
