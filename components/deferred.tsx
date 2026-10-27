'use client'
// Parts of the app that are not on screen when it opens: the dialogs and sheets, the
// calendar view and the calendar feed card, the location panel, setup (a returning
// visitor never sees it), and the header's signed-in parts (account menu, profile
// switcher) and scheduled activities, which a guest never sees. Each loads as its own chunk the first time it
// renders, so the first load carries only what the opening screen shows. Soon after
// the page has loaded, preloadDeferred() fetches them all, so opening one is instant;
// preloadSignedInParts() fetches the signed-in header parts at once.
//
// Import these instead of the modules themselves; each renders nothing (or its
// fallback) until its chunk has arrived.
import { useEffect, useState, type ComponentType } from 'react'
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
/** Floats over the page once the browser allows installing (lib/install-prompt.ts). */
export const InstallPrompt = deferred(() => import('./InstallPrompt'))
export const ActivityModals = deferred(() => import('./dashboard/ActivityModals'))
export const DayDialog = deferred(() => import('./dashboard/DayDialog'))
export const LocationPanel = deferred(() => import('./LocationPanel'))
/** Setup, for a first visit; the loading screen shows until it has arrived. */
export const Onboarding = deferred(() => import('./Onboarding'), AccountLoading)
export const AccountMenu = deferred(() => import('./AccountMenu'))
export const ProfileSwitcher = deferred(() => import('./ProfileSwitcher'))
/** After a guest signs in to an existing account: what the guest plan held that was not kept. */
export const GuestPlanNotice = deferred(() => import('./GuestPlanNotice'))
/** A signed-in account's scheduled activities; until it arrives, the screens show none. */
export const AccountScheduled = deferred(() => import('./scheduled/AccountScheduled'))

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
  let cancelled = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let idle: number | undefined
  const run = () => {
    if (cancelled) return
    for (const preload of loaders) preload().catch(() => {})
  }
  const schedule = () => {
    timer = setTimeout(() => {
      if (typeof requestIdleCallback === 'function')
        idle = requestIdleCallback(run, { timeout: 3000 })
      else run()
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
