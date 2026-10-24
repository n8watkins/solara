import type { User } from 'firebase/auth'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from './firebase'
import { callFunction, functionsApiConfigured } from './functions-api'
import { normalizePrefs } from './prefs'
import type { UserPreferences } from './types'

// Prices and the plan comparison live in lib/plans.ts (no Firebase), shared with the
// landing page; they are re-exported here for the billing UI.
export { PRO_FEATURES, PRO_PLAN, type ProFeature } from './plans'

/** Whether authenticated server-side checkout is deployed and configured. */
export function isCheckoutConfigured(): boolean {
  return functionsApiConfigured()
}

export async function createCheckoutUrl(user: User): Promise<string> {
  // The response contract only accepts a Stripe Checkout URL (FUNCTION_RESPONSES).
  const { url } = await callFunction(user, 'createCheckoutSession', {
    method: 'POST',
    body: { attemptId: crypto.randomUUID() },
    limitedUse: true,
    freshIdToken: true,
    fallbackMessage: 'Checkout is temporarily unavailable',
  })
  return url
}

export async function createBillingPortalUrl(user: User): Promise<string> {
  // The response contract only accepts an https billing.stripe.com URL (FUNCTION_RESPONSES).
  const { url } = await callFunction(user, 'createBillingPortalSession', {
    method: 'POST',
    body: {},
    freshIdToken: true,
    fallbackMessage: 'Billing management is temporarily unavailable',
  })
  return new URL(url).toString()
}

export type CheckoutResult =
  | { status: 'waiting' }
  | { status: 'pending' }
  | { status: 'succeeded'; prefs: UserPreferences }
  | { status: 'failed' }

export function observeCheckoutResult(
  uid: string,
  sessionId: string,
  onResult: (result: CheckoutResult) => void,
  onError: () => void,
): () => void {
  if (!db) {
    onError()
    return () => {}
  }
  return onSnapshot(
    doc(db, 'users', uid),
    snapshot => {
      if (!snapshot.exists()) {
        onResult({ status: 'waiting' })
        return
      }
      const raw = snapshot.data()
      if (raw.stripeCheckoutSessionId !== sessionId) {
        onResult({ status: 'waiting' })
        return
      }
      if (raw.stripeCheckoutStatus === 'failed') {
        onResult({ status: 'failed' })
        return
      }
      const prefs = normalizePrefs(raw)
      if (raw.stripeCheckoutStatus === 'succeeded' && prefs?.tier === 'paid') {
        onResult({ status: 'succeeded', prefs })
        return
      }
      onResult({ status: 'pending' })
    },
    onError,
  )
}
