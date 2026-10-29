'use client'
// Parts of the app that are not on screen when it opens: the dialogs and sheets, the
// calendar view and the calendar feed card, the location panel, setup and the sign-in
// screen (a returning visitor never sees them), the UV scale's bands (until opened), the
// install prompt, the header's signed-in parts (account menu, profile switcher) and
// scheduled activities, which a guest never sees, and the dashboard's activity plan,
// which a plan without activities (a new guest's) never shows. Each loads as its own
// chunk the first time it renders, so the first load carries only what the opening
// screen shows. Soon after the page has loaded, preloadDeferred() fetches them all, so
// opening one is instant; preloadSignedInParts() fetches the signed-in parts at once.
//
// Import these instead of the modules themselves; each renders nothing (or its
// fallback) until its chunk has arrived.
import {
  useEffect,
  useState,
  useSyncExternalStore,
  type ComponentProps,
  type ComponentType,
  type ReactNode,
} from 'react'
import { installEnvironment, installPromptKind } from '@/lib/install-prompt'
import { AccountLoading } from './AccountStatus'
import type * as ActivityPlanModule from './dashboard/activity-plan'
import type { ReapplyTimerProps } from './dashboard/ReapplyTimer'

type Loader<P> = () => Promise<{ default: ComponentType<P> }>

const loaders = new Set<() => Promise<unknown>>()

/** How long after the page's load event the deferred parts start to download. */
const PRELOAD_DELAY_MS = 1500

// Plain state rather than React.lazy and Suspense: Suspense reveals content on a
// timer, and a part that has loaded once must render in the same pass, with no gap.
function deferred<P extends object>(
  load: Loader<P>,
  Fallback: ComponentType<P> | null = null,
): ComponentType<P> & { preload: () => Promise<unknown>; loaded: () => boolean } {
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
  return Object.assign(Deferred, { preload, loaded: () => loaded !== null })
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
/** The dashboard's empty state when no forecast has loaded and the last request failed. */
export const ForecastUnavailable = deferred(() => import('./ForecastUnavailable'))

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

// The dashboard's activity plan (components/dashboard/activity-plan.ts), one chunk.
type ActivityPlan = typeof ActivityPlanModule
let activityPlanLoaded: ActivityPlan | null = null
const activityPlanListeners = new Set<() => void>()
const activityPlan = () =>
  import('./dashboard/activity-plan').then(module => {
    if (!activityPlanLoaded) {
      activityPlanLoaded = module
      for (const listener of activityPlanListeners) listener()
    }
    return module
  })

/** Finds each activity's slots (@solara/core next-slot and planner), with the activity plan. */
export type ActivityPlanning = Pick<
  ActivityPlan,
  'planActivityDay' | 'soonestPlan' | 'nextSlotAfterToday'
>

function onActivityPlanLoad(listener: () => void): () => void {
  activityPlanListeners.add(listener)
  return () => activityPlanListeners.delete(listener)
}

/**
 * The activity plan's planning once its chunk has loaded, else null; the caller renders
 * again when it arrives. Only a plan with activities has slots to find, and
 * ActivityPlanGate loads it before such a dashboard first paints (an activity added
 * later finds its slots as soon as its card's chunk, the same one, arrives).
 */
export function useActivityPlanning(): ActivityPlanning | null {
  return useSyncExternalStore(
    onActivityPlanLoad,
    () => activityPlanLoaded,
    () => null,
  )
}
export const HeroSlot = deferred<ComponentProps<ActivityPlan['HeroSlot']>>(() =>
  activityPlan().then(parts => ({ default: parts.HeroSlot })),
)
export const PlanAhead = deferred<ComponentProps<ActivityPlan['PlanAhead']>>(() =>
  activityPlan().then(parts => ({ default: parts.PlanAhead })),
)
export const CalendarConnectBanner = deferred<
  ComponentProps<ActivityPlan['CalendarConnectBanner']>
>(() => activityPlan().then(parts => ({ default: parts.CalendarConnectBanner })))
export const ActivityCards = deferred<ComponentProps<ActivityPlan['ActivityCards']>>(() =>
  activityPlan().then(parts => ({ default: parts.ActivityCards })),
)
const activityPlanParts = [HeroSlot, PlanAhead, CalendarConnectBanner, ActivityCards]

/** How long the dashboard waits for the activity plan before it shows without it. */
const ACTIVITY_PLAN_WAIT_MS = 3000

/**
 * Loads the dashboard's activity plan now, for a plan with activities about to show
 * (a guest plan at start-up, or a session about to show). Never rejects.
 */
export function preloadActivityPlan(): Promise<void> {
  return Promise.all(activityPlanParts.map(part => part.preload())).then(
    () => {},
    () => {},
  )
}

/**
 * Shows `fallback` instead of the dashboard while a plan with activities waits for the
 * activity plan's parts, so they render with the rest of the dashboard instead of
 * popping in. Start-up fetches them as soon as it knows the plan has activities
 * (components/App.tsx), so this is normally no wait at all. Only the first paint
 * waits: an activity added later shows its parts once they arrive, which the preloads
 * have long done. After ACTIVITY_PLAN_WAIT_MS, or should the download fail, the
 * dashboard shows without them, and they appear once they load.
 */
export function ActivityPlanGate({
  needed,
  fallback,
  children,
}: {
  needed: boolean
  fallback: ReactNode
  children: ReactNode
}) {
  const [ready, setReady] = useState(
    () => !needed || activityPlanParts.every(part => part.loaded()),
  )
  useEffect(() => {
    if (ready) return
    let active = true
    const show = () => {
      if (active) setReady(true)
    }
    const timer = setTimeout(show, ACTIVITY_PLAN_WAIT_MS)
    void preloadActivityPlan().then(show)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [ready])
  return ready ? children : fallback
}

/** Keeps the sunscreen timer's place until it shows, so nothing below it moves. */
function ReapplyTimerSpace() {
  return <div aria-hidden="true" className="min-h-16" />
}
const ReapplyTimer = deferred<ReapplyTimerProps>(
  () => import('./dashboard/ReapplyTimer'),
  ReapplyTimerSpace,
)

/**
 * The sunscreen reapply timer on today's dashboard (components/dashboard/ReapplyTimer.tsx).
 * It appears once the page has loaded and the browser is idle, like the preloads below,
 * so none of it is part of a guest's first load.
 */
export function SunscreenTimer(props: ReapplyTimerProps) {
  const [ready, setReady] = useState(false)
  useEffect(() => afterPageLoad(() => setReady(true)), [])
  return ready ? <ReapplyTimer {...props} /> : <ReapplyTimerSpace />
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
 * Loads the signed-in parts now, for a session about to show (a stored session at
 * start-up, or a sign-in in progress), so they render with the rest of the screen
 * instead of popping in: the header's account menu and profile switcher, scheduled
 * activities and the dashboard's activity plan. Never rejects.
 */
export function preloadSignedInParts(): Promise<void> {
  return Promise.all([
    AccountMenu.preload(),
    ProfileSwitcher.preload(),
    AccountScheduled.preload(),
    preloadActivityPlan(),
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
