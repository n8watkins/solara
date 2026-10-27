// Deployment configuration for browser-called endpoints: the app origin, App Check and
// the cost guard.

import type { FunctionName, FunctionResponse } from '#core'
import { getAppCheck } from 'firebase-admin/app-check'
import { defineString } from 'firebase-functions/params'

import { CostGuard } from './cost-guard'
import { db } from './firebase'
import { type ApiHandlerOptions, type HttpHandler, createApiHandler } from './http'

const APP_URL = defineString('APP_URL', { default: 'https://solara-uv.web.app' })

/** The web app origin, without a trailing slash. */
export const appOrigin = (): string => APP_URL.value().replace(/\/$/, '')

/** One cost guard per instance, shared by every guarded endpoint (shared/cost-guard.ts). */
export const costGuard = new CostGuard(db)

/**
 * The endpoints built with browserApi, which all verify App Check. A test checks that
 * every deployed HTTP function is one of these, or one of the two documented exceptions
 * (the signature-verified Stripe webhook and the token-authorized calendar feed).
 */
export const APP_CHECK_ENDPOINTS = new Set<string>()

/**
 * Every browser-called endpoint shares one pipeline: exact-origin CORS, one method, a
 * per-address limit, a body size limit, App Check, the cost guard where requested, then
 * the handler. `limited-use` consumes the App Check token so it cannot be replayed; it is
 * used for the two irreversible or money-moving actions.
 *
 * `name` is the exported function name, and the handler's body must match that
 * endpoint's response contract in @solara/core (FUNCTION_RESPONSES), which the web client
 * validates, so the server and the client cannot drift apart.
 */
export function browserApi<Name extends FunctionName>(
  options: Omit<
    ApiHandlerOptions<FunctionResponse<Name>>,
    'allowedOrigin' | 'appCheck' | 'costGuard'
  > & {
    name: Name
  },
): HttpHandler {
  APP_CHECK_ENDPOINTS.add(options.name)
  return createApiHandler({
    ...options,
    allowedOrigin: appOrigin,
    appCheck: () => getAppCheck(),
    costGuard: () => costGuard,
  })
}
