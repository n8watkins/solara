// "Add a calendar from..." (docs/integrations/CALENDAR_LINKS.md, ROADMAP item 24): which
// provider a pasted calendar link comes from, judged by its shape alone, and the common
// mistakes (a provider's website, Google's public address, Outlook's HTML link) caught
// before anything is sent.
//
// Only a link that certainly is not a calendar (a provider's web page, an HTML or embed
// link) is held back; any other link on a provider's host goes to the server with at most
// a warning, since a provider may change its link shape and the server checks every link
// anyway (REVIEW7 L5).
//
// Pure and offline: nothing is fetched, and nothing here returns, logs or keeps any part
// of the link, because a private calendar link is a credential. Recognition only adds a
// name and a warning; a link it does not know is still checked by the server as before.

import { normalizeSubscriptionUrl } from './event-subscriptions'

/** The providers the helper has steps for, in the order it offers them. */
export const CALENDAR_PROVIDERS = Object.freeze(['icloud', 'google', 'outlook', 'yahoo'] as const)
export type CalendarProvider = (typeof CALENDAR_PROVIDERS)[number]

/** A provider's name on a linked calendar's card ("Google Calendar", "iCloud"). */
export const CALENDAR_PROVIDER_NAMES: Readonly<Record<CalendarProvider, string>> = Object.freeze({
  icloud: 'iCloud',
  google: 'Google Calendar',
  outlook: 'Outlook',
  yahoo: 'Yahoo Calendar',
})

/** What a recognised calendar link is, for "Looks like ...". */
const FEED_NAMES: Readonly<Record<CalendarProvider, string>> = Object.freeze({
  icloud: 'a public iCloud calendar link',
  google: 'a Google Calendar secret address',
  outlook: 'a published Outlook calendar (ICS link)',
  yahoo: 'a Yahoo Calendar ICS link',
})

/** Links a provider gives for something other than a calendar feed, with what to do. */
export const CALENDAR_LINK_PROBLEMS = Object.freeze({
  'icloud-website': 'That is the iCloud website. Turn on Public Calendar and copy its link.',
  // A club's public Google calendar does work, so this one is a warning, not a refusal.
  'google-public':
    'That is Google’s public address, which works only for a public calendar. For your own, copy the Secret address in iCal format.',
  'google-page': 'That is a Google Calendar page. Copy the Secret address in iCal format.',
  'outlook-html': 'That is the HTML link. Copy the ICS link instead.',
  'outlook-website': 'That is the Outlook website. Publish the calendar and copy its ICS link.',
  'yahoo-page': 'That is a Yahoo page. Copy the link under To import into a Calendar app (ICS).',
  // A provider's host with a shape the helper does not know: it may still work.
  'icloud-unusual':
    'This is not the usual iCloud calendar link. If linking fails, turn on Public Calendar and copy its link.',
  'google-unusual':
    'This is not the usual Google Calendar secret address. If linking fails, copy the Secret address in iCal format.',
  'outlook-unusual':
    'This is not the usual published Outlook calendar link. If linking fails, publish the calendar and copy its ICS link.',
  'yahoo-unusual':
    'This is not the usual Yahoo Calendar link. If linking fails, copy the link under To import into a Calendar app (ICS).',
} as const)
export type CalendarLinkProblem = keyof typeof CALENDAR_LINK_PROBLEMS

/**
 * Problems that mean the link certainly is not a calendar, so it is not sent at all. Every
 * other problem is a warning, and the link is sent.
 */
const REFUSED: ReadonlySet<CalendarLinkProblem> = new Set<CalendarLinkProblem>([
  'icloud-website',
  'google-page',
  'outlook-html',
  'outlook-website',
  'yahoo-page',
])

export interface RecognisedCalendarLink {
  /** The provider the link comes from, or null when its shape is not one the helper knows. */
  provider: CalendarProvider | null
  /** 'calendar': the provider's calendar link; 'mistake': a link it gives for something else. */
  kind: 'calendar' | 'mistake' | null
  problem: CalendarLinkProblem | null
}

const UNKNOWN: RecognisedCalendarLink = Object.freeze({ provider: null, kind: null, problem: null })

const ICLOUD_FEED_HOST = /^p\d{1,3}-(?:caldav|calendars)\.icloud\.com$/
const OUTLOOK_HOSTS: ReadonlySet<string> = new Set([
  'outlook.live.com',
  'outlook.office365.com',
  'outlook.office.com',
])
const ICLOUD_WEBSITE_HOSTS: ReadonlySet<string> = new Set(['icloud.com', 'www.icloud.com'])
const GOOGLE_HOST = 'calendar.google.com'
const YAHOO_FEED_HOST = 'calendar.yahoo.com'
/** Yahoo hosts that serve only its website and mail, never a calendar file. */
const YAHOO_WEBSITE_HOSTS: ReadonlySet<string> = new Set([
  'yahoo.com',
  'www.yahoo.com',
  'mail.yahoo.com',
])

const calendar = (provider: CalendarProvider): RecognisedCalendarLink => ({
  provider,
  kind: 'calendar',
  problem: null,
})
const mistake = (provider: CalendarProvider, problem: CalendarLinkProblem) => ({
  provider,
  kind: 'mistake' as const,
  problem,
})

