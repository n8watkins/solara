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
  if (value === true) return <span style={{ color: '#16A34A', fontWeight: 700 }}>✓</span>
  if (value === false) return <span style={{ color: 'var(--text-3)' }}>—</span>
  return <span style={{ color: 'var(--text)', fontWeight: 600 }}>{value}</span>
}

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
              placeholder="Email for early access"
              value={waitEmail}
              onChange={e => setWaitEmail(e.target.value)}
              style={{ flex: 1, minWidth: '180px', fontSize: '13px' }}
            />
            <button
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
              background: 'rgba(249,115,22,0.08)',
              border: '0.5px solid rgba(249,115,22,0.2)',
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
              background: '#FEF3C7',
              color: '#92400E',
              fontSize: '13px',
            }}
          >
            Sign in before starting checkout.
          </div>
        )}
        {checkoutError && (
          <p role="alert" style={{ margin: 0, fontSize: '13px', color: '#DC2626' }}>
            {checkoutError}
          </p>
        )}

        <div className="metric-card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr 1fr', gap: 0 }}>
            <div
              style={{
                padding: '10px 14px',
                fontSize: '12px',
                fontWeight: 700,
                color: 'var(--text-3)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            />
            <div
              style={{
                padding: '10px 8px',
                textAlign: 'center',
                fontSize: '13px',
                fontWeight: 700,
                color: 'var(--text-2)',
              }}
            >
              Free
            </div>
            <div
              style={{
                padding: '10px 8px',
                textAlign: 'center',
                fontSize: '13px',
                fontWeight: 800,
                color: 'var(--accent)',
              }}
            >
              Pro
            </div>

            {PRO_FEATURES.map(f => (
              <div key={f.label} style={{ display: 'contents' }}>
                <div
                  style={{
                    padding: '11px 14px',
                    fontSize: '13px',
                    color: 'var(--text)',
                    borderTop: '0.5px solid var(--border-md)',
                  }}
                >
                  {f.label}
                </div>
                <div
                  style={{
                    padding: '11px 8px',
                    textAlign: 'center',
                    fontSize: '13px',
                    borderTop: '0.5px solid var(--border-md)',
                  }}
                >
                  <Cell value={f.free} />
                </div>
                <div
                  style={{
                    padding: '11px 8px',
                    textAlign: 'center',
                    fontSize: '13px',
                    borderTop: '0.5px solid var(--border-md)',
                    background: 'rgba(249,115,22,0.04)',
                  }}
                >
                  <Cell value={f.pro} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </ActivityModalShell>
  )
}
