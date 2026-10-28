// Linked calendars (docs/integrations/EVENTS.md, phase 2): an https or webcal link to an
// .ics feed that Solara fetches on the server, now and every few hours, so the events
// stay current without importing a file again.
//
// The link itself can hold a private token (Google's "secret address in iCal format"), so
// it is a credential: it lives only in the server-only `eventSubscriptions/{id}` document
// and never reaches the browser again. What the app shows comes from the summary the
// server keeps in `users/{uid}/private/eventSubscriptions` (owner-readable, server
// written), parsed by `parseSubscriptionSummaries` below: the link's host, a label, and
// how the last refreshes went.
//
// Pure and shared: the Function (functions/src/events/) and the app use the same limits,
// URL rules, error wording and summary schema.

import * as v from 'valibot'
import { IMPORTED_EVENT_KEY_PATTERN } from './events'
import { finiteNumber, record } from './schema'

/** Defaults, owner may change (docs/ROADMAP.md decisions, 2026-10-28). */
export const EVENT_SUBSCRIPTION_LIMITS = Object.freeze({
  /** Most linked calendars one account may hold. */
  maxPerAccount: 5,
  /** Longest link accepted. */
  urlLength: 2048,
  /** Longest label shown for a link. */
  labelLength: 60,
  /** Largest body read, in bytes (the file importer's limit). */
  maxBytes: 1024 * 1024,
  /** The whole fetch, redirects included, must finish within this. */
  timeoutMs: 10_000,
  /** Most redirects followed. */
  maxRedirects: 3,
  /** How often a working link is fetched again. */
  refreshHours: 6,
  /** The longest wait between attempts while a link keeps failing. */
  maxBackoffHours: 48,
  /** A link that has failed this long is paused until the person refreshes it. */
  pauseAfterDays: 7,
  /** The person may ask for a refresh of one link at most this often. */
  manualRefreshMinutes: 10,
})

/** What a summary says about a link's refreshes. */
export const SUBSCRIPTION_STATUSES = Object.freeze(['active', 'failing', 'paused'] as const)
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number]

/** Why a link could not be read, as stored and shown. */
export const SUBSCRIPTION_ERRORS = Object.freeze({
  'invalid-url': 'That is not a calendar link. Copy the full https:// or webcal:// address.',
  'not-https': 'Only https:// and webcal:// calendar links can be linked.',
  credentials: 'Links with a user name or password cannot be linked.',
  port: 'Only calendar links on the standard https port can be linked.',
  'blocked-address': 'That link points to a private or local network address.',
  unreachable: 'The calendar site could not be reached.',
  timeout: 'The calendar site took too long to answer.',
  'too-large': 'That calendar is larger than 1 MB. Link a shorter calendar.',
  'too-many-redirects': 'That link redirects too many times.',
  'http-status': 'The calendar site refused the request. Check the link still works.',
  'not-calendar': 'That link does not lead to a calendar (.ics) file.',
  'no-place': 'Set your place in Solara first, so events without one can use it.',
  duplicate: 'That calendar is already linked.',
  'too-many': `An account can link up to ${EVENT_SUBSCRIPTION_LIMITS.maxPerAccount} calendars. Remove one to add another.`,
} as const)
export type SubscriptionError = keyof typeof SUBSCRIPTION_ERRORS

/** The words for a stored error code ('' for none or an unknown code). */
export function subscriptionErrorMessage(code: string): string {
  return Object.hasOwn(SUBSCRIPTION_ERRORS, code)
    ? SUBSCRIPTION_ERRORS[code as SubscriptionError]
    : code
      ? 'The calendar could not be read.'
      : ''
}

export type NormalizedSubscriptionUrl =
  | { ok: true; url: string; host: string }
  | { ok: false; error: 'invalid-url' | 'not-https' | 'credentials' | 'port' }

/**
 * The link Solara fetches for what the person pasted: `webcal://` and `webcals://` become
 * `https://` (webcal is only a hint for calendar apps), the fragment is dropped, and
 * anything but https on the standard port without a user name or password is refused.
 * Addresses are checked again after every DNS lookup and redirect on the server.
 */
