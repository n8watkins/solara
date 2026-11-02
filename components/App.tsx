'use client'
import {
  useEffect,
  useEffectEvent,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { samePlace } from '@solara/core/coordinates'
import { saveLocalPrefs } from '@/lib/local-prefs'
import { syncErrorFor, type SyncError } from '@/lib/sync-error'
import { SIGN_IN_PARAM } from '@/lib/app-routes'
import { guestPlanHasActivities, loadGuestPrefs, saveGuestPrefs } from '@/lib/guest'
import { SignedInContext } from '@/lib/signed-in-context'
import { takeUpdateNotice } from '@/lib/stale-build'
import { canUseCalendar, getSavedLocationLimit } from '@solara/core/tiers'
import {
  otherPlaces,
  withHome,
  withPlaceRemoved,
  withPlaceSaved,
  type PlaceControls,
} from '@/lib/places'
import { VisitContext } from '@/lib/place-context'
import { saveVisit, subscribeTravel, travelOwner, visitSnapshot } from '@/lib/travel-place'
import { useTravelPrompt } from '@/lib/use-travel-prompt'
import { screenAfterOnboarding } from '@/lib/account-screen'
import { useAccount } from '@/lib/use-account'
import { useCheckoutReturn } from '@/lib/use-checkout-return'
import { createForecastStore, ForecastStoreProvider, useWeather } from '@/lib/use-forecast'
import { resolveUnits, unitFormatters } from '@/lib/units'
import { UnitsContext } from '@/lib/use-units'
import { lazySubscription, storedSessionHint } from '@/lib/firebase'
import { watchInstallPrompt } from '@/lib/install-prompt'
import type { Activity, UserPreferences, TierLevel, DayWeather } from '@/lib/types'
import Dashboard from './Dashboard'
import Header from './Header'
import Skeleton from './Skeleton'
import {
  CalendarView,
  ForecastUnavailable,
  GuestPlanNotice,
  InstallPrompt,
  Onboarding,
  SignInScreen,
  TravelBanner,
  preloadActivityPlan,
  preloadDeferred,
  preloadSignedInParts,
} from './deferred'
import DevPanel from './DevPanel'
import ErrorBoundary from './ErrorBoundary'
import AppShell, { type AppView } from './AppShell'
import AppNotice from './AppNotice'
import ForecastNotice from './ForecastNotice'
import UpdateNotice from './UpdateNotice'
import { AccountLoadError, AccountLoading } from './AccountStatus'
import ScheduledProvider from './ScheduledProvider'
import SettingsHost from './SettingsHost'
import { followLanguagePreference, withMessages } from '@/lib/i18n'
import t from '@/messages/app'

// A browser holding a session opens on the signed-in screen, which waits for these
// parts (lib/use-account.ts), and a guest plan with activities opens on a dashboard
// that waits for its activity plan (ActivityPlanGate): fetch them as soon as this
// module runs, not after the first render.
if (typeof window !== 'undefined') {
  if (storedSessionHint()) void preloadSignedInParts()
  else if (guestPlanHasActivities()) void preloadActivityPlan()
}
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
  const [syncError, setSyncError] = useState<SyncError | null>(null)
  const [foregroundNotice, setForegroundNotice] = useState(false)
  const [billingNotice, setBillingNotice] = useState<string | null>(null)
  // Set when this tab has just reloaded to a newer version (lib/stale-build.ts).
  const [updateNotice] = useState(takeUpdateNotice)
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

  // A visit (ROADMAP item 53): another place this device shows instead of home, kept in
  // this browser for whoever's plan it is (lib/travel-place.ts). Everything on screen that
  // depends on place follows the shown place; home stays the plan's own `location`, which
  // the server's calendar link and notifications use.
  const owner = travelOwner(prefs?.uid)
  const visit = useSyncExternalStore(
    subscribeTravel,
    () => visitSnapshot(owner),
    () => null,
  )
  const visiting = !!prefs && !!visit && !samePlace(visit, prefs.location)
  const shownPrefs = useMemo(
    () => (prefs && visiting && visit ? { ...prefs, location: visit } : prefs),
    [prefs, visiting, visit],
  )
  const savedPlaces = useMemo(() => (prefs ? [prefs.location, ...otherPlaces(prefs)] : []), [prefs])
  // Offers the forecast where the device is when it is far from the shown place, only with
  // location permission already granted (lib/use-travel-prompt.ts).
  const travel = useTravelPrompt({
    active: screen === 'dashboard' && !!prefs && !pending,
    owner,
    shown: shownPrefs?.location ?? null,
    places: savedPlaces,
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
        const { onForegroundMessage } = await withMessages(
          ['settings'],
          () => import('@/lib/notifications'),
        )
        return onForegroundMessage(() => setForegroundNotice(true))
      },
      error => console.error('Foreground notification error:', error),
    )
  }, [user])

  // Records that ended over 30 days ago are deleted once per signed-in visit, whatever
  // shows (even with no forecast), as the privacy policy says (lib/privacy-retention.ts).
  const signedInUid = user?.uid ?? null
  useEffect(() => {
    if (!signedInUid) return
    const uid = signedInUid
    withMessages(['editor', 'events', 'linking'], () => import('@/lib/retention'))
      .then(({ pruneEndedRecords }) => pruneEndedRecords(uid, Date.now()))
      .then(outcome => {
        for (const [records, result] of Object.entries(outcome)) {
          if (result instanceof Error) console.error(`Pruning ended ${records} failed:`, result)
        }
      })
      .catch(error => console.error('Pruning ended records failed:', error))
  }, [signedInUid])

  useCheckoutReturn(user, { onNotice: setBillingNotice, onPaid: setPrefs })

  // The language of the plan that opened (a signed-in account's synced choice, which
  // may come from another device, or the guest plan's): the page reloads in it when it
  // differs from the one this page opened in (lib/i18n.ts). Saving Settings follows it
  // in handlePrefsUpdate, once the save has gone through.
  const planReady = prefs !== null
  const followLanguage = useEffectEvent(() => followLanguagePreference(prefs?.language))
  useEffect(() => {
    if (planReady) followLanguage()
  }, [planReady, signedInUid])

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
    updatedAt: weatherUpdatedAt,
    stale: weatherStale,
    refresh: refreshWeather,
  } = useWeather(screen === 'dashboard' ? shownPrefs?.location : null)
  const units = unitFormatters(resolveUnits(prefs))

  async function handlePrefsUpdate(updated: UserPreferences) {
    setPrefs(updated)
    setSyncError(null)
    // A guest's plan stays in this browser (lib/guest.ts).
    if (!user) {
      saveGuestPrefs(updated)
      followLanguagePreference(updated.language)
      return
    }
    saveLocalPrefs({ ...updated, uid: user.uid })
    try {
      const { saveFirestorePrefs } = await import('@/lib/account-prefs')
      await saveFirestorePrefs(user.uid, updated)
    } catch (error) {
      setSyncError(syncErrorFor(error))
    }
    // After the save, so a reload into the new language never cuts it short.
    followLanguagePreference(updated.language)
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
    void loadGuestPrefs().then(guest => {
      setPrefs(guest ?? answers)
      setScreen('dashboard')
    })
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
  const home = prefs.location
  /** Saves the plan; a new home ends a visit, as the new home shows. */
  const savePrefs = (p: UserPreferences) => {
    if (visiting && !samePlace(p.location, home)) saveVisit(owner, null, p.location)
    void handlePrefsUpdate(p)
  }
  // The parts that show the visited place hand back the plan with it as `location`: home
  // stays home.
  const shownPlan = shownPrefs ?? prefs
  const saveFromView = (p: UserPreferences) =>
    savePrefs(p.location === shownPlan.location ? { ...p, location: home } : p)
  const placeLimit = getSavedLocationLimit(displayTier)
  const places: PlaceControls = {
    home,
    shown: shownPlan.location,
    visiting,
    others: otherPlaces(prefs),
    limit: placeLimit,
    signedIn: !!user,
    show: place => saveVisit(owner, place, home),
    save: place => {
      const next = withPlaceSaved(prefs, place, placeLimit)
      if (next && next !== prefs) savePrefs(next)
      return next !== null
    },
    remove: place => savePrefs(withPlaceRemoved(prefs, place)),
    setHome: place => savePrefs(withHome(prefs, place, placeLimit)),
  }

  return (
    <AccountContexts
      onSignedIn={handleSignedIn}
      units={units}
      // Scheduled activities (Google Calendar) come with every account, Free included
      // (canUseCalendar in packages/core/src/tiers.ts).
      uid={user && canUseCalendar(prefs.tier) ? user.uid : null}
      activities={prefs.activities}
    >
      <VisitContext value={visiting ? { home, shown: shownPlan.location } : null}>
        <SettingsHost prefs={prefs} user={user} onSave={savePrefs}>
          {/* Until Auth confirms the account shown from this browser's copy and its saved
          plan has loaded, nothing on screen can be changed (lib/use-account.ts). */}
          <div className="contents" inert={!!pending} aria-busy={pending ? true : undefined}>
            <AppShell
              header={
                <Header
                  user={user}
                  account={user ?? pending}
                  prefs={prefs}
                  places={places}
                  displayTier={displayTier}
                  onPrefsUpdate={savePrefs}
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
              {travel.offer && (
                <TravelBanner
                  place={travel.offer}
                  onSwitch={() => {
                    saveVisit(owner, travel.offer!, home)
                    travel.hide()
                  }}
                  onNotNow={() => {
                    const place = travel.offer!
                    travel.hide()
                    import('@/lib/travel-areas')
                      .then(({ notNowFor }) => notNowFor(owner, place))
                      .catch(error => console.error('Could not keep "Not now":', error))
                  }}
                />
              )}
              {/* A failed refresh has its own notice below, which also says the forecast is old. */}
              <ForecastNotice
                weather={weather}
                updatedAt={weatherUpdatedAt}
                stale={weatherStale && !error}
                readOnly={!!pending}
              />
              {foregroundNotice && (
                <AppNotice
                  tone="notice"
                  role="status"
                  icon="🔔"
                  action={{ label: t.dismiss, onClick: () => setForegroundNotice(false) }}
                >
                  {t.morningSummaryReady}
                </AppNotice>
              )}
              {/* Keyed by account so a later account never sees the previous one's notice. */}
              {user && !pending && <GuestPlanNotice key={user.uid} uid={user.uid} />}
              {updateNotice && <UpdateNotice reason={updateNotice} />}
              {billingNotice && (
                <AppNotice tone="info" role="status">
                  {billingNotice}
                </AppNotice>
              )}
              {/* Without any forecast the dashboard says so in its own place (below). */}
              {error && weather && (
                <AppNotice
                  tone="error"
                  icon="⚠️"
                  action={{ label: t.retry, onClick: refreshWeather }}
                >
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
                      ? { label: t.reload, onClick: () => window.location.reload() }
                      : { label: t.retrySync, onClick: () => savePrefs(prefs) }
                  }
                >
                  {syncError.message}
                </AppNotice>
              )}
              {/* No forecast at all: the same empty state for the dashboard and the calendar. */}
              {error && !weather && (
                <ForecastUnavailable message={error} onRetry={refreshWeather} />
              )}
              {effectiveView === 'dashboard' && (
                <>
                  {weatherLoading && <Skeleton />}
                  {weather && (
                    <ErrorBoundary label={t.errorDashboard} onReset={refreshWeather}>
                      <Dashboard
                        user={user}
                        weather={weather}
                        prefs={shownPlan}
                        displayTier={displayTier}
                        onPrefsUpdate={saveFromView}
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
                    <ErrorBoundary label={t.errorCalendar} onReset={refreshWeather}>
                      <CalendarView
                        prefs={shownPlan}
                        displayTier={displayTier}
                        weather={weather}
                        onPrefsUpdate={saveFromView}
                      />
                    </ErrorBoundary>
                  ) : (
                    <p role="status" className="m-0 py-12 text-center text-[14px] text-ink-3">
                      {t.loadingForecast}
                    </p>
                  )}
                </div>
              )}
            </AppShell>
          </div>
        </SettingsHost>
      </VisitContext>
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
