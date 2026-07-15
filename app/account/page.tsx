'use client'

import Link from 'next/link'
import { onAuthStateChanged, reauthenticateWithPopup, signOut, User } from 'firebase/auth'
import { useEffect, useState } from 'react'
import { auth, googleProvider } from '@/lib/firebase'
import { createBillingPortalUrl } from '@/lib/billing'
import { clearLocalPrefs } from '@/lib/prefs'
import { clearLocalNotificationState } from '@/lib/notifications'

const FUNCTIONS_URL = process.env.NEXT_PUBLIC_FUNCTIONS_URL?.replace(/\/$/, '')

export default function AccountPage() {
  const [user, setUser] = useState<User | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState<'billing' | 'export' | 'delete' | null>(null)
  const [message, setMessage] = useState('')
  const [deletionPending, setDeletionPending] = useState(false)

  useEffect(() => {
    if (!auth) { setAuthReady(true); return }
    return onAuthStateChanged(auth, value => { setUser(value); setAuthReady(true) })
  }, [])

  useEffect(() => {
    setDeletionPending(new URLSearchParams(window.location.search).get('deletion') === 'pending')
  }, [])

  async function authorizedRequest(path: string, init?: RequestInit) {
    if (!user || !FUNCTIONS_URL) throw new Error('Account controls are not configured yet.')
    const token = await user.getIdToken(true)
    const response = await fetch(`${FUNCTIONS_URL}/${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...init?.headers,
      },
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(body.error || 'The request could not be completed.')
    return body
  }

  async function downloadData() {
    setBusy('export')
    setMessage('')
    try {
      const data = await authorizedRequest('exportAccountData')
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `solara-account-${new Date().toISOString().slice(0, 10)}.json`
      anchor.click()
      URL.revokeObjectURL(url)
      setMessage('Your account data was downloaded.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Export failed.')
    } finally {
      setBusy(null)
    }
  }

  async function manageBilling() {
    if (!user) return
    setBusy('billing')
    setMessage('')
    try {
      window.location.assign(await createBillingPortalUrl(user))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Billing management failed.')
      setBusy(null)
    }
  }

  async function removeAccount() {
    if (!user || confirmation !== 'DELETE') return
    setBusy('delete')
    setMessage('')
    try {
      if (!googleProvider) throw new Error('Google reauthentication is not configured.')
      await reauthenticateWithPopup(user, googleProvider)
      const result = await authorizedRequest('deleteAccount', {
        method: 'DELETE',
        body: JSON.stringify({ confirmation }),
      }) as { deletionPending?: boolean }
      clearLocalPrefs()
      await clearLocalNotificationState(user.uid)
      if (auth) await signOut(auth)
      window.location.assign(result.deletionPending
        ? '/account/?deletion=pending'
        : '/?account=deleted')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Deletion failed.')
      setBusy(null)
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: '32px 16px 64px' }}>
      <div style={{ maxWidth: '680px', margin: '0 auto' }}>
        <Link href="/" style={{ color: 'var(--accent)', fontSize: '14px', textDecoration: 'none' }}>← Back to Solara</Link>
        <h1 style={{ margin: '24px 0 8px', fontSize: 'clamp(28px, 6vw, 42px)' }}>Account controls</h1>
        <p style={{ margin: '0 0 28px', color: 'var(--text-2)', lineHeight: 1.6 }}>
          Manage billing, download a portable copy of your Solara preferences, or permanently delete your account.
        </p>

        {!authReady ? (
          <div className="card">Loading your account...</div>
        ) : !user ? (
          <div className="card">
            <h2 style={{ marginTop: 0, fontSize: '18px' }}>
              {deletionPending ? 'Account deletion is in progress' : 'Sign in required'}
            </h2>
            <p role="status" style={{ color: 'var(--text-2)', lineHeight: 1.55 }}>
              {deletionPending
                ? 'You have been signed out while Solara finishes canceling billing and removing your account data.'
                : 'Return to Solara and sign in before using these controls.'}
            </p>
            <Link href="/" className="btn btn-primary" style={{ textDecoration: 'none' }}>Go to sign in</Link>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: '18px' }}>
            <section className="card">
              <h2 style={{ margin: '0 0 8px', fontSize: '18px' }}>Billing and subscription</h2>
              <p style={{ margin: '0 0 18px', color: 'var(--text-2)', lineHeight: 1.55 }}>
                Update your payment method, review invoices, or cancel your subscription securely through Stripe.
              </p>
              <button className="btn btn-primary" disabled={busy !== null || !FUNCTIONS_URL} onClick={manageBilling}>
                {busy === 'billing' ? 'Opening...' : 'Manage subscription'}
              </button>
            </section>

            <section className="card">
              <h2 style={{ margin: '0 0 8px', fontSize: '18px' }}>Download your data</h2>
              <p style={{ margin: '0 0 18px', color: 'var(--text-2)', lineHeight: 1.55 }}>
                The JSON export includes your account preferences and device registration metadata.
                Capability tokens and payment-provider identifiers are excluded for security.
              </p>
              <button className="btn btn-primary" disabled={busy !== null || !FUNCTIONS_URL} onClick={downloadData}>
                {busy === 'export' ? 'Preparing...' : 'Download account data'}
              </button>
            </section>

            <section className="card" style={{ borderColor: '#FCA5A5' }}>
              <h2 style={{ margin: '0 0 8px', fontSize: '18px', color: '#DC2626' }}>Delete account</h2>
              <p style={{ margin: '0 0 14px', color: 'var(--text-2)', lineHeight: 1.55 }}>
                This permanently removes your Solara preferences and notification devices.
                If you have an active subscription, Solara attempts to cancel it before deleting the account.
              </p>
              <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px', fontWeight: 600 }} htmlFor="delete-confirmation">
                Type DELETE to confirm
              </label>
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                <input id="delete-confirmation" value={confirmation} onChange={event => setConfirmation(event.target.value)} autoComplete="off" />
                <button
                  className="btn"
                  style={{ color: '#DC2626', borderColor: '#FCA5A5' }}
                  disabled={confirmation !== 'DELETE' || busy !== null || !FUNCTIONS_URL}
                  onClick={removeAccount}
                >
                  {busy === 'delete' ? 'Deleting...' : 'Delete permanently'}
                </button>
              </div>
            </section>
          </div>
        )}

        {!FUNCTIONS_URL && authReady && (
          <p style={{ marginTop: '18px', padding: '12px', borderRadius: '10px', background: '#FEF3C7', color: '#92400E', fontSize: '13px' }}>
            Account controls will become available after the Cloud Functions URL is configured.
          </p>
        )}
        {message && <p role="status" style={{ marginTop: '18px', color: 'var(--text-2)' }}>{message}</p>}
        <p style={{ marginTop: '30px', fontSize: '13px', color: 'var(--text-3)' }}>
          Review the <Link href="/privacy/">Privacy Policy</Link> and <Link href="/terms/">Terms of Use</Link>.
        </p>
      </div>
    </div>
  )
}
