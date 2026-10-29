// What the privacy policy (app/privacy/page.tsx) may promise about keeping data, tied to
// the switches that make each promise true (REVIEW8 SEC M3 and L7, QA M2). The page
// renders these sentences; lib/privacy-policy.test.ts checks every one in both states.
import { SCHEDULED_RETENTION_DAYS } from '@solara/core'
import { IMPORTED_EVENT_RETENTION_DAYS } from '@solara/core/event-import'
import { forecastProxyBaseUrl } from './forecast'

/**
 * Production steps that are run by hand (infra/), not build variables. Set one to true
 * in the pull request that records the step as done in production, and update
 * PRIVACY_LAST_UPDATED (lib/legal.ts) in the same change, since the policy text changes.
 */
export const PRODUCTION_DATA_STEPS = Object.freeze({
  /**
   * `infra/firestore-ttl.sh --apply` has turned the TTL policies on (it needs the Blaze
   * plan), and `gcloud firestore fields ttls list --project uv-activity-planner` lists
   * `expireAt` as ACTIVE for the `events` and `scheduled` groups.
   */
  firestoreTtl: false,
  /**
   * `infra/backups.sh --apply` has turned on point-in-time recovery (7 days) and the daily
   * backup kept for 14 days (Blaze).
   */
  backups: false,
})

/** The switches the policy's wording depends on. */
export interface PrivacySwitches {
  /** Firestore deletes expired events and scheduled activities itself (TTL policies). */
  firestoreTtl: boolean
  /** Deleted data can survive in point-in-time recovery and daily backups. */
  backups: boolean
  /** Forecasts and place search go through Solara's servers, which need App Check. */
  forecastProxy: boolean
}

/** The switches of this build and of production. */
export function privacySwitches(): PrivacySwitches {
  return {
    firestoreTtl: PRODUCTION_DATA_STEPS.firestoreTtl,
    backups: PRODUCTION_DATA_STEPS.backups,
    forecastProxy: forecastProxyBaseUrl() !== null,
  }
}

/**
 * How ended events and scheduled activities are deleted. The app deletes them on every
 * signed-in visit (lib/retention.ts, from components/App.tsx); Firestore's TTL policy
 * also deletes them for people who never come back, once it is on.
 */
function afterItEnds(
  days: number,
  switches: PrivacySwitches,
  deleted: 'it' | 'its record',
): string {
  const app = `once an event ended more than ${days} days ago, Solara deletes ${deleted} the next time you open the app while signed in`
  return switches.firestoreTtl
    ? `${app}, and Firestore deletes it automatically even if you never come back`
    : app
}

/** The "How long information is kept" lines whose truth depends on a switch. */
export function retentionLines(switches: PrivacySwitches) {
  const events = afterItEnds(IMPORTED_EVENT_RETENTION_DAYS, switches, 'it')
  return {
    scheduled: `Scheduled activities: until you remove the event or it is deleted in Google Calendar; ${afterItEnds(SCHEDULED_RETENTION_DAYS, switches, 'its record')}; and always when you delete your account.`,
    imported: `Imported events: until you remove them; ${events}; and always when you delete your account.`,
    google: `Events from your Google Calendar: until they are gone from your calendar or you disconnect, which removes them and the list of calendars; ${events}; and always when you delete your account.`,
    outlook: `Events from your Outlook calendar: until they are gone from your calendar or you disconnect, which removes them and the list of calendars; ${events}; and always when you delete your account. The Microsoft access is kept only in your browser's memory, for up to an hour.`,
    waitlist:
      'The Pro waitlist email: while your account exists, unless you ask to be taken off the waitlist.',
    backups: switches.backups
      ? 'Backups: deleted data can stay in encrypted database backups for up to 14 days (point-in-time recovery for 7 days, daily backups for 14), and is then gone.'
      : 'Backups: Solara keeps no backups of its database yet, so deleted data is gone at once.',
  }
}

/** Where reCAPTCHA (App Check) runs, for the Google Firebase entry of "Service providers". */
export function recaptchaScope(switches: PrivacySwitches): string {
  return switches.forecastProxy
    ? 'reCAPTCHA runs after you sign in, and also without an account, before your browser asks Solara for a forecast or a place search'
    : 'reCAPTCHA runs only after you sign in'
}
