// The vitamin D log's switch (ROADMAP item 48), alone in its module: the dashboard and
// components/deferred.tsx read it in every first load, so nothing else rides along. The
// log's storage keys and the sign-in hand-over are in lib/vitamin-d-owner.ts.

/**
 * Whether this build has the vitamin D log: on unless NEXT_PUBLIC_VITAMIN_D_LOG is '0'
 * (next.config.ts compiles it in; the deploy sets '0' when the VITAMIN_D_LOG repository
 * variable is false). Off hides the log; entries already stored stay untouched.
 */
export function vitaminDLogEnabled(): boolean {
  return process.env.NEXT_PUBLIC_VITAMIN_D_LOG !== '0'
}
