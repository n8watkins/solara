'use client'

import Link from 'next/link'
import MessagesGate from '@/components/MessagesGate'
import { SIGN_IN_PATH } from '@/lib/app-routes'
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
import AccountControls, {
  AccountPageFrame,
  type AccountBusy,
} from '@/components/account/AccountControls'
import m from '@/messages/account'
import { withMessages } from '@/lib/i18n'

const FUNCTIONS_READY = functionsApiConfigured()

/** Where a failed deletion leaves the person, in plain words. */
const emailFallback = () => m.emailFallback(DATA_REQUEST_EMAIL, DATA_REQUEST_DAYS)

/** The page, in the visitor's language once its translations have arrived. */
export default function AccountPageInLanguage() {
  return (
    <MessagesGate messages={['account', 'pricing']}>
      <AccountPage />
    </MessagesGate>
  )
}

function AccountPage() {
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
    withMessages(
      ['account', 'editor', 'linking', 'sunscreen'],
      () => import('@/lib/account-self-service'),
    )
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
      if (!user) throw new Error(m.signInToDownload)
      const data =
        path === 'functions'
          ? await callFunction(user, 'exportAccountData', {
              method: 'GET',
              freshIdToken: true,
              fallbackMessage: m.exportFailed,
            })
          : await (
              await withMessages(
                ['account', 'editor', 'linking', 'sunscreen'],
                () => import('@/lib/account-self-service'),
              )
            ).exportAccountInBrowser(user.uid)
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
          : m.downloadFailed(DATA_REQUEST_EMAIL),
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
      setMessage(error instanceof Error ? error.message : m.billingFailed)
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
          ? m.deletionCanceled
          : (error as { code?: unknown } | null)?.code === 'auth/user-mismatch'
            ? m.differentAccount
            : m.notConfirmed,
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
    if (!services || !googleProvider) throw new Error(m.reauthNotConfigured)
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
        fallbackMessage: m.deletionIncomplete,
      })
      await finishDeletion(account, result.deletionPending ? 'pending' : 'done')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : m.deletionFailed)
      setBusy(null)
    }
  }

  async function deleteInBrowser(account: User) {
    setMessage(m.deletingData)
    try {
      const { deleteAccountInBrowser } = await withMessages(
        ['account', 'editor', 'linking', 'sunscreen'],
        () => import('@/lib/account-self-service'),
      )
      await deleteAccountInBrowser(account)
      await finishDeletion(account, 'done')
    } catch (error) {
      const stage = (error as { stage?: unknown } | null)?.stage
      if (stage === 'blocked') setCanDelete(false)
      setMessage(
        stage === 'blocked'
          ? m.blocked
          : stage === 'sign-in'
            ? m.signInLeft(emailFallback())
            : m.dataLeft(emailFallback()),
      )
      setBusy(null)
    }
  }

  /** Nothing of the deleted account may stay in this browser, then the page says so. */
  async function finishDeletion(account: User, state: 'pending' | 'done') {
    const { clearDeletedAccount } = await withMessages(
      ['settings', 'setup'],
      () => import('@/lib/account-local'),
    )
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
    <AccountPageFrame emailFallback={authReady && !deletion}>
      {!authReady ? (
        <div className="card">{m.loadingAccount}</div>
      ) : !user ? (
        <div className="card">
          <h2 className="mb-2 text-[18px] font-[650]">
            {deletion === 'done'
              ? m.deletedTitle
              : deletion === 'pending'
                ? m.pendingTitle
                : m.signInRequired}
          </h2>
          <p role="status" className="mb-[18px] leading-[1.55] text-ink-2">
            {deletion === 'done'
              ? m.deletedBody
              : deletion === 'pending'
                ? m.pendingBody
                : m.signInRequiredBody}
          </p>
          {deletion ? (
            <Link href="/" className="btn btn-primary no-underline">
              {m.backToSolara}
            </Link>
          ) : (
            <Link href={SIGN_IN_PATH} className="btn btn-primary no-underline">
              {m.goToSignIn}
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
    </AccountPageFrame>
  )
}

function deletionState(value: string | null): 'pending' | 'done' | null {
  return value === 'pending' || value === 'done' ? value : null
}
