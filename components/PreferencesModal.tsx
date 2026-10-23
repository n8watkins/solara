'use client'
import { useState, useEffect, useId, useRef } from 'react'
import type { KeyboardEvent } from 'react'
import type { User } from 'firebase/auth'
import type { UserPreferences, SkinType, Location } from '@/lib/types'
import { clearWeatherCache } from '@/lib/cache'
import { searchLocation } from '@/lib/geocoding'
import { TIER_LIMITS } from '@/lib/tiers'
import {
  disableNotifications,
  enableNotifications,
  notificationRegistrationConfigured,
  notificationsEnabledLocally,
} from '@/lib/notifications'
import { firebaseEnabled } from '@/lib/firebase'
import { signOutAndClear } from '@/lib/session'
import ActivitySuggestionSettings from './ActivitySuggestionSettings'
import DarkModeToggle from './DarkModeToggle'
import Dialog from './Dialog'
import styles from './PreferencesModal.module.css'
import PricingModal from './PricingModal'
import GoogleSignInButton from './GoogleSignInButton'

interface Props {
  prefs: UserPreferences
  onSave: (updated: UserPreferences) => void
  onClose: () => void
  initialTab?: LegacyTab
  user?: User | null
}

const SKIN_OPTIONS: { value: SkinType; label: string; burn: string; desc: string }[] = [
  {
    value: 'very-fair',
    label: 'Very fair',
    burn: '~10m at UV 10',
    desc: 'Burns easily, rarely tans',
  },
  { value: 'fair', label: 'Fair', burn: '~15m at UV 10', desc: 'Burns often, tans lightly' },
  { value: 'medium', label: 'Medium', burn: '~25m at UV 10', desc: 'Burns sometimes, tans well' },
  { value: 'olive', label: 'Olive', burn: '~35m at UV 10', desc: 'Rarely burns, tans easily' },
  { value: 'dark', label: 'Dark', burn: '~50m at UV 10', desc: 'Very rarely burns' },
]

type LegacyTab = 'general' | 'activities' | 'location'
type Tab = 'general' | 'appearance' | 'activities' | 'location' | 'account'

