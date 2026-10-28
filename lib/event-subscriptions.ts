// Linked calendars (docs/integrations/EVENTS.md, phase 2): the app's side. The links live
// on the server (functions/src/events/), which fetches them every few hours and writes
// their events next to imported ones; the app adds, refreshes and removes links through
// the `eventSubscriptions` endpoint and follows the summary the server keeps in
// users/{uid}/private/eventSubscriptions (host, label, refresh state; never the link).
// Only the lazily loaded Events section imports this module.
import {
  EVENT_SUBSCRIPTION_LIMITS,
  IMPORTED_EVENT_LIMITS,
  SubscriptionSummarySchema,
  normalizeSubscriptionUrl,
  parseSubscriptionSummaries,
  subscriptionErrorMessage,
  type SubscriptionSummary,
} from '@solara/core/event-import'
import * as v from 'valibot'
import { lazySubscription, loadFirebase, loadedFirebase } from './firebase'
import { FunctionsApiError, callFunction } from './functions-api'

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
  if (!user || user.uid !== uid) throw new Error('Sign in again to manage linked calendars.')
  return user
}

const FALLBACK = 'Could not reach Solara. Check your connection and try again.'

async function call(
  uid: string,
  body: { action: 'add' | 'refresh' | 'remove'; url?: string; id?: string },
): Promise<SubscriptionSummary | null> {
  const result = await callFunction(signedInUser(uid), 'eventSubscriptions', {
    method: 'POST',
    body,
    fallbackMessage: FALLBACK,
  })
  if (result.subscription === null) return null
  const parsed = v.safeParse(SubscriptionSummarySchema, result.subscription)
  if (!parsed.success) throw new FunctionsApiError(FALLBACK, 200, 'invalid-response')
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
    if (!summary) throw new Error(FALLBACK)
    return summary
  },
  async refresh(uid, id) {
    const summary = await call(uid, { action: 'refresh', id })
    if (!summary) throw new Error(FALLBACK)
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

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`

/** PURE. "Updated 2 hours ago", "Updated Jun 14", "Not updated yet". */
export function updatedText(iso: string, nowMs: number): string {
  const at = Date.parse(iso)
  if (!iso || Number.isNaN(at)) return 'Not updated yet'
  const minutes = Math.max(0, Math.round((nowMs - at) / 60_000))
  if (minutes < 1) return 'Updated just now'
  if (minutes < 60) return `Updated ${plural(minutes, 'minute')} ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `Updated ${plural(hours, 'hour')} ago`
  return `Updated ${new Date(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
}

export interface SubscriptionView {
  /** The label, or the host when there is none. */
  title: string
  /** "calendar.example.org · Updated 2 hours ago · 12 upcoming events". */
  meta: string
  /** What went wrong and what happens next, when the last check failed or it is paused. */
  problem: string | null
  /** Events that did not fit under the account's cap. */
  refused: string | null
}

/** PURE. What one linked calendar's row says. */
export function subscriptionView(item: SubscriptionSummary, nowMs: number): SubscriptionView {
  const title = item.label || item.host
  // The host names a link without a label already, so it is not repeated.
  const parts = [...(item.label ? [item.host] : []), updatedText(item.lastSuccessAt, nowMs)]
  if (item.lastSuccessAt) parts.push(plural(item.eventCount, 'upcoming event'))
  const reason = subscriptionErrorMessage(item.error)
  let problem: string | null = null
  if (item.status === 'paused') {
    problem = `Paused after a week of failed checks. ${reason} Refresh to try again.`
  } else if (item.status === 'failing') {
    problem = `The last check failed. ${reason} Solara will try again automatically.`
  }
  const refused = item.refused
    ? `${plural(item.refused, 'event')} did not fit: an account keeps at most ${IMPORTED_EVENT_LIMITS.maxStored.toLocaleString('en-US')} events. Remove some to make room.`
    : null
  return { title, meta: parts.join(' · '), problem, refused }
}

export const SUBSCRIPTION_CAP = EVENT_SUBSCRIPTION_LIMITS.maxPerAccount
export const REFRESH_HOURS = EVENT_SUBSCRIPTION_LIMITS.refreshHours
