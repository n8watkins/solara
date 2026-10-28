'use client'
// Parts of the app that are not on screen when it opens: the dialogs and sheets, the
// calendar view and the calendar feed card, the location panel, setup and the sign-in
// screen (a returning visitor never sees them), the UV scale's bands (until opened), the
// install prompt, and the header's signed-in parts (account menu, profile switcher)
// and scheduled activities, which a guest never sees. Each loads as its own
// chunk the first time it renders, so the first load carries only what the opening
// screen shows. Soon after the page has loaded, preloadDeferred() fetches them all, so
// opening one is instant; preloadSignedInParts() fetches the signed-in header parts at once.
//
// Import these instead of the modules themselves; each renders nothing (or its
// fallback) until its chunk has arrived.
import { useEffect, useState, type ComponentType } from 'react'
import { installEnvironment, installPromptKind } from '@/lib/install-prompt'
import { AccountLoading } from './AccountStatus'

type Loader<P> = () => Promise<{ default: ComponentType<P> }>

const loaders = new Set<() => Promise<unknown>>()

/** How long after the page's load event the deferred parts start to download. */
const PRELOAD_DELAY_MS = 1500

// Plain state rather than React.lazy and Suspense: Suspense reveals content on a
// timer, and a part that has loaded once must render in the same pass, with no gap.
function deferred<P extends object>(
  load: Loader<P>,
  Fallback: ComponentType<P> | null = null,
): ComponentType<P> & { preload: () => Promise<unknown> } {
  let loaded: ComponentType<P> | null = null
  let pending: Promise<ComponentType<P>> | null = null
  const preload = () => {
    pending ??= load().then(
      module => (loaded = module.default),
      error => {
        // A failed load (offline, or a deploy in between) is tried again next time.
        pending = null
        throw error
      },
    )
    return pending
  }
  loaders.add(preload)
  function Deferred(props: P) {
    const [Component, setComponent] = useState<ComponentType<P> | null>(() => loaded)
    useEffect(() => {
      if (Component) return
      let active = true
      preload().then(
        loadedComponent => {
          if (active) setComponent(() => loadedComponent)
        },
        error => console.error('Could not load part of the app:', error),
      )
      return () => {
        active = false
      }
    }, [Component])
    if (Component) return <Component {...props} />
    return Fallback ? <Fallback {...props} /> : null
  }
  return Object.assign(Deferred, { preload })
}

// Code that runs only after a click, fetched with the rest so the click needs no download.
loaders.add(() => import('@/lib/gcal'))
loaders.add(() => import('@/lib/share'))
loaders.add(() => import('@/lib/ics'))

export const PreferencesModal = deferred(() => import('./PreferencesModal'))
export const PricingModal = deferred(() => import('./PricingModal'))
/** The optional Fitzpatrick skin type quiz, from setup and Settings. */
export const SkinTypeQuiz = deferred(() => import('./SkinTypeQuiz'))
export const AddActivityModal = deferred(() => import('./AddActivityModal'))
export const EditActivityModal = deferred(() => import('./EditActivityModal'))
export const ManageActivitiesModal = deferred(() => import('./ManageActivitiesModal'))
export const ScheduledSheet = deferred(() => import('./ScheduledSheet'))
export const CalendarView = deferred(() => import('./CalendarView'))
export const CalendarFeed = deferred(() => import('./CalendarFeed'))
/** The UV card's cloud and confidence notes, shown on cloudy or far-off days. */
export const ForecastNotes = deferred(() => import('./dashboard/ForecastNotes'))
const InstallPromptPart = deferred(() => import('./InstallPrompt'))
export const ActivityModals = deferred(() => import('./dashboard/ActivityModals'))
/** A scheduled activity's details (change the time, remove it), opened from its card. */
export const ScheduledDetails = deferred(() => import('./dashboard/ScheduledDetails'))
export const DayDialog = deferred(() => import('./dashboard/DayDialog'))
/** The "UV scale" disclosure's bands, once it is opened. */
export const UVScaleBands = deferred(() => import('./dashboard/UVScaleBands'))
export const LocationPanel = deferred(() => import('./LocationPanel'))

