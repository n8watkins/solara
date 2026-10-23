// A small fixed-window limiter held in instance memory.
//
// It is a coarse first line against abusive clients of unauthenticated endpoints: each
// Cloud Run instance enforces it independently, and `maxInstances` bounds the total.
// Memory stays bounded because the oldest keys are evicted first.

export class FixedWindowLimiter {
  readonly limit: number
  readonly windowMs: number
  readonly maxKeys: number
  readonly windows = new Map<string, { count: number; resetAt: number }>()

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

  /** Counts one request for `key`. */
  take(key: string, now = Date.now()): { allowed: boolean; retryAfterSeconds: number } {
    let window = this.windows.get(key)
    if (!window || window.resetAt <= now) {
      this.windows.delete(key)
      if (this.windows.size >= this.maxKeys) {
        const oldest = this.windows.keys().next()
        if (!oldest.done) this.windows.delete(oldest.value)
      }
      window = { count: 0, resetAt: now + this.windowMs }
      this.windows.set(key, window)
    }
    window.count += 1
    return {
      allowed: window.count <= this.limit,
      retryAfterSeconds: Math.max(1, Math.ceil((window.resetAt - now) / 1000)),
    }
  }

  /** Whether `key` has already used its budget in the current window, without counting. */
  exhausted(key: string, now = Date.now()): boolean {
    const window = this.windows.get(key)
    return !!window && window.resetAt > now && window.count >= this.limit
  }

  clear(): void {
    this.windows.clear()
  }
}
