// Log lines whose count an attacker controls (rejections, cost-guard pauses, fallbacks)
// are throttled: the first occurrence of each kind in a window is logged at once, the
// rest only counted, and the count is reported with the next line of that kind. So a
// flood of a million rejected requests costs a few log lines a minute per instance
// instead of a million (Cloud Logging bills ingestion past 50 GiB a month).

import { logger } from 'firebase-functions/logger'

export type ThrottledSeverity = 'info' | 'warn' | 'error'

/** How long each kind of line stays quiet after it was logged. Default one minute. */
export const LOG_THROTTLE_WINDOW_MS = 60_000
/** At most this many kinds are tracked; past it the oldest is forgotten. */
const MAX_KINDS = 200

export class ThrottledLog {
  private readonly kinds = new Map<string, { loggedAt: number; suppressed: number }>()

  constructor(
    private readonly windowMs = LOG_THROTTLE_WINDOW_MS,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Logs `message` unless a line of the same `kind` was logged within the window; then
   * only counts it. A logged line carries `suppressed`, the lines not logged since the
   * previous one of its kind.
   * @returns whether the line was logged
   */
  log(
    severity: ThrottledSeverity,
    kind: string,
    message: string,
    fields: Record<string, unknown> = {},
  ): boolean {
    const now = this.now()
    const state = this.kinds.get(kind)
    if (state && now - state.loggedAt < this.windowMs) {
      state.suppressed += 1
      return false
    }
    const suppressed = state?.suppressed ?? 0
    this.kinds.delete(kind)
    this.kinds.set(kind, { loggedAt: now, suppressed: 0 })
    if (this.kinds.size > MAX_KINDS) {
      const oldest = this.kinds.keys().next()
      if (!oldest.done) this.kinds.delete(oldest.value)
    }
    logger[severity](message, { ...fields, suppressed })
    return true
  }

  clear(): void {
    this.kinds.clear()
  }
}