/**
 * The "Add to home screen" prompt (components/InstallPrompt.tsx), which floats over the
 * page once the browser allows installing. It loads once the page has loaded and the
 * browser is idle, like the preloads below, and only where a prompt can show (not once
 * installed or dismissed), so none of it is part of the first load. The browser's
 * install event is kept from start-up (lib/install-prompt.ts), so it is never missed.
 */
export function InstallPrompt() {
  const [ready, setReady] = useState(false)
  useEffect(
    () =>
      installPromptKind(installEnvironment()) ? afterPageLoad(() => setReady(true)) : undefined,
    [],
  )
  return ready ? <InstallPromptPart /> : null
}

/** Keeps the sunscreen timer's place until it shows, so nothing below it moves. */
function ReapplyTimerSpace() {
  return <div aria-hidden="true" className="min-h-16" />
}
const ReapplyTimer = deferred(() => import('./dashboard/ReapplyTimer'), ReapplyTimerSpace)

/**
 * The sunscreen reapply timer on today's dashboard (components/dashboard/ReapplyTimer.tsx).
 * It appears once the page has loaded and the browser is idle, like the preloads below,
 * so none of it is part of a guest's first load.
 */
export function SunscreenTimer() {
  const [ready, setReady] = useState(false)
  useEffect(() => afterPageLoad(() => setReady(true)), [])
  return ready ? <ReapplyTimer /> : <ReapplyTimerSpace />
}
/** The sign-in screen (the landing page's "Sign in"); the loading screen shows until it has arrived. */
export const SignInScreen = deferred(() => import('./SignInScreen'), AccountLoading)
/** Setup, for a first visit; the loading screen shows until it has arrived. */
export const Onboarding = deferred(() => import('./Onboarding'), AccountLoading)
export const AccountMenu = deferred(() => import('./AccountMenu'))
export const ProfileSwitcher = deferred(() => import('./ProfileSwitcher'))
/** After a guest signs in to an existing account: what the guest plan held that was not kept. */
export const GuestPlanNotice = deferred(() => import('./GuestPlanNotice'))
/** A signed-in account's scheduled activities; until it arrives, the screens show none. */
export const AccountScheduled = deferred(() => import('./scheduled/AccountScheduled'))
/** Imported .ics events with the UV during each (signed-in accounts only). */
export const EventsSection = deferred(() => import('./events/EventsSection'))

/**
 * Loads the header's signed-in parts now, for a session about to show (a stored
 * session at start-up, or a sign-in in progress), so they render with the rest of the
 * header instead of popping in. Never rejects.
 */
export function preloadSignedInParts(): Promise<void> {
  return Promise.all([
    AccountMenu.preload(),
    ProfileSwitcher.preload(),
    AccountScheduled.preload(),
  ]).then(
    () => {},
    () => {},
  )
}

/**
 * Fetches every deferred part a little after the page has loaded, when the browser is
 * idle, so it never competes with the first render or the forecast request. Skipped
 * when the visitor asked to save data or is on a very slow connection. Returns a
 * function that cancels it.
 */
export function preloadDeferred(): () => void {
  const connection = (
    navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }
  ).connection
  if (connection?.saveData || /(^|-)2g$/.test(connection?.effectiveType ?? '')) return () => {}
  return afterPageLoad(() => {
    for (const preload of loaders) preload().catch(() => {})
  })
}

/**
 * Runs `run` PRELOAD_DELAY_MS after the page's load event, when the browser is idle.
 * Returns a function that cancels it.
 */
function afterPageLoad(run: () => void): () => void {
  let cancelled = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let idle: number | undefined
  const go = () => {
    if (!cancelled) run()
  }
  const schedule = () => {
    timer = setTimeout(() => {
      if (typeof requestIdleCallback === 'function')
        idle = requestIdleCallback(go, { timeout: 3000 })
      else go()
    }, PRELOAD_DELAY_MS)
  }
  if (document.readyState === 'complete') schedule()
  else window.addEventListener('load', schedule, { once: true })
  return () => {
    cancelled = true
    window.removeEventListener('load', schedule)
    clearTimeout(timer)
    if (idle !== undefined) cancelIdleCallback(idle)
  }
}
