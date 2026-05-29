import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// These helpers read process.env at module-eval time, so re-import per scenario.
async function freshBilling() {
  vi.resetModules()
  return import('@/lib/billing')
}

describe('billing — checkout link', () => {
  const original = process.env.NEXT_PUBLIC_STRIPE_PAYMENT_LINK

  afterEach(() => {
    process.env.NEXT_PUBLIC_STRIPE_PAYMENT_LINK = original
  })

  it('reports unconfigured when no payment link env is set', async () => {
    delete process.env.NEXT_PUBLIC_STRIPE_PAYMENT_LINK
    const { isCheckoutConfigured, buildCheckoutUrl } = await freshBilling()
    expect(isCheckoutConfigured()).toBe(false)
    expect(buildCheckoutUrl({ email: 'a@b.com', uid: 'u1' })).toBeNull()
  })

  it('builds a prefilled link with uid as client_reference_id', async () => {
    process.env.NEXT_PUBLIC_STRIPE_PAYMENT_LINK = 'https://buy.stripe.com/test_123'
    const { isCheckoutConfigured, buildCheckoutUrl } = await freshBilling()
    expect(isCheckoutConfigured()).toBe(true)
    const url = buildCheckoutUrl({ email: 'runner@example.com', uid: 'uid_42' })!
    const parsed = new URL(url)
    expect(parsed.origin + parsed.pathname).toBe('https://buy.stripe.com/test_123')
    expect(parsed.searchParams.get('prefilled_email')).toBe('runner@example.com')
    expect(parsed.searchParams.get('client_reference_id')).toBe('uid_42')
  })

  it('omits params that are not provided', async () => {
    process.env.NEXT_PUBLIC_STRIPE_PAYMENT_LINK = 'https://buy.stripe.com/test_123'
    const { buildCheckoutUrl } = await freshBilling()
    const url = new URL(buildCheckoutUrl()!)
    expect(url.searchParams.has('prefilled_email')).toBe(false)
    expect(url.searchParams.has('client_reference_id')).toBe(false)
  })

  it('returns null for a malformed payment link', async () => {
    process.env.NEXT_PUBLIC_STRIPE_PAYMENT_LINK = 'not a url'
    const { buildCheckoutUrl } = await freshBilling()
    expect(buildCheckoutUrl({ uid: 'u' })).toBeNull()
  })
})
