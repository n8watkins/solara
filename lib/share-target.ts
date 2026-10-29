// Sharing a calendar file or link to the installed app (docs/integrations/EVENTS.md,
// "Sharing to Solara"). The manifest's share_target (public/manifest.webmanifest) makes
// Android's share sheet POST what is shared to SHARE_TARGET_PATH as multipart form data.
// Hosting only serves static files, so the app-shell service worker (scripts/sw/shell.ts)
// answers that POST with receiveShare below: it reads at most SHARE_BODY_MAX_BYTES, keeps
// one calendar file or link (never anything else) in the browser's Cache Storage for
// SHARE_KEEP_MS, and redirects to the app with `?shared=<id>`, where the dashboard shows
// it (components/events/SharedItem.tsx) and removes it once used. Nothing shared is run,
// rendered or sent anywhere until the person confirms an import.
//
// Shared by the worker and the page; free of React, Firebase and the parser.
import { SHARED_PARAM, sharedId } from './app-routes'

/** Where the share sheet posts (the manifest's share_target action). */
export const SHARE_TARGET_PATH = '/app/share-target/'
/** The form field the manifest names for shared files. */
export const SHARE_FILE_FIELD = 'calendar'
/**
 * The Cache Storage cache holding the one shared item. Not a shell or static cache
 * (lib/sw-shell.mts), so a new app version keeps it; a new stash format gets a new name.
 */
export const SHARE_CACHE = 'solara-share-v1'
/** The key the item is kept under. Never fetched, and never served by the worker. */
export const SHARE_STASH_PATH = '/app/share-target/item'
/** How long a shared item waits (long enough to sign in first). */
export const SHARE_KEEP_MS = 30 * 60_000
/** The largest calendar file kept, the same as the import's (ICS_IMPORT_LIMITS.maxBytes). */
export const SHARE_FILE_MAX_BYTES = 1024 * 1024
/** The most of a share's body read: one file at the cap, its links and the form's framing. */
export const SHARE_BODY_MAX_BYTES = SHARE_FILE_MAX_BYTES + 32 * 1024
/** The longest shared link kept. */
export const SHARE_LINK_MAX = 2048
/** The header carrying the item's description (encodeShareMeta). */
export const SHARE_META_HEADER = 'X-Solara-Share'

/** Calendar file types: what Android and calendar apps label .ics files with. */
const CALENDAR_TYPES: ReadonlySet<string> = new Set([
  'text/calendar',
  'application/ics',
  'text/x-vcalendar',
])

/** Why a share was not kept. */
export type ShareRefusal = 'too-large' | 'not-calendar' | 'nothing'

/** What the stash holds, as the page reads it. */
export type ShareMeta =
  | { v: 1; id: string; at: number; kind: 'file'; name: string }
  | { v: 1; id: string; at: number; kind: 'link'; link: string }
  | { v: 1; id: string; at: number; kind: 'refused'; reason: ShareRefusal }

/** PURE. The app URL a share redirects to. */
export function sharedAppUrl(id: string): string {
  return `/app/?${SHARED_PARAM}=${id}`
}

/** PURE. Whether a request is a share from the share sheet that this worker should take. */
export function isSharePost(
  request: { method: string; url: string; mode: string },
  origin: string,
): boolean {
  if (request.method !== 'POST' || request.mode !== 'navigate') return false
  const url = new URL(request.url)
  return url.origin === origin && url.pathname === SHARE_TARGET_PATH
}

/**
 * PURE. Whether another website sent the POST. The share sheet sends no referrer (an
 * Android app's shows as `android-app://`); a form on another site normally sends its
 * own address. Defence in depth only: a site can hide its address, so nothing shared
 * is imported until the person confirms it.
 */
