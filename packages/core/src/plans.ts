// Forecast days per plan, shared by the app (lib/tiers.ts TIER_LIMITS) and the live
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
