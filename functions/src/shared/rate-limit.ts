// A small fixed-window limiter held in instance memory.
//
// It is a coarse first line against abusive clients of unauthenticated endpoints: each
// Cloud Run instance enforces it independently, and `maxInstances` bounds the total.
//
// A request can count against several keys at once (`LimitScope`), each with a multiple
// of the limit: a client address counts against its own bucket and the wider prefix it
// belongs to (an IPv6 /64 and its /48, shared/client-address.ts), so holding many
// buckets of one prefix does not multiply the budget (REVIEW4 M1).
//
// Memory stays bounded at `maxKeys` exact windows without ever forgetting a live one
// (REVIEW4 M1): every window lasts `windowMs`, so the map's insertion order is also
// expiry order, and expired windows are dropped from the front. When the map is full of
// live windows, a key without one is counted in a fixed-size count-min sketch for the
// current window instead (REVIEW5 M5). The sketch never under-counts, so a key it holds
// is refused once its count reaches the limit, like an exact window, and a key that
// later gets an exact window starts from the sketch's count; so neither a throttled
// client nor a client sprayed into the sketch is handed a fresh budget, and a newcomer
// during a flood of new keys is still served. The sketch can over-count a key that
// shares cells with others: its width keeps that small (a flood of 100,000 new keys in
// one window leaves about 0.4 counts per cell, so about 1 newcomer in 100 loses one
// request of its budget, against limits of 6 a minute and up), and its
// cells are picked by a keyed hash with a per-instance secret, so nobody can aim
// collisions at another client's cells.

import { createHash, randomBytes } from 'node:crypto'

/** One key a request counts against, allowed `weight` times the limiter's limit. */
export interface LimitScope {
  key: string
  weight: number
}

export interface LimitResult {
  allowed: boolean
  retryAfterSeconds: number
}

interface Window {
  count: number
  resetAt: number
}

/** Rows and columns of the overflow sketch: 4 x 262,144 16-bit cells, 2 MB once used. */
const SKETCH_DEPTH = 4
const SKETCH_WIDTH = 1 << 18
const SKETCH_MAX = 0xffff

/**
 * A count-min sketch with conservative update for the keys of one fixed window (aligned
 * to multiples of `windowMs`), allocated on first use and cleared when the window ends.
 */
class OverflowSketch {
  private cells: Uint16Array | null = null
  private windowStart = -1
  private readonly secret = randomBytes(16)

  constructor(private readonly windowMs: number) {}

  /** When the current sketch window ends. */
  resetAt(now: number): number {
    return (Math.floor(now / this.windowMs) + 1) * this.windowMs
  }

  /** The key's count this window; never below its true count. */
  estimate(key: string, now: number): number {
    if (!this.cells || this.windowStart !== this.start(now)) return 0
    return Math.min(...this.slots(key).map(slot => this.cells![slot]!))
  }

  /** Counts one request for `key` and returns its new estimate. */
  add(key: string, now: number): number {
    const start = this.start(now)
    if (!this.cells) this.cells = new Uint16Array(SKETCH_DEPTH * SKETCH_WIDTH)
    if (this.windowStart !== start) {
      this.cells.fill(0)
      this.windowStart = start
    }
    const slots = this.slots(key)
    const next = Math.min(SKETCH_MAX, Math.min(...slots.map(slot => this.cells![slot]!)) + 1)
    // Conservative update: raise only the cells below the new estimate.
    for (const slot of slots) if (this.cells[slot]! < next) this.cells[slot] = next
    return next
  }

  clear(): void {
    this.cells = null
    this.windowStart = -1
  }

  private start(now: number): number {
    return Math.floor(now / this.windowMs) * this.windowMs
  }

  private slots(key: string): number[] {
    const digest = createHash('sha256').update(this.secret).update(key).digest()
    return Array.from(
      { length: SKETCH_DEPTH },
      (_, row) => row * SKETCH_WIDTH + (digest.readUInt32BE(row * 4) & (SKETCH_WIDTH - 1)),
    )
  }
}

