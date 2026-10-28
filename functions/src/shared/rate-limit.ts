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
// Memory stays bounded at `maxKeys` windows without ever forgetting a live one (REVIEW4
// M1): every window lasts `windowMs`, so the map's insertion order is also expiry order,
// and expired windows are dropped from the front. When the map is full of live windows,
// a key without one is refused until windows expire, instead of evicting a live window
// and handing a throttled client a fresh budget. Keys that already have a window are
// unaffected, so known clients keep their normal budget during such a flood.

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

export class FixedWindowLimiter {
  readonly limit: number
  readonly windowMs: number
  readonly maxKeys: number
  readonly windows = new Map<string, Window>()

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
  }

  /** The live windows of `scopes` that have used their whole budget. */
  private spentWindows(scopes: readonly LimitScope[], now: number): Window[] {
    return scopes.flatMap(({ key, weight }) => {
      const window = this.windows.get(key)
      return window && window.resetAt > now && window.count >= this.limit * weight ? [window] : []
    })
  }

  private takeOne({ key, weight }: LimitScope, now: number): LimitResult {
    let window = this.windows.get(key)
    if (!window || window.resetAt <= now) {
      this.windows.delete(key)
      this.dropExpired(now)
      if (this.windows.size >= this.maxKeys) {
        // Full of live windows: refuse the newcomer rather than forget a live window.
        const oldest = this.windows.values().next()
        return {
          allowed: false,
          retryAfterSeconds: this.secondsLeft(oldest.done ? undefined : oldest.value, now),
        }
      }
      window = { count: 0, resetAt: now + this.windowMs }
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