export function crossSiteReferrer(referrer: string, origin: string): boolean {
  if (!referrer) return false
  let url: URL
  try {
    url = new URL(referrer)
  } catch {
    return true
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  return url.origin !== origin
}

/** PURE. Whether a shared file is a calendar file, by its type or its name. */
export function isCalendarFile(file: { name: string; type: string }): boolean {
  const type = file.type.split(';')[0]!.trim().toLowerCase()
  if (CALENDAR_TYPES.has(type)) return true
  // Some apps share .ics files with no type or a generic one.
  const generic = type === '' || type === 'application/octet-stream' || type === 'text/plain'
  return generic && /\.ics$/i.test(file.name.trim())
}

/** PURE. A file name that is safe to show: no paths or control characters, at most 80 characters. */
export function displayFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? ''
  const clean = base.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮]/g, '').trim()
  if (!clean) return 'the shared file'
  return clean.length > 80 ? `${clean.slice(0, 77)}…` : clean
}

const LINK = /(?:https|webcal):\/\/[^\s<>"']+/i

/**
 * PURE. The calendar link in a share: the `url` field, else the first https or webcal
 * link in `text` (apps put links in either). Only https and webcal links without
 * credentials, at most SHARE_LINK_MAX long; anything else is ignored.
 */
export function sharedLink(fields: { url?: string | null; text?: string | null }): string | null {
  for (const value of [fields.url, fields.text]) {
    if (typeof value !== 'string' || !value) continue
    const found = value.slice(0, SHARE_LINK_MAX * 2).match(LINK)?.[0]
    if (!found) continue
    // Trailing punctuation from a sentence is not part of the link.
    const candidate = found.replace(/[.,;:!?)\]]+$/, '')
    if (candidate.length > SHARE_LINK_MAX) continue
    try {
      const url = new URL(candidate)
      if (url.username || url.password || !url.hostname) continue
      return url.href
    } catch {
      continue
    }
  }
  return null
}

/** PURE. The item's description as a header value (ASCII only). */
export function encodeShareMeta(meta: ShareMeta): string {
  return encodeURIComponent(JSON.stringify(meta))
}

/**
 * PURE. The description back from encodeShareMeta, or null when it is missing, malformed,
 * from another stash format, or older than SHARE_KEEP_MS.
 */
export function decodeShareMeta(value: string | null, nowMs: number): ShareMeta | null {
  if (!value || value.length > SHARE_LINK_MAX * 4) return null
  let meta: unknown
  try {
    meta = JSON.parse(decodeURIComponent(value))
  } catch {
    return null
  }
  if (!meta || typeof meta !== 'object') return null
  const m = meta as Record<string, unknown>
  if (m.v !== 1 || typeof m.id !== 'string' || sharedId(m.id) === null) return null
  if (typeof m.at !== 'number' || !Number.isFinite(m.at)) return null
  if (nowMs - m.at > SHARE_KEEP_MS) return null
  const base = { v: 1 as const, id: m.id, at: m.at }
  if (m.kind === 'file' && typeof m.name === 'string') {
    return { ...base, kind: 'file', name: displayFileName(m.name) }
  }
  if (m.kind === 'link' && typeof m.link === 'string') {
    const link = sharedLink({ url: m.link })
    return link ? { ...base, kind: 'link', link } : null
  }
  if (
    m.kind === 'refused' &&
    (m.reason === 'too-large' || m.reason === 'not-calendar' || m.reason === 'nothing')
  ) {
    return { ...base, kind: 'refused', reason: m.reason }
  }
  return null
}

/** A new random id for a share (16 hex characters). */
export function newShareId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Reads a request body up to `max` bytes, or returns null as soon as it is longer (a
 * declared length over the cap is refused before anything is read).
 */
export async function readCapped(
  request: Request,
  max: number,
): Promise<Uint8Array<ArrayBuffer> | null> {
  const declared = Number(request.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > max) return null
  if (!request.body) return new Uint8Array(0)
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > max) {
      await reader.cancel().catch(() => {})
      return null
    }
    chunks.push(value)
  }
  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}

/** What the worker keeps for one share. */
export interface ShareStash {
  meta: ShareMeta
  /** The calendar file's bytes, for a file. */
  file: Blob | null
}

