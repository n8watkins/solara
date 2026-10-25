'use client'
// Parts of the app that are not on screen when it opens: the dialogs and sheets, the
// calendar view and the calendar feed card. Each loads as its own chunk the first
// time it renders, so the first load carries only the dashboard (or setup). Soon after
// the page has loaded, preloadDeferred() fetches them all, so opening one is instant.
//
// Import these instead of the modules themselves; each renders nothing until its
// chunk has arrived.
import { lazy, Suspense, type ComponentType } from 'react'

type Loader<P> = () => Promise<{ default: ComponentType<P> }>

const loaders = new Set<() => Promise<unknown>>()

/** How long after the page's load event the deferred parts start to download. */
const PRELOAD_DELAY_MS = 1500

function deferred<P extends object>(load: Loader<P>): ComponentType<P> {
  let pending: ReturnType<Loader<P>> | null = null
  const preload = () => {
    pending ??= load().catch(error => {
      // A failed idle preload (offline, or a deploy in between) must not stop the
      // first render from loading it again.
      pending = null
      throw error
    })
    return pending
  }
  loaders.add(preload)
  const Lazy = lazy(preload)
  function Deferred(props: P) {
    return (
      <Suspense fallback={null}>
        <Lazy {...props} />
      </Suspense>
    )
  }
  return Deferred
}

export const PreferencesModal = deferred(() => import('./PreferencesModal'))
export const PricingModal = deferred(() => import('./PricingModal'))
export const AddActivityModal = deferred(() => import('./AddActivityModal'))
export const EditActivityModal = deferred(() => import('./EditActivityModal'))
export const ManageActivitiesModal = deferred(() => import('./ManageActivitiesModal'))
export const ScheduledSheet = deferred(() => import('./ScheduledSheet'))
export const CalendarView = deferred(() => import('./CalendarView'))
export const CalendarFeed = deferred(() => import('./CalendarFeed'))

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
