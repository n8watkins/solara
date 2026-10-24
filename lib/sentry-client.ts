/**
 * The Sentry SDK, loaded on demand by lib/error-reporting.ts only when the build has
 * a DSN. Builds without NEXT_PUBLIC_SENTRY_DSN never load this module.
 */
import { captureException, init } from '@sentry/nextjs'
import { sentryOptions } from './sentry-options'

export type CaptureException = typeof captureException

/** Starts Sentry (global error and unhandled rejection handlers included). */
export function initSentry(dsn: string, release?: string): CaptureException {
  init(sentryOptions(dsn, release))
  return captureException
}
