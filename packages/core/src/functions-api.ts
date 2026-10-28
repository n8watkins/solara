// Response contracts of the browser-called Cloud Functions, validated by the web
// client (lib/functions-api.ts) so a malformed or unexpected answer surfaces as a clear
// error instead of an undefined field deep in the UI. Functions can type their
// handlers against the same schemas.

import * as v from 'valibot'
import { isValidFeedToken } from './feed-token'
import { OpenMeteoResponseSchema } from './forecast'
import { GeocodingResponseSchema } from './geocoding'
import { finiteNumber, isPlainRecord, looseRecord, record } from './schema'

function isUrl(value: string, check: (url: URL) => boolean): boolean {
  try {
    return check(new URL(value))
  } catch {
    return false
  }
}

/** Successful response bodies, by endpoint name. */
export const FUNCTION_RESPONSES = {
  createCheckoutSession: record({
    url: v.pipe(
      v.string(),
      v.check(url => url.startsWith('https://checkout.stripe.com/')),
    ),
  }),
  createBillingPortalSession: record({
    url: v.pipe(
      v.string(),
      v.check(url =>
        isUrl(
          url,
          ({ protocol, hostname }) => protocol === 'https:' && hostname === 'billing.stripe.com',
        ),
      ),
    ),
  }),
  /** A portable copy of the account; extra fields are kept for the download. */
  exportAccountData: looseRecord({
    formatVersion: finiteNumber,
    exportedAt: v.string(),
    account: v.nullable(
      v.pipe(v.custom<Record<string, unknown>>(isPlainRecord), v.record(v.string(), v.unknown())),
    ),
    notificationDevices: v.array(v.unknown()),
  }),
  deleteAccount: record({ deleted: v.boolean(), deletionPending: v.boolean() }),
  registerNotificationDevice: record({
    deviceId: v.string(),
    registered: v.literal(true),
    migrationPending: v.optional(v.boolean()),
  }),
  removeNotificationDevice: record({ deviceId: v.string(), removed: v.literal(true) }),
  rotateCalendarFeed: record({
    token: v.pipe(
      v.string(),
      v.check(token => isValidFeedToken(token)),
    ),
  }),
  revokeCalendarFeed: record({ revoked: v.boolean() }),
  /** The forecast proxy answers in Open-Meteo's shape, read by the same parser. */
  forecast: OpenMeteoResponseSchema,
  /** The place search proxy answers in Open-Meteo's geocoding shape. */
  placeSearch: GeocodingResponseSchema,
  /**
   * A linked calendar was added, refreshed or removed. The summary is read with
   * SubscriptionSummarySchema (@solara/core/event-import) by the lazily loaded Events
   * section, so that schema stays out of the main bundle.
   */
  eventSubscriptions: record({
    action: v.picklist(['add', 'refresh', 'remove']),
    subscription: v.nullable(looseRecord({ id: v.string() })),
  }),
}

export type FunctionName = keyof typeof FUNCTION_RESPONSES
export type FunctionResponse<Name extends FunctionName> = v.InferOutput<
  (typeof FUNCTION_RESPONSES)[Name]
>

/** The validated success body of `name`, or null when it does not match the contract. */
export function parseFunctionResponse<Name extends FunctionName>(
  name: Name,
  body: unknown,
): FunctionResponse<Name> | null {
  const parsed = v.safeParse(FUNCTION_RESPONSES[name], body)
  return parsed.success ? (parsed.output as FunctionResponse<Name>) : null
}

const FunctionErrorSchema = record({
  error: v.fallback(v.optional(v.pipe(v.string(), v.minLength(1))), undefined),
  code: v.fallback(v.optional(v.string()), undefined),
})

export type FunctionError = v.InferOutput<typeof FunctionErrorSchema>

/** The `{ error, code }` body of a failed call; empty when the body has neither. */
export function parseFunctionError(body: unknown): FunctionError {
  const parsed = v.safeParse(FunctionErrorSchema, body)
  return parsed.success ? parsed.output : {}
}
