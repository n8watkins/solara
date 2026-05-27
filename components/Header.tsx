'use client'
import { useState } from 'react'
import { User, signInWithPopup, signOut } from 'firebase/auth'
import { auth, googleProvider, firebaseEnabled } from '@/lib/firebase'
import { saveFirestorePrefs, saveLocalPrefs } from '@/lib/prefs'
import { UserPreferences } from '@/lib/types'
import { TIER_LABELS } from '@/lib/tiers'
import PreferencesModal from './PreferencesModal'
import DarkModeToggle from './DarkModeToggle'

interface Props {
  user: User | null
  prefs: UserPreferences
  onPrefsUpdate: (p: UserPreferences) => void
}

export default function Header({ user, prefs, onPrefsUpdate }: Props) {
  const [showPrefs, setShowPrefs] = useState(false)

  async function handleSignIn() {
    if (!auth || !googleProvider) return
    try {
      const result = await signInWithPopup(auth, googleProvider)
      if (result.user && prefs) {
        await saveFirestorePrefs(result.user.uid, { ...prefs, uid: result.user.uid })
      }
    } catch (e) { console.error(e) }
  }

  async function handleSignOut() {
    if (!auth) return
    await signOut(auth)
  }

  async function handlePrefsUpdate(updated: UserPreferences) {
    saveLocalPrefs(updated)
    if (user) await saveFirestorePrefs(user.uid, updated)
    onPrefsUpdate(updated)
    setShowPrefs(false)
  }

  const tier = prefs.tier || 'anonymous'

  return (
    <>
      <header style={{
        background: 'var(--bg-card)',
        borderBottom: '0.5px solid var(--border-md)',
        padding: '10px 16px',
        position: 'sticky',
        top: 0,
        zIndex: 40,
      }}>
        <div style={{ maxWidth: '900px', margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '20px' }}>☀️</span>
            <span style={{ fontWeight: 600, fontSize: '17px', color: 'var(--text)' }}>Solara</span>
            <span style={{ fontSize: '13px', color: 'var(--text-3)' }}>· {prefs.location.city}</span>
            <span style={{
              fontSize: '10px', fontWeight: 600, padding: '2px 7px', borderRadius: '6px',
              background: tier === 'paid' ? 'rgba(249,115,22,0.15)' : 'var(--bg-metric)',
              color: tier === 'paid' ? 'var(--accent)' : 'var(--text-3)',
              textTransform: 'uppercase', letterSpacing: '0.05em',
            }}>
              {TIER_LABELS[tier]}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <DarkModeToggle />
            <button className="btn btn-ghost" onClick={() => setShowPrefs(true)} style={{ fontSize: '13px' }}>
              ⚙️ Preferences
            </button>
            {firebaseEnabled && (
              user
                ? <button className="btn" onClick={handleSignOut} style={{ fontSize: '12px' }}>Sign out</button>
                : <button className="btn btn-primary" onClick={handleSignIn} style={{ fontSize: '12px' }}>Sign in</button>
            )}
          </div>
        </div>
      </header>

      {showPrefs && (
        <PreferencesModal
          prefs={prefs}
          onSave={handlePrefsUpdate}
          onClose={() => setShowPrefs(false)}
        />
      )}
    </>
  )
}
