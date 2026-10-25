'use client'
import { use, useEffect, useState } from 'react'
import clsx from 'clsx'
import type { User } from 'firebase/auth'
import { isSignInCancelled } from '@/lib/auth-errors'
import { firebaseEnabled, loadFirebase, preloadFirebase } from '@/lib/firebase'
import { loadGuestPrefs } from '@/lib/guest'
import { createAccountPrefs } from '@/lib/prefs'
import { SignedInContext } from '@/lib/signed-in-context'
import type { UserPreferences } from '@/lib/types'
import { preloadSignedInParts } from './deferred'

interface Props {
  label?: string
  /**
   * Setup answers to seed a brand-new account with. Without them, a new account is
   * seeded from the guest plan kept in this browser (lib/guest.ts), so it carries
   * over. An existing account always wins: its saved (possibly Pro) plan is never
   * overwritten by whatever is on this device.
   */
  seedPrefs?: UserPreferences | null
  /**
   * Called after sign-in with the account document as `createAccountPrefs` read or
   * created it (null when there was nothing to seed it with). Defaults to the app's
   * SignedInContext, which loads the account.
   */
  onSignedIn?: (user: User, account: UserPreferences | null) => void
  /**
   * `sm` for the header, `md` (default) inline, `lg` for a full-width primary
   * action such as the last onboarding step.
   */
  size?: 'sm' | 'md' | 'lg'
  /** Layout utilities for the button (margins, min-width); not padding or type. */
  className?: string
  /**
   * Load Firebase as soon as the button shows, for screens whose main action is
   * signing in. Otherwise it loads when the pointer or focus reaches the button.
   * Either way the popup can open within the click's user activation.
   */
  preload?: boolean
}

/** Loads what sign-in and the signed-in screen need, ahead of the click. */
function warmUp() {
  preloadFirebase()
  void preloadSignedInParts()
}

const SIZES = {
  sm: 'px-3 py-1.5 text-[12px]',
  md: 'px-3.5 py-[9px] text-[13px]',
  lg: 'w-full p-[13px] text-[13px]',
} as const

export function GoogleIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" className="shrink-0">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  )
}

export default function GoogleSignInButton({
  label = 'Continue with Google',
  seedPrefs,
  onSignedIn,
  size = 'md',
  className,
  preload = false,
}: Props) {
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const signedIn = use(SignedInContext)

  useEffect(() => {
    if (preload) warmUp()
  }, [preload])

  if (!firebaseEnabled) return null

  async function handleClick() {
    setLoading(true)
    setError(null)
    // Read before the popup: once signed in, the app's own account load may clear the
    // guest plan from this browser while this is still running.
    const seed = seedPrefs
      ? ({ prefs: seedPrefs, source: 'setup' } as const)
      : (() => {
          const guest = loadGuestPrefs()
          return guest ? ({ prefs: guest, source: 'guest' } as const) : null
        })()
    try {
      const [services, { signInWithPopup }] = await Promise.all([
        loadFirebase(),
        import('firebase/auth'),
      ])
      const auth = services?.auth
      const provider = services?.googleProvider
      if (!auth || !provider) return
      const result = await signInWithPopup(auth, provider, services.popupRedirectResolver)
      const u = result.user
      if (!u) return
      // Creates the account only if it does not exist yet, in one transaction, so a
      // returning account's saved document is never written here.
      const account = seed ? await createAccountPrefs(u.uid, seed.prefs, seed.source) : null
      if (onSignedIn) onSignedIn(u, account)
      else signedIn?.(account)
    } catch (e) {
      // Closing the popup is the person's choice; the button simply comes back.
      if (isSignInCancelled(e)) return
      console.error('Google sign-in failed:', e)
      setError(
        // The first sign-in on a slow connection can take longer than the browser
        // allows a click to open a window; by now everything has loaded.
        (e as { code?: unknown } | null)?.code === 'auth/popup-blocked'
          ? 'Your browser blocked the sign-in window. Try again to continue.'
          : 'Could not finish signing in. Check your connection and try again.',
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <button
        onClick={() => void handleClick()}
        onPointerEnter={warmUp}
        onPointerDown={warmUp}
        onFocus={warmUp}
        disabled={loading}
        className={clsx(
          'flex items-center justify-center gap-2 rounded-[10px] border-[0.5px] border-line-strong bg-surface-card font-semibold text-ink transition-colors duration-[120ms]',
          loading && 'cursor-wait opacity-70',
          SIZES[size],
          className,
        )}
      >
        <GoogleIcon /> {loading ? 'Signing in...' : label}
      </button>
      {error && (
        <p role="alert" className="mt-2 text-center text-[12px] text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