export default function PreferencesModal({ prefs, onSave, onClose, initialTab, user }: Props) {
  const idPrefix = useId()
  const tabRefs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({})
  const [tab, setTab] = useState<Tab>(initialTab || 'general')
  const [skinType, setSkinType] = useState<SkinType>(prefs.skinType)
  const [location, setLocation] = useState<Location>(prefs.location)
  const [citySearch, setCitySearch] = useState('')
  const [locLoading, setLocLoading] = useState(false)
  const [locError, setLocError] = useState<string | null>(null)
  const [showSunPath, setShowSunPath] = useState(prefs.showSunPath !== false)
  const [upgradeEmail] = useState(user?.email ?? prefs.upgradeInterest?.email ?? '')
  const [upgradeSaved, setUpgradeSaved] = useState(false)
  const [showPricing, setShowPricing] = useState(false)
  const [showSkinHelp, setShowSkinHelp] = useState(false)
  const [hiddenActivitySuggestionIds, setHiddenActivitySuggestionIds] = useState<string[]>(
    prefs.hiddenActivitySuggestionIds ?? [],
  )
  const [collapsedActivityCategories, setCollapsedActivityCategories] = useState<string[]>(
    prefs.collapsedActivityCategories ?? [],
  )
  const [notificationHour, setNotificationHour] = useState(prefs.notificationHour ?? 7)
  const tier = prefs.tier || 'anonymous'

  // SSR-safe notification state: 'unknown' until read in the browser via useEffect,
  // so the server/build render never touches `Notification` or `localStorage`.
  type NotifState = 'unknown' | 'enabled' | 'blocked' | 'default'
  const [notifState, setNotifState] = useState<NotifState>('unknown')
  const [notifLoading, setNotifLoading] = useState(false)
  const [notifError, setNotifError] = useState<string | null>(null)

  function readNotifState(): NotifState {
    if (typeof window === 'undefined' || !('Notification' in window)) return 'blocked'
    if (Notification.permission === 'granted')
      return user && notificationsEnabledLocally(user.uid) ? 'enabled' : 'default'
    if (Notification.permission === 'denied') return 'blocked'
    return 'default'
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Browser-only state is read after hydration so the static export's prerendered markup matches the first client render.
    setNotifState(readNotifState())
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Read the notification permission once when the modal mounts.
  }, [])

  async function handleEnableNotifications() {
    if (!user) return
    setNotifLoading(true)
    setNotifError(null)
    try {
      await enableNotifications(user.uid)
      setNotifState('enabled')
    } catch (error) {
      setNotifState(Notification.permission === 'denied' ? 'blocked' : 'default')
      setNotifError(error instanceof Error ? error.message : 'Could not enable notifications')
    } finally {
      setNotifLoading(false)
    }
  }

  async function handleDisableNotifications() {
    if (!user) return
    setNotifLoading(true)
    setNotifError(null)
    try {
      await disableNotifications(user.uid)
      setNotifState(Notification.permission === 'denied' ? 'blocked' : 'default')
    } catch (error) {
      setNotifError(error instanceof Error ? error.message : 'Could not disable notifications')
    } finally {
      setNotifLoading(false)
    }
  }

  const selectedSkin = SKIN_OPTIONS.find(o => o.value === skinType) ?? SKIN_OPTIONS[1]!
  const draft: UserPreferences = {
    ...prefs,
    skinType,
    location,
    showSunPath,
    hiddenActivitySuggestionIds,
    collapsedActivityCategories,
    notificationHour,
  }
  const dirty =
    JSON.stringify({
      skinType: prefs.skinType,
      location: prefs.location,
      showSunPath: prefs.showSunPath !== false,
      hiddenActivitySuggestionIds: prefs.hiddenActivitySuggestionIds ?? [],
      collapsedActivityCategories: prefs.collapsedActivityCategories ?? [],
      notificationHour: prefs.notificationHour ?? 7,
    }) !==
    JSON.stringify({
      skinType,
      location,
      showSunPath,
      hiddenActivitySuggestionIds,
      collapsedActivityCategories,
      notificationHour,
    })

  function requestClose() {
    if (dirty && !window.confirm('Discard unsaved settings changes?')) return
    onClose()
  }

  async function searchCity() {
    if (!citySearch.trim()) return
    setLocLoading(true)
    setLocError(null)
    try {
      const nextLocation = await searchLocation(citySearch)
      if (!nextLocation) throw new Error()
      setLocation(nextLocation)
      clearWeatherCache()
    } catch {
      setLocError('City not found.')
    } finally {
      setLocLoading(false)
    }
  }

  async function locateCurrentPosition() {
    setLocLoading(true)
    setLocError(null)
    async function resolvePosition(pos: GeolocationPosition) {
      try {
        const { latitude: lat, longitude: lon } = pos.coords
        const res = await fetch(
          `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`,
        )
        const data = await res.json()
        const city =
          data.address?.city || data.address?.town || data.address?.village || 'Your location'
        setLocation({
          lat,
          lon,
          city,
          region: data.address?.state || '',
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        })
        clearWeatherCache()
      } catch {
        setLocError('Could not resolve.')
      } finally {
        setLocLoading(false)
      }
    }
    navigator.geolocation.getCurrentPosition(
      pos => void resolvePosition(pos),
      () => {
        setLocError('Location denied.')
        setLocLoading(false)
      },
    )
  }

  function joinWaitlistWithEmail(email: string) {
    onSave({
      ...draft,
      upgradeInterest: { email: email || undefined, createdAt: new Date().toISOString() },
    })
    setUpgradeSaved(true)
  }

  function updateSuggestionPrefs(updated: UserPreferences) {
    setHiddenActivitySuggestionIds(updated.hiddenActivitySuggestionIds ?? [])
    setCollapsedActivityCategories(updated.collapsedActivityCategories ?? [])
  }

  const SECTIONS: { id: Tab; label: string; emoji: string; desc: string }[] = [
    {
      id: 'general',
      label: 'Sun profile',
      emoji: '☀️',
      desc: 'Skin type and the assumptions behind your exposure estimates.',
    },
    {
      id: 'appearance',
      label: 'Appearance',
      emoji: '🎨',
      desc: 'Theme and what the dashboard shows.',
    },
    {
      id: 'activities',
      label: 'Activities',
      emoji: '🏃',
      desc: 'Suggestion and category preferences.',
    },
    {
      id: 'location',
      label: 'Location',
      emoji: '📍',
      desc: 'Where Solara checks the UV forecast.',
    },
    { id: 'account', label: 'Account', emoji: '👤', desc: 'Plan, sign-in, and cross-device sync.' },
  ]
  const activeSection = SECTIONS.find(s => s.id === tab) ?? SECTIONS[0]!
  const titleId = `${idPrefix}-title`
  const tabId = (id: Tab) => `${idPrefix}-tab-${id}`
  const panelId = `${idPrefix}-panel`
  const skinTitleId = `${idPrefix}-skin-title`
  const skinDescId = `${idPrefix}-skin-desc`
  const sunPathTitleId = `${idPrefix}-sun-path-title`
  const sunPathDescId = `${idPrefix}-sun-path-desc`

  // Tabs pattern: arrows move between sections (the rail is vertical on
  // desktop and horizontal on phones, so both axes work), Home and End jump.
  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const index = SECTIONS.findIndex(s => s.id === tab)
    const last = SECTIONS.length - 1
    const next =
      event.key === 'ArrowDown' || event.key === 'ArrowRight'
        ? index === last
          ? 0
          : index + 1
        : event.key === 'ArrowUp' || event.key === 'ArrowLeft'
          ? index === 0
            ? last
            : index - 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null
    if (next === null) return
    event.preventDefault()
    const nextTab = SECTIONS[next]!.id
    setTab(nextTab)
    tabRefs.current[nextTab]?.focus()
  }

  return (
    <Dialog onClose={requestClose} labelledBy={titleId} variant="sheet">
      <div className={styles.layout}>
        <div className={styles.topbar}>
          <h2
            id={titleId}
            style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: 'var(--text)' }}
          >
            Settings
          </h2>
          <button
            type="button"
            onClick={requestClose}
            style={{
              background: 'var(--bg-metric)',
              border: 'none',
              width: '32px',
              height: '32px',
              borderRadius: '50%',
              fontSize: '18px',
              cursor: 'pointer',
              color: 'var(--text-2)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
            aria-label="Close settings"
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>

        <div className={styles.body}>
          <div role="tablist" aria-label="Settings sections" className={styles.tabs}>
            {SECTIONS.map(s => (
              <button
                key={s.id}
                ref={el => {
                  tabRefs.current[s.id] = el
                }}
                type="button"
                role="tab"
                id={tabId(s.id)}
                aria-selected={tab === s.id}
                aria-controls={panelId}
                tabIndex={tab === s.id ? 0 : -1}
                onClick={() => setTab(s.id)}
                onKeyDown={handleTabKeyDown}
                className={styles.tab}
              >
                <span aria-hidden="true" className={styles.tabIcon}>
                  {s.emoji}
                </span>
                {s.label}
              </button>
            ))}
          </div>

          <div
            role="tabpanel"
            id={panelId}
            aria-labelledby={tabId(tab)}
            tabIndex={0}
            className={styles.panel}
          >
            <div style={{ marginBottom: '18px' }}>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--text)' }}>
                <span aria-hidden="true">{activeSection.emoji}</span> {activeSection.label}
              </h3>
              <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--text-3)' }}>
                {activeSection.desc}
              </p>
            </div>

            {tab === 'general' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
                <div
                  className="metric-card"
                  style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}
                >
                  <div className={styles.field}>
                    <div>
                      <h4
                        style={{
                          margin: '0 0 4px',
                          fontSize: '13px',
                          fontWeight: 700,
                          color: 'var(--text)',
                        }}
                      >
                        <label id={skinTitleId} htmlFor={`${idPrefix}-skin`}>
                          Skin type
                        </label>
                      </h4>
                      <p
                        id={skinDescId}
                        style={{
                          margin: 0,
                          fontSize: '13px',
                          color: 'var(--text-3)',
                          lineHeight: 1.45,
                        }}
                      >
                        Used for burn-time and vitamin D estimates.
                      </p>
                    </div>
                    <select
                      id={`${idPrefix}-skin`}
                      aria-describedby={skinDescId}
                      value={skinType}
                      onChange={e => setSkinType(e.target.value as SkinType)}
                      className={styles.fieldControl}
                    >
                      {SKIN_OPTIONS.map(o => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: '10px',
                      alignItems: 'center',
                      padding: '10px 12px',
                      borderRadius: '10px',
                      background: 'var(--bg-card)',
                      border: '0.5px solid var(--border-md)',
                    }}
                  >
                    <div>
                      <p
                        style={{
                          margin: 0,
                          fontSize: '14px',
                          fontWeight: 650,
                          color: 'var(--text)',
                        }}
                      >
                        {selectedSkin.label}
                      </p>
                      <p style={{ margin: '2px 0 0', fontSize: '12px', color: 'var(--text-3)' }}>
                        {selectedSkin.desc}
                      </p>
                    </div>
                    <span
                      style={{
                        fontSize: '12px',
                        color: 'var(--text-2)',
                        fontWeight: 600,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {selectedSkin.burn}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    aria-expanded={showSkinHelp}
                    aria-controls={`${idPrefix}-skin-help`}
                    onClick={() => setShowSkinHelp(s => !s)}
                    style={{
                      justifyContent: 'flex-start',
                      padding: '4px 0',
                      fontSize: '12px',
                      color: 'var(--accent)',
                    }}
                  >
                    {showSkinHelp ? 'Hide explanation' : 'How skin type affects Solara'}
                  </button>
                  {showSkinHelp && (
                    <p
                      id={`${idPrefix}-skin-help`}
                      style={{
                        margin: 0,
                        fontSize: '13px',
                        lineHeight: 1.55,
                        color: 'var(--text-2)',
                      }}
                    >
                      Lighter skin typically burns faster at the same UV level. Solara uses this
                      profile to estimate burn limits and useful sun exposure windows. These are
                      planning estimates, not medical advice.
                    </p>
                  )}
                </div>

                <div
                  className="metric-card"
                  style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}
                >
                  <h4
                    style={{ margin: 0, fontSize: '13px', fontWeight: 700, color: 'var(--text)' }}
                  >
                    Sunscreen is activity-specific
                  </h4>
                  <p
                    style={{
                      margin: 0,
                      fontSize: '13px',
                      color: 'var(--text-3)',
                      lineHeight: 1.45,
                    }}
                  >
                    SPF assumptions are now set per activity from the Dashboard Activity section, so
                    a swim, walk, and quick coffee break can each use different protection settings.
                  </p>
                </div>

                <div
                  className="metric-card"
                  style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      justifyContent: 'space-between',
                      gap: '14px',
                    }}
                  >
                    <div>
                      <p
                        style={{
                          margin: '0 0 4px',
                          fontSize: '13px',
                          fontWeight: 700,
                          color: 'var(--text)',
                        }}
                      >
                        🔔 Morning sun alerts (paused)
                      </p>
                      <p
                        style={{
                          margin: 0,
                          fontSize: '13px',
                          color: 'var(--text-3)',
                          lineHeight: 1.45,
                        }}
                      >
                        Morning summaries are paused and not being sent right now.
                      </p>
                    </div>
                    {!TIER_LIMITS[tier].notifications && (
                      <span
                        style={{
                          fontSize: '11px',
                          fontWeight: 700,
                          color: 'var(--accent)',
                          whiteSpace: 'nowrap',
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                        }}
                      >
                        Pro
                      </span>
                    )}
                  </div>
                  {TIER_LIMITS[tier].notifications ? (
                    notifState === 'enabled' ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        <p
                          style={{
                            margin: 0,
                            fontSize: '13px',
                            fontWeight: 600,
                            color: 'var(--accent)',
                          }}
                        >
                          ✓ On for this device once summaries resume
                        </p>
                        <label
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            fontSize: '13px',
                            color: 'var(--text-2)',
                          }}
                        >
                          Local delivery time
                          <select
                            value={notificationHour}
                            onChange={event => setNotificationHour(Number(event.target.value))}
                          >
                            {[5, 6, 7, 8, 9, 10].map(hour => (
                              <option key={hour} value={hour}>
                                {hour}:00 AM
                              </option>
                            ))}
                          </select>
                        </label>
                        <button
                          className="btn"
                          onClick={() => void handleDisableNotifications()}
                          disabled={notifLoading}
                          style={{ alignSelf: 'flex-start' }}
                        >
                          {notifLoading ? 'Turning off...' : 'Turn off on this device'}
                        </button>
                      </div>
                    ) : notifState === 'blocked' ? (
                      <p
                        style={{
                          margin: 0,
                          fontSize: '13px',
                          color: 'var(--text-3)',
                          lineHeight: 1.45,
                        }}
                      >
                        Notifications are blocked. Enable them in your browser settings.
                      </p>
                    ) : notifState === 'default' ? (
                      <button
                        className="btn btn-primary"
                        onClick={() => void handleEnableNotifications()}
                        disabled={notifLoading || !notificationRegistrationConfigured()}
                        style={{ alignSelf: 'flex-start', whiteSpace: 'nowrap' }}
                      >
                        {notifLoading
                          ? 'Enabling...'
                          : notificationRegistrationConfigured()
                            ? 'Enable notifications'
                            : 'Notifications unavailable'}
                      </button>
                    ) : null
                  ) : (
                    <p
                      style={{
                        margin: 0,
                        fontSize: '13px',
                        color: 'var(--text-3)',
                        lineHeight: 1.45,
                      }}
                    >
                      Paused for all plans right now.
                    </p>
                  )}
                  {notifError && (
                    <p role="alert" style={{ margin: 0, fontSize: '12px', color: '#DC2626' }}>
                      {notifError}
                    </p>
                  )}
                </div>
              </div>
            )}

            {tab === 'appearance' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <div className="metric-card">
                  <div className={styles.field} style={{ alignItems: 'center' }}>
                    <div>
                      <h4
                        style={{
                          margin: '0 0 4px',
                          fontSize: '13px',
                          fontWeight: 700,
                          color: 'var(--text)',
                        }}
                      >
                        Theme
                      </h4>
                      <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-3)' }}>
                        Follow your device, or always use light or dark.
                      </p>
                    </div>
                    <DarkModeToggle />
                  </div>
                </div>
                <div
                  className="metric-card"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '14px',
                  }}
                >
                  <div>
                    <h4
                      id={sunPathTitleId}
                      style={{
                        margin: '0 0 4px',
                        fontSize: '13px',
                        fontWeight: 700,
                        color: 'var(--text)',
                      }}
                    >
                      Sun path animation
                    </h4>
                    <p
                      id={sunPathDescId}
                      style={{ margin: 0, fontSize: '13px', color: 'var(--text-3)' }}
                    >
                      The arc above the hourly UV chart showing the sun&apos;s position.
                    </p>
                  </div>
                  <button
                    type="button"
                    aria-pressed={showSunPath}
                    id={`${sunPathTitleId}-toggle`}
                    aria-labelledby={`${sunPathTitleId} ${sunPathTitleId}-toggle`}
                    aria-describedby={sunPathDescId}
                    onClick={() => setShowSunPath(s => !s)}
                    className="btn"
                    style={{ whiteSpace: 'nowrap' }}
                  >
                    {showSunPath ? '✓ On' : 'Off'}
                  </button>
                </div>
              </div>
            )}

            {tab === 'activities' && (
              <ActivitySuggestionSettings prefs={draft} onChange={updateSuggestionPrefs} />
            )}

            {tab === 'location' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div className="metric-card">
                  <p style={{ margin: '0 0 3px', fontSize: '12px', color: 'var(--text-3)' }}>
                    Current location
                  </p>
                  <p style={{ margin: 0, fontSize: '16px', fontWeight: 650, color: 'var(--text)' }}>
                    {location.city}
                    {location.region ? `, ${location.region}` : ''}
                  </p>
                </div>
                <button
                  className="btn"
                  onClick={() => void locateCurrentPosition()}
                  disabled={locLoading}
                  style={{ justifyContent: 'center' }}
                >
                  📍 {locLoading ? 'Detecting…' : 'Use current location'}
                </button>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="search"
                    aria-label="Search a city"
                    placeholder="Search a city…"
                    value={citySearch}
                    onChange={e => setCitySearch(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') void searchCity()
                    }}
                    style={{ flex: 1 }}
                  />
                  <button className="btn" onClick={() => void searchCity()} disabled={locLoading}>
                    {locLoading ? '…' : 'Search'}
                  </button>
                </div>
                {locError && (
                  <p role="alert" style={{ margin: 0, fontSize: '12px', color: '#DC2626' }}>
                    {locError}
                  </p>
                )}
              </div>
            )}

            {tab === 'account' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div
                  className="metric-card"
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '12px',
                  }}
                >
                  <div>
                    <p style={{ margin: '0 0 3px', fontSize: '12px', color: 'var(--text-3)' }}>
                      Current plan
                    </p>
                    <p
                      style={{
                        margin: 0,
                        fontSize: '17px',
                        fontWeight: 700,
                        color: tier === 'paid' ? 'var(--accent)' : 'var(--text)',
                      }}
                    >
                      {tier === 'paid' ? 'Pro' : user ? 'Free' : 'Not signed in'}
                    </p>
                  </div>
                  {tier !== 'paid' && (
                    <button
                      className="btn btn-primary"
                      onClick={() => setShowPricing(true)}
                      style={{ fontSize: '12px', whiteSpace: 'nowrap' }}
                    >
                      {upgradeSaved || prefs.upgradeInterest ? '✓ On waitlist' : 'See Pro plans'}
                    </button>
                  )}
                </div>

                <div
                  style={{
                    background: 'var(--bg-metric)',
                    borderRadius: '10px',
                    padding: '12px 14px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                  }}
                >
                  <p
                    style={{
                      margin: 0,
                      fontSize: '12px',
                      fontWeight: 650,
                      color: 'var(--text-2)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                    }}
                  >
                    Plan limits
                  </p>
                  {[
                    [
                      'Activities',
                      tier === 'paid'
                        ? 'Unlimited'
                        : tier === 'anonymous'
                          ? 'Sign in required'
                          : `${prefs.activities.length} / ${TIER_LIMITS[tier].activities}`,
                    ],
                    ['Calendar sync', TIER_LIMITS[tier].calendar ? '✓' : '—'],
                    ['10-day forecast', tier === 'paid' ? '✓' : '—'],
                  ].map(([label, val]) => (
                    <div
                      key={label}
                      style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}
                    >
                      <span style={{ color: 'var(--text-2)' }}>{label}</span>
                      <span
                        style={{
                          color: val === '—' ? 'var(--text-3)' : 'var(--text)',
                          fontWeight: 600,
                        }}
                      >
                        {val}
                      </span>
                    </div>
                  ))}
                </div>

                {user ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div className="metric-card">
                      <p style={{ margin: '0 0 2px', fontSize: '12px', color: 'var(--text-3)' }}>
                        Signed in as
                      </p>
                      <p
                        style={{
                          margin: 0,
                          fontSize: '14px',
                          fontWeight: 600,
                          color: 'var(--text)',
                        }}
                      >
                        {user.displayName || user.email}
                      </p>
                    </div>
                    <button
                      className="btn"
                      onClick={() =>
                        void (async () => {
                          setNotifError(null)
                          try {
                            await signOutAndClear(user?.uid)
                          } catch (error) {
                            console.error('Sign-out failed:', error)
                            setNotifError(
                              'Could not safely sign out. Check your connection and try again.',
                            )
                            return
                          }
                          onClose()
                        })()
                      }
                      style={{ justifyContent: 'center', color: '#DC2626', borderColor: '#FECACA' }}
                    >
                      Sign out
                    </button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-3)' }}>
                      Sign in to track {TIER_LIMITS.free.activities} activities free and sync
                      preferences across devices.
                    </p>
                    {firebaseEnabled ? (
                      <GoogleSignInButton seedPrefs={draft} style={{ justifyContent: 'center' }} />
                    ) : (
                      <p
                        style={{
                          margin: 0,
                          fontSize: '12px',
                          color: 'var(--text-3)',
                          fontStyle: 'italic',
                        }}
                      >
                        Firebase not configured — running in local mode.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className={styles.footer}>
          <button
            type="button"
            className="btn"
            onClick={requestClose}
            style={{ flex: 1, justifyContent: 'center' }}
          >
            {dirty ? 'Discard' : 'Cancel'}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => onSave(draft)}
            style={{ flex: 1, justifyContent: 'center' }}
          >
            Save settings
          </button>
        </div>
      </div>

      {showPricing && (
        <PricingModal
          user={user}
          email={upgradeEmail}
          alreadyWaitlisted={upgradeSaved || !!prefs.upgradeInterest}
          onJoinWaitlist={joinWaitlistWithEmail}
          onClose={() => setShowPricing(false)}
        />
      )}
    </Dialog>
  )
}