/** `host` is `domain` or one of its subdomains (a whole-label match, never "contains"). */
const within = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`)

const endsWithIcs = (path: string) => /\.ics$/i.test(path)
const endsWithHtml = (path: string) => /\.html?$/i.test(path)

/** Google Calendar's web app and embed pages: home, /calendar, embed, render, event, u, r, b. */
const GOOGLE_WEB_PAGE = /^\/(?:calendar(?:\/(?:embed|render|event|u|r|b)(?:\/.*)?|\/?)?)?$/
/** Outlook's web app: its home page, mail, calendar and the bare OWA (any case). */
const OUTLOOK_WEB_PAGE = /^\/(?:(?:calendar|mail)(?:\/.*)?|owa\/?)?$/i
/** Where Outlook publishes calendars, exactly as Outlook writes it. */
const OUTLOOK_PUBLISHED = '/owa/calendar/'

/**
 * PURE. Which provider a pasted link comes from and whether it is that provider's calendar
 * link or a common mistake. The link goes through the linked calendar rules first
 * (`normalizeSubscriptionUrl`: webcal becomes https, hosts are lower case), then its host
 * is compared exactly and its path matched; anything else is unknown.
 */
export function recogniseCalendarLink(raw: string): RecognisedCalendarLink {
  const normalized = normalizeSubscriptionUrl(raw)
  if (!normalized.ok) return UNKNOWN
  const { host } = normalized
  const path = new URL(normalized.url).pathname

  const ics = endsWithIcs(path)
  const html = endsWithHtml(path)

  if (ICLOUD_FEED_HOST.test(host)) {
    return path.startsWith('/published/') ? calendar('icloud') : UNKNOWN
  }
  if (ICLOUD_WEBSITE_HOSTS.has(host)) {
    return ics ? mistake('icloud', 'icloud-unusual') : mistake('icloud', 'icloud-website')
  }

  if (host === GOOGLE_HOST) {
    const parts = path.split('/')
    if (parts[1] === 'calendar' && parts[2] === 'ical') {
      const [, , , id, access, file, ...rest] = parts
      if (!id || file !== 'basic.ics' || rest.length > 0) return UNKNOWN
      if (access === 'public') return mistake('google', 'google-public')
      return /^private-[A-Za-z0-9_-]+$/.test(access ?? '') ? calendar('google') : UNKNOWN
    }
    if (!ics && (html || GOOGLE_WEB_PAGE.test(path))) return mistake('google', 'google-page')
    return mistake('google', 'google-unusual')
  }

  if (OUTLOOK_HOSTS.has(host)) {
    const published = path.toLowerCase().startsWith(OUTLOOK_PUBLISHED)
    if (html) return mistake('outlook', published ? 'outlook-html' : 'outlook-website')
    // Outlook writes /owa/calendar/ in lower case; the same path in capitals may work.
    if (path.startsWith(OUTLOOK_PUBLISHED)) return ics ? calendar('outlook') : UNKNOWN
    if (published) return mistake('outlook', 'outlook-unusual')
    if (!ics && OUTLOOK_WEB_PAGE.test(path)) return mistake('outlook', 'outlook-website')
    return mistake('outlook', 'outlook-unusual')
  }

  if (within(host, 'yahoo.com')) {
    if (host === YAHOO_FEED_HOST && ics) return calendar('yahoo')
    if (ics) return mistake('yahoo', 'yahoo-unusual')
    const homePage = host === YAHOO_FEED_HOST && path === '/'
    if (html || homePage || YAHOO_WEBSITE_HOSTS.has(host)) return mistake('yahoo', 'yahoo-page')
    return mistake('yahoo', 'yahoo-unusual')
  }

  return UNKNOWN
}

/** PURE. Whether a recognised mistake means the link is not sent (it cannot be a calendar). */
export function calendarLinkRefused(link: RecognisedCalendarLink): boolean {
  return link.problem !== null && REFUSED.has(link.problem)
}

/**
 * PURE. What the link field says about a pasted link: "Looks like a Google Calendar secret
 * address.", the mistake and what to do instead, or null when it says nothing. It names
 * only the provider, never any part of the link.
 */
export function calendarLinkHint(
  link: RecognisedCalendarLink,
): { text: string; tone: 'ok' | 'warning' } | null {
  if (link.problem) return { text: CALENDAR_LINK_PROBLEMS[link.problem], tone: 'warning' }
  if (link.kind === 'calendar' && link.provider) {
    return { text: `Looks like ${FEED_NAMES[link.provider]}.`, tone: 'ok' }
  }
  return null
}

/**
 * PURE. The provider whose calendar links are served from `host` (a linked calendar's card
 * knows only the host), or null.
 */
export function calendarProviderForHost(host: string): CalendarProvider | null {
  const name = host.toLowerCase()
  if (ICLOUD_FEED_HOST.test(name)) return 'icloud'
  if (name === GOOGLE_HOST) return 'google'
  if (OUTLOOK_HOSTS.has(name)) return 'outlook'
  if (name === YAHOO_FEED_HOST) return 'yahoo'
  return null
}
