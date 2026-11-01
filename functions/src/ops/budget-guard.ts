// The budget kill switch's Cloud Function, `budgetAlert`, and nothing else.
//
// This module is the whole budget guard: src/index.ts loads only it when
// SOLARA_FUNCTION_SET is `budget-guard`, so the guard can deploy on Blaze before (and
// without) the other Functions, their secrets (Stripe, Open-Meteo, the trial history key)
// and their setup. Keep its imports to the kill switch's own code (./budget, the Admin SDK
// handle and the runtime options): functions/test/budget-guard.test.js fails when loading
// it declares a secret or any param the kill switch does not read, or loads another
// feature's code.

import { applicationDefault } from 'firebase-admin/app'
import { logger } from 'firebase-functions/logger'
import { defineBoolean, defineInt, defineString } from 'firebase-functions/params'
import { onMessagePublished } from 'firebase-functions/v2/pubsub'

import { db } from '../shared/firebase'
import { pubSubOptions } from '../shared/options'
import {
  budgetServiceAccount,
  cloudBillingDisabler,
  fromExpectedBudget,
  handleBudgetNotification,
  parseBudgetNotification,
} from './budget'

/**
 * The Pub/Sub topic the Cloud Billing budget publishes to (infra/budget.sh links them).
 * A literal, not a param, so the deploy names the trigger exactly.
 */
const BUDGET_TOPIC = 'budget-alerts'
/** One WARNING per budget period at this percentage of the budget amount. */
const COST_GUARD_WARN_PERCENT = defineInt('COST_GUARD_WARN_PERCENT', { default: 50 })
/** Engage the cost guard at this percentage of the budget amount. */
const COST_GUARD_THRESHOLD_PERCENT = defineInt('COST_GUARD_THRESHOLD_PERCENT', { default: 100 })
/**
 * The hard stop: detach billing at COST_GUARD_DETACH_THRESHOLD_PERCENT. On by default
 * (default, owner may change); the deploy writes `false` only when the
 * COST_GUARD_DETACH_BILLING repository variable is `false`.
 */
const COST_GUARD_DETACH_BILLING = defineBoolean('COST_GUARD_DETACH_BILLING', { default: true })
const COST_GUARD_DETACH_THRESHOLD_PERCENT = defineInt('COST_GUARD_DETACH_THRESHOLD_PERCENT', {
  default: 300,
})
/**
 * The id of the budget infra/budget.sh created (the BUDGET_ID repository variable).
 * Notifications from any other budget are ignored; empty accepts every budget.
 */
const BUDGET_ID = defineString('BUDGET_ID', { default: '' })

export const budgetAlert = onMessagePublished(
  {
    ...pubSubOptions(BUDGET_TOPIC, { timeoutSeconds: 60 }),
    // Its own identity, the only one allowed to detach billing (finding L2).
    ...(budgetServiceAccount() ? { serviceAccount: budgetServiceAccount() } : {}),
  },
  async event => {
    const message = event.data.message
    if (!fromExpectedBudget(message.attributes, BUDGET_ID.value())) {
      // Another budget pointed at the topic, or a message that is not Cloud Billing's.
      logger.error('budgetAlert ignored a notification from another budget', {
        budgetId: message.attributes?.budgetId ?? null,
      })
      return
    }
    const notification = parseBudgetNotification(message.json)
    if (!notification) {
      logger.warn('budgetAlert ignored a message that is not a budget notification')
      return
    }
    const result = await handleBudgetNotification({
      config: {
        warnThreshold: COST_GUARD_WARN_PERCENT.value() / 100,
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
