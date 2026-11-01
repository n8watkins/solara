// Operations Cloud Functions: the maintenance job. The budget kill switch, `budgetAlert`,
// is in budget-guard.ts, which can also deploy on its own (src/index.ts).

import { getAuth } from 'firebase-admin/auth'
import { logger } from 'firebase-functions/logger'
import { onSchedule } from 'firebase-functions/v2/scheduler'

import { processPendingAccountDeletions } from '../account/deletion'
import { pruneSelfDeletionMarkers } from '../account/self-deletion'
import { backfillBillingResourcePage } from '../billing/backfill'
import { endExpiredGracePeriods } from '../billing/grace'
import { processPendingCheckoutCleanups } from '../billing/checkout'
import { STRIPE_SECRET_KEY, stripeClient } from '../billing/config'
import { db, serverTimestamp } from '../shared/firebase'
import { scheduleOptions } from '../shared/options'
import { runMaintenance } from './maintenance'

/** Each run walks at most this many backfill pages; a completed backfill costs one read. */
const BACKFILL_PAGES_PER_RUN = 5

export const maintenance = onSchedule(
  scheduleOptions('every 5 minutes', { timeoutSeconds: 300, secrets: [STRIPE_SECRET_KEY] }),
  async () => {
    const stripe = stripeClient()
    await runMaintenance([
      {
        // Finishes account deletions, Stripe cancellation and data cleanup.
        name: 'accountDeletions',
        run: () => processPendingAccountDeletions({ auth: getAuth(), db, stripe }),
      },
      {
        // Removes the browser deletions' day-old "just deleted" markers.
        name: 'selfDeletionMarkers',
        run: () => pruneSelfDeletionMarkers({ db }),
      },
      {
        // Neutralizes Checkout Sessions a failed request could not clean up.
        name: 'failedCheckouts',
        run: async () => {
          const results = await processPendingCheckoutCleanups({ db, stripe })
          const failed = results.filter(result => !result.completed).length
          if (failed > 0) logger.warn('failed checkout cleanups will retry', { failed })
          return { processed: results.length, failed }
        },
      },
      {
        // Moves accounts whose past_due grace period ran out to Free.
        name: 'pastDueGrace',
        run: () => endExpiredGracePeriods({ db }),
      },
      {
        // Builds ownership records for Stripe resources created before the index existed.
        name: 'billingResourceBackfill',
        run: async () => {
          let result = { completed: false, processed: 0 }
          for (let page = 0; page < BACKFILL_PAGES_PER_RUN && !result.completed; page += 1) {
            result = await backfillBillingResourcePage({ db, serverTimestamp, stripe })
          }
          return result
        },
      },
    ])
  },
)
