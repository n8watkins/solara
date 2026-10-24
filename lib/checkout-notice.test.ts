import { describe, expect, it } from 'vitest'
import type { UserPreferences } from './types'
import {
  CHECKOUT_NOTICES,
  checkoutResultNotice,
  checkoutReturn,
  withoutCheckoutParams,
} from './checkout-notice'

describe('checkoutReturn', () => {
  it('reads a canceled or successful return, and ignores everything else', () => {
    expect(checkoutReturn(new URLSearchParams('checkout=canceled'))).toEqual({ kind: 'canceled' })
    expect(checkoutReturn(new URLSearchParams('checkout=success&session_id=cs_1'))).toEqual({
      kind: 'succeeded',
      sessionId: 'cs_1',
    })
    expect(checkoutReturn(new URLSearchParams('checkout=success'))).toEqual({
      kind: 'succeeded',
      sessionId: null,
    })
    expect(checkoutReturn(new URLSearchParams(''))).toBeNull()
    expect(checkoutReturn(new URLSearchParams('checkout=other'))).toBeNull()
  })
})

describe('checkoutResultNotice', () => {
  it('stays quiet until the session is written, then reports its state', () => {
    expect(checkoutResultNotice({ status: 'waiting' })).toBeNull()
    expect(checkoutResultNotice({ status: 'pending' })).toBe(CHECKOUT_NOTICES.pending)
    expect(checkoutResultNotice({ status: 'failed' })).toBe(CHECKOUT_NOTICES.failed)
    expect(checkoutResultNotice({ status: 'succeeded', prefs: {} as UserPreferences })).toBe(
      CHECKOUT_NOTICES.succeeded,
    )
  })
})

describe('withoutCheckoutParams', () => {
  it('drops only the checkout parameters and keeps the rest of the address', () => {
    expect(
      withoutCheckoutParams('https://solara.test/?checkout=success&session_id=cs_1&tab=x#top'),
    ).toBe('/?tab=x#top')
    expect(withoutCheckoutParams('https://solara.test/account/?checkout=canceled')).toBe(
      '/account/',
    )
  })
})
