// What the app does after Stripe Checkout sends the visitor back (`?checkout=...`), for
// lib/use-checkout-return.ts. It loads only on such a return, with the pricing words its
// notices read, so a guest's first load never carries it (ROADMAP item 52).
import type { User } from 'firebase/auth'
import { lazySubscription } from './firebase'
import { saveLocalPrefs } from './local-prefs'
import {
  CHECKOUT_NOTICES,
  checkoutResultNotice,
  checkoutReturn,
  withoutCheckoutParams,
} from './checkout-notice'
import type { UserPreferences } from './types'
import { withMessages } from './i18n'

/**
 * Reports the checkout's progress through `notify` and, once the subscription is
 * confirmed, hands the paid account to `paid`. The checkout parameters are removed when
 * the outcome is final. Returns a function that stops following it, if there is one.
 */
export function followCheckoutReturn(
  user: User,
  { notify, paid }: { notify: (notice: string) => void; paid: (prefs: UserPreferences) => void },
): (() => void) | undefined {
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
      const { observeCheckoutResult } = await withMessages(['pricing'], () => import('./billing'))
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
}
