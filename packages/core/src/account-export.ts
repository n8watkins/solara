// @solara/core/account-export: the account data export, one shape for both of the places
// that build it.
//
// - The `exportAccountData` Function (functions/src/account/export.ts) reads every
//   document of users/{uid} with the Admin SDK, server-only ones included.
// - Without Functions (the free Spark plan), the account page builds the same file in
//   the browser from the documents the rules let the owner read
//   (lib/account-self-service.ts).
//
// Both hand plain document data to buildAccountExport, so the file has the same
// sections, field names and filtering either way: the portable preferences only, never
// billing ids, tokens or internal bookkeeping. FUNCTION_RESPONSES.exportAccountData in
// functions-api.ts is the contract the browser reads the Function's answer with, and a
// test checks the browser's file against it too.
//
// A separate entry point, like event-import.ts, so only the account page loads it.

import { parseGoogleCalendarLink } from './google-calendar-events'
import { parseImportedEvent } from './events'
import { parseOutlookCalendarLink } from './outlook-calendar-events'
import { parseScheduledActivity } from './scheduled'
import { parseSubscriptionSummaries } from './event-subscriptions'
import { PREFERENCE_FIELDS } from './prefs'
import { subscriptionProviderOf } from './subscription'

/** Raises when a section's fields or meaning change; readers can tell files apart. */
export const ACCOUNT_EXPORT_FORMAT_VERSION = 1

/**
 * The most documents exported per collection. Well above what the rules let an account
 * keep (1,000 imported events, 500 scheduled activities), so it only cuts short an account
 * that wrote documents around the app.
 */
export const EXPORT_COLLECTION_LIMIT = 5000

type Data = Readonly<Record<string, unknown>>

/** A document as either SDK gives it: its id and its data. */
export interface ExportDocument {
  id: string
  data: Data
}

/** The export's sections that can be cut short at EXPORT_COLLECTION_LIMIT. */
export type TruncatedSection = 'notificationDevices' | 'scheduledActivities' | 'importedEvents'

/** What buildAccountExport needs: each document's data, or null when it does not exist. */
export interface AccountExportSources {
  account: Data | null
  /** users/{uid}/alertState/daily (server-only; null when it cannot be read). */
  alerts: Data | null
  /** users/{uid}/alertState/events (server-only; null when it cannot be read). */
  eventAlerts: Data | null
  /** users/{uid}/private/eventSubscriptions. */
  links: Data | null
  /** users/{uid}/meta/googleCalendar. */
  google: Data | null
  /** users/{uid}/meta/outlookCalendar. */
  outlook: Data | null
  devices: readonly ExportDocument[]
  scheduled: readonly ExportDocument[]
  events: readonly ExportDocument[]
  truncated: readonly TruncatedSection[]
}

const PORTABLE_ACCOUNT_FIELDS: ReadonlySet<string> = new Set(PREFERENCE_FIELDS)

/** The preferences schema's fields of the account document, nothing else. */
export function safeAccountData(data: Data | null | undefined): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(data || {}).filter(([key]) => PORTABLE_ACCOUNT_FIELDS.has(key)),
  )
}

/**
 * Milliseconds since the epoch of a `Date` or a Firestore `Timestamp` from either SDK
 * (both have `toMillis`), or `NaN` for anything else.
 */
export function toMillis(value: unknown): number {
  if (value instanceof Date) return value.getTime()
  const timestamp = value as { toMillis?: unknown } | null | undefined
  if (timestamp && typeof timestamp.toMillis === 'function') {
    return (timestamp as { toMillis: () => number }).toMillis()
  }
  return Number.NaN
}

function isoDate(value: unknown): string | null {
  const millis = toMillis(value)
  return Number.isFinite(millis) ? new Date(millis).toISOString() : null
}

/**
 * What the account's subscription is, from the fields billing keeps on the account,
 * without any Stripe identifier: the plan, its state, and the dates that matter.
 */
export function exportBillingSummary(data: Data | null | undefined) {
  const interval = data?.subscriptionPlan
  return {
    plan: data?.tier === 'paid' ? 'pro' : 'free',
    /** Where the subscription is bought: 'stripe' (also when unset), or null for an unknown store. */
    provider: subscriptionProviderOf(data),
    interval: interval === 'monthly' || interval === 'yearly' ? interval : null,
    status: typeof data?.subscriptionStatus === 'string' ? data.subscriptionStatus : null,
    proSince: isoDate(data?.proSince),
    trialEndsAt: isoDate(data?.subscriptionTrialEnd),
    currentPeriodEndsAt: isoDate(data?.subscriptionCurrentPeriodEnd),
    cancelsAtPeriodEnd: data?.subscriptionCancelAtPeriodEnd === true,
    paymentFailedSince: isoDate(data?.pastDueSince),
    freeTrialUsed: data?.stripeTrialUsed === true,
  }
}

