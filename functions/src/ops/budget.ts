// The budget kill switch: Cloud Billing budget notifications in, cost guard out.
//
// A Cloud Billing budget publishes its state to a Pub/Sub topic several times a day
// (https://cloud.google.com/billing/docs/how-to/budgets-programmatic-notifications).
// When the month's cost passes COST_GUARD_THRESHOLD times the budget, this engages the
// cost guard (shared/cost-guard.ts), which turns off the paths whose cost grows with
// traffic. When a new budget period starts below the threshold, it releases the guard
// again, unless the owner pinned it.
//
// As an opt-in last resort (COST_GUARD_DETACH_BILLING=true), a cost past
// COST_GUARD_DETACH_THRESHOLD times the budget detaches the project from its billing
// account, which stops every paid service, Hosting and Firestore included, until the
// owner re-attaches it (docs/RUNBOOK.md, "Budget kill switch").

import type { Firestore } from 'firebase-admin/firestore'
import { logger } from 'firebase-functions/logger'

import { COST_GUARD_COLLECTION, COST_GUARD_DOC } from '../shared/cost-guard'
import { loggableError } from '../shared/errors'

/** The fields of a budget notification this switch reads. */
export interface BudgetNotification {
  budgetDisplayName: string
  costAmount: number
  budgetAmount: number
  costIntervalStart: string
  currencyCode: string
}

/** A budget notification from a Pub/Sub message's JSON, or null when it is not one. */
export function parseBudgetNotification(json: unknown): BudgetNotification | null {
  const data = json as Record<string, unknown> | null
  if (!data || typeof data !== 'object') return null
  const { costAmount, budgetAmount, costIntervalStart } = data
  if (typeof costAmount !== 'number' || !Number.isFinite(costAmount) || costAmount < 0) return null
  if (typeof budgetAmount !== 'number' || !Number.isFinite(budgetAmount) || budgetAmount <= 0) {
    return null
  }
  if (typeof costIntervalStart !== 'string' || !costIntervalStart) return null
  return {
    budgetDisplayName: typeof data.budgetDisplayName === 'string' ? data.budgetDisplayName : '',
    costAmount,
    budgetAmount,
    costIntervalStart,
    currencyCode: typeof data.currencyCode === 'string' ? data.currencyCode : '',
  }
}

export interface KillSwitchConfig {
  /** Engage the cost guard at this share of the budget (1 = the whole budget). */
  threshold: number
  /** Detach billing (opt-in) at this share of the budget. */
  detachThreshold: number
  detachBilling: boolean
  projectId: string
}

export type KillSwitchAction = 'none' | 'engaged' | 'released' | 'detached'

export interface KillSwitchResult {
  ratio: number
  actions: KillSwitchAction[]
}

/** Removes the project's billing account; injected so tests never reach Cloud Billing. */
export type DisableBilling = (projectId: string) => Promise<void>

export async function handleBudgetNotification({
  config,
  db,
  disableBilling,
  notification,
  now = new Date(),
}: {
  config: KillSwitchConfig
  db: Firestore
  disableBilling: DisableBilling
  notification: BudgetNotification
  now?: Date
}): Promise<KillSwitchResult> {
  const ratio = notification.costAmount / notification.budgetAmount
  const ref = db.collection(COST_GUARD_COLLECTION).doc(COST_GUARD_DOC)
  const fields = {
    budget: notification.budgetDisplayName,
    costAmount: notification.costAmount,
    budgetAmount: notification.budgetAmount,
    currencyCode: notification.currencyCode,
    costIntervalStart: notification.costIntervalStart,
    ratio,
  }

  const action = await db.runTransaction(async (transaction): Promise<KillSwitchAction> => {
    const current = (await transaction.get(ref)).data() ?? {}
    if (ratio >= config.threshold) {
      if (
        current.engaged === true &&
        current.costIntervalStart === notification.costIntervalStart
      ) {
        return 'none'
      }
      transaction.set(
        ref,
        { ...fields, engaged: true, engagedAt: now, reason: 'budget', updatedAt: now },
        { merge: true },
      )
      return current.engaged === true ? 'none' : 'engaged'
    }
    // Below the threshold: a guard the budget engaged in an earlier period is released
    // once the new period starts. A guard engaged in this period stays on, because
    // cost never goes down within a period: a lower figure means a different budget
    // filter or a correction, and the owner decides those (docs/RUNBOOK.md).
    if (
      current.engaged === true &&
      current.reason === 'budget' &&
      current.costIntervalStart !== notification.costIntervalStart
    ) {
      transaction.set(
        ref,
        { ...fields, engaged: false, releasedAt: now, reason: null, updatedAt: now },
        { merge: true },
      )
      return 'released'
    }
    return 'none'
  })

  const actions: KillSwitchAction[] = [action]
  if (action === 'engaged') {
    // An ERROR log is the alert hook: the error-log alert (docs/RUNBOOK.md) reaches the owner.
    logger.error('cost guard engaged by the budget', fields)
  } else if (action === 'released') {
    logger.warn('cost guard released for a new budget period', fields)
  }

  if (config.detachBilling && ratio >= config.detachThreshold) {
    try {
      await disableBilling(config.projectId)
      actions.push('detached')
      logger.error('billing detached by the budget kill switch', {
        ...fields,
        projectId: config.projectId,
      })
    } catch (error) {
      logger.error('billing could not be detached by the budget kill switch', {
        ...fields,
        projectId: config.projectId,
        error: loggableError(error),
      })
      throw error
    }
  }
  return { ratio, actions: actions.filter(entry => entry !== 'none') }
}

/**
 * Detaches the project from its billing account through the Cloud Billing API, as in
 * Google's guide "Disable billing usage with notifications". The Functions' runtime
 * service account needs a role that may change the project's billing (the guide uses
 * Billing Account Administrator on the billing account; docs/RUNBOOK.md lists the steps).
 */
export function cloudBillingDisabler(
  getAccessToken: () => Promise<string>,
  fetchImpl: typeof fetch = fetch,
): DisableBilling {
  return async projectId => {
    if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId)) throw new Error('Invalid project id')
    const token = await getAccessToken()
    const response = await fetchImpl(
      `https://cloudbilling.googleapis.com/v1/projects/${projectId}/billingInfo`,
      {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ billingAccountName: '' }),
        signal: AbortSignal.timeout(20_000),
      },
    )
    if (!response.ok) throw new Error(`Cloud Billing answered ${response.status}`)
  }
}
