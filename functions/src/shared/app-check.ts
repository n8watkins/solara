import type { AppCheck, VerifyAppCheckTokenResponse } from 'firebase-admin/app-check'

import { HttpError } from './errors'

/**
 * `standard` accepts any valid token. `limited-use` consumes the token, so a captured
 * token cannot be replayed; it guards the irreversible or money-moving actions.
 */
export type AppCheckMode = 'standard' | 'limited-use'

/**
 * Verifies the Firebase App Check token a browser sends in `X-Firebase-AppCheck`.
 *
 * In `limited-use` mode the token is consumed, so a captured token cannot be replayed:
 * the browser must mint a fresh limited-use token for every sensitive request.
 */
export async function verifyAppCheck(
  appCheck: AppCheck,
  token: unknown,
  mode: AppCheckMode,
): Promise<VerifyAppCheckTokenResponse> {
  if (typeof token !== 'string' || !token) {
    throw new HttpError('app-check-required', 'App verification required')
  }
  let result: VerifyAppCheckTokenResponse
  try {
    result =
      mode === 'limited-use'
        ? await appCheck.verifyToken(token, { consume: true })
        : await appCheck.verifyToken(token)
  } catch (error) {
    throw new HttpError('app-check-required', 'App verification required', { cause: error })
  }
  if (mode === 'limited-use' && result.alreadyConsumed !== false) {
    throw new HttpError('app-check-required', 'App verification required')
  }
  return result
}
