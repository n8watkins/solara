// The vitamin D log's switch and storage key (ROADMAP item 48). Tiny on purpose: the
// dashboard's entry, an activity card's "Log it" and the sign-out clean-up read it, while
// the log itself loads only when opened (components/deferred.tsx).

/** Where the log lives in this browser; a `solara_` key, so account deletion clears it. */
export const VITAMIN_D_LOG_KEY = 'solara_vitamin_d_log'

/**
 * Whether this build has the vitamin D log: on unless NEXT_PUBLIC_VITAMIN_D_LOG is '0'
 * (next.config.ts compiles it in; the deploy sets '0' when the VITAMIN_D_LOG repository
 * variable is false). Off hides the log; entries already stored stay untouched.
 */
export function vitaminDLogEnabled(): boolean {
  return process.env.NEXT_PUBLIC_VITAMIN_D_LOG !== '0'
}

/** Removes the log from this browser (sign-out, another account, "Delete all"). */
export function clearVitaminDLog(): void {
  try {
    localStorage.removeItem(VITAMIN_D_LOG_KEY)
  } catch {}
}
