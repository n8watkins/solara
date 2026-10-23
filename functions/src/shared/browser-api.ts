// Deployment configuration for browser-called endpoints: the app origin and App Check.

import type { FunctionName, FunctionResponse } from '#core'
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
 *
 * `name` is the exported function name, and the handler's body must match that
 * endpoint's response contract in @solara/core (FUNCTION_RESPONSES), which the web client
 * validates, so the server and the client cannot drift apart.
 */
export function browserApi<Name extends FunctionName>(
  options: Omit<ApiHandlerOptions<FunctionResponse<Name>>, 'allowedOrigin' | 'appCheck'> & {
    name: Name
  },
): HttpHandler {
  return createApiHandler({ ...options, allowedOrigin: appOrigin, appCheck: () => getAppCheck() })
}
