'use client'
import { useEffect, useState, type ReactNode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { saveLocalPrefs, saveFirestorePrefs } from '@/lib/prefs'
import { syncErrorFor, type SyncError } from '@/lib/sync-error'
import { screenAfterOnboarding } from '@/lib/account-screen'
import { useAccount } from '@/lib/use-account'
import { useCheckoutReturn } from '@/lib/use-checkout-return'
import { createQueryClient, useWeather } from '@/lib/use-forecast'
import { resolveUnits, unitFormatters } from '@/lib/units'
import { UnitsContext } from '@/lib/use-units'
import { onForegroundMessage } from '@/lib/notifications'
import type { Activity, UserPreferences, TierLevel, DayWeather } from '@/lib/types'
import Welcome from './Welcome'
import Onboarding from './Onboarding'
import Dashboard from './Dashboard'
import Header from './Header'
import Skeleton from './Skeleton'
import InstallPrompt from './InstallPrompt'
import CalendarView from './CalendarView'
import DevPanel from './DevPanel'
import ErrorBoundary from './ErrorBoundary'
import AppShell, { type AppView } from './AppShell'
import AppNotice from './AppNotice'
import { AccountLoadError, AccountLoading } from './AccountStatus'
import ScheduledProvider from './ScheduledProvider'

export default function App() {
  const [queryClient] = useState(createQueryClient)
  return (
    <QueryClientProvider client={queryClient}>
      <SignedInApp />
    </QueryClientProvider>
  )
}

function SignedInApp() {
  const [view, setView] = useState<AppView>('dashboard')
  const [selectedDay, setSelectedDay] = useState<DayWeather | null>(null)
  const [tierOverride, setTierOverride] = useState<TierLevel | null>(null)
  const [prefsOpen, setPrefsOpen] = useState(false)
  const [prefsTab] = useState<'general' | 'activities' | 'location'>('general')
  const [syncError, setSyncError] = useState<SyncError | null>(null)
  const [foregroundNotice, setForegroundNotice] = useState(false)
  const [billingNotice, setBillingNotice] = useState<string | null>(null)
  const isDev = process.env.NODE_ENV === 'development'

  const { user, prefs, setPrefs, screen, setScreen, accountError, reload } = useAccount({
    onAccountReset: () => {
      setSyncError(null)
      setBillingNotice(null)
      setForegroundNotice(false)
      setSelectedDay(null)
      setView('dashboard')
    },
  })

  useEffect(() => {
    if (!user) return
    return onForegroundMessage(() => setForegroundNotice(true))
  }, [user])

  useCheckoutReturn(user, { onNotice: setBillingNotice, onPaid: setPrefs })

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
    if (!user) return
    saveLocalPrefs({ ...updated, uid: user.uid })
    try {
      await saveFirestorePrefs(user.uid, updated)
    } catch (error) {
      setSyncError(syncErrorFor(error))
    }
  }

  function handleOnboardingComplete() {
    // Sign-in from setup has created the account from the setup answers, or found
    // the account that already existed. Either way the saved account is the only
    // source for what is on screen, so load it rather than showing the answers: a
    // returning account must never see (or save over its plan with) setup answers.
    setScreen(screenAfterOnboarding)
    reload()
  }

  if (screen === 'loading') {
    return accountError ? (
      <AccountLoadError message={accountError} onRetry={reload} />
    ) : (
      <AccountLoading />
    )
  }

  if (screen === 'welcome') {
    return <Welcome onGetStarted={() => setScreen('onboarding')} />
  }

  if (screen === 'onboarding' || !prefs?.location) {
    return <Onboarding onComplete={handleOnboardingComplete} />
  }

  const displayTier = tierOverride || prefs.tier || 'anonymous'
  // Guests only get the dashboard - no calendar tab bar, and never a stale
  // 'calendar' view (e.g. right after signing out). Derived rather than reset in
  // the auth listener because DevPanel's tierOverride flips displayTier without an
  // auth event. EVERY render decision below must key off effectiveView, never `view`.
  const effectiveView = displayTier === 'anonymous' ? 'dashboard' : view
  const savePrefs = (p: UserPreferences) => void handlePrefsUpdate(p)

  return (
    <AccountContexts units={units} uid={user?.uid ?? null} activities={prefs.activities}>
      <AppShell
        header={
          <Header
            user={user}
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
    </AccountContexts>
  )
}

/** Display units and the account's scheduled activities, for everything below. */
function AccountContexts({
  units,
  uid,
  activities,
  children,
}: {
  units: ReturnType<typeof unitFormatters>
  uid: string | null
  activities: Activity[]
  children: ReactNode
}) {
  return (
    <UnitsContext value={units}>
      <ScheduledProvider uid={uid} activities={activities}>
        {children}
      </ScheduledProvider>
    </UnitsContext>
  )
}
