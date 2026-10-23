'use client'
// Signed-in UI harness. Renders the real Header, Dashboard, CalendarView,
// PreferencesModal and PricingModal with fixed fixtures inside the same
// AppShell that components/App.tsx uses for the signed-in app.
//
// Query parameters:
//   screen = dashboard (default) | calendar | settings | pricing
//   tier   = paid (default) | free
//   tab    = general (default) | activities | location   (settings only)
//   fixture = default (default) | uv-gaps   (see uv-gap-fixtures.ts)
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
import { HARNESS_MARKER, buildPrefs, buildUser, buildWeather } from './fixtures'
import { buildGapWeather } from './uv-gap-fixtures'

export type HarnessScreen = 'dashboard' | 'calendar' | 'settings' | 'pricing'
type SettingsTab = 'general' | 'activities' | 'location'

const SCREENS: HarnessScreen[] = ['dashboard', 'calendar', 'settings', 'pricing']
const TABS: SettingsTab[] = ['general', 'activities', 'location']

function readParams() {
  const params = new URLSearchParams(window.location.search)
  const screen = params.get('screen') as HarnessScreen | null
  const tier = params.get('tier') === 'free' ? 'free' : 'paid'
  const tab = params.get('tab') as SettingsTab | null
  return {
    screen: screen && SCREENS.includes(screen) ? screen : 'dashboard',
    tier: tier as TierLevel,
    tab: tab && TABS.includes(tab) ? tab : 'general',
    fixture: params.get('fixture') === 'uv-gaps' ? 'uv-gaps' : 'default',
  }
}

export default function HarnessApp() {
  const initial = useMemo(() => readParams(), [])
  const user = useMemo(() => buildUser(), [])
  const weather = useMemo(
    () => (initial.fixture === 'uv-gaps' ? buildGapWeather() : buildWeather()),
    [initial.fixture],
  )
  const [prefs, setPrefs] = useState<UserPreferences>(() => buildPrefs(initial.tier))
  const [view, setView] = useState<AppView>(
    initial.screen === 'calendar' ? 'calendar' : 'dashboard',
  )
  const [selectedDay, setSelectedDay] = useState<DayWeather | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(initial.screen === 'settings')
  const [pricingOpen, setPricingOpen] = useState(initial.screen === 'pricing')

  const displayTier = prefs.tier

  return (
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
            currentUV={weather.current.uv}
          />
        }
        view={view}
        onViewChange={setView}
        after={
          pricingOpen && (
            <PricingModal
              user={user}
              email={user.email ?? undefined}
              onJoinWaitlist={() => {}}
              onClose={() => setPricingOpen(false)}
            />
          )
        }
      >
        {view === 'dashboard' && (
          <Dashboard
            weather={weather}
            prefs={prefs}
            displayTier={displayTier}
            onPrefsUpdate={setPrefs}
            onRefresh={() => {}}
            selectedDay={selectedDay}
            onSelectDay={setSelectedDay}
          />
        )}
        {view === 'calendar' && (
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
  )
}
