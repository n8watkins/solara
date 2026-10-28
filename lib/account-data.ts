// What the account page says the export holds and what deletion removes. The export's
// sections are keyed by the field names `exportAccountData` returns, so a test can check
// that the page names every section the download really has (REVIEW4 L4).

/** Each section of the JSON export, as the account page describes it. */
export const EXPORT_SECTIONS = {
  account: 'your preferences (places, skin type, profiles and activities)',
  billing: 'a summary of your plan and billing dates',
  scheduledActivities: 'your scheduled activities',
  importedEvents: 'your imported events',
  linkedCalendars: 'your linked calendars (their site and name, not their links)',
  googleCalendar: 'the Google calendars you show events from',
  alerts: 'the Pro alerts sent in the last week',
  eventHeadsUps: 'the Pro event heads-ups sent in the last week',
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
  'your calendar feed',
  'notification devices',
  'alert history',
  'your Solara sign-in',
] as const

/** "a, b and c". */
export function listInWords(items: readonly string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`
}

export const EXPORT_DESCRIPTION = `The JSON export includes ${listInWords(
  Object.values(EXPORT_SECTIONS),
)}. Capability tokens, such as your calendar feed address, and payment-provider identifiers are excluded for security.`

export const DELETION_DESCRIPTION = `This permanently removes ${listInWords(
  DELETED_DATA,
)}. A subscription is canceled at once, without a refund for the current period, and your billing details are deleted at Stripe. Events already added to your Google Calendar stay there; to end Solara’s access to your Google Calendar, remove Solara at myaccount.google.com/connections. If you had the free trial, a hashed record of it is kept for 2 years so the trial is once per person.`

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
