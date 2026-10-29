// The sunscreen reapply timer, kept in this browser's localStorage. The timer itself is
// pure and lives in @solara/core (packages/core/src/reapply.ts), shared with a native
// client.
import { parseTimer, type ReapplyTimer } from '@solara/core/reapply'

export * from '@solara/core/reapply'

export const REAPPLY_STORAGE_KEY = 'solara_reapply'

export function loadTimer(now: number = Date.now()): ReapplyTimer | null {
  try {
    const raw = localStorage.getItem(REAPPLY_STORAGE_KEY)
    return raw ? parseTimer(JSON.parse(raw), now) : null
  } catch {
    return null
  }
}

export function saveTimer(timer: ReapplyTimer | null): void {
  try {
    if (timer) localStorage.setItem(REAPPLY_STORAGE_KEY, JSON.stringify(timer))
    else localStorage.removeItem(REAPPLY_STORAGE_KEY)
  } catch {
    // Private mode or storage off: the timer still runs for this page.
  }
}
