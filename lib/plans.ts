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

/**
 * What the plans' calendar feature is called in this build (REVIEW8 QA L7): "Calendar
 * sync" once something keeps a calendar up to date, adding to Google Calendar (the OAuth
 * client ID, which also shows Scheduled) or the live feed (the Functions, with App Check);
 * until then the feature is downloads only (the .ics export and "Add to Calendar").
 * Free of Firebase like the rest of this module, so it reads the build variables itself,
 * as isCalendarConfigured (lib/gcal-view.ts) and isFeedConfigured (lib/feed.ts) do.
 */
export function calendarFeatureLabel(
  env: { googleClientId?: string; functionsUrl?: string; appCheck?: string; emulators?: string } = {
    googleClientId: process.env.NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID,
    functionsUrl: process.env.NEXT_PUBLIC_FUNCTIONS_URL,
    appCheck: process.env.NEXT_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY,
    emulators: process.env.NEXT_PUBLIC_FIREBASE_EMULATORS,
  },
): 'Calendar sync' | 'Calendar export' {
  const feed = !!env.functionsUrl && (env.emulators === '1' || !!env.appCheck)
  return env.googleClientId || feed ? 'Calendar sync' : 'Calendar export'
}

/** The comparison row for linked calendars, which Solara keeps current on its server. */
export const LINKED_CALENDARS_LABEL = 'Linked calendars, kept current'

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
 * landing page, derived from the tier rules in packages/core/src/tiers.ts.
 */
export const PRO_FEATURES: ProFeature[] = [
  { label: 'Forecast', ...perTier(forecastLabel) },
  { label: 'Activities', ...perTier(tier => String(TIER_LIMITS[tier].activities)) },
  {
    label: 'Your plan',
    ...perTier(tier => (TIER_LIMITS[tier].storage === 'device' ? 'This device' : 'Synced')),
  },
  { label: calendarFeatureLabel(), ...perTier(tier => TIER_LIMITS[tier].calendar) },
  // Imported events need an account to keep them (docs/integrations/EVENTS.md).
  { label: 'UV at your events (.ics)', ...perTier(tier => tier !== 'anonymous') },
  // Linked calendars are Pro-only (REVIEW8 SEC L3), listed once they are switched on.
  ...(eventSubscriptionsLaunched()
    ? [{ label: LINKED_CALENDARS_LABEL, ...perTier(tier => tier === 'paid') }]
    : []),
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

/**
 * Whether linked calendars and Pro event heads-ups (docs/integrations/EVENTS.md, phase 2)
 * are switched on: the deploy sets NEXT_PUBLIC_EVENTS_SUBSCRIPTIONS_ENABLED with the
 * EVENTS_SUBSCRIPTIONS_ENABLED repository variable, and only together with the Functions
 * behind them.
 */
export function eventSubscriptionsLaunched(): boolean {
  if (process.env.NEXT_PUBLIC_EVENTS_SUBSCRIPTIONS_ENABLED === '1') return true
  // The UI harness shows the production default and opts in per screen with
  // ?subscriptions=on; outside a harness build this is compiled away.
  return (
    process.env.NEXT_PUBLIC_UI_HARNESS === '1' &&
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('subscriptions') === 'on'
  )
}

/**
 * Whether the Events section offers events already in Google Calendar
 * (docs/integrations/EVENTS.md, phase 2b): only in a build with the Google OAuth client
 * ID (the switch that also shows Scheduled) and NEXT_PUBLIC_GOOGLE_CALENDAR_EVENTS_ENABLED,
 * which the deploy sets from the GOOGLE_CALENDAR_EVENTS_ENABLED repository variable once
 * Google has verified the read-only Calendar scope it asks for.
 */
export function googleCalendarEventsLaunched(): boolean {
  if (
    process.env.NEXT_PUBLIC_GOOGLE_CALENDAR_EVENTS_ENABLED === '1' &&
    !!process.env.NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID
  ) {
    return true
  }
  // The UI harness has no client ID and shows the production default; a screen opts in
  // with ?gcal=on (and a fake Google). Outside a harness build this is compiled away.
  return (
    process.env.NEXT_PUBLIC_UI_HARNESS === '1' &&
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('gcal') === 'on'
  )
}

/**
 * Whether the Events section offers events already in Outlook (docs/integrations/OUTLOOK.md,
 * ROADMAP item 23): only in a build with the Azure app's client ID
 * (NEXT_PUBLIC_MICROSOFT_CLIENT_ID, from the MICROSOFT_CLIENT_ID repository variable) and
 * NEXT_PUBLIC_OUTLOOK_CALENDAR_EVENTS_ENABLED, which the deploy sets from the
 * OUTLOOK_CALENDAR_EVENTS_ENABLED repository variable once a real account has been checked.
 */
export function outlookCalendarEventsLaunched(): boolean {
  if (
    process.env.NEXT_PUBLIC_OUTLOOK_CALENDAR_EVENTS_ENABLED === '1' &&
    !!process.env.NEXT_PUBLIC_MICROSOFT_CLIENT_ID
  ) {
    return true
  }
  // The UI harness has no client ID and shows the production default; a screen opts in
  // with ?outlook=on (and a fake Microsoft). Outside a harness build this is compiled away.
  return (
    process.env.NEXT_PUBLIC_UI_HARNESS === '1' &&
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('outlook') === 'on'
  )
}

/**
 * Whether Pro event heads-ups are offered: with the alerts on and any source of outside
 * events switched on, linked calendars, Google Calendar or Outlook, as the server's
 * `alerts` job sends them (eventHeadsUpsEnabled in functions/src/notifications/config.ts,
 * REVIEW6 L1). Imported files then get them too.
 */
export function eventHeadsUpsLaunched(): boolean {
  return (
    alertsLaunched() &&
    (eventSubscriptionsLaunched() ||
      googleCalendarEventsLaunched() ||
      outlookCalendarEventsLaunched())
  )
}
