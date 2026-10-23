// Response contracts of the browser-called Cloud Functions, validated by the web
// client (lib/functions-api.ts) so a malformed or unexpected answer surfaces as a clear
// error instead of an undefined field deep in the UI. Functions can type their
// handlers against the same schemas.

import * as z from 'zod/mini'
import { isValidFeedToken } from './feed-token'

function isUrl(value: string, check: (url: URL) => boolean): boolean {
  try {
    return check(new URL(value))
  } catch {
    return false
  }
}

/** Successful response bodies, by endpoint name. */
export const FUNCTION_RESPONSES = {
  createCheckoutSession: z.object({
    url: z.string().check(z.refine(url => url.startsWith('https://checkout.stripe.com/'))),
  }),
  createBillingPortalSession: z.object({
    url: z
      .string()
      .check(
        z.refine(url =>
          isUrl(
            url,
            ({ protocol, hostname }) => protocol === 'https:' && hostname === 'billing.stripe.com',
          ),
        ),
      ),
  }),
  /** A portable copy of the account; extra fields are kept for the download. */
  exportAccountData: z.looseObject({
    formatVersion: z.number(),
    exportedAt: z.string(),
    account: z.nullable(z.record(z.string(), z.unknown())),
    notificationDevices: z.array(z.unknown()),
  }),
  deleteAccount: z.object({ deleted: z.boolean(), deletionPending: z.boolean() }),
  registerNotificationDevice: z.object({
    deviceId: z.string(),
    registered: z.literal(true),
    migrationPending: z.optional(z.boolean()),
  }),
  removeNotificationDevice: z.object({ deviceId: z.string(), removed: z.literal(true) }),
  rotateCalendarFeed: z.object({ token: z.string().check(z.refine(isValidFeedToken)) }),
  revokeCalendarFeed: z.object({ revoked: z.boolean() }),
}

export type FunctionName = keyof typeof FUNCTION_RESPONSES
export type FunctionResponse<Name extends FunctionName> = z.output<
  (typeof FUNCTION_RESPONSES)[Name]
>

/** The validated success body of `name`, or null when it does not match the contract. */
export function parseFunctionResponse<Name extends FunctionName>(
  name: Name,
  body: unknown,
): FunctionResponse<Name> | null {
  const parsed = FUNCTION_RESPONSES[name].safeParse(body)
  return parsed.success ? (parsed.data as FunctionResponse<Name>) : null
}

const FunctionErrorSchema = z.object({
  error: z.catch(z.optional(z.string().check(z.minLength(1))), undefined),
  code: z.catch(z.optional(z.string()), undefined),
})

export type FunctionError = z.output<typeof FunctionErrorSchema>

/** The `{ error, code }` body of a failed call; empty when the body has neither. */
export function parseFunctionError(body: unknown): FunctionError {
  const parsed = FunctionErrorSchema.safeParse(body)
  return parsed.success ? parsed.data : {}
}
