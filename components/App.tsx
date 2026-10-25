'use client'
import { useEffect, useState, type ReactNode } from 'react'
import { saveLocalPrefs, saveFirestorePrefs } from '@/lib/prefs'
import { syncErrorFor, type SyncError } from '@/lib/sync-error'
import { SIGN_IN_PARAM } from '@/lib/app-routes'
import { loadGuestPrefs, saveGuestPrefs } from '@/lib/guest'
import { SignedInContext } from '@/lib/signed-in-context'
import { canUseCalendar } from '@/lib/tiers'
import { screenAfterOnboarding } from '@/lib/account-screen'
import { useAccount } from '@/lib/use-account'
import { useCheckoutReturn } from '@/lib/use-checkout-return'
import { createForecastStore, ForecastStoreProvider, useWeather } from '@/lib/use-forecast'
import { resolveUnits, unitFormatters } from '@/lib/units'
import { UnitsContext } from '@/lib/use-units'
import { lazySubscription, storedSessionHint } from '@/lib/firebase'
import { watchInstallPrompt } from '@/lib/install-prompt'
import type { Activity, UserPreferences, TierLevel, DayWeather } from '@/lib/types'
import SignInScreen from './SignInScreen'
import Dashboard from './Dashboard'
import Header from './Header'
import Skeleton from './Skeleton'
import {
  CalendarView,
  InstallPrompt,
  Onboarding,
  preloadDeferred,
  preloadSignedInParts,
} from './deferred'
import DevPanel from './DevPanel'
import ErrorBoundary from './ErrorBoundary'
import AppShell, { type AppView } from './AppShell'
import AppNotice from './AppNotice'
import { AccountLoadError, AccountLoading } from './AccountStatus'
import ScheduledProvider from './ScheduledProvider'

// A browser holding a session opens on the signed-in screen, which waits for these
// parts (lib/use-account.ts): fetch them as soon as this module runs, not after the
// first render.
if (typeof window !== 'undefined' && storedSessionHint()) void preloadSignedInParts()
// The install prompt loads later; the browser's install event is kept from now on.
watchInstallPrompt()

export default function App() {
  const [forecasts] = useState(createForecastStore)
  return (
    <ForecastStoreProvider value={forecasts}>
      <SignedInApp />
    </ForecastStoreProvider>
  )
}

/** Whether the visitor came to sign in (the landing page's "Sign in" link). */
function signInRequestedByUrl(): boolean {
  return new URLSearchParams(window.location.search).has(SIGN_IN_PARAM)
}

