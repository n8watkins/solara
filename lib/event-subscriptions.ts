// Linked calendars (docs/integrations/EVENTS.md, phase 2): the app's side. The links live
// on the server (functions/src/events/), which fetches them every few hours and writes
// their events next to imported ones; the app adds, refreshes and removes links through
// the `eventSubscriptions` endpoint and follows the summary the server keeps in
// users/{uid}/private/eventSubscriptions (host, label, refresh state; never the link).
// Only the lazily loaded Events section imports this module.
import {
  CALENDAR_PROVIDER_NAMES,
  EVENT_SUBSCRIPTION_LIMITS,
  IMPORTED_EVENT_LIMITS,
  SubscriptionSummarySchema,
  calendarProviderForHost,
  normalizeSubscriptionUrl,
  parseSubscriptionSummaries,
  subscriptionErrorMessage,
  type SubscriptionSummary,
} from '@solara/core/event-import'
import * as v from 'valibot'
import { lazySubscription, loadFirebase, loadedFirebase } from './firebase'
import { FunctionsApiError, callFunction } from './functions-api'
import m from '@/messages/linked'
import conn from '@/messages/connections'
import { formatNumber, intlTag, registeredNamespaces } from '@solara/core/i18n'
import linking from '@solara/core/messages/linking'

export type { SubscriptionSummary }

/** Where the Events section keeps linked calendars: the server, or memory in the UI harness. */
export interface SubscriptionsStore {
  /** Live summaries, oldest first. */
  subscribe(
    uid: string,
    onChange: (items: SubscriptionSummary[]) => void,
    onError: (error: Error) => void,
  ): () => void
  add(uid: string, url: string): Promise<SubscriptionSummary>
  refresh(uid: string, id: string): Promise<SubscriptionSummary>
  remove(uid: string, id: string): Promise<void>
}

function signedInUser(uid: string) {
  // Only a signed-in account sees the Events section, so Firebase has loaded.
  const user = loadedFirebase()?.auth?.currentUser
  if (!user || user.uid !== uid) throw new Error(m.signInAgain)
  return user
}

async function call(
  uid: string,
  body: { action: 'add' | 'refresh' | 'remove'; url?: string; id?: string },
): Promise<SubscriptionSummary | null> {
  const result = await callFunction(signedInUser(uid), 'eventSubscriptions', {
    method: 'POST',
    body,
    fallbackMessage: m.fallback,
  })
  if (result.subscription === null) return null
  const parsed = v.safeParse(SubscriptionSummarySchema, result.subscription)
  if (!parsed.success) throw new FunctionsApiError(m.fallback, 200, 'invalid-response')
  return parsed.output
}

export const serverSubscriptionsStore: SubscriptionsStore = {
  subscribe(uid, onChange, onError) {
    return lazySubscription(
      async () => {
        const db = (await loadFirebase())?.db
        if (!db) throw new Error('Firestore is not configured')
        const { doc, onSnapshot } = await import('firebase/firestore')
        return onSnapshot(
          doc(db, 'users', uid, 'private', 'eventSubscriptions'),
          snapshot => onChange(parseSubscriptionSummaries(snapshot.data())),
          onError,
        )
      },
      error => onError(error instanceof Error ? error : new Error(String(error))),
    )
  },
  async add(uid, url) {
    const summary = await call(uid, { action: 'add', url })
    if (!summary) throw new Error(m.fallback)
    return summary
  },
  async refresh(uid, id) {
    const summary = await call(uid, { action: 'refresh', id })
    if (!summary) throw new Error(m.fallback)
    return summary
  },
  async remove(uid, id) {
    await call(uid, { action: 'remove', id })
  },
}

/** PURE. Why a pasted link cannot be linked, before asking the server; null when it may be. */
export function linkProblem(raw: string): string | null {
  const normalized = normalizeSubscriptionUrl(raw)
  return normalized.ok ? null : subscriptionErrorMessage(normalized.error)
}

/**
 * A message the eventSubscriptions Function sent, in the page's language: the Functions
 * write in English (the linking messages of @solara/core), so a known one is shown in its
 * translation; anything else as sent.
 */
export function serverErrorText(message: string): string {
  const english = registeredNamespaces().get('linking')
  const key = english && Object.keys(english).find(k => english[k] === message)
  const text = key ? (linking as Record<string, unknown>)[key] : undefined
  return typeof text === 'string' ? text : message
}

/** PURE. "Updated 2 hours ago", "Updated Jun 14", "Not updated yet". */
export function updatedText(iso: string, nowMs: number): string {
  const at = Date.parse(iso)
  if (!iso || Number.isNaN(at)) return conn.notUpdated
  const minutes = Math.max(0, Math.round((nowMs - at) / 60_000))
  if (minutes < 1) return conn.updatedJustNow
  if (minutes < 60) return conn.updatedMinutesAgo(minutes)
  const hours = Math.round(minutes / 60)
  if (hours < 24) return conn.updatedHoursAgo(hours)
  return conn.updatedOn(
    new Date(at).toLocaleDateString(intlTag(), { month: 'short', day: 'numeric' }),
  )
}

export interface SubscriptionView {
  /** The label, else the provider's name, else the host (subscriptionTitle). */
  title: string
  /** "calendar.example.org · Updated 2 hours ago · 12 upcoming events". */
  meta: string
  /** What went wrong and what happens next, when the last check failed or it is paused. */
  problem: string | null
  /** Events that did not fit under the account's cap. */
  refused: string | null
}

/** Whether the calendar sent no name of its own: the server then labels it with its host. */
const unnamed = (item: SubscriptionSummary) => !item.label || item.label === item.host

/**
 * PURE. A linked calendar's name: its label, else the provider its host belongs to
 * ("Google Calendar", "iCloud"; docs/integrations/CALENDAR_LINKS.md), else the host.
 */
export function subscriptionTitle(item: SubscriptionSummary): string {
  if (!unnamed(item)) return item.label
  const provider = calendarProviderForHost(item.host)
  return provider ? CALENDAR_PROVIDER_NAMES[provider] : item.host
}

/** PURE. What one linked calendar's row says. */
export function subscriptionView(item: SubscriptionSummary, nowMs: number): SubscriptionView {
  const title = subscriptionTitle(item)
  // A title that is the host already names it, so the host is not repeated.
  const parts = [
    ...(title !== item.host ? [item.host] : []),
    updatedText(item.lastSuccessAt, nowMs),
  ]
  if (item.lastSuccessAt) parts.push(m.upcomingEvents(item.eventCount))
  const reason = subscriptionErrorMessage(item.error)
  let problem: string | null = null
  if (item.status === 'paused' && item.error === 'pro-required') {
    // Paused by the server while the account was not Pro (REVIEW8 SEC L3).
    problem = m.pausedPro
  } else if (item.status === 'paused') {
    problem = m.pausedFailures(reason)
  } else if (item.status === 'failing') {
    problem = m.lastCheckFailed(reason)
  }
  const refused = item.refused
    ? m.refused(item.refused, formatNumber(IMPORTED_EVENT_LIMITS.maxStored))
    : null
  return { title, meta: parts.join(' · '), problem, refused }
}

export const SUBSCRIPTION_CAP = EVENT_SUBSCRIPTION_LIMITS.maxPerAccount
export const REFRESH_HOURS = EVENT_SUBSCRIPTION_LIMITS.refreshHours
