// Live calendar feed - client helpers for the Cloud Functions behind the feed.
//
// The user subscribes their calendar app to a stable URL that re-fetches periodically; the
// `calendarFeed` function regenerates the .ics from the latest forecast. The token in the
// URL is the only credential, so the server mints it (256 bits, never chosen by a client)
// and indexes it by hash. The owner reads their current link from a server-written
// document, so it shows on every device, and can rotate or revoke it.

import { isValidFeedToken } from '@solara/core'
import type { User } from 'firebase/auth'
import { lazySubscription, loadFirebase } from './firebase'
import { callFunction, functionsApiConfigured, functionsBaseUrl } from './functions-api'

/** Whether the feed functions are deployed and callable from this build. */
export function isFeedConfigured(): boolean {
  return functionsApiConfigured()
}

/** The subscribe URL for a given token, or null when the feed isn't configured. */
export function buildFeedUrl(token: string): string | null {
  const base = functionsBaseUrl()
  if (!base || !token) return null
  return `${base}/calendarFeed?token=${encodeURIComponent(token)}`
}

/** The webcal:// variant some calendar apps (Apple) prefer for one-tap subscribe. */
export function buildWebcalUrl(token: string): string | null {
  const url = buildFeedUrl(token)
  return url ? url.replace(/^https?:\/\//, 'webcal://') : null
}

export type FeedTokenState = { status: 'loading' } | { status: 'ready'; token: string | null }

/**
 * Follows the signed-in user's current feed token. Reports `null` when no feed exists.
 * Returns an unsubscribe function.
 */
export function watchFeedToken(
  uid: string,
  onChange: (state: FeedTokenState) => void,
  onError: (error: Error) => void,
): () => void {
  onChange({ status: 'loading' })
  return lazySubscription(
    async () => {
      const db = (await loadFirebase())?.db
      if (!db) throw new Error('Firebase is not configured')
      const { doc, onSnapshot } = await import('firebase/firestore')
      return onSnapshot(
        doc(db, 'users', uid, 'private', 'calendarFeed'),
        snapshot => {
          const token: unknown = snapshot.exists() ? snapshot.get('token') : null
          onChange({
            status: 'ready',
            token: isValidFeedToken(token) ? token : null,
          })
        },
        onError,
      )
    },
    error => onError(error instanceof Error ? error : new Error(String(error))),
  )
}

/** Creates a feed link, replacing (and revoking) any previous one. */
export async function rotateFeedToken(user: User): Promise<string> {
  const fallbackMessage = 'Could not create a feed link. Try again shortly.'
  const { token } = await callFunction(user, 'rotateCalendarFeed', {
    method: 'POST',
    body: {},
    fallbackMessage,
  })
  return token
}

/** Turns the feed off; existing subscriptions stop updating. */
export async function revokeFeedToken(user: User): Promise<void> {
  await callFunction(user, 'revokeCalendarFeed', {
    method: 'DELETE',
    fallbackMessage: 'Could not turn off the feed. Try again shortly.',
  })
}
