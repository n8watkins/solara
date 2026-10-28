// A per-caller share of the paid upstream calls (REVIEW4 H1).
//
// The global upstream budget (upstream-budget.ts) bounds what the paid API costs, but on
// its own it is first come, first served: one caller with one App Check token could
// spend the whole hour on new places, and then everyone else would get only cached
// forecasts. So each caller may cause at most `perHour` upstream calls per UTC hour per
// budget (forecasts and place search are counted apart), across every instance.
//
// A caller is the client address, keyed like the per-address rate limits
// (shared/client-address.ts): an IPv4 address, or an IPv6 /64 at the share and its /48
// at IPV6_SITE_WEIGHT times the share, so a /48 cannot hold 65,536 shares (REVIEW4 M1).
// The counts live in `forecastUpstream/caller-<scope>-<hour>-<hash>` (the budget's own
// collection, so the same TTL policy removes them), one transaction per upstream call;
// the id holds a hash of the key, never the address. A cache hit never reaches here, so
// people looking at places others already fetched spend nothing.
//
// It fails closed like the budget: when the counters cannot be read, the caller gets the
// cached forecast. An instance remembers which callers spent their share this hour, so a
// caller past its share costs no further Firestore transaction on that instance. An
// instance also runs one caller's transactions one at a time (per widest scope, so per
// /48), because many concurrent transactions on one counter abort on lock contention
// (a page opening many new places at once would otherwise lose most of its share).

import { createHash } from 'node:crypto'

import type { Firestore } from 'firebase-admin/firestore'

import { loggableError } from '../shared/errors'
import { ThrottledLog } from '../shared/log-throttle'
import type { LimitScope } from '../shared/rate-limit'
import { RETENTION_DAYS, expiresAfter } from '../shared/ttl'
import { FORECAST_UPSTREAM_COLLECTION } from './upstream-budget'

/** The most callers one instance remembers as spent; forgetting one costs one read. */
const MAX_REMEMBERED = 10_000

export interface CallerShareOptions {
  db: Firestore
  /** Which budget the share is of (`forecast` or `places`), in the counter ids and logs. */
  scope: string
  /** Upstream calls one caller may cause per UTC hour; read on each use. */
  perHour: () => number
  now?: () => number
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

export class CallerShare {
  private spent = { hour: '', keys: new Set<string>() }
  /** The last queued take per caller lane (its widest scope), so takes run in turn. */
  private readonly lanes = new Map<string, Promise<boolean>>()
  private readonly logs = new ThrottledLog()

  constructor(private readonly options: CallerShareOptions) {}

  /**
   * Takes one upstream call from the caller's share, counted against every scope (an IPv6
   * /64 and its /48); false when any scope has spent its share this hour.
   */
  take(caller: readonly LimitScope[]): Promise<boolean> {
    const lane = caller.at(-1)?.key
    if (lane === undefined) return Promise.resolve(false)
    const previous = this.lanes.get(lane)
    const run = previous ? previous.then(() => this.takeNow(caller)) : this.takeNow(caller)
    this.lanes.set(lane, run)
    void run.finally(() => {
      if (this.lanes.get(lane) === run) this.lanes.delete(lane)
    })
    return run
  }

  clear(): void {
    this.spent = { hour: '', keys: new Set() }
    this.lanes.clear()
    this.logs.clear()
  }

  /** One take, after the caller's earlier ones; never throws. */
  private async takeNow(caller: readonly LimitScope[]): Promise<boolean> {
    const { db, scope, perHour } = this.options
    const now = (this.options.now ?? Date.now)()
    const hour = new Date(now).toISOString().slice(0, 13)
    if (this.spent.hour !== hour) this.spent = { hour, keys: new Set() }
    if (caller.some(({ key }) => this.spent.keys.has(key))) return false

    const share = perHour()
    const collection = db.collection(FORECAST_UPSTREAM_COLLECTION)
    const refs = caller.map(({ key }) => collection.doc(`caller-${scope}-${hour}-${digest(key)}`))
    try {
      const full = await db.runTransaction(async transaction => {
        const docs = await transaction.getAll(...refs)
        const used = docs.map(doc => count(doc?.data()?.count))
        const over = caller.filter((entry, index) => (used[index] ?? 0) >= share * entry.weight)
        if (over.length > 0) return over
        const expireAt = expiresAfter(RETENTION_DAYS.forecastUpstream, new Date(now))
        refs.forEach((ref, index) => {
          transaction.set(ref, { count: (used[index] ?? 0) + 1, expireAt })
        })
        return []
      })
      if (full.length === 0) return true
      for (const { key } of full) this.remember(key)
      // Expected under abuse (and for a busy shared address); a WARNING, once a minute.
      this.logs.log('warn', 'spent', 'caller share of upstream calls spent', {
        scope,
        perHour: share,
      })
      return false
    } catch (error) {
      this.logs.log('warn', 'failed', 'caller share could not be read', {
        scope,
        error: loggableError(error),
      })
      return false
    }
  }

  private remember(key: string): void {
    // Forgetting is safe: Firestore holds the count, so a forgotten caller costs one more
    // transaction and is refused again.
    if (this.spent.keys.size >= MAX_REMEMBERED) this.spent.keys.clear()
    this.spent.keys.add(key)
  }
}

/** A short hash of a caller key, so no address is stored. */
function digest(key: string): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 32)
}