export function normalizeSubscriptionUrl(raw: string): NormalizedSubscriptionUrl {
  const text = raw.trim()
  if (!text || text.length > EVENT_SUBSCRIPTION_LIMITS.urlLength) {
    return { ok: false, error: 'invalid-url' }
  }
  const rewritten = text.replace(/^webcals?:\/\//i, 'https://')
  let url: URL
  try {
    url = new URL(rewritten)
  } catch {
    return { ok: false, error: 'invalid-url' }
  }
  if (url.protocol !== 'https:') return { ok: false, error: 'not-https' }
  if (url.username || url.password) return { ok: false, error: 'credentials' }
  if (url.port && url.port !== '443') return { ok: false, error: 'port' }
  if (!url.hostname || !url.hostname.includes('.') || url.hostname.endsWith('.')) {
    return { ok: false, error: 'invalid-url' }
  }
  url.hash = ''
  const href = url.href
  if (href.length > EVENT_SUBSCRIPTION_LIMITS.urlLength) return { ok: false, error: 'invalid-url' }
  return { ok: true, url: href, host: url.hostname }
}

/** The label shown for a link: the person's, else the calendar's name, else its host. */
export function subscriptionLabel(...candidates: (string | null | undefined)[]): string {
  for (const candidate of candidates) {
    const label = cleanLabel(candidate ?? '')
    if (label) return label
  }
  return ''
}

function cleanLabel(text: string): string {
  const chars = Array.from(
    text
      // Controls, bidi overrides and zero-width characters (REVIEW4 L2).
      .replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩﻿]/g, '')
      .replace(/\s+/g, ' ')
      .trim(),
  )
  return chars.slice(0, EVENT_SUBSCRIPTION_LIMITS.labelLength).join('').trim()
}

const isoOrEmpty = v.union([
  v.literal(''),
  v.pipe(
    v.string(),
    v.maxLength(40),
    v.check(value => !Number.isNaN(Date.parse(value))),
  ),
])

const count = v.pipe(finiteNumber, v.integer(), v.minValue(0))

/** One linked calendar as the app sees it (never its link). */
export const SubscriptionSummarySchema = record({
  id: v.pipe(v.string(), v.regex(IMPORTED_EVENT_KEY_PATTERN)),
  host: v.pipe(v.string(), v.maxLength(253)),
  label: v.pipe(v.string(), v.maxLength(EVENT_SUBSCRIPTION_LIMITS.labelLength)),
  status: v.picklist(SUBSCRIPTION_STATUSES),
  createdAt: isoOrEmpty,
  lastAttemptAt: isoOrEmpty,
  lastSuccessAt: isoOrEmpty,
  nextRefreshAt: isoOrEmpty,
  /** The last attempt's error code ('' when it worked). */
  error: v.pipe(v.string(), v.maxLength(40)),
  /** Upcoming events stored from it after the last refresh. */
  eventCount: count,
  /** Events the last refresh could not store because the account was at its cap. */
  refused: count,
})
export type SubscriptionSummary = v.InferOutput<typeof SubscriptionSummarySchema>

/**
 * The summaries in `users/{uid}/private/eventSubscriptions` (`items`, by id), oldest
 * first; entries that do not match the schema are left out.
 */
export function parseSubscriptionSummaries(raw: unknown): SubscriptionSummary[] {
  const items = (raw as { items?: unknown } | null | undefined)?.items
  if (!items || typeof items !== 'object' || Array.isArray(items)) return []
  const out: SubscriptionSummary[] = []
  for (const [id, value] of Object.entries(items)) {
    const parsed = v.safeParse(SubscriptionSummarySchema, value)
    if (parsed.success && parsed.output.id === id) out.push(parsed.output)
  }
  return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
}

/** What the `eventSubscriptions` endpoint can be asked to do. */
export const SUBSCRIPTION_ACTIONS = Object.freeze(['add', 'refresh', 'remove'] as const)
export type SubscriptionAction = (typeof SUBSCRIPTION_ACTIONS)[number]

/**
 * When a link is fetched next after `failures` failures in a row (0 after a success):
 * every `refreshHours` while it works, then twice as long after each failure, up to
 * `maxBackoffHours`.
 */
export function nextRefreshDelayMs(failures: number): number {
  const { refreshHours, maxBackoffHours } = EVENT_SUBSCRIPTION_LIMITS
  const hours =
    failures <= 0
      ? refreshHours
      : Math.min(maxBackoffHours, (refreshHours / 2) * 2 ** Math.min(failures, 16))
  return hours * 60 * 60 * 1000
}
