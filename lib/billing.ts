import type { BillingPlan } from '@solara/core'
import type { User } from 'firebase/auth'
import { lazySubscription, loadFirebase } from './firebase'
import { callFunction, functionsApiConfigured } from './functions-api'
import { normalizePrefs } from './prefs'
import type { UserPreferences } from './types'

// Prices and the plan comparison live in lib/plans.ts (no Firebase), shared with the
// landing page; they are re-exported here for the billing UI.
export { PRO_FEATURES, PRO_PLAN, type ProFeature } from './plans'

export type { BillingPlan }

/**
 * Whether Pro can be bought from this build: the Functions are deployed and the owner
 * switched billing on (NEXT_PUBLIC_BILLING_ENABLED, from the BILLING_ENABLED repository
 * variable). Until then the plans dialog offers the waitlist.
 */
export function isCheckoutConfigured(): boolean {
  return functionsApiConfigured() && process.env.NEXT_PUBLIC_BILLING_ENABLED === '1'
}

/** Whether the billing portal and the account's billing summary can be offered. */
export function isBillingManagementConfigured(): boolean {
  return functionsApiConfigured()
}

export async function createCheckoutUrl(
  user: User,
  plan: BillingPlan = 'monthly',
): Promise<string> {
  // The response contract only accepts a Stripe Checkout URL (FUNCTION_RESPONSES).
  const { url } = await callFunction(user, 'createCheckoutSession', {
    method: 'POST',
    body: { attemptId: crypto.randomUUID(), plan },
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
  return lazySubscription(async () => {
    const db = (await loadFirebase())?.db
    if (!db) {
      onError()
      return null
    }
    const { doc, onSnapshot } = await import('firebase/firestore')
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
  }, onError)
}

/** What the account page says about the subscription; never a Stripe identifier. */
export interface BillingSummary {
  pro: boolean
  plan: BillingPlan | null
  /** Stripe's subscription status (`trialing`, `active`, `past_due`, `canceled`, ...). */
  status: string | null
  trialEndsAt: Date | null
  periodEndsAt: Date | null
  cancelAtPeriodEnd: boolean
  /** Whether a Stripe customer exists, so the billing portal has something to manage. */
  hasBillingAccount: boolean
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return value
  const timestamp = value as { toDate?: unknown } | null | undefined
  if (timestamp && typeof timestamp.toDate === 'function') {
    const date = (timestamp as { toDate: () => Date }).toDate()
    return Number.isFinite(date.getTime()) ? date : null
  }
  return null
}

/** The billing summary from the server-owned fields of `users/{uid}` (functions/src/billing/webhook.ts). */
export function billingSummary(raw: Record<string, unknown> | undefined): BillingSummary {
  const plan = raw?.subscriptionPlan
  return {
    pro: raw?.tier === 'paid',
    plan: plan === 'monthly' || plan === 'yearly' ? plan : null,
    status: typeof raw?.subscriptionStatus === 'string' ? raw.subscriptionStatus : null,
    trialEndsAt: toDate(raw?.subscriptionTrialEnd),
    periodEndsAt: toDate(raw?.subscriptionCurrentPeriodEnd),
    cancelAtPeriodEnd: raw?.subscriptionCancelAtPeriodEnd === true,
    hasBillingAccount: typeof raw?.stripeCustomerId === 'string' && !!raw.stripeCustomerId,
  }
}

/** One plain sentence about the subscription, for the account page. */
export function billingStatusText(
  summary: BillingSummary,
  formatDay: (date: Date) => string,
): string {
  if (!summary.pro) {
    return summary.status === 'canceled' || summary.status === 'unpaid'
      ? 'Your Pro subscription has ended. You are on the Free plan.'
      : 'You are on the Free plan.'
  }
  const plan = summary.plan === 'yearly' ? 'Pro, yearly' : summary.plan ? 'Pro, monthly' : 'Pro'
  if (summary.status === 'past_due') {
    return `${plan}. Your last payment failed: update your payment method to keep Pro.`
  }
  if (summary.status === 'trialing' && summary.trialEndsAt) {
    return summary.cancelAtPeriodEnd
      ? `${plan}. Your free trial ends on ${formatDay(summary.trialEndsAt)} and will not renew.`
      : `${plan}. Your free trial ends on ${formatDay(summary.trialEndsAt)}; the first payment is taken then.`
  }
  if (summary.periodEndsAt) {
    return summary.cancelAtPeriodEnd
      ? `${plan}. Canceled: Pro stays until ${formatDay(summary.periodEndsAt)}.`
      : `${plan}. Renews on ${formatDay(summary.periodEndsAt)}.`
  }
  return `${plan}.`
}

/** Reads the account's billing summary once (the account page). */
export async function loadBillingSummary(uid: string): Promise<BillingSummary> {
  const db = (await loadFirebase())?.db
  if (!db) throw new Error('Account services are not available.')
  const { doc, getDoc } = await import('firebase/firestore')
  const snapshot = await getDoc(doc(db, 'users', uid))
  return billingSummary(snapshot.exists() ? snapshot.data() : undefined)
}
