import type { Auth, DecodedIdToken } from 'firebase-admin/auth'

import { HttpError } from './errors'
import { FixedWindowLimiter } from './rate-limit'

export interface AuthenticateOptions {
  /** Require a sign-in no older than this (for destructive actions). */
  maxAgeSeconds?: number
  nowSeconds?: number
  /** Counts the request against the account's budget for this endpoint (uidLimiter). */
  limiter?: FixedWindowLimiter
}

/**
 * A per-account budget for one endpoint, held in instance memory: with each endpoint's
 * maxInstances it bounds what one signed-in account can make the backend do.
 */
export function uidLimiter(perMinute: number): FixedWindowLimiter {
  const limiter = new FixedWindowLimiter({ limit: perMinute, windowMs: 60_000 })
  uidLimiters.add(limiter)
  return limiter
}

const uidLimiters = new Set<FixedWindowLimiter>()

/** Empties every per-account budget (tests). */
export function clearUidLimiters(): void {
  for (const limiter of uidLimiters) limiter.clear()
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
  if (options.limiter && !options.limiter.take(identity.uid).allowed) {
    throw new HttpError('rate-limited', 'Too many requests. Try again shortly.')
  }
  return identity
}
