'use client'
// Signed-in UI harness. Renders the real Header, Dashboard, CalendarView,
// PreferencesModal and PricingModal with fixed fixtures, laid out the way
// components/App.tsx lays out the signed-in app.
//
// Query parameters:
//   screen = dashboard (default) | calendar | settings | pricing
//   tier   = paid (default) | free
//   tab    = general (default) | activities | location   (settings only)
//
// Only reachable in builds made with NEXT_PUBLIC_UI_HARNESS=1; see
// app/harness/page.harness.tsx and scripts/check-no-ui-harness.mjs.
import { useMemo, useState } from 'react'
import type { DayWeather, TierLevel, UserPreferences } from '@/lib/types'
import Header from '@/components/Header'
import Dashboard from '@/components/Dashboard'
import CalendarView from '@/components/CalendarView'
import PricingModal from '@/components/PricingModal'
import { HARNESS_MARKER, buildPrefs, buildUser, buildWeather } from './fixtures'

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
  }
}

export default function HarnessApp() {
  const initial = useMemo(() => readParams(), [])
  const user = useMemo(() => buildUser(), [])
  const weather = useMemo(() => buildWeather(), [])
  const [prefs, setPrefs] = useState<UserPreferences>(() => buildPrefs(initial.tier))
  const [view, setView] = useState<'dashboard' | 'calendar'>(
    initial.screen === 'calendar' ? 'calendar' : 'dashboard',
  )
  const [selectedDay, setSelectedDay] = useState<DayWeather | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(initial.screen === 'settings')
  const [pricingOpen, setPricingOpen] = useState(initial.screen === 'pricing')

  const displayTier = prefs.tier

  // Mirrors the signed-in shell in components/App.tsx (sticky header, view tabs,
  // main column widths). Keep in sync until App exposes a reusable shell.
  return (
    <div
      data-testid={HARNESS_MARKER}
      data-screen={initial.screen}
      style={{ minHeight: '100vh', background: 'var(--bg)' }}
    >
      <div style={{ position: 'sticky', top: 0, zIndex: 40 }}>
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
        <div style={{ borderBottom: '0.5px solid var(--border-md)', background: 'var(--bg-card)' }}>
          <div
            style={{
              maxWidth: '900px',
              margin: '0 auto',
              padding: '0 1rem',
              display: 'flex',
              gap: '0',
            }}
          >
            {(['dashboard', 'calendar'] as const).map(v => (
              <button
                key={v}
                onClick={() => setView(v)}
                style={{
                  padding: '11px 16px',
                  fontSize: '13px',
                  fontWeight: 500,
                  cursor: 'pointer',
                  background: 'none',
                  border: 'none',
                  borderBottom: view === v ? '2px solid var(--accent)' : '2px solid transparent',
                  color: view === v ? 'var(--accent)' : 'var(--text-3)',
                  textTransform: 'capitalize',
                  transition: 'color 0.15s',
                }}
              >
                {v === 'dashboard' ? '☀️ Dashboard' : '🗓️ Calendar'}
              </button>
            ))}
          </div>
        </div>
      </div>
      <main
        style={{
          maxWidth: view === 'calendar' ? '1120px' : '900px',
          margin: '0 auto',
          padding: '1.5rem 1rem',
        }}
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
      </main>
      {pricingOpen && (
        <PricingModal
          user={user}
          email={user.email ?? undefined}
          onJoinWaitlist={() => {}}
          onClose={() => setPricingOpen(false)}
        />
      )}
    </div>
  )
}
