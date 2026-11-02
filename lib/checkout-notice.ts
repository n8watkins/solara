// The notice shown after Stripe Checkout sends the visitor back to the app.
import type { CheckoutResult } from './billing'
import m from '@/messages/pricing'
import dashboard from '@/messages/dashboard'

export type CheckoutReturn =
  { kind: 'canceled' } | { kind: 'succeeded'; sessionId: string | null } | null

/** What the `checkout` and `session_id` query parameters say happened, if anything. */
export function checkoutReturn(params: URLSearchParams): CheckoutReturn {
  const checkout = params.get('checkout')
  if (checkout === 'canceled') return { kind: 'canceled' }
  if (checkout === 'success') return { kind: 'succeeded', sessionId: params.get('session_id') }
  return null
}

// Read when shown, in the page's language; the pricing words load with this code
// (lib/use-checkout-return.ts).
export const CHECKOUT_NOTICES = {
  get canceled() {
    return m.checkoutCanceled
  },
  get noSession() {
    return m.checkoutNoSession
  },
  get confirming() {
    return m.checkoutConfirming
  },
  get pending() {
    return m.checkoutPending
  },
  get failed() {
    return m.checkoutFailed
  },
  get succeeded() {
    return m.checkoutSucceeded
  },
  // Also shown when this code cannot load (lib/use-checkout-return.ts), so it stays
  // with the dashboard's words.
  get unreachable() {
    return dashboard.checkoutUnreachable
  },
}

/** The notice for a checkout session's state, or null while it is not written yet. */
export function checkoutResultNotice(result: CheckoutResult): string | null {
  if (result.status === 'waiting') return null
  return CHECKOUT_NOTICES[result.status]
}

/** The URL without the checkout parameters, so a reload does not repeat the notice. */
export function withoutCheckoutParams(href: string): string {
  const url = new URL(href)
  url.searchParams.delete('checkout')
  url.searchParams.delete('session_id')
  return `${url.pathname}${url.search}${url.hash}`
}
