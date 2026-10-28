// Operations Cloud Functions: the maintenance job and the budget kill switch.

import { applicationDefault } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { logger } from 'firebase-functions/logger'
import { defineBoolean, defineInt } from 'firebase-functions/params'
import { onMessagePublished } from 'firebase-functions/v2/pubsub'
import { onSchedule } from 'firebase-functions/v2/scheduler'

import { processPendingAccountDeletions } from '../account/deletion'
import { backfillBillingResourcePage } from '../billing/backfill'
import { endExpiredGracePeriods } from '../billing/grace'
import { processPendingCheckoutCleanups } from '../billing/checkout'
import { STRIPE_SECRET_KEY, stripeClient } from '../billing/config'
import { db, serverTimestamp } from '../shared/firebase'
import { pubSubOptions, scheduleOptions } from '../shared/options'
import { cloudBillingDisabler, handleBudgetNotification, parseBudgetNotification } from './budget'
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

/**
 * The Pub/Sub topic the Cloud Billing budget publishes to (infra/budget.sh links them).
 * A literal, not a param, so the deploy names the trigger exactly.
 */
const BUDGET_TOPIC = 'budget-alerts'
/** Engage the cost guard at this percentage of the budget amount. */
const COST_GUARD_THRESHOLD_PERCENT = defineInt('COST_GUARD_THRESHOLD_PERCENT', { default: 100 })
/** Opt-in last resort: detach billing at COST_GUARD_DETACH_THRESHOLD_PERCENT. */
const COST_GUARD_DETACH_BILLING = defineBoolean('COST_GUARD_DETACH_BILLING', { default: false })
const COST_GUARD_DETACH_THRESHOLD_PERCENT = defineInt('COST_GUARD_DETACH_THRESHOLD_PERCENT', {
  default: 200,
})

export const budgetAlert = onMessagePublished(
  pubSubOptions(BUDGET_TOPIC, { timeoutSeconds: 60 }),
  async event => {
    const notification = parseBudgetNotification(event.data.message.json)
    if (!notification) {
      logger.warn('budgetAlert ignored a message that is not a budget notification')
      return
    }
    const result = await handleBudgetNotification({
      config: {
        threshold: COST_GUARD_THRESHOLD_PERCENT.value() / 100,
        detachThreshold: COST_GUARD_DETACH_THRESHOLD_PERCENT.value() / 100,
        detachBilling: COST_GUARD_DETACH_BILLING.value(),
        projectId: process.env.GCLOUD_PROJECT ?? '',
      },
      db,
      disableBilling: cloudBillingDisabler(async () => {
        const { access_token: token } = await applicationDefault().getAccessToken()
        return token
      }),
      notification,
    })
    logger.info('budgetAlert processed', { ratio: result.ratio, actions: result.actions })
  },
)
