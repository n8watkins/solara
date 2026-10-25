'use client'
import { useEffect, useEffectEvent } from 'react'
import type { User } from 'firebase/auth'
import { lazySubscription } from './firebase'
import { saveLocalPrefs } from './prefs'
import {
  CHECKOUT_NOTICES,
  checkoutResultNotice,
  checkoutReturn,
  withoutCheckoutParams,
} from './checkout-notice'
import type { UserPreferences } from './types'

/**
 * After Stripe Checkout returns to the app (`?checkout=...`), reports progress
 * through `onNotice` and, once the subscription is confirmed, hands the paid
 * account to `onPaid`. The checkout parameters are removed when the outcome is
 * final.
 */
export function useCheckoutReturn(
  user: User | null,
  {
    onNotice,
    onPaid,
  }: { onNotice: (notice: string) => void; onPaid: (prefs: UserPreferences) => void },
) {
  const notify = useEffectEvent(onNotice)
  const paid = useEffectEvent(onPaid)

  useEffect(() => {
    if (!user) return
    const returned = checkoutReturn(new URLSearchParams(window.location.search))
    if (!returned) return
    if (returned.kind === 'canceled') {
      notify(CHECKOUT_NOTICES.canceled)
      return
    }
    if (!returned.sessionId) {
      notify(CHECKOUT_NOTICES.noSession)
      return
    }

    notify(CHECKOUT_NOTICES.confirming)
    const { sessionId } = returned
    // The billing code loads only on a return from Checkout.
    return lazySubscription(
      async () => {
        const { observeCheckoutResult } = await import('./billing')
        return observeCheckoutResult(
          user.uid,
          sessionId,
          result => {
            const notice = checkoutResultNotice(result)
            if (!notice) return
            if (result.status !== 'pending') {
              window.history.replaceState({}, '', withoutCheckoutParams(window.location.href))
            }
            if (result.status === 'succeeded') {
              saveLocalPrefs(result.prefs)
              paid(result.prefs)
            }
            notify(notice)
          },
          () => notify(CHECKOUT_NOTICES.unreachable),
        )
      },
      () => notify(CHECKOUT_NOTICES.unreachable),
    )
  }, [user])
}
