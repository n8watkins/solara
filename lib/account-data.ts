// What the account page says the export holds and what deletion removes. The export's
// sections are keyed by the field names `exportAccountData` returns, so a test can check
// that the page names every section the download really has (REVIEW4 L4).

import { LEGAL_DETAILS } from './legal'
import {
  alertsLaunched,
  eventHeadsUpsLaunched,
  eventSubscriptionsLaunched,
  googleCalendarEventsLaunched,
  outlookCalendarEventsLaunched,
} from './plans'
import m from '@/messages/account'
import core from '@solara/core/messages/core'
import { formatNumber } from '@solara/core/i18n'

/** Each section of the JSON export, as the account page describes it. */
// Read when shown, in the page's language.
export const EXPORT_SECTIONS = {
  get account() {
    return m.sectionAccount
  },
  get billing() {
    return m.sectionBilling
  },
  get scheduledActivities() {
    return m.sectionScheduled
  },
  get importedEvents() {
    return m.sectionImported
  },
  get linkedCalendars() {
    return m.sectionLinked
  },
  get googleCalendar() {
    return m.sectionGoogle
  },
  get outlookCalendar() {
    return m.sectionOutlook
  },
  get alerts() {
    return m.sectionAlerts
  },
  get eventHeadsUps() {
    return m.sectionHeadsUps
  },
  get reapplyReminder() {
    return m.sectionReminder
  },
  get notificationDevices() {
    return m.sectionDevices
  },
  get bookkeeping() {
    return m.sectionBookkeeping
  },
}

/** The export's bookkeeping fields, which are not sections of the person's data. */
export const EXPORT_METADATA_FIELDS = ['formatVersion', 'exportedAt', 'truncated'] as const

/**
 * What deleting the account removes from Solara, in the order the page lists it. These
 * English words are the items' keys; deletedDataShown gives them in the page's language.
 */
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

/** "a, b and c", in the page's language. */
export function listInWords(items: readonly string[]): string {
  return core.listAnd([...items])
}

// The page leads with one short sentence for each action and keeps the details in a
// "What's included" disclosure, so a phone shows the controls instead of a wall of text.

/** The download's lead sentence. */
export function exportSummary(): string {
  return m.exportSummary
}

/** What the download leaves out, under its list of sections. */
export function exportExcluded(): string {
  return m.exportExcluded
}

/** The deletion's lead sentence. */
export function deletionSummary(): string {
  return m.deletionSummary
}

/**
 * What happens beyond Solara's own data when the account is deleted, one point each, in
 * English; deletionNotesShown gives them in the page's language.
 */
export const DELETION_NOTES = [
  'A subscription is canceled at once, without a refund for the current period, and your billing details are deleted at Stripe.',
  "Events already added to your Google Calendar stay there. To end Solara's access, remove Solara at myaccount.google.com/connections.",
  "Events in your Outlook calendar stay there too, and Solara never kept a Microsoft token. To remove the permission you gave it, use your Microsoft account's app permissions.",
  'If you had the free trial, a hashed record of it is kept for 2 years, so the trial is once per person.',
] as const

/**
 * The features this build has switched on that leave data of their own. The account page
 * lists only what can exist (REVIEW9 QA L6): a Free account on a build without linked
 * calendars or alerts is not told about its linked calendars or Pro heads-ups. The
 * download itself always has every section (`EXPORT_SECTIONS`), empty when unused.
 */
export interface AccountFeatures {
  billing: boolean
  linkedCalendars: boolean
  googleCalendar: boolean
  outlookCalendar: boolean
  calendarFeed: boolean
  alerts: boolean
  eventHeadsUps: boolean
}

type Feature = keyof AccountFeatures

/** What this build has switched on (the same switches as the plan lists, lib/plans.ts). */
export function buildAccountFeatures(): AccountFeatures {
  const functions = !!process.env.NEXT_PUBLIC_FUNCTIONS_URL
  return {
    billing: functions && process.env.NEXT_PUBLIC_BILLING_ENABLED === '1',
    linkedCalendars: eventSubscriptionsLaunched(),
    // The OAuth client ID alone already adds events to Google Calendar (Scheduled).
    googleCalendar:
      !!process.env.NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID || googleCalendarEventsLaunched(),
    outlookCalendar: outlookCalendarEventsLaunched(),
    calendarFeed: functions,
    alerts: alertsLaunched(),
    eventHeadsUps: eventHeadsUpsLaunched(),
  }
}

/** The feature each export section needs; a section not listed is always there. */
const SECTION_FEATURE: Partial<Record<keyof typeof EXPORT_SECTIONS, Feature>> = {
  billing: 'billing',
  linkedCalendars: 'linkedCalendars',
  googleCalendar: 'googleCalendar',
  outlookCalendar: 'outlookCalendar',
  alerts: 'alerts',
  eventHeadsUps: 'eventHeadsUps',
  reapplyReminder: 'alerts',
  notificationDevices: 'alerts',
  bookkeeping: 'alerts',
}

/** The feature each deleted item needs, by its words in DELETED_DATA. */
const DELETED_FEATURE: Partial<Record<(typeof DELETED_DATA)[number], Feature>> = {
  'linked calendars': 'linkedCalendars',
  'your Google Calendar choices': 'googleCalendar',
  'your Outlook calendar choices': 'outlookCalendar',
  'your calendar feed': 'calendarFeed',
  'notification devices': 'alerts',
  'alert history': 'alerts',
  'sunscreen reminders': 'alerts',
}

/** The feature each note in DELETION_NOTES needs, in order. */
const NOTE_FEATURES: readonly Feature[] = [
  'billing',
  'googleCalendar',
  'outlookCalendar',
  'billing',
]

/** The export's sections this build can fill, as the page lists them. */
export function exportSectionsShown(features: AccountFeatures): string[] {
  return (Object.keys(EXPORT_SECTIONS) as (keyof typeof EXPORT_SECTIONS)[]).flatMap(key => {
    const feature = SECTION_FEATURE[key]
    return !feature || features[feature] ? [EXPORT_SECTIONS[key]] : []
  })
}

/** What deletion removes in this build, in the page's order. */
export function deletedDataShown(features: AccountFeatures): string[] {
  return DELETED_DATA.flatMap((item, i) => {
    const feature = DELETED_FEATURE[item]
    return !feature || features[feature] ? [m.deletedItems.split('|')[i] ?? item] : []
  })
}

/** What happens outside Solara in this build. */
export function deletionNotesShown(features: AccountFeatures): string[] {
  const notes = [m.noteBilling, m.noteGoogle, m.noteOutlook, m.noteTrial]
  return DELETION_NOTES.flatMap((note, i) => {
    const feature = NOTE_FEATURES[i]
    return !feature || features[feature] ? [notes[i] ?? note] : []
  })
}

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

const SECTION_NAMES: Record<string, () => string> = {
  notificationDevices: () => m.truncatedDevices,
  scheduledActivities: () => m.truncatedScheduled,
  importedEvents: () => m.truncatedImported,
}

/**
 * The account page's note after a download. The server stops each collection at 5,000
 * records and names the cut-short sections in `truncated`, which only an account that
 * wrote records around the app can reach.
 */
export function exportedMessage(truncated: unknown): string {
  const sections = Array.isArray(truncated)
    ? truncated.flatMap(section =>
        typeof section === 'string' && SECTION_NAMES[section] ? [SECTION_NAMES[section]()] : [],
      )
    : []
  if (sections.length === 0) return m.downloaded
  return m.downloadedTruncated(formatNumber(5000), listInWords(sections))
}
