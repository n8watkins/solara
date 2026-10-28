'use client'
// Signed-in UI harness. Renders the real Header, Dashboard, CalendarView,
// PreferencesModal and PricingModal with fixed fixtures inside the same
// AppShell that components/App.tsx uses for the signed-in app.
//
// Query parameters:
//   screen = dashboard (default) | calendar | settings | pricing
//   tier   = paid (default) | free | guest (signed out, the guest plan with one activity)
//   tab    = general (default) | alerts | appearance | activities | location | account
//            (settings only; REVIEW6 L7 added alerts, appearance and account)
//   fixture = default (default) | uv-gaps   (see uv-gap-fixtures.ts)
//            | peak-early | peak-late   (see sun-peak-fixtures.ts)
//   scheduled = none (default) | synced | reconnect: in-memory scheduled activities
//            (see scheduled-fixtures.tsx), shown as synced or awaiting reconnect
//   activities = comma-separated activity ids to keep from the plan (default: all)
//   events = none (default) | sample | full: in-memory imported events (see
//            event-fixtures.ts; full is the sample in an account at the per-account cap);
//            signed-in screens always get the in-memory store, empty by default
//   links  = none (default) | sample: in-memory linked calendars (subscription-fixtures.ts)
//            and one event from a linked calendar; shown with ?subscriptions=on, which
//            stands in for NEXT_PUBLIC_EVENTS_SUBSCRIPTIONS_ENABLED
//   google = none (default) | connected | many: events already in Google Calendar, with a fake
//            Google (google-calendar-fixtures.ts); shown with ?gcal=on, which stands in for
//            NEXT_PUBLIC_GOOGLE_CALENDAR_EVENTS_ENABLED with the OAuth client ID
//   outlookcal = none (default) | connected: events already in Outlook, with a fake
//            Microsoft (outlook-calendar-fixtures.ts); shown with ?outlook=on, which stands in
//            for NEXT_PUBLIC_OUTLOOK_CALENDAR_EVENTS_ENABLED with the Microsoft client ID
//   (offline: the offline notice shows whenever the browser is offline, as in the app)
//   (stale: with data=live, a forecast answer marked `stale` shows its note, as in the
//   app; stale-forecast.spec.ts)
//   (guest plan notice: shows when localStorage holds a record for harness-user, as in
//   the app after a guest signs in to an existing account; guest-plan-notice.spec.ts)
//   data   = fixture (default) | live: load the forecast through the app's real data
//            layer (lib/use-forecast.ts useWeather); specs answer the Open-Meteo
//            requests with page.route (see data-layer.spec.ts)
//   place  = los-angeles (default) | sydney | san-luis-obispo | ojai: the account's place
//            (HARNESS_PLACES in fixtures.ts); with data=live, for screens in another zone
//            (sun-phase.spec.ts); the last two are a long and a short name in Los Angeles'
//            zone (dashboard-polish.spec.ts)
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
import ForecastNotice from '@/components/ForecastNotice'
import GuestPlanNotice from '@/components/GuestPlanNotice'
import { SETTINGS_SECTIONS, type SettingsTab } from '@/components/settings/SettingsTabs'
import { HARNESS_NOW_MS } from './clock'
import { HARNESS_MARKER, HARNESS_PLACES, buildPrefs, buildUser, buildWeather } from './fixtures'
import { buildGapWeather } from './uv-gap-fixtures'
import { buildSunPeakWeather, isSunPeakFixture, type SunPeakFixture } from './sun-peak-fixtures'
import { HarnessScheduledProvider } from './scheduled-fixtures'
import {
  EventsStoreContext,
  GoogleCalendarApiContext,
  GoogleLinkStoreContext,
  OutlookCalendarApiContext,
  OutlookLinkStoreContext,
  SubscriptionsStoreContext,
} from '@/lib/events-context'
import { IMPORTED_EVENT_LIMITS } from '@solara/core/event-import'
import { buildEvents, buildFeedEvent, createMemoryEventsStore } from './event-fixtures'
import { buildSubscriptions, createMemorySubscriptionsStore } from './subscription-fixtures'
import {
  buildGoogleEvents,
  buildGoogleLink,
  buildManyGoogleEvents,
  createFakeGoogleCalendarApi,
  createMemoryGoogleLinkStore,
} from './google-calendar-fixtures'
import {
  buildOutlookEvents,
  buildOutlookLink,
  createFakeOutlookCalendarApi,
  createMemoryOutlookLinkStore,
} from './outlook-calendar-fixtures'

