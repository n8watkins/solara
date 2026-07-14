import type { User } from 'firebase/auth'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from './firebase'
import { normalizePrefs } from './prefs'
import type { UserPreferences } from './types'

const FUNCTIONS_URL = process.env.NEXT_PUBLIC_FUNCTIONS_URL?.replace(/\/$/, '')
export const PRO_PRICE = process.env.NEXT_PUBLIC_PRO_PRICE || '$3.99/mo'

/** Whether authenticated server-side checkout is deployed and configured. */
export function isCheckoutConfigured(): boolean {
  return !!FUNCTIONS_URL
}

export async function createCheckoutUrl(user: User): Promise<string> {
  if (!FUNCTIONS_URL) throw new Error('Checkout is not configured')
  const token = await user.getIdToken(true)
  const response = await fetch(`${FUNCTIONS_URL}/createCheckoutSession`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: '{}',
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok || typeof body.url !== 'string' || !body.url.startsWith('https://checkout.stripe.com/')) {
    throw new Error(body.error || 'Checkout is temporarily unavailable')
  }
  return body.url
}

export async function createBillingPortalUrl(user: User): Promise<string> {
  if (!FUNCTIONS_URL) throw new Error('Billing management is not configured')
  const token = await user.getIdToken(true)
  const response = await fetch(`${FUNCTIONS_URL}/createBillingPortalSession`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: '{}',
  })
  const body = await response.json().catch(() => ({}))
  let url: URL | null = null
  try { url = new URL(body.url) } catch {}
  if (!response.ok || url?.protocol !== 'https:' || url.hostname !== 'billing.stripe.com') {
    throw new Error(body.error || 'Billing management is temporarily unavailable')
  }
  return url.toString()
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
  return onSnapshot(doc(db, 'users', uid), snapshot => {
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
  }, onError)
}

export interface ProFeature {
  label: string
  free: string | boolean
  pro: string | boolean
}

/** Single source of truth for the Free-vs-Pro comparison shown in the pricing modal. */
export const PRO_FEATURES: ProFeature[] = [
  { label: 'Outdoor activities',       free: '3',        pro: 'Unlimited' },
  { label: 'Forecast horizon',         free: '2 days',   pro: '10 days' },
  { label: 'Best-day planning',        free: '2 days',   pro: 'Full 10-day' },
  { label: 'Calendar sync',            free: true,       pro: true },
  { label: 'Morning sun-window alerts', free: false,     pro: true },
]
