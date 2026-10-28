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
// An IPv4 caller also counts against its /24 at IPV4_NETWORK_WEIGHT times the share
// (REVIEW5 L1), like an IPv6 /64 against its /48: a /24 is one network (a hosting
// provider's block, an office), and without it 75 addresses from one block could spend
// the hour. No per-address scheme stops an attacker with addresses in many networks, so
// the browser's forecasts may also spend only BROWSER_SHARE_OF_UPSTREAM of the global
// budget (`browserUpstreamLimits`): the rest stays for the server's own work for
// signed-in and Pro accounts (the calendar feed and event heads-ups), which a flood of
// anonymous callers therefore cannot starve.
//
// It fails closed like the budget: when the counters cannot be read, the caller gets the
// cached forecast. An instance remembers which callers spent their share this hour, so a
// caller past its share costs no further Firestore transaction on that instance. An
// instance also runs one caller's transactions one at a time (per widest scope, so per
// /48), because many concurrent transactions on one counter abort on lock contention
// (a page opening many new places at once would otherwise lose most of its share).

import { createHash } from 'node:crypto'
import { isIP } from 'node:net'

import type { Firestore } from 'firebase-admin/firestore'

import { loggableError } from '../shared/errors'
import { ThrottledLog } from '../shared/log-throttle'
import type { LimitScope } from '../shared/rate-limit'
import { RETENTION_DAYS, expiresAfter } from '../shared/ttl'
import { FORECAST_UPSTREAM_COLLECTION, type UpstreamLimits } from './upstream-budget'

/** The IPv4 prefix every IPv4 caller also counts against: one network. */
export const IPV4_NETWORK_PREFIX = 24
/**
 * How many times the per-caller share one IPv4 /24 may use in all (default, owner may
 * change): the same as an IPv6 /48 (shared/client-address.ts IPV6_SITE_WEIGHT). A
 * carrier's NAT block behind one /24 still gets 80 new places an hour; places anyone
 * looked at in the last hour are cache hits and cost no share.
 */
export const IPV4_NETWORK_WEIGHT = 4

/**
 * The part of the global forecast budget the browser's forecasts (guests and signed-in
 * people alike, through the `forecast` Function) may spend (default, owner may change):
 * two thirds, 1,000 of the 1,500 an hour; the last third is kept for the calendar feed
 * and event heads-ups, which serve signed-in and Pro accounts (REVIEW5 L1).
 */
export const BROWSER_SHARE_OF_UPSTREAM = 2 / 3

/** The global budget's limits as the browser's forecasts see them (BROWSER_SHARE_OF_UPSTREAM). */
export function browserUpstreamLimits({ perHour, perDay }: UpstreamLimits): UpstreamLimits {
  return {
    perHour: Math.floor(perHour * BROWSER_SHARE_OF_UPSTREAM),
    perDay: Math.floor(perDay * BROWSER_SHARE_OF_UPSTREAM),
  }
}

/**
 * The scopes a caller's share is counted against: its limit scopes
 * (shared/client-address.ts addressScopes), plus the /24 of an IPv4 address at
 * IPV4_NETWORK_WEIGHT. Other keys (an IPv6 /64 and /48, `uid:` accounts) are unchanged.
 */
export function shareScopes(caller: readonly LimitScope[]): LimitScope[] {
  const scopes = [...caller]
  for (const { key } of caller) {
    if (isIP(key) !== 4) continue
    const network = `${key.split('.').slice(0, 3).join('.')}.0/${IPV4_NETWORK_PREFIX}`
    if (!scopes.some(scope => scope.key === network)) {
      scopes.push({ key: network, weight: IPV4_NETWORK_WEIGHT })
    }
  }
  return scopes
}

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
   * /64 and its /48, an IPv4 address and its /24); false when any scope has spent its
   * share this hour.
   */
  take(callerScopes: readonly LimitScope[]): Promise<boolean> {
    const caller = shareScopes(callerScopes)
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
