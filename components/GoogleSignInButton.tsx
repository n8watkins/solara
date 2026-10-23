'use client'
import type { CSSProperties } from 'react'
import { useState } from 'react'
import type { User } from 'firebase/auth'
import { signInWithPopup } from 'firebase/auth'
import { auth, googleProvider, firebaseEnabled } from '@/lib/firebase'
import { loadFirestorePrefs, saveFirestorePrefs } from '@/lib/prefs'
import type { UserPreferences } from '@/lib/types'

// Shared between the dashboard activities gate and the onboarding sign-in step
// so the pitch can't drift between the two.
export const ACTIVITY_SIGNIN_BLURB =
  'Tell Solara what you do outside and it estimates lower-UV windows each day.'

interface Props {
  label?: string
  /**
   * Local prefs to seed a brand-new account with. Existing cloud prefs always win —
   * a returning user's saved (possibly Pro) profile must never be overwritten by
   * whatever guest state happens to be on this device.
   */
  seedPrefs?: UserPreferences | null
  onSignedIn?: (user: User) => void
  style?: CSSProperties
}

export function GoogleIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
    </svg>
  )
}

export default function GoogleSignInButton({ label = 'Continue with Google', seedPrefs, onSignedIn, style }: Props) {
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
      if (seedPrefs) {
        const existing = await loadFirestorePrefs(u.uid)
        if (existing.status === 'error') throw existing.error
        if (existing.status === 'missing') {
          await saveFirestorePrefs(u.uid, { ...seedPrefs, uid: u.uid, tier: 'free' })
        }
      }
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
      <button onClick={() => void handleClick()} disabled={loading} style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
        padding: '9px 14px', borderRadius: '10px', cursor: loading ? 'wait' : 'pointer',
        border: '0.5px solid var(--border-md)', background: 'var(--bg-card)',
        color: 'var(--text)', fontSize: '13px', fontWeight: 600,
        transition: 'background 0.12s', opacity: loading ? 0.7 : 1,
        ...style,
      }}>
        <GoogleIcon /> {loading ? 'Signing in...' : label}
      </button>
      {error && <p role="alert" style={{ margin: '8px 0 0', fontSize: '12px', color: '#DC2626', textAlign: 'center' }}>{error}</p>}
    </div>
  )
}
