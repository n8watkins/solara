/**
 * Firebase Auth codes for a sign-in the person stopped themselves: they closed the
 * Google popup, or a second click replaced a popup that was still open. Neither is a
 * failure, so the sign-in button goes back to normal without an error message.
 */
const CANCELLED_SIGN_IN_CODES = new Set([
  'auth/popup-closed-by-user',
  'auth/cancelled-popup-request',
])

/** True when a sign-in error only means the person cancelled it. */
export function isSignInCancelled(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' && CANCELLED_SIGN_IN_CODES.has(code)
}
