/**
 * Sentry options for the website (decision D10). Kept free of runtime Sentry imports
 * so they can be unit tested; lib/sentry-client.ts passes them to `Sentry.init`.
 */
import type { BrowserOptions } from '@sentry/nextjs'
import { scrubBreadcrumb, scrubEvent } from './sentry-scrub'

/**
 * Default integrations Solara leaves out:
 *
 * - BrowserTracing: performance tracing is off (see `tracesSampleRate`), and the
 *   integration would otherwise add trace headers to same-origin requests.
 * - BrowserSession: release-health sessions send a request on every page load; error
 *   reporting should make a request only when an error happens.
 */
export const OMITTED_INTEGRATIONS = new Set(['BrowserTracing', 'BrowserSession'])

export function sentryOptions(dsn: string, release?: string): BrowserOptions {
  return {
    dsn,
    ...(release && { release }),
    environment: 'production',
    // SDK 11 replaced `sendDefaultPii` with `dataCollection`. Collect the minimum: no
    // user fields or IP address inference, no cookies, no headers except the user
    // agent, no bodies, no query strings and no local variables.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: { request: { allow: ['User-Agent'] }, response: false },
      httpBodies: [],
      urlQueryParams: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
      frameContextLines: 0,
    },
    // Errors only. Performance tracing would send page timings and URLs for a share of
    // every page load, which Solara does not need and which would use up the free
    // quota; 0 keeps it off even if a tracing integration were added later.
    tracesSampleRate: 0,
    // No session replay: replay records the screen, which can show personal data.
    integrations: defaults =>
      defaults.filter(integration => !OMITTED_INTEGRATIONS.has(integration.name)),
    maxBreadcrumbs: 30,
    // Errors from browser extensions are not Solara's to fix.
    denyUrls: [/^(chrome|moz|safari-web)-extension:\/\//],
    beforeSend: event => scrubEvent(event),
    beforeBreadcrumb: breadcrumb => scrubBreadcrumb(breadcrumb),
  }
}
