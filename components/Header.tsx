'use client'
import { useState, useEffect, useRef } from 'react'
import type { User } from 'firebase/auth'
import { SignOutBlockedError, signOutAndClear } from '@/lib/session'
import type { UserPreferences, TierLevel } from '@/lib/types'
import { getSavedLocationLimit } from '@/lib/tiers'
import { uvLabel } from '@/lib/weather'
import PreferencesModal from './PreferencesModal'
import LocationPopover from './LocationPopover'
import ProfileSwitcher from './ProfileSwitcher'
import GoogleSignInButton from './GoogleSignInButton'
import styles from './Header.module.css'

interface Props {
  user: User | null
  prefs: UserPreferences
  onPrefsUpdate: (p: UserPreferences) => void
  onGoHome: () => void
  forceOpenTab?: 'general' | 'activities' | 'location'
  onModalClose?: () => void
  /** Current UV index at the active location; hidden when unknown. */
  currentUV?: number | null
  displayTier?: TierLevel
}

function uvIcon(uv: number): string {
  if (uv < 0.5) return '⚪'
  if (uv <= 2) return '🟢'
  if (uv <= 5) return '🟡'
  if (uv <= 7) return '🟠'
  if (uv <= 10) return '🔴'
  return '🟣'
}

export default function Header({
  user,
  prefs,
  onPrefsUpdate,
  onGoHome,
  forceOpenTab,
  onModalClose,
  currentUV,
  displayTier,
}: Props) {
  const [showPrefs, setShowPrefs] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [signOutError, setSignOutError] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // Open settings whenever a new tab is forced open (including on mount), adjusting
  // state during render rather than in an effect.
  const [seenForceOpenTab, setSeenForceOpenTab] = useState<typeof forceOpenTab>(undefined)
  if (forceOpenTab !== seenForceOpenTab) {
    setSeenForceOpenTab(forceOpenTab)
    if (forceOpenTab) setShowPrefs(true)
  }

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
    setSignOutError(null)
    try {
      await signOutAndClear(user?.uid)
    } catch (error) {
      console.error('Sign-out failed:', error)
      setSignOutError(
        error instanceof SignOutBlockedError
          ? 'Sign-out paused because notifications could not be disabled. Check your connection and try again.'
          : 'Could not sign out. Check your connection and try again.',
      )
    }
  }

  function handlePrefsUpdate(updated: UserPreferences) {
    onPrefsUpdate(updated)
    setShowPrefs(false)
    onModalClose?.()
  }

  const tier = displayTier || prefs.tier || 'anonymous'

  const uv =
    typeof currentUV === 'number' && Number.isFinite(currentUV)
      ? { icon: uvIcon(currentUV), value: currentUV.toFixed(1), level: uvLabel(currentUV) }
      : null

  return (
    <>
      <header className={styles.header}>
        <div className={styles.row}>
          <button
            onClick={onGoHome}
            className={styles.logo}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: '4px 6px',
              borderRadius: '8px',
              transition: 'background 0.1s',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-metric)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'none')}
          >
            <span style={{ fontSize: '20px' }}>☀️</span>
            <span style={{ fontWeight: 700, fontSize: '17px', color: 'var(--text)' }}>Solara</span>
          </button>

          <div className={styles.location}>
            <LocationPopover
              location={prefs.location}
              savedLocations={prefs.savedLocations ?? []}
              limit={getSavedLocationLimit(displayTier ?? prefs.tier)}
              onApply={({ location, savedLocations }) =>
                onPrefsUpdate({ ...prefs, location, savedLocations })
              }
            />
          </div>

          <div className={styles.right}>
            {tier !== 'anonymous' && (
              <span className="hide-mobile">
                <ProfileSwitcher
                  prefs={prefs}
                  tier={tier}
                  onApply={patch => onPrefsUpdate({ ...prefs, ...patch })}
                />
              </span>
            )}
            {uv && (
              <span className={styles.uv} title={`Current UV index ${uv.value}, ${uv.level}`}>
                <span aria-hidden="true">
                  {uv.icon} UV {uv.value}
                  <span className={styles.uvLevel}> · {uv.level}</span>
                </span>
                <span className="sr-only">
                  Current UV index {uv.value}, {uv.level}
                </span>
              </span>
            )}
            {tier === 'paid' && (
              <span
                className={styles.pro}
                style={{
                  fontSize: '10px',
                  fontWeight: 800,
                  padding: '4px 8px',
                  borderRadius: '999px',
                  flexShrink: 0,
                  background: 'var(--accent-soft)',
                  color: 'var(--accent)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.055em',
                }}
              >
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
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '30px',
                    height: '30px',
                    borderRadius: '50%',
                    padding: 0,
                    cursor: 'pointer',
                    flexShrink: 0,
                    overflow: 'hidden',
                    border: '0.5px solid var(--border-md)',
                    background: user.photoURL ? 'var(--bg-metric)' : 'var(--accent)',
                  }}
                >
                  {user.photoURL ? (
                    // eslint-disable-next-line @next/next/no-img-element -- Remote account avatar in a static export with images.unoptimized; next/image would add nothing.
                    <img
                      src={user.photoURL}
                      alt={user.displayName ?? 'Account'}
                      referrerPolicy="no-referrer"
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  ) : (
                    <span
                      style={{
                        color: 'var(--on-accent)',
                        fontWeight: 700,
                        fontSize: '14px',
                        lineHeight: 1,
                      }}
                    >
                      {(user.displayName ?? user.email ?? '?').trim().charAt(0).toUpperCase()}
                    </span>
                  )}
                </button>

                {menuOpen && (
                  <div
                    role="menu"
                    style={{
                      position: 'absolute',
                      top: 'calc(100% + 8px)',
                      right: 0,
                      zIndex: 40,
                      minWidth: '200px',
                      maxWidth: 'calc(100vw - 24px)',
                      background: 'var(--bg-card)',
                      border: '0.5px solid var(--border-md)',
                      borderRadius: '12px',
                      boxShadow: '0 16px 48px rgba(0,0,0,0.22)',
                      padding: '6px',
                      overflow: 'hidden',
                    }}
                  >
                    {(user.email || user.displayName) && (
                      <div
                        style={{
                          padding: '8px 10px 10px',
                          borderBottom: '0.5px solid var(--border-md)',
                          marginBottom: '4px',
                        }}
                      >
                        {user.displayName && (
                          <p
                            style={{
                              margin: 0,
                              fontSize: '13px',
                              fontWeight: 650,
                              color: 'var(--text)',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                          >
                            {user.displayName}
                          </p>
                        )}
                        {user.email && (
                          <p
                            style={{
                              margin: user.displayName ? '2px 0 0' : 0,
                              fontSize: '12px',
                              color: 'var(--text-3)',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                          >
                            {user.email}
                          </p>
                        )}
                      </div>
                    )}
                    <button
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false)
                        setShowPrefs(true)
                      }}
                      className="hdr-menu-item"
                    >
                      ⚙️ Settings
                    </button>
                    <a
                      role="menuitem"
                      href="/account/"
                      className="hdr-menu-item"
                      style={{ textDecoration: 'none' }}
                    >
                      👤 Account & billing
                    </a>
                    <button
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false)
                        void handleSignOut()
                      }}
                      className="hdr-menu-item"
                      style={{ color: 'var(--danger)' }}
                    >
                      ↪ Sign out
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <GoogleSignInButton
                label="Sign in"
                seedPrefs={prefs}
                style={{ fontSize: '12px', padding: '6px 12px' }}
              />
            )}
          </div>
        </div>
      </header>

      {signOutError && (
        <div
          role="alert"
          style={{
            maxWidth: '900px',
            margin: '12px auto 0',
            padding: '0 14px',
            color: 'var(--danger)',
            fontSize: '13px',
          }}
        >
          {signOutError}
        </div>
      )}

      {showPrefs && (
        <PreferencesModal
          prefs={prefs}
          user={user}
          onSave={handlePrefsUpdate}
          onClose={() => {
            setShowPrefs(false)
            onModalClose?.()
          }}
          initialTab={forceOpenTab}
        />
      )}
    </>
  )
}
