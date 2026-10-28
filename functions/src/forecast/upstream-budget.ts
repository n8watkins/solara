// A global budget for calls to the paid Open-Meteo API (finding M1).
//
// The forecast cache bounds upstream calls to one per place and hour, but the number of
// places is huge (every 0.02 degree cell on Earth), so a script walking new places could
// otherwise spend the Open-Meteo plan's whole monthly quota, which is not part of the
// Cloud Billing budget and so invisible to the cost guard. This budget caps the
// upstream calls the traffic-driven paths (the forecast proxy and the calendar feed) may
// make per UTC hour and per UTC day, across every instance, through two counters in
// Firestore (`forecastUpstream/hour-<hour>` and `forecastUpstream/day-<day>`).
//
// Place search has its own budget (`prefix: 'places-'`, REVIEW4 H1), so typing place
// names cannot spend the forecasts' calls, nor forecasts the searches'. Within each
// budget, a per-caller share (caller-share.ts) keeps one caller from taking the hour.
//
// Each instance leases a few calls at a time in one transaction, so a counter costs one
// read and two writes per LEASE_SIZE upstream calls, not per call. When the budget is
// spent, or the counters cannot be read, it fails closed: the cache serves the last
// good forecast or answers 503 (forecast/proxy.ts). The scheduled Pro alerts do not use
// it; their lookups are bounded by the per-run caps (notifications/alerts.ts).

import type { Firestore } from 'firebase-admin/firestore'

import { loggableError } from '../shared/errors'
import { ThrottledLog } from '../shared/log-throttle'
import { RETENTION_DAYS, expiresAfter } from '../shared/ttl'

export const FORECAST_UPSTREAM_COLLECTION = 'forecastUpstream'
/** Upstream calls one instance takes from the shared counters at a time. */
export const LEASE_SIZE = 10
/** A bound on the refills one call waits through while concurrent calls use the leases. */
const MAX_REFILLS_PER_TAKE = 50
/** How long an instance stops asking after the budget was spent. */
export const EXHAUSTED_RETRY_MS = 60_000
/** How long an instance stops asking after the counters could not be read. */
export const FAILED_RETRY_MS = 10_000

export interface UpstreamLimits {
  perHour: number
  perDay: number
}

export interface UpstreamBudgetOptions {
  db: Firestore
  /** What the budget pays for, in its log lines. Default `forecast`. */
  label?: string
  /** Prepended to the counter document ids, so budgets do not share counters. Default ''. */
  prefix?: string
  /** Read on each refill, so params resolve at run time, not at deploy analysis. */
  limits: () => UpstreamLimits
  leaseSize?: number
  now?: () => number
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

export class UpstreamBudget {
  private lease = { hour: '', remaining: 0 }
  private pausedUntil = 0
  private pending: Promise<void> | null = null
  private readonly logs = new ThrottledLog()

  constructor(private readonly options: UpstreamBudgetOptions) {}

  private now(): number {
    return (this.options.now ?? Date.now)()
  }

  /**
   * False while this instance knows the budget is spent (or its counters failed), so a
   * caller can skip other work, such as charging a caller's share, that would be wasted.
   */
  available(): boolean {
    const hour = new Date(this.now()).toISOString().slice(0, 13)
    return this.lease.hour === hour && this.lease.remaining > 0
      ? true
      : this.now() >= this.pausedUntil
  }

  /** Takes one upstream call from the budget; false when none is left this hour or day. */
  async take(): Promise<boolean> {
    const hour = new Date(this.now()).toISOString().slice(0, 13)
    // Concurrent requests share one refill at a time; a request that finds the new lease
    // already used by the others asks for the next one. Each refill either grants calls
    // or pauses the instance, so this ends.
    for (let attempt = 0; attempt < MAX_REFILLS_PER_TAKE; attempt += 1) {
      if (this.takeLeased(hour)) return true
      if (this.now() < this.pausedUntil) return false
      this.pending ??= this.refill(hour).finally(() => {
        this.pending = null
      })
      await this.pending
    }
    return this.takeLeased(hour)
  }

  clear(): void {
    this.lease = { hour: '', remaining: 0 }
    this.pausedUntil = 0
    this.logs.clear()
  }

  private takeLeased(hour: string): boolean {
    if (this.lease.hour !== hour || this.lease.remaining <= 0) return false
    this.lease.remaining -= 1
    return true
  }

  private async refill(hour: string): Promise<void> {
    const { db, leaseSize = LEASE_SIZE, label = 'forecast', prefix = '' } = this.options
    const { perHour, perDay } = this.options.limits()
    const day = hour.slice(0, 10)
    const collection = db.collection(FORECAST_UPSTREAM_COLLECTION)
    const hourRef = collection.doc(`${prefix}hour-${hour}`)
    const dayRef = collection.doc(`${prefix}day-${day}`)
    const at = new Date(this.now())
    try {
      const granted = await db.runTransaction(async transaction => {
        const [hourDoc, dayDoc] = await transaction.getAll(hourRef, dayRef)
        const usedHour = count(hourDoc?.data()?.count)
        const usedDay = count(dayDoc?.data()?.count)
        const grant = Math.max(0, Math.min(leaseSize, perHour - usedHour, perDay - usedDay))
        if (grant > 0) {
          const expireAt = expiresAfter(RETENTION_DAYS.forecastUpstream, at)
          transaction.set(hourRef, { count: usedHour + grant, expireAt, updatedAt: at })
          transaction.set(dayRef, { count: usedDay + grant, expireAt, updatedAt: at })
        }
        return grant
      })
      this.lease = { hour, remaining: granted }
      if (granted === 0) {
        this.pausedUntil = this.now() + EXHAUSTED_RETRY_MS
        // An ERROR reaches the owner through the error-log alert: forecasts are being
        // served from cache because someone (or real growth) used the whole budget.
        this.logs.log('error', 'exhausted', `${label} upstream budget exhausted`, {
          perHour,
          perDay,
        })
      }
    } catch (error) {
      this.lease = { hour, remaining: 0 }
      this.pausedUntil = this.now() + FAILED_RETRY_MS
      this.logs.log('warn', 'failed', `${label} upstream budget could not be read`, {
        error: loggableError(error),
      })
    }
  }
}
