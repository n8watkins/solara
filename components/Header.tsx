'use client'
import { useState, useEffect } from 'react'
import { User, signInWithPopup, signOut } from 'firebase/auth'
import { auth, googleProvider, firebaseEnabled } from '@/lib/firebase'
import { saveFirestorePrefs, saveLocalPrefs } from '@/lib/prefs'
import { UserPreferences } from '@/lib/types'
import { TIER_LABELS } from '@/lib/tiers'
import PreferencesModal from './PreferencesModal'
import LocationPopover from './LocationPopover'

interface Props {
  user: User | null
  prefs: UserPreferences
  onPrefsUpdate: (p: UserPreferences) => void
  onGoHome: () => void
  forceOpenTab?: 'general' | 'activities' | 'location'
  onModalClose?: () => void
  currentUV?: number
}

export default function Header({ user, prefs, onPrefsUpdate, onGoHome, forceOpenTab, onModalClose, currentUV }: Props) {
  const [showPrefs, setShowPrefs] = useState(false)

  useEffect(() => { if (forceOpenTab) setShowPrefs(true) }, [forceOpenTab])

  async function handleSignIn() {
    if (!auth || !googleProvider) return
    try {
      const result = await signInWithPopup(auth, googleProvider)
      if (result.user && prefs) {
        await saveFirestorePrefs(result.user.uid, { ...prefs, uid: result.user.uid, tier: 'free' })
      }
    } catch (e) { console.error(e) }
  }

  async function handleSignOut() {
    if (auth) await signOut(auth)
  }

  async function handlePrefsUpdate(updated: UserPreferences) {
    saveLocalPrefs(updated)
    if (user) await saveFirestorePrefs(user.uid, updated)
    onPrefsUpdate(updated)
    setShowPrefs(false)
    onModalClose?.()
  }

  const tier = prefs.tier || 'anonymous'

  const uvAlert = currentUV !== undefined && currentUV >= 8
    ? { icon: '🔴', msg: `UV ${currentUV.toFixed(1)} — Very high` }
    : currentUV !== undefined && currentUV >= 6
    ? { icon: '🟠', msg: `UV ${currentUV.toFixed(1)} — High` }
    : null

  return (
    <>
      <header style={{ background: 'var(--bg-card)', borderBottom: '0.5px solid var(--border-md)', padding: '0 16px', position: 'sticky', top: 0, zIndex: 40 }}>
        <div style={{ maxWidth: '900px', margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: '54px', gap: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
              <button
                onClick={onGoHome}
                style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 6px', borderRadius: '8px', transition: 'background 0.1s', flexShrink: 0 }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-metric)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'none')}
              >
                <span style={{ fontSize: '20px' }}>☀️</span>
                <span style={{ fontWeight: 700, fontSize: '17px', color: 'var(--text)' }}>Solara</span>
              </button>
              <span style={{ color: 'var(--border-md)', fontSize: '16px', userSelect: 'none', flexShrink: 0 }}>·</span>
              <div style={{ minWidth: 0 }}>
                <LocationPopover
                  location={prefs.location}
                  onUpdate={loc => onPrefsUpdate({ ...prefs, location: loc })}
                />
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
              {uvAlert && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '5px 8px', borderRadius: '9px', background: 'var(--bg-metric)', fontSize: '12px', color: 'var(--text-2)', whiteSpace: 'nowrap' }}>
                  {uvAlert.icon} <span className="hide-mobile">{uvAlert.msg}</span>
                </div>
              )}
              <span style={{
                fontSize: '10px', fontWeight: 800, padding: '4px 8px', borderRadius: '999px', flexShrink: 0,
                background: tier === 'paid' ? 'rgba(249,115,22,0.16)' : 'var(--bg-metric)',
                color: tier === 'paid' ? 'var(--accent)' : 'var(--text-3)',
                textTransform: 'uppercase', letterSpacing: '0.055em',
              }}>
                {TIER_LABELS[tier]}
              </span>
              <button className="btn btn-ghost" onClick={() => setShowPrefs(true)} style={{ fontSize: '13px', padding: '6px 10px' }} aria-label="Open settings">
                ⚙️ <span className="hide-mobile">Settings</span>
              </button>
              {(user || firebaseEnabled) ? (
                user
                  ? <button className="btn" onClick={handleSignOut} style={{ fontSize: '12px' }}>Sign out</button>
                  : <button className="btn btn-primary" onClick={handleSignIn} style={{ fontSize: '12px' }}>Sign in</button>
              ) : (
                <button className="btn btn-primary" onClick={handleSignIn} style={{ fontSize: '12px' }}>Sign in</button>
              )}
            </div>
          </div>
        </div>
      </header>

      {showPrefs && (
        <PreferencesModal
          prefs={prefs}
          user={user}
          onSave={handlePrefsUpdate}
          onClose={() => { setShowPrefs(false); onModalClose?.() }}
          initialTab={forceOpenTab}
        />
      )}
    </>
  )
}
