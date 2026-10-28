'use client'
import { useState } from 'react'
import type { User } from 'firebase/auth'
import type { AccountIdentity } from './AccountMenu'
import { goToLanding } from '@/lib/app-routes'
import type { UserPreferences, TierLevel } from '@/lib/types'
import { getSavedLocationLimit } from '@/lib/tiers'
import { headerUV } from '@/lib/header-display'
import { uvBandColor } from '@/lib/weather'
import { AccountMenu, PreferencesModal, ProfileSwitcher } from './deferred'
import type { SettingsTab } from './settings/SettingsTabs'
import LocationPopover from './LocationPopover'
import GoogleSignInButton from './GoogleSignInButton'
import SolaraMark from './SolaraMark'
import styles from './Header.module.css'

interface Props {
  user: User | null
  /**
   * The account shown in the header: the signed-in user, or the account a stored
   * session belongs to while Auth confirms it. Defaults to `user`.
   */
  account?: AccountIdentity | null
  prefs: UserPreferences
  onPrefsUpdate: (p: UserPreferences) => void
  onGoHome: () => void
  forceOpenTab?: SettingsTab
  onModalClose?: () => void
  /** Current UV index at the active location; hidden when unknown. */
  currentUV?: number | null
  displayTier?: TierLevel
}

export default function Header({
  user,
  account = user,
  prefs,
  onPrefsUpdate,
  onGoHome,
  forceOpenTab,
  onModalClose,
  currentUV,
  displayTier,
}: Props) {
  const [showPrefs, setShowPrefs] = useState(false)
  const [signOutError, setSignOutError] = useState<string | null>(null)

  // Open settings whenever a new tab is forced open (including on mount), adjusting
  // state during render rather than in an effect.
  const [seenForceOpenTab, setSeenForceOpenTab] = useState<typeof forceOpenTab>(undefined)
  if (forceOpenTab !== seenForceOpenTab) {
    setSeenForceOpenTab(forceOpenTab)
    if (forceOpenTab) setShowPrefs(true)
  }

  async function handleSignOut() {
    setSignOutError(null)
    const uid = user?.uid
    let failure: { error: unknown; blocked: boolean } | null = null
    try {
      // The sign-out code loads only when someone signs out.
      const { SignOutBlockedError, signOutAndClear } = await import('@/lib/session')
      try {
        await signOutAndClear(uid)
      } catch (error) {
        failure = { error, blocked: error instanceof SignOutBlockedError }
      }
    } catch (error) {
      failure = { error, blocked: false }
    }
    if (!failure) {
      goToLanding()
      return
    }
    console.error('Sign-out failed:', failure.error)
    setSignOutError(
      failure.blocked
        ? 'Sign-out paused because notifications could not be disabled. Check your connection and try again.'
        : 'Could not sign out. Check your connection and try again.',
    )
  }

  function handlePrefsUpdate(updated: UserPreferences) {
    onPrefsUpdate(updated)
    setShowPrefs(false)
    onModalClose?.()
  }

  const tier = displayTier || prefs.tier || 'anonymous'
  const uv = headerUV(currentUV)

  return (
    <>
      <header className={styles.header}>
        <div className={styles.row}>
          <button
            onClick={onGoHome}
            className="flex shrink-0 items-center gap-1.5 rounded-lg px-1.5 py-1 transition-colors duration-100 hover:bg-surface-metric"
          >
            <SolaraMark size={22} />
            {/* Under 360 px only the mark shows, which leaves the place its room; the
                name stays the button's accessible name. */}
            <span className="text-[17px] font-bold text-ink max-[359px]:sr-only">Solara</span>
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

          <div className={styles.right} data-header-controls>
            {tier !== 'anonymous' && (
              <ProfileSwitcher
                prefs={prefs}
                tier={tier}
                user={user}
                onApply={patch => onPrefsUpdate({ ...prefs, ...patch })}
              />
            )}
            {uv && (
              <span className={styles.uv} title={`Current UV index ${uv.value}, ${uv.level}`}>
                <span aria-hidden="true">
                  <span
                    className="mr-1.5 inline-block size-2 rounded-full align-[1px] shadow-[inset_0_0_0_0.5px_rgba(0,0,0,0.25)]"
                    style={{ background: uvBandColor(uv.band) }}
                  />
                  UV {uv.value}
                  <span> · {uv.level}</span>
                </span>
                <span className="sr-only">
                  Current UV index {uv.value}, {uv.level}
                </span>
              </span>
            )}
            {tier === 'paid' && (
              <span
                className={`${styles.pro} shrink-0 rounded-full bg-accent-soft px-2 py-1 text-[10px] font-extrabold tracking-[0.055em] text-accent uppercase`}
              >
                Pro
              </span>
            )}
            {account ? (
              <AccountMenu
                user={account}
                onOpenSettings={() => setShowPrefs(true)}
                onSignOut={() => void handleSignOut()}
              />
            ) : (
              <GoogleSignInButton label="Sign in" size="sm" />
            )}
          </div>
        </div>
      </header>

      {signOutError && (
        <div
          role="alert"
          className="mx-auto mt-3 max-w-[900px] px-3.5 text-[13px] text-danger lg:max-w-[1240px]"
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
