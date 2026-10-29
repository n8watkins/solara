// Where a subscription was bought. A module of its own (`@solara/core/subscription`,
// `#core/subscription`), outside the main entry point, so it stays out of a guest's
// first load.

/**
 * Where a subscription was bought, kept on the account as `subscriptionProvider` (written
 * only by the server). Pro is sold on the web through Stripe today; a Google Play or App
 * Store source would join this list with its own entitlement check
 * (docs/integrations/ANDROID.md), so the checks never assume Stripe's fields.
 */
export const SUBSCRIPTION_PROVIDERS = Object.freeze(['stripe'] as const)
export type SubscriptionProvider = (typeof SUBSCRIPTION_PROVIDERS)[number]

/** The provider of an account that has no `subscriptionProvider` (every account so far). */
export const DEFAULT_SUBSCRIPTION_PROVIDER: SubscriptionProvider = 'stripe'

/** How the account page names where Pro is managed. */
export const SUBSCRIPTION_PROVIDER_NAMES: Readonly<Record<SubscriptionProvider, string>> =
  Object.freeze({ stripe: 'Stripe, on the web' })

/**
 * The account's subscription provider: Stripe when the field is absent or null, the stored
 * one when it is known, and null for one this code does not know (which grants nothing).
 */
export function subscriptionProviderOf(
  data: { subscriptionProvider?: unknown } | null | undefined,
): SubscriptionProvider | null {
  const value = data?.subscriptionProvider
  if (value === undefined || value === null) return DEFAULT_SUBSCRIPTION_PROVIDER
  return (SUBSCRIPTION_PROVIDERS as readonly unknown[]).includes(value)
    ? (value as SubscriptionProvider)
    : null
}
