'use client'
import { useState, useEffect, useRef } from 'react'
import { User, signOut } from 'firebase/auth'
import { auth } from '@/lib/firebase'
import { UserPreferences, TierLevel } from '@/lib/types'
import { getSavedLocationLimit } from '@/lib/tiers'
import PreferencesModal from './PreferencesModal'
import LocationPopover from './LocationPopover'
import ProfileSwitcher from './ProfileSwitcher'
import GoogleSignInButton from './GoogleSignInButton'

interface Props {
  user: User | null
  prefs: UserPreferences
  onPrefsUpdate: (p: UserPreferences) => void
  onGoHome: () => void
  forceOpenTab?: 'general' | 'activities' | 'location'
  onModalClose?: () => void
  currentUV?: number
  displayTier?: TierLevel
}

export default function Header({ user, prefs, onPrefsUpdate, onGoHome, forceOpenTab, onModalClose, currentUV, displayTier }: Props) {
  const [showPrefs, setShowPrefs] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => { if (forceOpenTab) setShowPrefs(true) }, [forceOpenTab])

  // Close the profile menu on outside-click / Escape.
  useEffect(() => {
    if (!menuOpen) return
    function onDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  async function handleSignOut() {
    if (auth) await signOut(auth)
  }

  function handlePrefsUpdate(updated: UserPreferences) {
    onPrefsUpdate(updated)
    setShowPrefs(false)
    onModalClose?.()
  }

  const tier = displayTier || prefs.tier || 'anonymous'

  const uvAlert = currentUV !== undefined && currentUV >= 8
    ? { icon: '🔴', msg: `UV ${currentUV.toFixed(1)} — Very high` }
    : currentUV !== undefined && currentUV >= 6
    ? { icon: '🟠', msg: `UV ${currentUV.toFixed(1)} — High` }
    : null

  return (
    <>
      <header style={{ background: 'var(--bg-card)', borderBottom: '0.5px solid var(--border-md)', padding: '0 14px' }}>
        {/* Single row on desktop; on mobile the location drops to its own full-width
            row below (see .hdr-* rules in globals.css) so nothing ever collides. */}
        <div style={{ maxWidth: '900px', margin: '0 auto' }}>
          <div className="hdr-row">
            <button
              onClick={onGoHome}
              className="hdr-logo"
              style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 6px', borderRadius: '8px', transition: 'background 0.1s' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-metric)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'none')}
            >
              <span style={{ fontSize: '20px' }}>☀️</span>
              <span style={{ fontWeight: 700, fontSize: '17px', color: 'var(--text)' }}>Solara</span>
            </button>

            <div className="hdr-loc">
              <LocationPopover
                location={prefs.location}
                savedLocations={prefs.savedLocations ?? []}
                limit={getSavedLocationLimit(displayTier ?? prefs.tier)}
                onApply={({ location, savedLocations }) => onPrefsUpdate({ ...prefs, location, savedLocations })}
              />
            </div>

            <div className="hdr-right">
              {tier !== 'anonymous' && (
                <span className="hide-mobile">
                  <ProfileSwitcher
                    prefs={prefs}
                    tier={tier}
                    onApply={patch => onPrefsUpdate({ ...prefs, ...patch })}
                  />
                </span>
              )}
              {uvAlert && (
                <span className="hide-mobile">
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '5px 8px', borderRadius: '9px', background: 'var(--bg-metric)', fontSize: '12px', color: 'var(--text-2)', whiteSpace: 'nowrap' }}>
                    {uvAlert.icon} {uvAlert.msg}
                  </span>
                </span>
              )}
              {tier === 'paid' && (
                <span style={{
                  fontSize: '10px', fontWeight: 800, padding: '4px 8px', borderRadius: '999px', flexShrink: 0,
                  background: 'rgba(249,115,22,0.16)', color: 'var(--accent)',
                  textTransform: 'uppercase', letterSpacing: '0.055em',
                }}>
                  Pro
                </span>
              )}
              {user ? (
                <div ref={menuRef} style={{ position: 'relative', flexShrink: 0 }}>
                  <button
                    onClick={() => setMenuOpen(o => !o)}
                    aria-haspopup="menu"
                    aria-expanded={menuOpen}
                    aria-label="Account menu"
                    title={user.displayName ?? user.email ?? 'Account'}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      width: '30px', height: '30px', borderRadius: '50%',
                      padding: 0, cursor: 'pointer', flexShrink: 0, overflow: 'hidden',
                      border: '0.5px solid var(--border-md)',
                      background: user.photoURL ? 'var(--bg-metric)' : 'var(--accent)',
                    }}
                  >
                    {user.photoURL ? (
                      <img
                        src={user.photoURL}
                        alt={user.displayName ?? 'Account'}
                        referrerPolicy="no-referrer"
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    ) : (
                      <span style={{ color: '#fff', fontWeight: 700, fontSize: '14px', lineHeight: 1 }}>
                        {(user.displayName ?? user.email ?? '?').trim().charAt(0).toUpperCase()}
                      </span>
                    )}
                  </button>

                  {menuOpen && (
                    <div
                      role="menu"
                      style={{
                        position: 'absolute', top: 'calc(100% + 8px)', right: 0, zIndex: 40,
                        minWidth: '200px', maxWidth: 'calc(100vw - 24px)',
                        background: 'var(--bg-card)', border: '0.5px solid var(--border-md)',
                        borderRadius: '12px', boxShadow: '0 16px 48px rgba(0,0,0,0.22)',
                        padding: '6px', overflow: 'hidden',
                      }}
                    >
                      {(user.email || user.displayName) && (
                        <div style={{ padding: '8px 10px 10px', borderBottom: '0.5px solid var(--border-md)', marginBottom: '4px' }}>
                          {user.displayName && (
                            <p style={{ margin: 0, fontSize: '13px', fontWeight: 650, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user.displayName}</p>
                          )}
                          {user.email && (
                            <p style={{ margin: user.displayName ? '2px 0 0' : 0, fontSize: '12px', color: 'var(--text-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user.email}</p>
                          )}
                        </div>
                      )}
                      <button
                        role="menuitem"
                        onClick={() => { setMenuOpen(false); setShowPrefs(true) }}
                        className="hdr-menu-item"
                      >
                        ⚙️ Settings
                      </button>
                      <button
                        role="menuitem"
                        onClick={() => { setMenuOpen(false); handleSignOut() }}
                        className="hdr-menu-item"
                        style={{ color: '#DC2626' }}
                      >
                        ↪ Sign out
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <GoogleSignInButton label="Sign in" seedPrefs={prefs} style={{ fontSize: '12px', padding: '6px 12px' }} />
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