export class FixedWindowLimiter {
  readonly limit: number
  readonly windowMs: number
  readonly maxKeys: number
  readonly windows = new Map<string, Window>()
  /** Keys that found the map full of live windows (REVIEW5 M5). */
  private readonly overflow: OverflowSketch

  constructor({
    limit,
    windowMs,
    maxKeys = 10_000,
  }: {
    limit: number
    windowMs: number
    maxKeys?: number
  }) {
    this.limit = limit
    this.windowMs = windowMs
    this.maxKeys = maxKeys
    this.overflow = new OverflowSketch(windowMs)
  }

  /**
   * Counts one request for `key`, or for every scope in a list; allowed only when every
   * scope is within its limit. A request that a scope has already refused this window is
   * refused without counting or creating any window, so a client spraying new keys
   * under a spent prefix (new /64s of a throttled /48) cannot fill the map.
   */
  take(key: string | readonly LimitScope[], now = Date.now()): LimitResult {
    const scopes = asScopes(key)
    const spent = this.spentWindows(scopes, now)
    if (spent.length > 0) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(...spent.map(window => this.secondsLeft(window, now))),
      }
    }
    const results = scopes.map(scope => this.takeOne(scope, now))
    const refused = results.filter(result => !result.allowed)
    // When refused, the wait is the longest of the refusing scopes'.
    return {
      allowed: refused.length === 0,
      retryAfterSeconds: Math.max(
        1,
        ...(refused.length ? refused : results).map(result => result.retryAfterSeconds),
      ),
    }
  }

  /** Whether any scope has already used its budget in the current window, without counting. */
  exhausted(key: string | readonly LimitScope[], now = Date.now()): boolean {
    return this.spentWindows(asScopes(key), now).length > 0
  }

  clear(): void {
    this.windows.clear()
    this.overflow.clear()
  }

  /** The windows of `scopes` (exact or in the sketch) that have used their whole budget. */
  private spentWindows(scopes: readonly LimitScope[], now: number): Window[] {
    return scopes.flatMap(({ key, weight }) => {
      const window = this.liveWindow(key, now)
      return window && window.count >= this.limit * weight ? [window] : []
    })
  }

  /** The key's live window: its exact one, else its count in the overflow sketch. */
  private liveWindow(key: string, now: number): Window | undefined {
    const window = this.windows.get(key)
    if (window && window.resetAt > now) return window
    const count = this.overflow.estimate(key, now)
    return count > 0 ? { count, resetAt: this.overflow.resetAt(now) } : undefined
  }

  private takeOne({ key, weight }: LimitScope, now: number): LimitResult {
    let window = this.windows.get(key)
    if (!window || window.resetAt <= now) {
      this.windows.delete(key)
      this.dropExpired(now)
      if (this.windows.size >= this.maxKeys) {
        // Full of live windows: count the newcomer in the sketch rather than refuse it or
        // forget a live window.
        const count = this.overflow.add(key, now)
        return {
          allowed: count <= this.limit * weight,
          retryAfterSeconds: this.secondsLeft({ count, resetAt: this.overflow.resetAt(now) }, now),
        }
      }
      // A key the sketch counted this window keeps that count (and the sketch's reset,
      // which is never later than a new window's, so the map stays close to expiry
      // order and an entry that expires early is dropped soon after its predecessors).
      const counted = this.overflow.estimate(key, now)
      window =
        counted > 0
          ? { count: counted, resetAt: this.overflow.resetAt(now) }
          : { count: 0, resetAt: now + this.windowMs }
      this.windows.set(key, window)
    }
    window.count += 1
    return {
      allowed: window.count <= this.limit * weight,
      retryAfterSeconds: this.secondsLeft(window, now),
    }
  }

  /** Drops expired windows; the oldest are first, so this stops at the first live one. */
  private dropExpired(now: number): void {
    for (const [key, window] of this.windows) {
      if (window.resetAt > now) return
      this.windows.delete(key)
    }
  }

  private secondsLeft(window: Window | undefined, now: number): number {
    return window ? Math.max(1, Math.ceil((window.resetAt - now) / 1000)) : 1
  }
}

function asScopes(key: string | readonly LimitScope[]): readonly LimitScope[] {
  return typeof key === 'string' ? [{ key, weight: 1 }] : key
}
