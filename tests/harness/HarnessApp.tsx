'use client'
// Signed-in UI harness. Renders the real Header, Dashboard, CalendarView,
// PreferencesModal and PricingModal with fixed fixtures inside the same
// AppShell that components/App.tsx uses for the signed-in app.
//
// Query parameters:
//   screen = dashboard (default) | calendar | settings | pricing
//   tier   = paid (default) | free | guest (signed out, the guest plan with one activity)
//   tab    = general (default) | activities | location   (settings only)
//   fixture = default (default) | uv-gaps   (see uv-gap-fixtures.ts)
//            | peak-early | peak-late   (see sun-peak-fixtures.ts)
//   scheduled = none (default) | synced | reconnect: in-memory scheduled activities
//            (see scheduled-fixtures.tsx), shown as synced or awaiting reconnect
//   activities = comma-separated activity ids to keep from the plan (default: all)
//   events = none (default) | sample: in-memory imported events (see event-fixtures.ts);
//            signed-in screens always get the in-memory store, empty by default
//   (offline: the offline notice shows whenever the browser is offline, as in the app)
//   (guest plan notice: shows when localStorage holds a record for harness-user, as in
//   the app after a guest signs in to an existing account; guest-plan-notice.spec.ts)
//   data   = fixture (default) | live: load the forecast through the app's real data
//            layer (lib/use-forecast.ts useWeather); specs answer the Open-Meteo
//            requests with page.route (see data-layer.spec.ts)
//
// Only reachable in builds made with NEXT_PUBLIC_UI_HARNESS=1; see
// app/harness/page.harness.tsx and scripts/check-no-ui-harness.mjs.
import { useMemo, useState } from 'react'
import type { DayWeather, TierLevel, UserPreferences } from '@/lib/types'
import AppShell, { type AppView } from '@/components/AppShell'
import Header from '@/components/Header'
import Dashboard from '@/components/Dashboard'
import CalendarView from '@/components/CalendarView'
import PricingModal from '@/components/PricingModal'
import { resolveUnits, unitFormatters } from '@/lib/units'
import { UnitsContext } from '@/lib/use-units'
import { createForecastStore, ForecastStoreProvider, useWeather } from '@/lib/use-forecast'
import Skeleton from '@/components/Skeleton'
import OfflineNotice from '@/components/OfflineNotice'
import GuestPlanNotice from '@/components/GuestPlanNotice'
import { HARNESS_NOW_MS } from './clock'
import { HARNESS_MARKER, buildPrefs, buildUser, buildWeather } from './fixtures'
import { buildGapWeather } from './uv-gap-fixtures'
import { buildSunPeakWeather, isSunPeakFixture, type SunPeakFixture } from './sun-peak-fixtures'
import { HarnessScheduledProvider } from './scheduled-fixtures'
import { EventsStoreContext } from '@/lib/events-context'
import { buildEvents, createMemoryEventsStore } from './event-fixtures'

export type HarnessScreen = 'dashboard' | 'calendar' | 'settings' | 'pricing' | 'pricing-checkout'
type SettingsTab = 'general' | 'activities' | 'location'

const SCREENS: HarnessScreen[] = [
  'dashboard',
  'calendar',
  'settings',
  'pricing',
  'pricing-checkout',
]
const TABS: SettingsTab[] = ['general', 'activities', 'location']

function readFixture(name: string | null): 'default' | 'uv-gaps' | SunPeakFixture {
  if (name === 'uv-gaps' || isSunPeakFixture(name)) return name
  return 'default'
}

function readParams() {
  const params = new URLSearchParams(window.location.search)
  const screen = params.get('screen') as HarnessScreen | null
  const tierParam = params.get('tier')
  const tier = tierParam === 'free' ? 'free' : tierParam === 'guest' ? 'anonymous' : 'paid'
  const tab = params.get('tab') as SettingsTab | null
  return {
    screen: screen && SCREENS.includes(screen) ? screen : 'dashboard',
    tier: tier as TierLevel,
    tab: tab && TABS.includes(tab) ? tab : 'general',
    fixture: readFixture(params.get('fixture')),
    live: params.get('data') === 'live',
    scheduled: (['synced', 'reconnect'] as const).find(v => v === params.get('scheduled')) ?? null,
    activities: params.get('activities')?.split(',') ?? null,
    events: params.get('events') === 'sample',
  }
}

