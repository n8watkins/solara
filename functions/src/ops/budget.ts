// The budget kill switch: Cloud Billing budget notifications in, cost guard out.
//
// A Cloud Billing budget publishes its state to a Pub/Sub topic several times a day
// (https://cloud.google.com/billing/docs/how-to/budgets-programmatic-notifications).
// Three tiers, each a share of the budget (functions/.env, docs/RUNBOOK.md):
//
// 1. COST_GUARD_WARN_PERCENT (50): one WARNING per budget period.
// 2. COST_GUARD_THRESHOLD_PERCENT (100): engages the cost guard (shared/cost-guard.ts),
//    which turns off the paths whose cost an outsider's traffic drives, until the next
//    budget period starts (`engagedUntil`) or the owner releases it.
// 3. COST_GUARD_DETACH_THRESHOLD_PERCENT (300), when COST_GUARD_DETACH_BILLING is true
//    (the default; the owner may switch it off per project): detaches the project from
//    its billing account. That is the hard stop: the Functions stop, while Hosting,
//    Authentication and Firestore keep serving within the no-cost quotas, until the
//    owner re-attaches billing.
//
// Only notifications from the budget named by BUDGET_ID are acted on (finding L2).

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

/**
 * The service account `budgetAlert` runs as, from BUDGET_SERVICE_ACCOUNT in
 * functions/.env.<project> (the deploy writes it from the repository variable of the
 * same name). Read when the deploy loads the source, like ALERTS_SERVICE_ACCOUNT; unset
 * keeps the project's default identity, which then cannot detach billing.
 */
export function budgetServiceAccount(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const value = env.BUDGET_SERVICE_ACCOUNT?.trim()
  return value ? value : undefined
}

/**
 * Whether a Pub/Sub message comes from the budget this switch serves. Cloud Billing
 * sets the `budgetId` attribute on every notification. `expectedBudgetId` is the
 * BUDGET_ID param (the id, or the full `billingAccounts/.../budgets/<id>` name); while
 * it is empty every budget notification is accepted, as before it existed.
 */
export function fromExpectedBudget(
  attributes: Record<string, string> | undefined,
  expectedBudgetId: string,
): boolean {
  const expected = expectedBudgetId.trim().split('/').pop() ?? ''
  if (!expected) return true
  return attributes?.budgetId === expected
}

/** About the start of the next monthly budget period, or null when unreadable. */
export function nextBudgetPeriodStart(costIntervalStart: string): Date | null {
  const start = new Date(costIntervalStart)
  if (Number.isNaN(start.getTime())) return null
  const next = new Date(start)
  next.setUTCMonth(next.getUTCMonth() + 1)
  return next
}

export interface KillSwitchConfig {
  /** Log one warning per period at this share of the budget (0.5 = half). */
  warnThreshold: number
  /** Engage the cost guard at this share of the budget (1 = the whole budget). */
  threshold: number
  /** Detach billing at this share of the budget, when detachBilling is on. */
  detachThreshold: number
  detachBilling: boolean
  projectId: string
}

export type KillSwitchAction = 'warned' | 'engaged' | 'released' | 'detached'

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

  const interval = notification.costIntervalStart
  const engagedUntil = nextBudgetPeriodStart(interval)
  const changes = await db.runTransaction(async (transaction): Promise<KillSwitchAction[]> => {
    const current = (await transaction.get(ref)).data() ?? {}
    const done: KillSwitchAction[] = []
    const update: Record<string, unknown> = {}
    if (ratio >= config.threshold) {
      if (!(current.engaged === true && current.costIntervalStart === interval)) {
        Object.assign(update, {
          engaged: true,
          engagedAt: now,
          engagedUntil,
          reason: 'budget',
          warnedIntervalStart: interval,
        })
        done.push('engaged')
      }
    } else {
      // Below the threshold: a guard the budget engaged in an earlier period is released
      // once the new period starts (if engagedUntil has not already ended it). A guard
      // engaged in this period stays on, because cost never goes down within a period:
      // a lower figure means a different budget filter or a correction, and the owner
      // decides those (docs/RUNBOOK.md).
      if (
        current.engaged === true &&
        current.reason === 'budget' &&
        current.costIntervalStart !== interval
      ) {
        Object.assign(update, { engaged: false, releasedAt: now, reason: null, engagedUntil: null })
        done.push('released')
      }
      if (ratio >= config.warnThreshold && current.warnedIntervalStart !== interval) {
        update.warnedIntervalStart = interval
        done.push('warned')
      }
    }
    if (done.length > 0) {
      transaction.set(ref, { ...fields, ...update, updatedAt: now }, { merge: true })
    }
    return done
  })

  const actions: KillSwitchAction[] = [...changes]
  if (changes.includes('released')) {
    logger.warn('cost guard released for a new budget period', fields)
  }
  if (changes.includes('warned')) {
    logger.warn('budget passed its warning level', {
      ...fields,
      warnThreshold: config.warnThreshold,
    })
  }
  if (changes.includes('engaged')) {
    // An ERROR log is the alert hook: the error-log alert (docs/RUNBOOK.md) reaches the owner.
    logger.error('cost guard engaged by the budget', {
      ...fields,
      engagedUntil: engagedUntil?.toISOString() ?? null,
    })
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
  return { ratio, actions }
}

/**
 * Detaches the project from its billing account through the Cloud Billing API, as in
 * Google's guide "Disable billing usage with notifications". Only `budgetAlert`'s own
 * service account (BUDGET_SERVICE_ACCOUNT, created by infra/budget.sh) holds the role
 * that may change the project's billing; no HTTP function runs as it (finding L2).
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
