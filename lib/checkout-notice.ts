// The notice shown after Stripe Checkout sends the visitor back to the app.
import type { CheckoutResult } from './billing'

export type CheckoutReturn =
  { kind: 'canceled' } | { kind: 'succeeded'; sessionId: string | null } | null

/** What the `checkout` and `session_id` query parameters say happened, if anything. */
export function checkoutReturn(params: URLSearchParams): CheckoutReturn {
  const checkout = params.get('checkout')
  if (checkout === 'canceled') return { kind: 'canceled' }
  if (checkout === 'success') return { kind: 'succeeded', sessionId: params.get('session_id') }
  return null
}

export const CHECKOUT_NOTICES = {
  canceled: 'Checkout was canceled. You were not charged.',
  noSession: 'Checkout returned successfully. Refresh to confirm your subscription.',
  confirming: 'Confirming your subscription...',
  pending: 'Your payment is still processing. Pro will activate automatically when it completes.',
  failed: 'Your payment did not complete. You can try again from the Pro plans.',
  succeeded: 'Pro is active on your account.',
  unreachable: 'Could not confirm your subscription. Check your connection and refresh.',
} as const

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
