// Forecast days per plan, shared by the app (tiers.ts TIER_LIMITS) and the live
// calendar feed, so the feed never shows more or fewer days than the app does.

/** Forecast days each plan sees, today included. */
export const PLAN_FORECAST_DAYS = Object.freeze({
  anonymous: 1,
  free: 2,
  paid: 10,
} as const)

/**
 * The forecast days of a stored account: Pro's for `tier: 'paid'` (the server-owned field
 * billing sets), Free's for any other signed-in account.
 */
export function accountForecastDays(tier: unknown): number {
  return tier === 'paid' ? PLAN_FORECAST_DAYS.paid : PLAN_FORECAST_DAYS.free
}

/**
 * Pro's free trial, in days: shown by the plans dialog (lib/plans.ts) and given by
 * checkout (functions/src/billing/checkout.ts) to an account that never had one.
 */
export const PRO_TRIAL_DAYS = 7

/** The ways to pay for Pro; checkout maps each to its Stripe price. */
export const BILLING_PLANS = Object.freeze(['monthly', 'yearly'] as const)
export type BillingPlan = (typeof BILLING_PLANS)[number]

export function isBillingPlan(value: unknown): value is BillingPlan {
  return (BILLING_PLANS as readonly unknown[]).includes(value)
}

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
