// The page's side of sharing to the installed app (lib/share-target.ts has the worker's):
// reading the one shared item the service worker kept, removing it once used, and the
// pure view logic of the dashboard's "Shared with Solara" card
// (components/events/SharedItem.tsx). Loaded with that card only, when the app opens with
// `?shared=<id>`, so nothing here is in anyone's first load.
import {
  calendarLinkRefused,
  recogniseCalendarLink,
  zonedDate,
  wallClockAt,
  type IcsParseResult,
} from '@solara/core/event-import'
import { SHARED_PARAM } from './app-routes'
import { dayLabel } from './forecast'
import { SHARE_CACHE, readStash, type ShareRefusal, type StashCaches } from './share-target'
import { timeRange } from './time'

/** What the app finds for a share id. */
export type SharedItem =
  | { kind: 'none' }
  | { kind: 'file'; name: string; file: { size: number; text: () => Promise<string> } }
  | { kind: 'link'; link: string }
  | { kind: 'refused'; reason: ShareRefusal }

/** This browser's Cache Storage, where it exists (not in every private window). */
function browserCaches(): StashCaches | null {
  return typeof caches === 'undefined' ? null : caches
}

/**
 * The shared item for `id`, or `none` when there is none: it was used or removed already,
 * it waited longer than it may, or it belongs to another share.
 */
export async function loadSharedItem(
  id: string,
  nowMs: number,
  storage: StashCaches | null = browserCaches(),
): Promise<SharedItem> {
  if (!storage) return { kind: 'none' }
  let found: Awaited<ReturnType<typeof readStash>>
  try {
    found = await readStash(storage, nowMs)
  } catch {
    return { kind: 'none' }
  }
  if (!found || found.meta.id !== id) return { kind: 'none' }
  const { meta, response } = found
  if (meta.kind === 'link') return { kind: 'link', link: meta.link }
  if (meta.kind === 'refused') return { kind: 'refused', reason: meta.reason }
  const blob = await response.blob()
  return {
    kind: 'file',
    name: meta.name,
    file: { size: blob.size, text: () => blob.text() },
  }
}

/** Removes the shared item from this browser. Never throws. */
export async function clearSharedItem(
  storage: StashCaches | null = browserCaches(),
): Promise<void> {
  try {
    await storage?.delete(SHARE_CACHE)
  } catch {
    // Nothing to remove, or storage is unavailable: it expires on its own.
  }
}

/** Drops `?shared=` from the address, so a reload or a bookmark does not bring the card back. */
export function dropSharedParam(): void {
  const url = new URL(window.location.href)
  if (!url.searchParams.has(SHARED_PARAM)) return
  url.searchParams.delete(SHARED_PARAM)
  window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash)
}

/**
 * PURE. What a shared link is: `calendar` when it looks like a calendar link (a known
 * provider's calendar address, webcal, or a path ending in .ics), `page` when it certainly
 * is not one (a provider's website, or any other web page), and `unknown` otherwise.
 * Only `page` is refused outright; the linked calendars form checks the rest.
 */
export function sharedLinkKind(link: string): 'calendar' | 'page' | 'unknown' {
  const recognised = recogniseCalendarLink(link)
  if (calendarLinkRefused(recognised)) return 'page'
  if (recognised.kind === 'calendar') return 'calendar'
  let url: URL
  try {
    url = new URL(link)
  } catch {
    return 'page'
  }
  if (url.protocol === 'webcal:' || /\.ics$/i.test(url.pathname)) return 'calendar'
  return recognised.provider ? 'unknown' : 'page'
}

/** Events the card lists before "and N more". */
export const PREVIEW_COUNT = 3

/**
 * PURE. The first events of a shared file, each with when it is in the person's zone:
 * "Tomorrow · 9am–10:30am", like an event's card.
 */
export function previewEvents(
  result: Pick<IcsParseResult, 'events'>,
  nowMs: number,
  timeZone: string,
  time: (hours: number) => string,
): { title: string; when: string }[] {
  const today = zonedDate(nowMs, timeZone)
  const at = (ms: number) => {
    const local = wallClockAt(ms, timeZone)
    return time(local.hour + local.minute / 60)
  }
  return result.events.slice(0, PREVIEW_COUNT).map(event => {
    const startDate = zonedDate(event.start, timeZone)
    const endDate = zonedDate(event.end, timeZone)
    const endDay = endDate !== startDate ? `${dayLabel(endDate, today)} ` : ''
    return {
      title: event.title || 'Untitled event',
      when: `${dayLabel(startDate, today)} · ${timeRange(at(event.start), `${endDay}${at(event.end)}`)}`,
    }
  })
}

/** PURE. "invite.ics has 2 upcoming events." */
export function previewHeadline(name: string, count: number): string {
  if (!count) return `No upcoming events with a start time were found in ${name}.`
  return `${name} has ${count} upcoming ${count === 1 ? 'event' : 'events'}.`
}

/** PURE. Why a share was not kept, and what to do instead. */
export function refusalMessage(reason: ShareRefusal): string {
  switch (reason) {
    case 'too-large':
      return 'That file is larger than 1 MB. Export a shorter range of events, then share it again.'
    case 'not-calendar':
      return "Solara can import calendar (.ics) files only. On the event's page, use “Add to calendar” or “Export” to get one, then share that file."
    case 'nothing':
      return 'Nothing came through with that share. Share a calendar (.ics) file or a calendar link.'
  }
}
