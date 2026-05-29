// Monetization for a static-export app: we can't run Stripe Checkout Sessions
// server-side, so Pro upgrades go through a Stripe Payment Link (a hosted URL).
// The link is configured via env so the repo ships no secrets.
//
// client_reference_id carries the Firebase uid into Stripe; a future webhook /
// Cloud Function reads it to flip the user's tier to "paid". Until that backend
// exists, checkout still works — fulfilment is just manual/pending.

const PAYMENT_LINK = process.env.NEXT_PUBLIC_STRIPE_PAYMENT_LINK
export const PRO_PRICE = process.env.NEXT_PUBLIC_PRO_PRICE || '$3.99/mo'

/** Whether a real checkout link is configured. When false, callers fall back to the waitlist. */
export function isCheckoutConfigured(): boolean {
  return !!PAYMENT_LINK
}

/**
 * Build the Stripe Payment Link with the user's email prefilled and uid attached
 * as client_reference_id. Returns null when no link is configured.
 */
export function buildCheckoutUrl(opts: { email?: string; uid?: string } = {}): string | null {
  if (!PAYMENT_LINK) return null
  try {
    const url = new URL(PAYMENT_LINK)
    if (opts.email) url.searchParams.set('prefilled_email', opts.email)
    if (opts.uid) url.searchParams.set('client_reference_id', opts.uid)
    return url.toString()
  } catch {
    return null
  }
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
