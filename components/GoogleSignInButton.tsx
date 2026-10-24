'use client'
import { useState } from 'react'
import clsx from 'clsx'
import type { User } from 'firebase/auth'
import { signInWithPopup } from 'firebase/auth'
import { auth, googleProvider, firebaseEnabled } from '@/lib/firebase'
import { createAccountPrefs } from '@/lib/prefs'
import type { UserPreferences } from '@/lib/types'

// Shared between the dashboard activities gate and the onboarding sign-in step
// so the pitch can't drift between the two.
export const ACTIVITY_SIGNIN_BLURB =
  'Tell Solara what you do outside and it estimates lower-UV windows each day.'

interface Props {
  label?: string
  /**
   * Local prefs to seed a brand-new account with. Existing cloud prefs always win -
   * a returning user's saved (possibly Pro) profile must never be overwritten by
   * whatever guest state happens to be on this device.
   */
  seedPrefs?: UserPreferences | null
  onSignedIn?: (user: User) => void
  /**
   * `sm` for the header, `md` (default) inline, `lg` for a full-width primary
   * action such as the last onboarding step.
   */
  size?: 'sm' | 'md' | 'lg'
  /** Layout utilities for the button (margins, min-width); not padding or type. */
  className?: string
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
}: Props) {
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  if (!firebaseEnabled) return null

  async function handleClick() {
    if (!auth || !googleProvider) return
    setLoading(true)
    setError(null)
    try {
      const result = await signInWithPopup(auth, googleProvider)
      const u = result.user
      if (!u) return
      // Creates the account only if it does not exist yet, in one transaction, so a
      // returning account's saved document is never written here.
      if (seedPrefs) await createAccountPrefs(u.uid, seedPrefs)
      onSignedIn?.(u)
    } catch (e) {
      console.error('Google sign-in failed:', e)
      setError('Could not finish signing in. Check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <button
        onClick={() => void handleClick()}
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
