// Source for the app-shell service worker, out/sw.js. scripts/build-sw.mjs bundles it
// after `next build` with the list of files to precache, read from the export, and a
// version that is a hash of their contents. The rules (what is answered and how) are in
// lib/sw-shell.mts.
//
// Updates: the browser checks /sw.js (served with no-cache, see firebase.json) on every
// navigation, so a deploy changes the version and installs a new worker. It precaches
// the new files, takes over at once (skipWaiting and clients.claim) and deletes the
// previous version's caches. Pages are always fetched from the network first, so even
// an old worker never pins anyone to an old page.
import {
  NAVIGATION_TIMEOUT_MS,
  cacheNames,
  missingPageAssets,
  routeRequest,
  staleCaches,
  type ShellRoute,
} from '../../lib/sw-shell.mts'
import { chooseWindowClient, safeNotificationUrl } from '../../lib/notification-link'

// Replaced at bundle time.
declare const __SHELL__: { version: string; pages: string[]; assets: string[] }

// The root tsconfig compiles with the DOM library, not WebWorker, so the few
// service-worker APIs used here are typed locally.
interface ExtendableEventLike extends Event {
  waitUntil(promise: Promise<unknown>): void
}
interface FetchEventLike extends ExtendableEventLike {
  request: Request
  respondWith(response: Promise<Response>): void
}
interface WindowClientLike {
  url: string
  focus(): Promise<unknown>
  navigate(url: string): Promise<unknown>
}
interface NotificationClickEventLike extends ExtendableEventLike {
  notification: Notification
}
interface ShellScope {
  location: Location
  skipWaiting(): Promise<void>
  clients: {
    claim(): Promise<void>
    matchAll(options: { type: 'window'; includeUncontrolled: boolean }): Promise<WindowClientLike[]>
    openWindow(url: string): Promise<unknown>
  }
  addEventListener(
    type: 'install' | 'activate',
    listener: (event: ExtendableEventLike) => void,
  ): void
  addEventListener(type: 'fetch', listener: (event: FetchEventLike) => void): void
  addEventListener(
    type: 'notificationclick',
    listener: (event: NotificationClickEventLike) => void,
  ): void
}

const sw = self as unknown as ShellScope
const { version, pages, assets } = __SHELL__
const names = cacheNames(version)
const precached = new Set([...pages, ...assets])

/** A precached file's request: content-hashed files may come from the HTTP cache. */
function precacheRequest(url: string): Request {
  return new Request(url, {
    cache: url.startsWith('/_next/static/') ? 'default' : 'no-cache',
    credentials: 'same-origin',
  })
}

async function precache(): Promise<void> {
  const cache = await caches.open(names.shell)
  try {
    await Promise.all(
      [...precached].map(async url => {
        const response = await fetch(precacheRequest(url))
        // A redirected response cannot answer a navigation.
        if (!response.ok || response.redirected) throw new Error(`precache: ${url} failed`)
        if (pages.includes(url)) {
          const missing = missingPageAssets(await response.clone().text(), precached)
          // Deployed again meanwhile: the next update check installs that version.
          if (missing.length) throw new Error(`precache: ${url} is from another deploy`)
        }
        await cache.put(url, response)
      }),
    )
  } catch (error) {
    await caches.delete(names.shell)
    throw error
  }
}

sw.addEventListener('install', event => {
  event.waitUntil(precache().then(() => sw.skipWaiting()))
})

sw.addEventListener('activate', event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys => Promise.all(staleCaches(keys, version).map(key => caches.delete(key))))
      .then(() => sw.clients.claim()),
  )
})

async function fromCache(cacheName: string, request: Request | string) {
  const cache = await caches.open(cacheName)
  return cache.match(request, { ignoreVary: true })
}

/** Network first; the precached page when the network fails or takes too long. */
async function page(request: Request, url: string): Promise<Response> {
  const network = fetch(request)
  // Settled later than the race below, possibly with an error nobody awaits.
  network.catch(() => {})
  const fallback = () => fromCache(names.shell, url)
  try {
    return await Promise.race([
      network,
      new Promise<Response>(resolve => setTimeout(resolve, NAVIGATION_TIMEOUT_MS)).then(
        async () => (await fallback()) ?? network,
      ),
    ])
  } catch {
    return (await fallback()) ?? Response.error()
  }
}

/** Content-hashed files: cached ones first, others fetched and kept for this version. */
async function file(event: FetchEventLike): Promise<Response> {
  const { request } = event
  const cached = (await fromCache(names.shell, request)) ?? (await fromCache(names.static, request))
  if (cached) return cached
  const response = await fetch(request)
  if (response.ok && response.type === 'basic') {
    const copy = response.clone()
    event.waitUntil(caches.open(names.static).then(cache => cache.put(request, copy)))
  }
  return response
}

async function precachedFile(request: Request): Promise<Response> {
  return (await fromCache(names.shell, new URL(request.url).pathname)) ?? fetch(request)
}

function answer(event: FetchEventLike, route: NonNullable<ShellRoute>): Promise<Response> {
  if (route.kind === 'page') return page(event.request, route.page)
  if (route.kind === 'static') return file(event)
  return precachedFile(event.request)
}

sw.addEventListener('fetch', event => {
  const route = routeRequest(event.request, sw.location.origin, precached)
  if (route) event.respondWith(answer(event, route))
})

/** Focuses an open Solara window on the link (or the app), or opens one. */
async function openOrFocus(link: unknown): Promise<void> {
  const origin = sw.location.origin
  const target = safeNotificationUrl(link, origin)
  const windows = await sw.clients.matchAll({ type: 'window', includeUncontrolled: true })
  const index = chooseWindowClient(
    windows.map(client => client.url),
    target,
    origin,
  )
  const existing = index === -1 ? undefined : windows[index]
  if (!existing) {
    await sw.clients.openWindow(target)
    return
  }
  if (existing.url !== target) await existing.navigate(target)
  await existing.focus()
}

// Reminders the app shows through this worker (the sunscreen timer,
// components/dashboard/ReapplyTimer.tsx): a tap brings Solara back.
sw.addEventListener('notificationclick', event => {
  const data = event.notification.data as { link?: unknown } | null
  event.notification.close()
  event.waitUntil(openOrFocus(data?.link))
})
