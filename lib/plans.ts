// The plans as people see them: Pro pricing and the Guest / Free / Pro comparison.
// Free of Firebase so the static landing page (app/page.tsx) can render it; the
// billing UI reads it through lib/billing.ts.
import { TIER_LIMITS, forecastLabel } from './tiers'
import type { TierLevel } from './types'

/**
 * Pro pricing (confirmed 2026-10-24). Shown as a waitlist until the owner switches
 * billing on (lib/billing.ts isCheckoutConfigured); Stripe holds the real prices, and
 * `trialDays` matches the trial checkout gives (PRO_TRIAL_DAYS in @solara/core).
 */
export const PRO_PLAN = Object.freeze({
  monthly: '$2.99',
  yearly: '$19.99',
  trialDays: 7,
  /** The yearly price against twelve monthly payments, rounded down. */
  yearlySavingPercent: Math.floor((1 - 19.99 / (2.99 * 12)) * 100),
})

/** The comparison row for family profiles and planning by the most sensitive person. */
export const FAMILY_PROFILES_LABEL = 'Family profiles, most sensitive first'

/** One row of the plan comparison: what each plan gets, or whether it is included. */
export interface ProFeature {
  label: string
  guest: string | boolean
  free: string | boolean
  pro: string | boolean
}

function perTier(value: (tier: TierLevel) => string | boolean) {
  return { guest: value('anonymous'), free: value('free'), pro: value('paid') }
}

/**
 * Single source of truth for the plan comparison in the pricing dialog and on the
 * landing page, derived from the tier rules in lib/tiers.ts.
 */
export const PRO_FEATURES: ProFeature[] = [
  { label: 'Forecast', ...perTier(forecastLabel) },
  { label: 'Activities', ...perTier(tier => String(TIER_LIMITS[tier].activities)) },
  {
    label: 'Your plan',
    ...perTier(tier => (TIER_LIMITS[tier].storage === 'device' ? 'This device' : 'Synced')),
  },
  { label: 'Calendar sync', ...perTier(tier => TIER_LIMITS[tier].calendar) },
  {
    // Group planning by the most sensitive person comes with family profiles
    // (planningFor in packages/core/src/prefs.ts).
    label: FAMILY_PROFILES_LABEL,
    ...perTier(tier => TIER_LIMITS[tier].profiles > 1),
  },
  {
    label: 'Morning and UV alerts',
    ...perTier(tier =>
      TIER_LIMITS[tier].notifications ? (alertsLaunched() ? true : 'Coming soon') : false,
    ),
  },
]

/**
 * Whether Pro's morning and UV alerts are switched on: the deploy sets
 * NEXT_PUBLIC_ALERTS_ENABLED with the ALERTS_ENABLED repository variable, and only
 * together with the Functions that send them.
 */
export function alertsLaunched(): boolean {
  if (process.env.NEXT_PUBLIC_ALERTS_ENABLED === '1') return true
  // The UI harness shows the production default and opts in per screen with
  // ?alerts=on; outside a harness build this is compiled away.
  return (
    process.env.NEXT_PUBLIC_UI_HARNESS === '1' &&
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('alerts') === 'on'
  )
}
