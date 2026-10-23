// Deployment configuration for browser-called endpoints: the app origin and App Check.

import { getAppCheck } from 'firebase-admin/app-check'
import { defineString } from 'firebase-functions/params'

import { type ApiHandlerOptions, type HttpHandler, createApiHandler } from './http'

const APP_URL = defineString('APP_URL', { default: 'https://solara-uv.web.app' })

/** The web app origin, without a trailing slash. */
export const appOrigin = (): string => APP_URL.value().replace(/\/$/, '')

/**
 * Every browser-called endpoint shares one pipeline: exact-origin CORS, one method,
 * App Check, then the handler. `limited-use` consumes the App Check token so it cannot
 * be replayed; it is used for the two irreversible or money-moving actions.
 */
export function browserApi<T>(
  options: Omit<ApiHandlerOptions<T>, 'allowedOrigin' | 'appCheck'>,
): HttpHandler {
  return createApiHandler({ ...options, allowedOrigin: appOrigin, appCheck: () => getAppCheck() })
}
