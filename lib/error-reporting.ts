/**
 * Error reporting to Sentry (decision D10), off unless the build sets
 * NEXT_PUBLIC_SENTRY_DSN.
 *
 * The DSN is inlined at build time (.env declares it empty, so it is always defined).
 * Without it, the guard below is a constant, the bundler drops the dynamic import, and
 * the export contains no Sentry code, so nothing loads and no request is ever made.
 *
 * With a DSN, the SDK (about 50 KB gzip) loads as its own chunk once the page is idle,
 * so it never competes with the first render. Until then, a small listener keeps the
 * first few uncaught errors and unhandled rejections and hands them to Sentry when it
 * starts; an error caught by an error boundary loads it right away.
 */
import type { CaptureException } from './sentry-client'

/** Errors kept while the SDK loads; more than this in the first seconds is one bug. */
const MAX_EARLY_ERRORS = 10

let sentry: Promise<CaptureException | null> | null = null
let early: { error: unknown; source: string }[] = []
let stopEarlyCapture: (() => void) | null = null

function loadSentry(): Promise<CaptureException | null> {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return Promise.resolve(null)
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN
  const release = process.env.NEXT_PUBLIC_SENTRY_RELEASE
  sentry ??= import('./sentry-client')
    .then(({ initSentry }) => {
      const capture = initSentry(dsn, release)
      // Sentry's own handlers take over from here.
      stopEarlyCapture?.()
      for (const { error, source } of early) capture(error, { tags: { source } })
      early = []
      return capture
    })
    // A chunk that fails to load (offline, a deploy in between) or an SDK that fails
    // to start must not become an error of its own.
    .catch(() => null)
  return sentry
}

function whenIdle(callback: () => void): void {
  // Safari has no requestIdleCallback.
  const run = () =>
    typeof window.requestIdleCallback === 'function'
      ? window.requestIdleCallback(callback, { timeout: 5_000 })
      : setTimeout(callback, 1_000)
  if (document.readyState === 'complete') run()
  else window.addEventListener('load', run, { once: true })
}

/**
 * Starts error reporting once per page (from instrumentation-client.ts): records early
 * errors and loads the SDK when the page is idle. Does nothing without a DSN.
 */
export function startErrorReporting(): void {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return
  if (typeof window === 'undefined' || stopEarlyCapture || sentry) return
  const keep = (error: unknown, source: string) => {
    if (early.length < MAX_EARLY_ERRORS) early.push({ error, source })
  }
  const onError = (event: ErrorEvent) => keep(event.error ?? event.message, 'early-onerror')
  const onRejection = (event: PromiseRejectionEvent) =>
    keep(event.reason, 'early-unhandledrejection')
  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)
  stopEarlyCapture = () => {
    window.removeEventListener('error', onError)
    window.removeEventListener('unhandledrejection', onRejection)
  }
  whenIdle(() => void loadSentry())
}

export interface ErrorReportContext {
  /** Which handler caught the error, e.g. `error-boundary` or `global-error`. */
  source: string
  /** The section that failed, from ErrorBoundary's `label`. */
  label?: string
  /** React's component stack: component names only. */
  componentStack?: string | null
}

/** Reports an error that a React error boundary caught (the global handlers see the rest). */
export function reportError(error: unknown, context: ErrorReportContext): void {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return
  if (typeof window === 'undefined') return
  void loadSentry().then(capture =>
    capture?.(error, {
      tags: { source: context.source },
      ...(context.label && { extra: { label: context.label } }),
      ...(context.componentStack && {
        contexts: { react: { componentStack: context.componentStack } },
      }),
    }),
  )
}
