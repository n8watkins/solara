'use client'

import Link from 'next/link'
import { APP_PATH, SIGN_IN_PATH } from '@/lib/app-routes'
import type { User } from 'firebase/auth'
import { useEffect, useState } from 'react'
import {
  firebaseEnabled,
  loadedFirebase,
  loadFirebase,
  storedSessionHint,
  storedSessionInIndexedDb,
} from '@/lib/firebase'
import { createBillingPortalUrl, loadBillingSummary, type BillingSummary } from '@/lib/billing'
import {
  accountControlsPath,
  DATA_REQUEST_DAYS,
  DATA_REQUEST_EMAIL,
  exportedMessage,
  type AccountControlsPath,
} from '@/lib/account-data'
import { isSignInCancelled } from '@/lib/auth-errors'
import { callFunction, functionsApiConfigured } from '@/lib/functions-api'
import AccountControls, { type AccountBusy } from '@/components/account/AccountControls'

const FUNCTIONS_READY = functionsApiConfigured()

/** Where a failed deletion leaves the person, in plain words. */
const EMAIL_FALLBACK = `If it keeps failing, email ${DATA_REQUEST_EMAIL} and we will delete your account and all its data within ${DATA_REQUEST_DAYS} days.`

export default function AccountPage() {
  const [user, setUser] = useState<User | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState<AccountBusy>(null)
  const [message, setMessage] = useState('')
  // After a deletion: 'pending' while the server finishes, 'done' once it has.
  const [deletion, setDeletion] = useState<'pending' | 'done' | null>(null)
  // The subscription as the server last recorded it; undefined while it loads.
  const [billing, setBilling] = useState<BillingSummary | null | undefined>(undefined)
  // Functions when this build has them, else this browser (read after hydration).
  const [path, setPath] = useState<AccountControlsPath>('functions')
  // Whether this page can delete the account; undefined while that is checked.
  const [canDelete, setCanDelete] = useState<boolean | undefined>(undefined)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Browser-only state is read after hydration so the static export's prerendered markup matches the first client render.
    setPath(accountControlsPath(FUNCTIONS_READY))
  }, [])

  useEffect(() => {
    if (!user) return
    if (path === 'functions') {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- The Functions handle every account; nothing to check.
      setCanDelete(true)
      return
    }
    let current = true
    // Without Functions, this browser deletes the account unless part of it is server-only.
    import('@/lib/account-self-service')
      .then(async ({ readAccountRecords, selfDeletionBlocker }) =>
        selfDeletionBlocker(await readAccountRecords(user.uid)),
      )
      .then(blocker => current && setCanDelete(blocker === null))
      // Unknown: let the person try; deletion checks again before deleting anything.
      .catch(() => current && setCanDelete(true))
    return () => {
      current = false
    }
  }, [user, path])

  useEffect(() => {
    if (!user) return
    let current = true
    loadBillingSummary(user.uid)
      .then(summary => current && setBilling(summary))
      .catch(() => current && setBilling(null))
    return () => {
      current = false
    }
  }, [user])

  useEffect(() => {
    // Firebase loads only when this browser holds a session (lib/firebase.ts).
    let unsubscribe: (() => void) | null = null
    let disposed = false
    const signedOut = () => {
      if (!disposed) setAuthReady(true)
    }
    void (async () => {
      const session = firebaseEnabled && (storedSessionHint() || (await storedSessionInIndexedDb()))
      const services = session ? await loadFirebase() : null
      const auth = services?.auth
      if (!services || !auth) return signedOut()
      // Deleting the account confirms it again in Google's popup: start Auth's popup
      // helper now, so that popup opens within the click.
      services.prepareSignInPopup()
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
    setDeletion(deletionState(new URLSearchParams(window.location.search).get('deletion')))
  }, [])

  async function downloadData() {
    setBusy('export')
    setMessage('')
    try {
      if (!user) throw new Error('Sign in again to download your data.')
      const data =
        path === 'functions'
          ? await callFunction(user, 'exportAccountData', {
              method: 'GET',
              freshIdToken: true,
              fallbackMessage: 'The export could not be completed.',
            })
          : await (await import('@/lib/account-self-service')).exportAccountInBrowser(user.uid)
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
      )
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `solara-account-${new Date().toISOString().slice(0, 10)}.json`
      anchor.click()
      URL.revokeObjectURL(url)
      setMessage(exportedMessage(data.truncated))
    } catch (error) {
      setMessage(
        path === 'functions' && error instanceof Error
          ? error.message
          : `Your data could not be downloaded. Check your connection and try again, or email ${DATA_REQUEST_EMAIL} for a copy.`,
      )
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
    // Started first, so Google's popup opens within the click.
    const reauthenticated = reauthenticate(user)
    try {
      await reauthenticated
    } catch (error) {
      setMessage(
        isSignInCancelled(error)
          ? 'Deletion was canceled because Google did not confirm your account. Nothing was deleted.'
          : (error as { code?: unknown } | null)?.code === 'auth/user-mismatch'
            ? 'That was a different Google account. Confirm with the account you are signed in with. Nothing was deleted.'
            : 'Google could not confirm your account, so nothing was deleted. Try again.',
      )
      setBusy(null)
      return
    }
    if (path === 'functions') await deleteThroughFunctions(user)
    else await deleteInBrowser(user)
  }

  async function reauthenticate(account: User): Promise<void> {
    const services = loadedFirebase()
    const googleProvider = services?.googleProvider
    if (!services || !googleProvider) throw new Error('Google reauthentication is not configured.')
    const { reauthenticateWithPopup } = await import('firebase/auth')
    await reauthenticateWithPopup(account, googleProvider, services.popupRedirectResolver)
  }

  async function deleteThroughFunctions(account: User) {
    try {
      // A limited-use App Check token is consumed by the server, so this request cannot be
      // replayed.
      const result = await callFunction(account, 'deleteAccount', {
        method: 'DELETE',
        body: { confirmation },
        limitedUse: true,
        freshIdToken: true,
        fallbackMessage: 'Deletion could not be completed.',
      })
      await finishDeletion(account, result.deletionPending ? 'pending' : 'done')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Deletion failed.')
      setBusy(null)
    }
  }

  async function deleteInBrowser(account: User) {
    setMessage('Deleting your data. Keep this page open.')
    try {
      const { deleteAccountInBrowser } = await import('@/lib/account-self-service')
      await deleteAccountInBrowser(account)
      await finishDeletion(account, 'done')
    } catch (error) {
      const stage = (error as { stage?: unknown } | null)?.stage
      if (stage === 'blocked') setCanDelete(false)
      setMessage(
        stage === 'blocked'
          ? 'Nothing was deleted: part of this account can only be removed by Solara’s servers.'
          : stage === 'sign-in'
            ? `Your data was deleted, but your sign-in could not be removed. Try again. ${EMAIL_FALLBACK}`
            : `Not all of your data could be deleted, so your account is still here. Check your connection and try again; deletion picks up where it stopped. ${EMAIL_FALLBACK}`,
      )
      setBusy(null)
    }
  }

  /** Nothing of the deleted account may stay in this browser, then the page says so. */
  async function finishDeletion(account: User, state: 'pending' | 'done') {
    const { clearDeletedAccount } = await import('@/lib/account-local')
    await clearDeletedAccount(account.uid)
    const auth = loadedFirebase()?.auth
    if (auth) {
      const { signOut } = await import('firebase/auth')
      await signOut(auth).catch(() => undefined)
    }
    window.location.assign(
      state === 'pending' ? '/account/?deletion=pending' : '/account/?deletion=done',
    )
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
              {deletion === 'done'
                ? 'Your account was deleted'
                : deletion === 'pending'
                  ? 'Your account deletion is in progress'
                  : 'Sign in required'}
            </h2>
            <p role="status" className="mb-[18px] leading-[1.55] text-ink-2">
              {deletion === 'done'
                ? 'Your Solara account and its data have been removed, and nothing of it is left in this browser.'
                : deletion === 'pending'
                  ? 'You have been signed out while Solara finishes canceling billing and removing your account data.'
                  : 'Return to Solara and sign in before using these controls.'}
            </p>
            {deletion ? (
              <Link href="/" className="btn btn-primary no-underline">
                Back to Solara
              </Link>
            ) : (
              <Link href={SIGN_IN_PATH} className="btn btn-primary no-underline">
                Go to sign in
              </Link>
            )}
          </div>
        ) : (
          <AccountControls
            billing={billing}
            billingPortalReady={FUNCTIONS_READY}
            canDelete={canDelete}
            busy={busy}
            confirmation={confirmation}
            message={message}
            onConfirmationChange={setConfirmation}
            onManageBilling={() => void manageBilling()}
            onDownload={() => void downloadData()}
            onDelete={() => void removeAccount()}
          />
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

function deletionState(value: string | null): 'pending' | 'done' | null {
  return value === 'pending' || value === 'done' ? value : null
}
