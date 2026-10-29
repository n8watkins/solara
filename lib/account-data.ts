// What the account page says the export holds and what deletion removes. The export's
// sections are keyed by the field names `exportAccountData` returns, so a test can check
// that the page names every section the download really has (REVIEW4 L4).

import { LEGAL_DETAILS } from './legal'

/** Each section of the JSON export, as the account page describes it. */
export const EXPORT_SECTIONS = {
  account: 'your preferences (places, skin type, profiles and activities)',
  billing: 'a summary of your plan and billing dates',
  scheduledActivities: 'your scheduled activities',
  importedEvents: 'your imported events',
  linkedCalendars: 'your linked calendars (their site and name, not their links)',
  googleCalendar: 'the Google calendars you show events from',
  outlookCalendar: 'the Outlook calendars you show events from',
  alerts: 'the alerts sent in the last week',
  eventHeadsUps: 'the Pro event heads-ups sent in the last week',
  reapplyReminder: 'your sunscreen reminder waiting to be sent, if any',
  notificationDevices: 'device registration metadata',
} as const

/** The export's bookkeeping fields, which are not sections of the person's data. */
export const EXPORT_METADATA_FIELDS = ['formatVersion', 'exportedAt', 'truncated'] as const

/** What deleting the account removes from Solara, in the order the page lists it. */
export const DELETED_DATA = [
  'your Solara preferences, profiles and activities',
  'scheduled activities',
  'imported events',
  'linked calendars',
  'your Google Calendar choices',
  'your Outlook calendar choices',
  'your calendar feed',
  'notification devices',
  'alert history',
  'sunscreen reminders',
  'your Solara sign-in',
] as const

/** "a, b and c". */
export function listInWords(items: readonly string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`
}

// The page leads with one short sentence for each action and keeps the details in a
// "What's included" disclosure, so a phone shows the controls instead of a wall of text.

/** The download's lead sentence. */
export const EXPORT_SUMMARY = 'Get a copy of your Solara data as a JSON file.'

/** What the download leaves out, under its list of sections. */
export const EXPORT_EXCLUDED =
  'Left out for security: capability tokens, such as your calendar feed address, and payment-provider identifiers.'

/** The deletion's lead sentence. */
export const DELETION_SUMMARY =
  'Permanently deletes your account, its data and your Solara sign-in. This cannot be undone.'

/** What happens beyond Solara's own data when the account is deleted, one point each. */
export const DELETION_NOTES = [
  'A subscription is canceled at once, without a refund for the current period, and your billing details are deleted at Stripe.',
  'Events already added to your Google Calendar stay there. To end Solara’s access, remove Solara at myaccount.google.com/connections.',
  'Events in your Outlook calendar stay there too, and Solara never kept a Microsoft token. To remove the permission you gave it, use your Microsoft account’s app permissions.',
  'If you had the free trial, a hashed record of it is kept for 2 years, so the trial is once per person.',
] as const

/** A list item's words as a line of its own: "Your imported events". */
export function capitalized(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** Where data requests go when the page cannot handle them (lib/legal.ts). */
export const DATA_REQUEST_EMAIL = LEGAL_DETAILS.contactEmail ?? 'contact@n8builds.dev'

/** How long an emailed export or deletion request may take, in days. */
export const DATA_REQUEST_DAYS = 30

/**
 * Which way the account page downloads and deletes: through the Functions when this
 * build can call them (they also reach server-only records and end billing), else in
 * this browser (lib/account-self-service.ts).
 */
export type AccountControlsPath = 'functions' | 'browser'

export function accountControlsPath(functionsReady: boolean): AccountControlsPath {
  // Emulator builds only: the signed-in e2e suite (account-self-service.e2e.ts) takes the
  // browser path with this key, as a build without Functions does. The flag is inlined at
  // build time, so every other build drops the branch, and scripts/check-no-emulators.mjs
  // proves the key's marker text is gone from the production export.
  if (process.env.NEXT_PUBLIC_FIREBASE_EMULATORS === '1') {
    try {
      if (localStorage.getItem('solara-firebase-emulators.functions-off') === '1') return 'browser'
    } catch {}
  }
  return functionsReady ? 'functions' : 'browser'
}

const SECTION_NAMES: Record<string, string> = {
  notificationDevices: 'devices',
  scheduledActivities: 'scheduled activities',
  importedEvents: 'imported events',
}

/**
 * The account page's note after a download. The server stops each collection at 5,000
 * records and names the cut-short sections in `truncated`, which only an account that
 * wrote records around the app can reach.
 */
export function exportedMessage(truncated: unknown): string {
  const sections = Array.isArray(truncated)
    ? truncated.flatMap(section =>
        typeof section === 'string' && SECTION_NAMES[section] ? [SECTION_NAMES[section]] : [],
      )
    : []
  if (sections.length === 0) return 'Your account data was downloaded.'
  return `Your account data was downloaded. It holds the first 5,000 records of ${listInWords(sections)}; the privacy policy says how to ask for the rest.`
}
