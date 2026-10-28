// The cost guard: a server-owned switch that turns off the paths whose cost grows with
// traffic, without a deploy.
//
// `systemFlags/costGuard` holds the switch. The budget kill switch (functions/src/ops)
// engages it when the Cloud Billing budget passes its threshold, and the owner can force
// it either way from the Firestore console (docs/RUNBOOK.md, "Cost guard"). Clients
// cannot read or write it (firestore.rules denies everything not listed).
//
// Guarded paths answer 503 `unavailable` while it is engaged. Paths that bring in money
// or that people are owed are never guarded: checkout, the billing portal, the Stripe
// webhook, account export and deletion, and the maintenance job that finishes deletions.

import type { Firestore } from 'firebase-admin/firestore'
import { logger } from 'firebase-functions/logger'

import { loggableError } from './errors'

/** Paths the cost guard can turn off. */
export type CostFeature = 'calendarFeed' | 'feedLinks' | 'forecast' | 'notifications'

export const COST_GUARD_COLLECTION = 'systemFlags'
export const COST_GUARD_DOC = 'costGuard'

/**
 * `override` lets the owner pin the switch: `engaged` keeps the guarded paths off
 * whatever the budget says, `released` keeps them on (for example after raising the
 * budget), and `auto` (or no value) follows the budget.
 */
export type CostGuardOverride = 'auto' | 'engaged' | 'released'

/** Whether the guarded paths are off for this stored state. */
export function guardEngaged(data: Record<string, unknown> | undefined): boolean {
  const override = data?.override
  if (override === 'engaged') return true
  if (override === 'released') return false
  return data?.engaged === true
}

/** How long one instance trusts its last read of the switch. */
export const COST_GUARD_CACHE_MS = 60_000

/**
 * Reads the switch at most once a minute per instance, so a guarded request costs no
 * extra Firestore read in the common case. When the switch cannot be read the paths
 * stay on (the budget alert still reaches the owner), and the failure is logged.
 */
export class CostGuard {
  private cached: { engaged: boolean; expiresAt: number } | null = null
  private pending: Promise<boolean> | null = null

  constructor(
    private readonly db: Firestore,
    private readonly now: () => number = Date.now,
  ) {}

  async engaged(): Promise<boolean> {
    const now = this.now()
    if (this.cached && this.cached.expiresAt > now) return this.cached.engaged
    this.pending ??= this.read().finally(() => {
      this.pending = null
    })
    return this.pending
  }

  clear(): void {
    this.cached = null
  }

  private async read(): Promise<boolean> {
    let engaged = false
    try {
      const snapshot = await this.db.collection(COST_GUARD_COLLECTION).doc(COST_GUARD_DOC).get()
      engaged = guardEngaged(snapshot.data())
    } catch (error) {
      logger.warn('cost guard could not be read; guarded paths stay on', {
        error: loggableError(error),
      })
    }
    this.cached = { engaged, expiresAt: this.now() + COST_GUARD_CACHE_MS }
    return engaged
  }
}
