// A global budget for calls to the paid Open-Meteo API (finding M1).
//
// The forecast cache bounds upstream calls to one per place and hour, but the number of
// places is huge (every 0.02 degree cell on Earth), so a script walking new places could
// otherwise spend the Open-Meteo plan's whole monthly quota, which is not part of the
// Cloud Billing budget and so invisible to the cost guard. This budget caps the
// upstream calls the traffic-driven paths (the forecast proxy, the calendar feed and
// event heads-ups) may make per UTC hour and per UTC day, across every instance, through
// two counters in Firestore (`forecastUpstream/hour-<hour>` and `forecastUpstream/day-<day>`).
//
// Place search has its own budget (`prefix: 'places-'`, REVIEW4 H1), so typing place
// names cannot spend the forecasts' calls, nor forecasts the searches'. Within each
// budget, a per-caller share (caller-share.ts) keeps one caller from taking the hour.
//
// The forecast budget is spent from two sides: the browser (guests and signed-in people,
// through the `forecast` Function) and the server's own work for accounts (the calendar
// feed and event heads-ups). Each side may spend at most SIDE_SHARE_OF_UPSTREAM of the
// hour and the day, counted on counters of its own (`<side>-hour-<hour>`,
// `<side>-day-<day>`) as well as the shared ones, so the total never passes the limits
// and neither side can starve the other: whatever one side spends, the other keeps at
// least a third (REVIEW5 L1, REVIEW6 L3).
//
// Each instance leases a few calls at a time in one transaction, so a counter costs one
// read and two writes (four of each with a side's counters) per LEASE_SIZE upstream
// calls, not per call. When the budget is spent, or the counters cannot be read, it fails
// closed: the cache serves the last good forecast or answers 503 (forecast/proxy.ts).
// The scheduled Pro alerts' home forecasts do not use it; their lookups are bounded by
// the per-run caps (notifications/alerts.ts). Event heads-ups do, on the server side.

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

/** Who spends a budget: the browser's requests, or the server's own work for accounts. */
export type UpstreamSide = 'browser' | 'server'

/**
 * The part of the budget each side may spend at most (default, owner may change,
 * 2026-10-28): two thirds, 1,000 of the default 1,500 an hour. The two sides sum past the
 * whole, so the budget is not split in fixed halves (an idle side leaves the other more
 * than half), yet each side keeps at least a third whatever the other does.
 */
export const SIDE_SHARE_OF_UPSTREAM = 2 / 3

/** The limits one side of a budget may spend (SIDE_SHARE_OF_UPSTREAM of each). */
export function sideLimits({ perHour, perDay }: UpstreamLimits): UpstreamLimits {
  return {
    perHour: Math.floor(perHour * SIDE_SHARE_OF_UPSTREAM),
    perDay: Math.floor(perDay * SIDE_SHARE_OF_UPSTREAM),
  }
}

export interface UpstreamBudgetOptions {
  db: Firestore
  /** What the budget pays for, in its log lines. Default `forecast`. */
  label?: string
  /** Prepended to the counter document ids, so budgets do not share counters. Default ''. */
  prefix?: string
  /** Read on each refill, so params resolve at run time, not at deploy analysis. */
  limits: () => UpstreamLimits
  /**
   * The side this instance spends for: it may then spend only its side's part of the
   * limits (sideLimits), counted apart. Omitted, the budget has one side (place search).
   */
  side?: UpstreamSide
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
    const { db, leaseSize = LEASE_SIZE, label = 'forecast', prefix = '', side } = this.options
    const limits = this.options.limits()
    const day = hour.slice(0, 10)
    const collection = db.collection(FORECAST_UPSTREAM_COLLECTION)
    // The shared counters, then the side's own (counted against its part of the limits).
    const counters = [{ name: '', limits }]
    if (side) counters.push({ name: `${side}-`, limits: sideLimits(limits) })
    const refs = counters.flatMap(({ name }) => [
      collection.doc(`${prefix}${name}hour-${hour}`),
      collection.doc(`${prefix}${name}day-${day}`),
    ])
    const caps = counters.flatMap(({ limits: { perHour, perDay } }) => [perHour, perDay])
    const at = new Date(this.now())
    try {
      const granted = await db.runTransaction(async transaction => {
        const docs = await transaction.getAll(...refs)
        const used = docs.map(doc => count(doc?.data()?.count))
        const grant = Math.max(
          0,
          Math.min(leaseSize, ...caps.map((cap, index) => cap - (used[index] ?? 0))),
        )
        if (grant > 0) {
          const expireAt = expiresAfter(RETENTION_DAYS.forecastUpstream, at)
          refs.forEach((ref, index) => {
            transaction.set(ref, { count: (used[index] ?? 0) + grant, expireAt, updatedAt: at })
          })
        }
        return grant
      })
      this.lease = { hour, remaining: granted }
      if (granted === 0) {
        this.pausedUntil = this.now() + EXHAUSTED_RETRY_MS
        // An ERROR reaches the owner through the error-log alert: forecasts are being
        // served from cache because someone (or real growth) used the whole budget, or
        // this side's part of it.
        this.logs.log('error', 'exhausted', `${label} upstream budget exhausted`, {
          perHour: limits.perHour,
          perDay: limits.perDay,
          ...(side ? { side, sideLimits: sideLimits(limits) } : {}),
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
