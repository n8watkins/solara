'use client'
import { useMemo, useSyncExternalStore } from 'react'
import { msUntilNextMinute, zonedNow, type ZonedNow } from './time'

// One shared minute clock for the whole app. It ticks on every wall-clock minute
// (so the "now" line, the next slot and the date roll over on time, including at
// the location's midnight) and re-reads the time when the tab becomes visible
// again, since timers are throttled or frozen in background tabs and during sleep.

const listeners = new Set<() => void>()
let minute = floorToMinute(Date.now())
let timer: ReturnType<typeof setTimeout> | undefined

function floorToMinute(epochMs: number): number {
  return epochMs - (((epochMs % 60_000) + 60_000) % 60_000)
}

function refresh() {
  const next = floorToMinute(Date.now())
  if (next === minute) return
  minute = next
  for (const listener of listeners) listener()
}

function schedule() {
  timer = setTimeout(() => {
    refresh()
    schedule()
  }, msUntilNextMinute(Date.now()))
}

function onVisibility() {
  if (document.visibilityState === 'visible') refresh()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  if (listeners.size === 1) {
    refresh()
    schedule()
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', refresh)
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size > 0) return
    clearTimeout(timer)
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('focus', refresh)
  }
}

const getSnapshot = () => minute

/** The current minute in `timeZone`, updating as the wall clock moves. */
export function useZonedNow(timeZone: string): ZonedNow {
  const epochMs = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return useMemo(() => zonedNow(timeZone, epochMs), [timeZone, epochMs])
}
