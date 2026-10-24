// Runs in the browser before the app hydrates (Next.js instrumentation-client).
// Starts error reporting when the build has a Sentry DSN; see lib/error-reporting.ts.
import { startErrorReporting } from './lib/error-reporting'

startErrorReporting()