/** Notification devices, without their push token. */
export function safeDeviceData(docs: readonly ExportDocument[]) {
  return docs.map(({ id, data }) => ({
    id,
    enabled: data.enabled === true,
    platform: data.platform || 'unknown',
    createdAt: data.createdAt || null,
    updatedAt: data.updatedAt || null,
    lastDeliveredAt: data.lastDeliveredAt || null,
    lastError: data.lastError || null,
  }))
}

/** Scheduled activities (Google Calendar events Solara created), as stored. */
export function safeScheduledData(docs: readonly ExportDocument[]) {
  return docs.flatMap(({ id, data }) => {
    const item = parseScheduledActivity(data)
    return item && item.eventId === id ? [item] : []
  })
}

/** Imported, linked, Google Calendar and Outlook events, as stored (docs/integrations/EVENTS.md). */
export function safeImportedEventData(docs: readonly ExportDocument[]) {
  return docs.flatMap(({ id, data }) => {
    const event = parseImportedEvent(data)
    return event && event.key === id ? [event] : []
  })
}

const ALERT_KINDS = ['morning', 'uv'] as const

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

/**
 * The Pro alerts sent recently (`alertState/daily`, kept 7 days): for each kind, the
 * last local day it was sent for and how that went, without the internal attempt id.
 */
export function alertHistory(data: Data | null | undefined) {
  return ALERT_KINDS.flatMap(kind => {
    const entry = record(data?.[kind])
    if (!entry || typeof entry.day !== 'string') return []
    return [
      {
        kind,
        day: entry.day,
        status: typeof entry.status === 'string' ? entry.status : null,
        attempts: typeof entry.attempts === 'number' ? entry.attempts : null,
        devicesReached: typeof entry.devices === 'number' ? entry.devices : null,
        sentAt: isoDate(entry.claimedAt),
        finishedAt: isoDate(entry.finishedAt),
        error: typeof entry.error === 'string' ? entry.error : null,
      },
    ]
  })
}

/**
 * The Pro heads-ups sent before events (`alertState/events`, kept 7 days): the event's
 * key and how the delivery went.
 */
export function eventHeadsUpHistory(data: Data | null | undefined) {
  return Object.entries(data ?? {}).flatMap(([field, value]) => {
    const entry = record(value)
    if (!/^[0-9a-f]{32}$/.test(field) || !entry) return []
    return [
      {
        eventKey: field,
        status: typeof entry.status === 'string' ? entry.status : null,
        attempts: typeof entry.attempts === 'number' ? entry.attempts : null,
        devicesReached: typeof entry.devices === 'number' ? entry.devices : null,
        sentAt: isoDate(entry.claimedAt),
        finishedAt: isoDate(entry.finishedAt),
      },
    ]
  })
}

/** The downloadable file: the same sections in the same order wherever it is built. */
export function buildAccountExport(sources: AccountExportSources, exportedAt: Date) {
  return {
    formatVersion: ACCOUNT_EXPORT_FORMAT_VERSION,
    exportedAt: exportedAt.toISOString(),
    account: sources.account ? safeAccountData(sources.account) : null,
    billing: exportBillingSummary(sources.account),
    notificationDevices: safeDeviceData(sources.devices),
    scheduledActivities: safeScheduledData(sources.scheduled),
    alerts: alertHistory(sources.alerts),
    importedEvents: safeImportedEventData(sources.events),
    eventHeadsUps: eventHeadsUpHistory(sources.eventAlerts),
    // Linked calendars without their links, which may hold private tokens.
    linkedCalendars: parseSubscriptionSummaries(sources.links),
    // The Google calendars events are read from (no token is ever stored), or null.
    googleCalendar: parseGoogleCalendarLink(sources.google),
    // The Outlook calendars events are read from (no token or account is stored), or null.
    outlookCalendar: parseOutlookCalendarLink(sources.outlook),
    truncated: [...sources.truncated],
  }
}

export type AccountExport = ReturnType<typeof buildAccountExport>
