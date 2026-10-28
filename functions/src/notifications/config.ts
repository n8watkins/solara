// Pro alerts configuration: the switch that turns the scheduled alerts on, which events
// switches turn the event heads-ups on, and the runtime identity they run as.

import { defineBoolean } from 'firebase-functions/params'

import { EVENTS_SUBSCRIPTIONS_ENABLED, GOOGLE_CALENDAR_EVENTS_ENABLED } from '../events/config'

/**
 * Whether the scheduled `alerts` Function sends anything. Off until the owner switches
 * it on (the ALERTS_ENABLED repository variable); while off, each run returns at once.
 */
export const ALERTS_ENABLED = defineBoolean('ALERTS_ENABLED', { default: false })

/**
 * Whether the `alerts` Function (itself on with ALERTS_ENABLED) sends Pro heads-ups before
 * high-UV events: with either events switch on, linked calendars
 * (EVENTS_SUBSCRIPTIONS_ENABLED) or events from Google Calendar
 * (GOOGLE_CALENDAR_EVENTS_ENABLED), for every stored event alike (files, linked calendars,
 * Google Calendar). With both off, no heads-ups (REVIEW6 L1; default, owner may change,
 * 2026-10-28).
 */
export function eventHeadsUpsEnabled(
  switches: { linkedCalendars: boolean; googleCalendar: boolean } = {
    linkedCalendars: EVENTS_SUBSCRIPTIONS_ENABLED.value(),
    googleCalendar: GOOGLE_CALENDAR_EVENTS_ENABLED.value(),
  },
): boolean {
  return switches.linkedCalendars || switches.googleCalendar
}

/**
 * The service account the `alerts` Function runs as (BE-11: least privilege), from
 * ALERTS_SERVICE_ACCOUNT in functions/.env.<project>, which the deploy job writes from
 * the repository variable of the same name. Read when the deploy loads the source (it
 * passes the .env values to that load), so an unset value keeps the project's default
 * runtime identity and the first deploy never depends on an account that does not
 * exist yet. infra/alerts-identity.sh creates the account with only the roles it needs.
 */
export function alertsServiceAccount(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const value = env.ALERTS_SERVICE_ACCOUNT?.trim()
  return value ? value : undefined
}