/** Decides what to keep from a share's form data. */
export function stashFromForm(form: FormData, id: string, nowMs: number): ShareStash {
  const base = { v: 1 as const, id, at: nowMs }
  const files = form.getAll(SHARE_FILE_FIELD).filter((entry): entry is File => {
    return typeof entry === 'object' && entry !== null && 'size' in entry && entry.size > 0
  })
  if (files.length) {
    // One file a share; a calendar file if there is one.
    const file = files.find(isCalendarFile)
    if (!file) return { meta: { ...base, kind: 'refused', reason: 'not-calendar' }, file: null }
    if (file.size > SHARE_FILE_MAX_BYTES) {
      return { meta: { ...base, kind: 'refused', reason: 'too-large' }, file: null }
    }
    // Kept as plain bytes with a type no browser renders or runs.
    const bytes = file.slice(0, file.size, 'application/octet-stream')
    return { meta: { ...base, kind: 'file', name: displayFileName(file.name) }, file: bytes }
  }
  const text = (name: string) => {
    const value = form.get(name)
    return typeof value === 'string' ? value : null
  }
  const link = sharedLink({ url: text('url'), text: text('text') })
  if (link) return { meta: { ...base, kind: 'link', link }, file: null }
  return { meta: { ...base, kind: 'refused', reason: 'nothing' }, file: null }
}

/** The part of Cache Storage the stash uses. */
export interface StashCaches {
  has(name: string): Promise<boolean>
  open(name: string): Promise<Pick<Cache, 'put' | 'match' | 'delete'>>
  delete(name: string): Promise<boolean>
}

/** Keeps a share, replacing any earlier one. */
export async function putStash(caches: StashCaches, stash: ShareStash): Promise<void> {
  await caches.delete(SHARE_CACHE)
  const cache = await caches.open(SHARE_CACHE)
  await cache.put(
    SHARE_STASH_PATH,
    new Response(stash.file ?? '', {
      headers: {
        'Content-Type': 'application/octet-stream',
        [SHARE_META_HEADER]: encodeShareMeta(stash.meta),
      },
    }),
  )
}

/** The kept share, or null (an expired or malformed one is removed). */
export async function readStash(
  caches: StashCaches,
  nowMs: number,
): Promise<{ meta: ShareMeta; response: Response } | null> {
  // Opening a cache creates it: look first.
  if (!(await caches.has(SHARE_CACHE))) return null
  const cache = await caches.open(SHARE_CACHE)
  const response = await cache.match(SHARE_STASH_PATH)
  if (!response) return null
  const meta = decodeShareMeta(response.headers.get(SHARE_META_HEADER), nowMs)
  if (!meta) {
    await caches.delete(SHARE_CACHE)
    return null
  }
  return { meta, response }
}

/** Removes a kept share that has expired; keeps a current one. */
export async function pruneStash(caches: StashCaches, nowMs: number): Promise<void> {
  await readStash(caches, nowMs)
}

/**
 * The worker's answer to a share: keeps what was shared (or why it was refused) and sends
 * the app to it with a 303, so the POST becomes a normal page load. A POST from another
 * website keeps nothing and opens the app.
 */
export async function receiveShare(
  request: Request,
  origin: string,
  caches: StashCaches,
  nowMs: number,
  id: string = newShareId(),
): Promise<Response> {
  const app = new URL('/app/', origin).href
  if (crossSiteReferrer(request.referrer, origin)) return Response.redirect(app, 303)
  const type = (request.headers.get('content-type') ?? '').toLowerCase()
  let stash: ShareStash
  if (!type.startsWith('multipart/form-data')) {
    stash = { meta: { v: 1, id, at: nowMs, kind: 'refused', reason: 'nothing' }, file: null }
  } else {
    const body = await readCapped(request, SHARE_BODY_MAX_BYTES)
    if (!body) {
      stash = { meta: { v: 1, id, at: nowMs, kind: 'refused', reason: 'too-large' }, file: null }
    } else {
      let form: FormData | null = null
      try {
        form = await new Response(body, {
          headers: { 'Content-Type': request.headers.get('content-type') ?? '' },
        }).formData()
      } catch {
        form = null
      }
      stash = form
        ? stashFromForm(form, id, nowMs)
        : { meta: { v: 1, id, at: nowMs, kind: 'refused', reason: 'nothing' }, file: null }
    }
  }
  try {
    await putStash(caches, stash)
  } catch {
    // Storage full or unavailable: the app says there is nothing to import.
  }
  return Response.redirect(new URL(sharedAppUrl(id), origin).href, 303)
}