export default function HarnessApp() {
  const [forecasts] = useState(createForecastStore)
  const [scheduled] = useState(() => readParams().scheduled)
  const [events] = useState(() => createMemoryEventsStore(readParams().events ? buildEvents() : []))
  return (
    <ForecastStoreProvider value={forecasts}>
      <EventsStoreContext value={events}>
        {scheduled ? (
          <HarnessScheduledProvider sync={scheduled}>
            <Harness />
          </HarnessScheduledProvider>
        ) : (
          <Harness />
        )}
      </EventsStoreContext>
    </ForecastStoreProvider>
  )
}

function Harness() {
  const initial = useMemo(() => readParams(), [])
  const user = useMemo(() => (initial.tier === 'anonymous' ? null : buildUser()), [initial.tier])
  const fixtureWeather = useMemo(
    () =>
      initial.fixture === 'uv-gaps'
        ? buildGapWeather()
        : initial.fixture === 'default'
          ? buildWeather()
          : buildSunPeakWeather(initial.fixture),
    [initial.fixture],
  )
  const [prefs, setPrefs] = useState<UserPreferences>(() => {
    const built = buildPrefs(initial.tier)
    const keep = initial.activities
    return keep
      ? { ...built, activities: built.activities.filter(a => keep.includes(a.id)) }
      : built
  })
  const live = useWeather(initial.live ? prefs.location : null)
  const weather = initial.live ? live.weather : fixtureWeather
  const [view, setView] = useState<AppView>(
    initial.screen === 'calendar' ? 'calendar' : 'dashboard',
  )
  const [selectedDay, setSelectedDay] = useState<DayWeather | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(initial.screen === 'settings')
  const [pricingOpen, setPricingOpen] = useState(
    initial.screen === 'pricing' || initial.screen === 'pricing-checkout',
  )

  const displayTier = prefs.tier
  // Display units from the account, else the browser locale, as in components/App.tsx.
  const units = unitFormatters(resolveUnits(prefs))

  return (
    <UnitsContext value={units}>
      <div data-testid={HARNESS_MARKER} data-screen={initial.screen}>
        <AppShell
          header={
            <Header
              user={user}
              prefs={prefs}
              displayTier={displayTier}
              onPrefsUpdate={setPrefs}
              forceOpenTab={settingsOpen ? initial.tab : undefined}
              onModalClose={() => setSettingsOpen(false)}
              onGoHome={() => {
                setView('dashboard')
                setSelectedDay(null)
              }}
              currentUV={weather?.current.uv}
            />
          }
          view={view}
          onViewChange={displayTier === 'anonymous' ? undefined : setView}
          after={
            pricingOpen && (
              <PricingModal
                user={user}
                email={user?.email ?? undefined}
                onJoinWaitlist={() => {}}
                onClose={() => setPricingOpen(false)}
                // The harness build has no Functions; this screen shows Pro once billing is on.
                checkoutAvailable={initial.screen === 'pricing-checkout' || undefined}
              />
            )
          }
        >
          {/* Shown only offline (tests/harness/offline.spec.ts). The fixtures were
              "fetched" 75 minutes before the frozen now. */}
          <OfflineNotice
            weather={weather}
            updatedAt={initial.live ? live.updatedAt : HARNESS_NOW_MS - 75 * 60_000}
          />
          {user && <GuestPlanNotice uid={user.uid} />}
          {initial.live && live.error && (
            <p role="alert" data-testid="weather-error">
              {live.error}
            </p>
          )}
          {live.loading && <Skeleton />}
          {view === 'dashboard' && weather && (
            <Dashboard
              user={user}
              weather={weather}
              prefs={prefs}
              displayTier={displayTier}
              onPrefsUpdate={setPrefs}
              onRefresh={live.refresh}
              selectedDay={selectedDay}
              onSelectDay={setSelectedDay}
            />
          )}
          {view === 'calendar' && weather && (
            <div className="card">
              <CalendarView
                prefs={prefs}
                displayTier={displayTier}
                weather={weather}
                onPrefsUpdate={setPrefs}
              />
            </div>
          )}
        </AppShell>
      </div>
    </UnitsContext>
  )
}
