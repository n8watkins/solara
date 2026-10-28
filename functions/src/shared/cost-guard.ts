// The cost guard: a server-owned switch that turns off the paths whose cost grows with
// traffic, without a deploy.
//
// `systemFlags/costGuard` holds the switch. The budget kill switch (functions/src/ops)
// engages it when the Cloud Billing budget passes its threshold, and the owner can force
// it either way from the Firestore console (docs/RUNBOOK.md, "Cost guard"). Clients
// cannot read or write it (firestore.rules denies everything not listed).
//
// Only paths whose cost an outsider's traffic drives are guarded; they answer 503
// `unavailable` while it is engaged, and the forecast proxy serves only cached forecasts.
// Never guarded: paths that bring in money or that people are owed (checkout, the
// billing portal, the Stripe webhook, account export and deletion, the maintenance job),
// and the scheduled Pro alerts, whose cost is bounded by the number of Pro accounts and
// their per-run caps, not by anyone's traffic (finding H2: pausing them would punish
// paying customers for someone else's flood without stopping it).
//
// A guard the budget engaged ends by itself when the next budget period starts
// (`engagedUntil`), even if no budget notification arrives, so an attack that crosses the
// budget once cannot keep the guarded paths off beyond the period. The owner can end it
// sooner with infra/cost-guard.sh (docs/RUNBOOK.md, "Cost guard").

import type { Firestore } from 'firebase-admin/firestore'
import { logger } from 'firebase-functions/logger'

import { loggableError } from './errors'

/** Paths the cost guard can turn off. */
export type CostFeature = 'calendarFeed' | 'feedLinks' | 'notifications'

export const COST_GUARD_COLLECTION = 'systemFlags'
export const COST_GUARD_DOC = 'costGuard'

/**
 * `override` lets the owner pin the switch: `engaged` keeps the guarded paths off
 * whatever the budget says, `released` keeps them on (for example after raising the
 * budget), and `auto` (or no value) follows the budget.
 */
export type CostGuardOverride = 'auto' | 'engaged' | 'released'

/** A Firestore Timestamp, Date or epoch milliseconds as epoch milliseconds, or NaN. */
function millis(value: unknown): number {
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'number') return value
  const toMillis = (value as { toMillis?: () => number } | null)?.toMillis
  return typeof toMillis === 'function' ? toMillis.call(value) : Number.NaN
}

/**
 * Whether the guarded paths are off for this stored state at `now`. The owner's
 * `override` wins; otherwise a guard the budget engaged stays on until `engagedUntil`,
 * the start of the next budget period.
 */
export function guardEngaged(data: Record<string, unknown> | undefined, now = Date.now()): boolean {
  const override = data?.override
  if (override === 'engaged') return true
  if (override === 'released') return false
  if (data?.engaged !== true) return false
  const until = millis(data.engagedUntil)
  return !(data.reason === 'budget' && Number.isFinite(until) && now >= until)
}

/** How long one instance trusts its last read of the switch. */
export const COST_GUARD_CACHE_MS = 60_000

/**
 * Whether the owner pinned the guard on (`override: engaged`). Only this pauses the
 * scheduled Pro alerts: a guard the budget engaged never does (finding H2), but the
 * owner keeps an immediate stop for alerts that misbehave.
 */
export function pinnedByOwner(data: Record<string, unknown> | undefined): boolean {
  return data?.override === 'engaged'
}

/**
 * Reads the switch at most once a minute per instance, so a guarded request costs no
 * extra Firestore read in the common case (finding L1). When the switch cannot be read
 * the paths stay on (the budget alert still reaches the owner), and the failure is
 * logged once per read, so at most once a minute per instance.
 */
export class CostGuard {
  private cached: { data: Record<string, unknown> | undefined; expiresAt: number } | null = null
  private pending: Promise<Record<string, unknown> | undefined> | null = null

  constructor(
    private readonly db: Firestore,
    private readonly now: () => number = Date.now,
  ) {}

  /** Whether the guarded paths are off (guardEngaged). */
  async engaged(): Promise<boolean> {
    return guardEngaged(await this.state(), this.now())
  }

  /** Whether the owner pinned the guard on (pinnedByOwner). */
  async pinnedByOwner(): Promise<boolean> {
    return pinnedByOwner(await this.state())
  }

  clear(): void {
    this.cached = null
  }

  private async state(): Promise<Record<string, unknown> | undefined> {
    if (this.cached && this.cached.expiresAt > this.now()) return this.cached.data
    this.pending ??= this.read().finally(() => {
      this.pending = null
    })
    return this.pending
  }

  private async read(): Promise<Record<string, unknown> | undefined> {
    let data: Record<string, unknown> | undefined
    try {
      const snapshot = await this.db.collection(COST_GUARD_COLLECTION).doc(COST_GUARD_DOC).get()
      data = snapshot.data()
    } catch (error) {
      logger.warn('cost guard could not be read; guarded paths stay on', {
        error: loggableError(error),
      })
    }
    this.cached = { data, expiresAt: this.now() + COST_GUARD_CACHE_MS }
    return data
  }
}