export type HarnessScreen = 'dashboard' | 'calendar' | 'settings' | 'pricing' | 'pricing-checkout'

const SCREENS: HarnessScreen[] = [
  'dashboard',
  'calendar',
  'settings',
  'pricing',
  'pricing-checkout',
]
const TABS: readonly SettingsTab[] = SETTINGS_SECTIONS.map(section => section.id)

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
    events: (['sample', 'full'] as const).find(v => v === params.get('events')) ?? null,
    links: params.get('links') === 'sample',
    google: (['connected', 'many'] as const).find(v => v === params.get('google')) ?? null,
    outlook: params.get('outlookcal') === 'connected',
    place: HARNESS_PLACES[params.get('place') ?? ''] ?? null,
  }
}

export default function HarnessApp() {
  const [forecasts] = useState(createForecastStore)
  const [scheduled] = useState(() => readParams().scheduled)
  const [links] = useState(() =>
    createMemorySubscriptionsStore(readParams().links ? buildSubscriptions() : []),
  )
  const [googleApi] = useState(createFakeGoogleCalendarApi)
  const [googleLink] = useState(() =>
    createMemoryGoogleLinkStore(readParams().google ? buildGoogleLink() : null),
  )
  const [outlookApi] = useState(createFakeOutlookCalendarApi)
  const [outlookLink] = useState(() =>
    createMemoryOutlookLinkStore(readParams().outlook ? buildOutlookLink() : null),
  )
  const [events] = useState(() => {
    const { events: kind, links: withLinks, google, outlook } = readParams()
    const sample = [
      ...(kind ? buildEvents() : []),
      ...(withLinks ? [buildFeedEvent()] : []),
      ...(google === 'many' ? buildManyGoogleEvents() : google ? buildGoogleEvents() : []),
      ...(outlook ? buildOutlookEvents() : []),
    ]
    // "full": the sample plus enough past events to reach the per-account cap.
    const pastStored = kind === 'full' ? IMPORTED_EVENT_LIMITS.maxStored - sample.length : 0
    return createMemoryEventsStore(sample, { pastStored })
  })
  return (
    <ForecastStoreProvider value={forecasts}>
      <EventsStoreContext value={events}>
        <SubscriptionsStoreContext value={links}>
          <GoogleLinkStoreContext value={googleLink}>
            <GoogleCalendarApiContext value={googleApi}>
              <OutlookLinkStoreContext value={outlookLink}>
                <OutlookCalendarApiContext value={outlookApi}>
                  {scheduled ? (
                    <HarnessScheduledProvider sync={scheduled}>
                      <Harness />
                    </HarnessScheduledProvider>
                  ) : (
                    <Harness />
                  )}
                </OutlookCalendarApiContext>
              </OutlookLinkStoreContext>
            </GoogleCalendarApiContext>
          </GoogleLinkStoreContext>
        </SubscriptionsStoreContext>
      </EventsStoreContext>
    </ForecastStoreProvider>
  )
}

function Harness() {
  const initial = useMemo(() => readParams(), [])
  const user = useMemo(() => (initial.tier === 'anonymous' ? null : buildUser()), [initial.tier])
  // The page clock is the harness's (clock.ts), so the live reading matches it.
  const [openedAt] = useState(() => Date.now())
  const fixtureWeather = useMemo(
    () =>
      initial.fixture === 'uv-gaps'
        ? buildGapWeather()
        : initial.fixture === 'default'
          ? buildWeather(openedAt)
          : buildSunPeakWeather(initial.fixture),
    [initial.fixture, openedAt],
  )
  const [prefs, setPrefs] = useState<UserPreferences>(() => {
    const built = buildPrefs(initial.tier)
    const placed = initial.place ? { ...built, location: initial.place } : built
    const keep = initial.activities
    return keep
      ? { ...placed, activities: placed.activities.filter(a => keep.includes(a.id)) }
      : placed
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
          {/* Shown offline (tests/harness/offline.spec.ts) or for the proxy's earlier
              copy (stale-forecast.spec.ts). The fixtures were "fetched" 75 minutes
              before the frozen now. */}
          <ForecastNotice
            weather={weather}
            updatedAt={initial.live ? live.updatedAt : HARNESS_NOW_MS - 75 * 60_000}
            stale={initial.live && live.stale && !live.error}
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
