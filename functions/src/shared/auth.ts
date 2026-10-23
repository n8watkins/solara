import type { Auth, DecodedIdToken } from 'firebase-admin/auth'

import { HttpError } from './errors'

export interface AuthenticateOptions {
  /** Require a sign-in no older than this (for destructive actions). */
  maxAgeSeconds?: number
  nowSeconds?: number
}

/**
 * Verifies the `Authorization: Bearer <Firebase ID token>` header, rejecting revoked
 * sessions, and returns the decoded identity.
 */
export async function authenticate(
  auth: Auth,
  authorization: string | undefined,
  options: AuthenticateOptions = {},
): Promise<DecodedIdToken> {
  const match = (authorization || '').match(/^Bearer (.+)$/)
  if (!match?.[1]) throw new HttpError('unauthenticated', 'Authentication required')
  let identity: DecodedIdToken
  try {
    identity = await auth.verifyIdToken(match[1], true)
  } catch (error) {
    throw new HttpError('unauthenticated', 'Authentication required', { cause: error })
  }
  if (options.maxAgeSeconds) {
    const authenticatedAt = identity.auth_time
    const nowSeconds = options.nowSeconds ?? Math.floor(Date.now() / 1000)
    if (!Number.isFinite(authenticatedAt) || nowSeconds - authenticatedAt > options.maxAgeSeconds) {
      throw new HttpError('reauth-required', 'Recent authentication required')
    }
  }
  return identity
}
