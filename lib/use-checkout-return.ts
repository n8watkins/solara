'use client'
import { useEffect, useEffectEvent } from 'react'
import type { User } from 'firebase/auth'
import type { UserPreferences } from './types'
import { withMessages } from './i18n'
import m from '@/messages/dashboard'

/**
 * After Stripe Checkout returns to the app (`?checkout=...`), reports progress
 * through `onNotice` and, once the subscription is confirmed, hands the paid
 * account to `onPaid` (lib/checkout-return.ts, which loads only then). The checkout
 * parameters are removed when the outcome is final.
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
    if (!user || !new URLSearchParams(window.location.search).has('checkout')) return
    let stop: (() => void) | undefined
    let stopped = false
    withMessages(['pricing'], () => import('./checkout-return')).then(
      ({ followCheckoutReturn }) => {
        if (!stopped) stop = followCheckoutReturn(user, { notify, paid })
      },
      () => notify(m.checkoutUnreachable),
    )
    return () => {
      stopped = true
      stop?.()
    }
  }, [user])
}