function SignedInApp() {
  const [signInRequested] = useState(signInRequestedByUrl)
  const [view, setView] = useState<AppView>('dashboard')
  const [selectedDay, setSelectedDay] = useState<DayWeather | null>(null)
  const [tierOverride, setTierOverride] = useState<TierLevel | null>(null)
  const [prefsOpen, setPrefsOpen] = useState(false)
  const [prefsTab] = useState<'general' | 'activities' | 'location'>('general')
  const [syncError, setSyncError] = useState<SyncError | null>(null)
  const [foregroundNotice, setForegroundNotice] = useState(false)
  const [billingNotice, setBillingNotice] = useState<string | null>(null)
  const isDev = process.env.NODE_ENV === 'development'

  const {
    user,
    pending,
    prefs,
    setPrefs,
    screen,
    setScreen,
    accountError,
    reload,
    continueAsGuest,
  } = useAccount({
    onAccountReset: () => {
      setSyncError(null)
      setBillingNotice(null)
      setForegroundNotice(false)
      setSelectedDay(null)
      setView('dashboard')
    },
    signInRequested,
    prepareSignedIn: preloadSignedInParts,
  })

  // The sign-in flag is read once; drop it so a reload or a later sign-out does not
  // bring the sign-in screen back.
  useEffect(() => {
    if (!signInRequested) return
    const url = new URL(window.location.href)
    url.searchParams.delete(SIGN_IN_PARAM)
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash)
  }, [signInRequested])

  useEffect(() => {
    if (!user) return
    // The notifications code loads only for someone signed in.
    return lazySubscription(
      async () => {
        const { onForegroundMessage } = await import('@/lib/notifications')
        return onForegroundMessage(() => setForegroundNotice(true))
      },
      error => console.error('Foreground notification error:', error),
    )
  }, [user])

  useCheckoutReturn(user, { onNotice: setBillingNotice, onPaid: setPrefs })

  // Once the first screen shows, fetch the dialogs and views it can open (deferred.tsx).
  const shown = screen !== 'loading'
  useEffect(() => (shown ? preloadDeferred() : undefined), [shown])

  // The forecast for the active location. Switching location aborts the old
  // request; a cached forecast shows at once while a stale one refreshes; "today"
  // and "now" come from the location's time zone.
  const {
    weather,
    loading: weatherLoading,
    error,
    refresh: refreshWeather,
  } = useWeather(screen === 'dashboard' ? prefs?.location : null)
  const units = unitFormatters(resolveUnits(prefs))

  async function handlePrefsUpdate(updated: UserPreferences) {
    setPrefs(updated)
    setSyncError(null)
    // A guest's plan stays in this browser (lib/guest.ts).
    if (!user) {
      saveGuestPrefs(updated)
      return
    }
    saveLocalPrefs({ ...updated, uid: user.uid })
    try {
      await saveFirestorePrefs(user.uid, updated)
    } catch (error) {
      setSyncError(syncErrorFor(error))
    }
  }

  function handleSignedIn(account: UserPreferences | null) {
    // Sign-in (from setup, the sign-in screen or any upsell) has created the account
    // from the guest plan or the setup answers, or found the account that already
    // existed. Either way the saved account is the only source for what is on screen,
    // so load it rather than showing what was on this device: a returning account
    // must never see (or save over its plan with) guest data. The reload uses the
    // document that sign-in's transaction returned instead of reading it again (see
    // loadAccountPrefs).
    setScreen(screenAfterOnboarding)
    reload(account)
  }

  function handleStartAsGuest(answers: UserPreferences) {
    saveGuestPrefs(answers)
    setPrefs(loadGuestPrefs() ?? answers)
    setScreen('dashboard')
  }

  if (screen === 'loading') {
    return accountError ? (
      <AccountLoadError message={accountError} onRetry={() => reload()} />
    ) : (
      <AccountLoading />
    )
  }

  if (screen === 'signin') {
    return (
      <SignedInContext value={handleSignedIn}>
        <SignInScreen onContinueAsGuest={continueAsGuest} />
      </SignedInContext>
    )
  }

  if (screen === 'onboarding' || !prefs?.location) {
    return (
      <Onboarding user={user} onSignedIn={handleSignedIn} onStartAsGuest={handleStartAsGuest} />
    )
  }

  const displayTier = tierOverride || prefs.tier || 'anonymous'
  // Guests only get the dashboard - no calendar tab bar, and never a stale
  // 'calendar' view (e.g. right after signing out). Derived rather than reset in
  // the auth listener because DevPanel's tierOverride flips displayTier without an
  // auth event. EVERY render decision below must key off effectiveView, never `view`.
  const effectiveView = displayTier === 'anonymous' ? 'dashboard' : view
  const savePrefs = (p: UserPreferences) => void handlePrefsUpdate(p)

  return (
    <AccountContexts
      onSignedIn={handleSignedIn}
      units={units}
      // Scheduled activities (Google Calendar) come with every account, Free included
      // (canUseCalendar in lib/tiers.ts).
      uid={user && canUseCalendar(prefs.tier) ? user.uid : null}
      activities={prefs.activities}
    >
      {/* Until Auth confirms the account shown from this browser's copy and its saved
          plan has loaded, nothing on screen can be changed (lib/use-account.ts). */}
      <div className="contents" inert={!!pending} aria-busy={pending ? true : undefined}>
        <AppShell
          header={
            <Header
              user={user}
              account={user ?? pending}
              prefs={prefs}
              displayTier={displayTier}
              onPrefsUpdate={savePrefs}
              forceOpenTab={prefsOpen ? prefsTab : undefined}
              onModalClose={() => setPrefsOpen(false)}
              onGoHome={() => {
                setView('dashboard')
                setSelectedDay(null)
              }}
              currentUV={weather?.current.uv}
            />
          }
          view={effectiveView}
          onViewChange={displayTier !== 'anonymous' ? setView : undefined}
          after={isDev && <DevPanel currentTier={displayTier} onOverride={setTierOverride} />}
        >
          <InstallPrompt />
          {foregroundNotice && (
            <AppNotice
              tone="notice"
              role="status"
              icon="🔔"
              action={{ label: 'Dismiss', onClick: () => setForegroundNotice(false) }}
            >
              Your latest local-morning planning summary is ready.
            </AppNotice>
          )}
          {billingNotice && (
            <AppNotice tone="info" role="status">
              {billingNotice}
            </AppNotice>
          )}
          {error && (
            <AppNotice tone="error" icon="⚠️" action={{ label: 'Retry', onClick: refreshWeather }}>
              {error}
            </AppNotice>
          )}
          {syncError && (
            <AppNotice
              tone="notice"
              role="alert"
              icon="☁️"
              action={
                syncError.reload
                  ? { label: 'Reload', onClick: () => window.location.reload() }
                  : { label: 'Retry sync', onClick: () => savePrefs(prefs) }
              }
            >
              {syncError.message}
            </AppNotice>
          )}
          {effectiveView === 'dashboard' && (
            <>
              {weatherLoading && <Skeleton />}
              {weather && (
                <ErrorBoundary label="the dashboard" onReset={refreshWeather}>
                  <Dashboard
                    user={user}
                    weather={weather}
                    prefs={prefs}
                    displayTier={displayTier}
                    onPrefsUpdate={savePrefs}
                    onRefresh={refreshWeather}
                    selectedDay={selectedDay}
                    onSelectDay={setSelectedDay}
                  />
                </ErrorBoundary>
              )}
            </>
          )}
          {effectiveView === 'calendar' && (weather || weatherLoading) && (
            <div className="card">
              {weather ? (
                <ErrorBoundary label="the calendar" onReset={refreshWeather}>
                  <CalendarView
                    prefs={prefs}
                    displayTier={displayTier}
                    weather={weather}
                    onPrefsUpdate={savePrefs}
                  />
                </ErrorBoundary>
              ) : (
                <p role="status" className="m-0 py-12 text-center text-[14px] text-ink-3">
                  Loading forecast…
                </p>
              )}
            </div>
          )}
        </AppShell>
      </div>
    </AccountContexts>
  )
}

/**
 * Display units, what sign-in does, and the account's scheduled activities, for
 * everything below.
 */
function AccountContexts({
  onSignedIn,
  units,
  uid,
  activities,
  children,
}: {
  onSignedIn: (account: UserPreferences | null) => void
  units: ReturnType<typeof unitFormatters>
  uid: string | null
  activities: Activity[]
  children: ReactNode
}) {
  return (
    <SignedInContext value={onSignedIn}>
      <UnitsContext value={units}>
        <ScheduledProvider uid={uid} activities={activities}>
          {children}
        </ScheduledProvider>
      </UnitsContext>
    </SignedInContext>
  )
}
