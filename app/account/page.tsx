'use client'

import Link from 'next/link'
import { APP_PATH, SIGN_IN_PATH } from '@/lib/app-routes'
import type { User } from 'firebase/auth'
import { useEffect, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import {
  firebaseEnabled,
  loadedFirebase,
  loadFirebase,
  storedSessionHint,
  storedSessionInIndexedDb,
} from '@/lib/firebase'
import { createBillingPortalUrl } from '@/lib/billing'
import { callFunction, functionsApiConfigured } from '@/lib/functions-api'
import { clearLocalPrefs } from '@/lib/prefs'
import { clearLocalNotificationState } from '@/lib/notifications'

const FUNCTIONS_READY = functionsApiConfigured()

export default function AccountPage() {
  const [user, setUser] = useState<User | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState<'billing' | 'export' | 'delete' | null>(null)
  const [message, setMessage] = useState('')
  const [deletionPending, setDeletionPending] = useState(false)

  useEffect(() => {
    // Firebase loads only when this browser holds a session (lib/firebase.ts).
    let unsubscribe: (() => void) | null = null
    let disposed = false
    const signedOut = () => {
      if (!disposed) setAuthReady(true)
    }
    void (async () => {
      const session = firebaseEnabled && (storedSessionHint() || (await storedSessionInIndexedDb()))
      const auth = session ? (await loadFirebase())?.auth : null
      if (!auth) return signedOut()
      const { onAuthStateChanged } = await import('firebase/auth')
      if (disposed) return
      unsubscribe = onAuthStateChanged(auth, value => {
        setUser(value)
        setAuthReady(true)
      })
    })().catch(signedOut)
    return () => {
      disposed = true
      unsubscribe?.()
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Browser-only state is read after hydration so the static export's prerendered markup matches the first client render.
    setDeletionPending(new URLSearchParams(window.location.search).get('deletion') === 'pending')
  }, [])

  async function downloadData() {
    setBusy('export')
    setMessage('')
    try {
      if (!user) throw new Error('Sign in again to download your data.')
      const data = await callFunction(user, 'exportAccountData', {
        method: 'GET',
        freshIdToken: true,
        fallbackMessage: 'The export could not be completed.',
      })
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
      )
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
      const googleProvider = loadedFirebase()?.googleProvider
      if (!googleProvider) throw new Error('Google reauthentication is not configured.')
      const { reauthenticateWithPopup, signOut } = await import('firebase/auth')
      await reauthenticateWithPopup(user, googleProvider)
      // A limited-use App Check token is consumed by the server, so this request cannot be
      // replayed.
      const result = await callFunction(user, 'deleteAccount', {
        method: 'DELETE',
        body: { confirmation },
        limitedUse: true,
        freshIdToken: true,
        fallbackMessage: 'Deletion could not be completed.',
      })
      clearLocalPrefs()
      await clearLocalNotificationState(user.uid)
      const auth = loadedFirebase()?.auth
      if (auth) await signOut(auth)
      window.location.assign(
        result.deletionPending ? '/account/?deletion=pending' : '/?account=deleted',
      )
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Deletion failed.')
      setBusy(null)
    }
  }

  return (
    <main className="min-h-screen bg-surface px-4 pt-8 pb-16">
      <div className="mx-auto max-w-[680px]">
        <Link href={APP_PATH} className="text-[14px] text-accent no-underline">
          ← Back to Solara
        </Link>
        <h1 className="mt-6 mb-2 text-[clamp(28px,6vw,42px)] leading-[1.1] font-[750]">
          Account controls
        </h1>
        <p className="mb-7 leading-[1.6] text-ink-2">
          Manage billing, download a portable copy of your Solara preferences, or permanently delete
          your account.
        </p>

        {!authReady ? (
          <div className="card">Loading your account...</div>
        ) : !user ? (
          <div className="card">
            <h2 className="mb-2 text-[18px] font-[650]">
              {deletionPending ? 'Account deletion is in progress' : 'Sign in required'}
            </h2>
            <p role="status" className="mb-[18px] leading-[1.55] text-ink-2">
              {deletionPending
                ? 'You have been signed out while Solara finishes canceling billing and removing your account data.'
                : 'Return to Solara and sign in before using these controls.'}
            </p>
            <Link href={SIGN_IN_PATH} className="btn btn-primary no-underline">
              Go to sign in
            </Link>
          </div>
        ) : (
          <div className="grid gap-[18px]">
            <AccountSection
              title="Billing and subscription"
              body="Update your payment method, review invoices, or cancel your subscription securely through Stripe."
            >
              <button
                className="btn btn-primary"
                disabled={busy !== null || !FUNCTIONS_READY}
                onClick={() => void manageBilling()}
              >
                {busy === 'billing' ? 'Opening...' : 'Manage subscription'}
              </button>
            </AccountSection>

            <AccountSection
              title="Download your data"
              body="The JSON export includes your account preferences and device registration metadata. Capability tokens and payment-provider identifiers are excluded for security."
            >
              <button
                className="btn btn-primary"
                disabled={busy !== null || !FUNCTIONS_READY}
                onClick={() => void downloadData()}
              >
                {busy === 'export' ? 'Preparing...' : 'Download account data'}
              </button>
            </AccountSection>

            <AccountSection
              danger
              title="Delete account"
              body="This permanently removes your Solara preferences and notification devices. If you have an active subscription, Solara attempts to cancel it before deleting the account."
            >
              <label className="mb-2 block text-[13px] font-semibold" htmlFor="delete-confirmation">
                Type DELETE to confirm
              </label>
              <div className="flex flex-wrap gap-2.5">
                <input
                  id="delete-confirmation"
                  value={confirmation}
                  onChange={event => setConfirmation(event.target.value)}
                  autoComplete="off"
                />
                <button
                  className="btn border-danger/40 text-danger"
                  disabled={confirmation !== 'DELETE' || busy !== null || !FUNCTIONS_READY}
                  onClick={() => void removeAccount()}
                >
                  {busy === 'delete' ? 'Deleting...' : 'Delete permanently'}
                </button>
              </div>
            </AccountSection>
          </div>
        )}

        {!FUNCTIONS_READY && authReady && (
          <p className="mt-[18px] rounded-[10px] border-[0.5px] border-notice-border bg-notice p-3 text-[13px] text-notice-ink">
            Account controls will become available after the Cloud Functions and App Check are
            configured.
          </p>
        )}
        {message && (
          <p role="status" className="mt-[18px] text-ink-2">
            {message}
          </p>
        )}
        <p className="mt-[30px] text-[13px] text-ink-3">
          Review the{' '}
          <Link href="/privacy/" className="underline">
            Privacy Policy
          </Link>{' '}
          and{' '}
          <Link href="/terms/" className="underline">
            Terms of Use
          </Link>
          .
        </p>
      </div>
    </main>
  )
}

function AccountSection({
  title,
  body,
  danger = false,
  children,
}: {
  title: string
  body: string
  danger?: boolean
  children: ReactNode
}) {
  return (
    <section className={clsx('card', danger && 'border-danger/40')}>
      <h2 className={clsx('mb-2 text-[18px] font-[650]', danger && 'text-danger')}>{title}</h2>
      <p className={clsx('leading-[1.55] text-ink-2', danger ? 'mb-3.5' : 'mb-[18px]')}>{body}</p>
      {children}
    </section>
  )
}
