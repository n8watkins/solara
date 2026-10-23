// A small fixed-window limiter held in instance memory.
//
// It is a coarse first line against abusive clients of unauthenticated endpoints: each
// Cloud Run instance enforces it independently, and `maxInstances` bounds the total.
// Memory stays bounded because the oldest keys are evicted first.

class FixedWindowLimiter {
  /**
   * @param {{ limit: number, windowMs: number, maxKeys?: number }} options
   */
  constructor({ limit, windowMs, maxKeys = 10_000 }) {
    this.limit = limit
    this.windowMs = windowMs
    this.maxKeys = maxKeys
    /** @type {Map<string, { count: number, resetAt: number }>} */
    this.windows = new Map()
  }

  /**
   * Counts one request for `key`.
   *
   * @param {string} key
   * @param {number} [now]
   * @returns {{ allowed: boolean, retryAfterSeconds: number }}
   */
  take(key, now = Date.now()) {
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

  /**
   * Whether `key` has already used its budget in the current window, without counting.
   *
   * @param {string} key
   * @param {number} [now]
   */
  exhausted(key, now = Date.now()) {
    const window = this.windows.get(key)
    return !!window && window.resetAt > now && window.count >= this.limit
  }

  clear() {
    this.windows.clear()
  }
}

module.exports = { FixedWindowLimiter }
