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
  if (value === true)
    return (
      <>
        <span aria-hidden="true" style={{ color: 'var(--success)', fontWeight: 700 }}>
          ✓
        </span>
        <span className="sr-only">Included</span>
      </>
    )
  if (value === false)
    return (
      <>
        <span aria-hidden="true" style={{ color: 'var(--text-3)' }}>
          —
        </span>
        <span className="sr-only">Not included</span>
      </>
    )
  return <span style={{ color: 'var(--text)', fontWeight: 600 }}>{value}</span>
}

const headerCell = {
  padding: '10px 8px',
  textAlign: 'center',
  fontSize: '13px',
  fontWeight: 700,
  color: 'var(--text-2)',
} as const

const bodyCell = {
  padding: '11px 8px',
  textAlign: 'center',
  fontSize: '13px',
  fontWeight: 400,
  borderTop: '0.5px solid var(--border-md)',
} as const

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
      description="Unlimited activities, 10-day planning, saved places and family profiles."
      onClose={onClose}
      footer={
        checkoutReady ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
              flexWrap: 'wrap',
            }}
          >
            <div>
              <p style={{ margin: 0, fontSize: '20px', fontWeight: 800, color: 'var(--text)' }}>
                {PRO_PRICE}
              </p>
              <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-3)' }}>Cancel anytime</p>
            </div>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void upgrade()}
              disabled={!user || checkoutLoading}
              style={{ fontSize: '14px', padding: '10px 22px' }}
            >
              {checkoutLoading ? 'Opening checkout...' : 'Upgrade to Pro'}
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <input
              type="email"
              autoComplete="email"
              aria-label="Email for early access"
              placeholder="Email for early access"
              value={waitEmail}
              onChange={e => setWaitEmail(e.target.value)}
              style={{ flex: 1, minWidth: '180px', fontSize: '13px' }}
            />
            <button
              type="button"
              className="btn btn-primary"
              onClick={join}
              disabled={!waitEmail.trim()}
              style={{ fontSize: '13px', whiteSpace: 'nowrap' }}
            >
              {joined || alreadyWaitlisted ? '✓ On the waitlist' : 'Join Pro waitlist'}
            </button>
          </div>
        )
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {!checkoutReady && (
          <div
            style={{
              padding: '10px 12px',
              borderRadius: '10px',
              background: 'var(--notice-bg)',
              border: '0.5px solid var(--notice-border)',
              fontSize: '13px',
              color: 'var(--text-2)',
            }}
          >
            Pro is launching soon. Join the waitlist and you&apos;ll be first to upgrade.
          </div>
        )}
        {checkoutReady && !user && (
          <div
            role="alert"
            style={{
              padding: '10px 12px',
              borderRadius: '10px',
              background: 'var(--notice-bg)',
              border: '0.5px solid var(--notice-border)',
              color: 'var(--notice-text)',
              fontSize: '13px',
            }}
          >
            Sign in before starting checkout.
          </div>
        )}
        {checkoutError && (
          <p role="alert" style={{ margin: 0, fontSize: '13px', color: 'var(--danger)' }}>
            {checkoutError}
          </p>
        )}

        <div className="metric-card" style={{ padding: 0, overflow: 'hidden' }}>
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              tableLayout: 'fixed',
            }}
          >
            <caption className="sr-only">Free and Pro plan features</caption>
            <colgroup>
              <col style={{ width: '44.4%' }} />
              <col style={{ width: '27.8%' }} />
              <col style={{ width: '27.8%' }} />
            </colgroup>
            <thead>
              <tr>
                <td style={{ padding: '10px 14px' }} />
                <th scope="col" style={headerCell}>
                  Free
                </th>
                <th scope="col" style={{ ...headerCell, fontWeight: 800, color: 'var(--accent)' }}>
                  Pro
                </th>
              </tr>
            </thead>
            <tbody>
              {PRO_FEATURES.map(f => (
                <tr key={f.label}>
                  <th
                    scope="row"
                    style={{
                      ...bodyCell,
                      padding: '11px 14px',
                      textAlign: 'left',
                      color: 'var(--text)',
                    }}
                  >
                    {f.label}
                  </th>
                  <td style={bodyCell}>
                    <Cell value={f.free} />
                  </td>
                  <td style={{ ...bodyCell, background: 'var(--accent-soft)' }}>
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
