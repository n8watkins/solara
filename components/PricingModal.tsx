'use client'
import { useState } from 'react'
import type { User } from 'firebase/auth'
import ActivityModalShell from './ActivityModalShell'
import { PRO_FEATURES, PRO_PRICE, isCheckoutConfigured, createCheckoutUrl } from '@/lib/billing'

interface Props {
  user?: User | null
  email?: string
  /** Called with the entered email when checkout isn't configured (waitlist fallback). */
  onJoinWaitlist?: (email: string) => void
  alreadyWaitlisted?: boolean
  onClose: () => void
}

function Cell({ value }: { value: string | boolean }) {
  if (typeof value === 'string') return <span className="font-semibold text-ink">{value}</span>
  return (
    <>
      <span aria-hidden="true" className={value ? 'font-bold text-success' : 'text-ink-3'}>
        {value ? '✓' : '–'}
      </span>
      <span className="sr-only">{value ? 'Included' : 'Not included'}</span>
    </>
  )
}

const HEADER_CELL = 'px-2 py-2.5 text-center text-[13px]'
const BODY_CELL = 'border-t-[0.5px] border-line-strong py-[11px] text-[13px] font-normal'
const NOTICE =
  'rounded-[10px] border-[0.5px] border-notice-border bg-notice px-3 py-2.5 text-[13px]'

export default function PricingModal({
  user,
  email,
  onJoinWaitlist,
  alreadyWaitlisted,
  onClose,
}: Props) {
  const checkoutReady = isCheckoutConfigured()
  const [waitEmail, setWaitEmail] = useState(email ?? '')
  const [joined, setJoined] = useState(false)
  const [checkoutLoading, setCheckoutLoading] = useState(false)
  const [checkoutError, setCheckoutError] = useState<string | null>(null)

  async function upgrade() {
    if (!user) return
    setCheckoutLoading(true)
    setCheckoutError(null)
    try {
      const url = await createCheckoutUrl(user)
      window.location.assign(url)
    } catch (error) {
      setCheckoutError(
        error instanceof Error ? error.message : 'Checkout is temporarily unavailable',
      )
      setCheckoutLoading(false)
    }
  }

  function join() {
    onJoinWaitlist?.(waitEmail.trim())
    setJoined(true)
  }

  return (
    <ActivityModalShell
      title="Solara Pro"
      description="Up to 20 activities, 10-day planning, saved places and family profiles."
      onClose={onClose}
      footer={
        checkoutReady ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[20px] font-extrabold text-ink">{PRO_PRICE}</p>
              <p className="text-[12px] text-ink-3">Cancel anytime</p>
            </div>
            <button
              type="button"
              className="btn btn-primary px-5.5 py-2.5 text-[14px]"
              onClick={() => void upgrade()}
              disabled={!user || checkoutLoading}
            >
              {checkoutLoading ? 'Opening checkout...' : 'Upgrade to Pro'}
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="email"
              autoComplete="email"
              aria-label="Email for early access"
              placeholder="Email for early access"
              value={waitEmail}
              onChange={e => setWaitEmail(e.target.value)}
              className="min-w-45 flex-1 text-[13px]"
            />
            <button
              type="button"
              className="btn btn-primary text-[13px] whitespace-nowrap"
              onClick={join}
              disabled={!waitEmail.trim()}
            >
              {joined || alreadyWaitlisted ? '✓ On the waitlist' : 'Join Pro waitlist'}
            </button>
          </div>
        )
      }
    >
      <div className="flex flex-col gap-3.5">
        {!checkoutReady && (
          <div className={`${NOTICE} text-ink-2`}>
            Pro is launching soon. Join the waitlist and you&apos;ll be first to upgrade.
          </div>
        )}
        {checkoutReady && !user && (
          <div role="alert" className={`${NOTICE} text-notice-ink`}>
            Sign in before starting checkout.
          </div>
        )}
        {checkoutError && (
          <p role="alert" className="text-[13px] text-danger">
            {checkoutError}
          </p>
        )}

        <div className="metric-card overflow-hidden p-0">
          <table className="w-full table-fixed border-collapse">
            <caption className="sr-only">Free and Pro plan features</caption>
            <colgroup>
              <col className="w-[44.4%]" />
              <col className="w-[27.8%]" />
              <col className="w-[27.8%]" />
            </colgroup>
            <thead>
              <tr>
                <td className="px-3.5 py-2.5" />
                <th scope="col" className={`${HEADER_CELL} font-bold text-ink-2`}>
                  Free
                </th>
                <th scope="col" className={`${HEADER_CELL} font-extrabold text-accent`}>
                  Pro
                </th>
              </tr>
            </thead>
            <tbody>
              {PRO_FEATURES.map(f => (
                <tr key={f.label}>
                  <th scope="row" className={`${BODY_CELL} px-3.5 text-left text-ink`}>
                    {f.label}
                  </th>
                  <td className={`${BODY_CELL} px-2 text-center`}>
                    <Cell value={f.free} />
                  </td>
                  <td className={`${BODY_CELL} bg-accent-soft px-2 text-center`}>
                    <Cell value={f.pro} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </ActivityModalShell>
  )
}
