import { describe, expect, it } from 'vitest'
import {
  CALENDAR_LINK_PROBLEMS,
  CALENDAR_PROVIDERS,
  CALENDAR_PROVIDER_NAMES,
  calendarLinkHint,
  calendarLinkRefused,
  calendarProviderForHost,
  recogniseCalendarLink,
  type CalendarLinkProblem,
  type CalendarProvider,
} from './calendar-providers'

// Real-shaped links with made-up tokens (docs/integrations/CALENDAR_LINKS.md, "Recognising
// links"). None of these tokens has ever been a real calendar's.
// Spelled out as a pattern, so secret scanners do not mistake it for a real token.
const TOKEN = 'MadeUpToken'.repeat(3)
const LINKS = {
  icloud: `webcal://p63-caldav.icloud.com/published/2/${TOKEN}${TOKEN}`,
  icloudOld: `webcal://p12-calendars.icloud.com/published/2/${TOKEN}`,
  google: `https://calendar.google.com/calendar/ical/ola.reyes%40gmail.com/private-0123456789abcdef0123456789abcdef/basic.ics`,
  googleGroup: `https://calendar.google.com/calendar/ical/c_0a1b2c3d4e5f%40group.calendar.google.com/private-${TOKEN}/basic.ics`,
  googlePublic:
    'https://calendar.google.com/calendar/ical/club%40group.calendar.google.com/public/basic.ics',
  googleEmbed: 'https://calendar.google.com/calendar/embed?src=club%40group.calendar.google.com',
  googleApp: 'https://calendar.google.com/calendar/u/0/r/week',
  outlook: `https://outlook.live.com/owa/calendar/00000000-0000-0000-0000-000000000000/${TOKEN}/cid-0123456789ABCDEF/calendar.ics`,
  outlook365: `https://outlook.office365.com/owa/calendar/${TOKEN}@contoso.com/${TOKEN}/calendar.ics`,
  outlookHtml: `https://outlook.live.com/owa/calendar/00000000-0000-0000-0000-000000000000/${TOKEN}/cid-0123456789ABCDEF/calendar.html`,
  outlookWebsite: 'https://outlook.live.com/calendar/0/view/month',
  yahoo: `https://calendar.yahoo.com/ola_reyes/${TOKEN}/ycal.ics?id=1234`,
  yahooPage: 'https://mail.yahoo.com/d/calendar',
  icloudWebsite: 'https://www.icloud.com/calendar/',
}

const feed = (provider: CalendarProvider) => ({ provider, kind: 'calendar', problem: null })
const mistake = (provider: CalendarProvider, problem: CalendarLinkProblem) => ({
  provider,
  kind: 'mistake',
  problem,
})
const UNKNOWN = { provider: null, kind: null, problem: null }

describe('recogniseCalendarLink', () => {
  it('recognises each provider’s calendar link', () => {
    expect(recogniseCalendarLink(LINKS.icloud)).toEqual(feed('icloud'))
    expect(recogniseCalendarLink(LINKS.icloudOld)).toEqual(feed('icloud'))
    expect(recogniseCalendarLink(LINKS.google)).toEqual(feed('google'))
    expect(recogniseCalendarLink(LINKS.googleGroup)).toEqual(feed('google'))
    expect(recogniseCalendarLink(LINKS.outlook)).toEqual(feed('outlook'))
    expect(recogniseCalendarLink(LINKS.outlook365)).toEqual(feed('outlook'))
    expect(recogniseCalendarLink(LINKS.outlook365.replace('office365.com', 'office.com'))).toEqual(
      feed('outlook'),
    )
    expect(recogniseCalendarLink(LINKS.yahoo)).toEqual(feed('yahoo'))
  })

  it('catches each common mistake', () => {
    expect(recogniseCalendarLink(LINKS.icloudWebsite)).toEqual(mistake('icloud', 'icloud-website'))
    expect(recogniseCalendarLink('https://icloud.com/')).toEqual(
      mistake('icloud', 'icloud-website'),
    )
    expect(recogniseCalendarLink(LINKS.googlePublic)).toEqual(mistake('google', 'google-public'))
    expect(recogniseCalendarLink(LINKS.googleEmbed)).toEqual(mistake('google', 'google-page'))
    expect(recogniseCalendarLink(LINKS.googleApp)).toEqual(mistake('google', 'google-page'))
    expect(recogniseCalendarLink(LINKS.outlookHtml)).toEqual(mistake('outlook', 'outlook-html'))
    expect(recogniseCalendarLink(LINKS.outlookWebsite)).toEqual(
      mistake('outlook', 'outlook-website'),
    )
    expect(recogniseCalendarLink(LINKS.yahooPage)).toEqual(mistake('yahoo', 'yahoo-page'))
    expect(recogniseCalendarLink('https://calendar.yahoo.com/')).toEqual(
      mistake('yahoo', 'yahoo-page'),
    )
  })

  it('reads webcal, webcals, upper case and surrounding spaces like the server does', () => {
    expect(recogniseCalendarLink(LINKS.google.replace('https://', 'webcal://'))).toEqual(
      feed('google'),
    )
    expect(recogniseCalendarLink(LINKS.icloud.replace('webcal://', 'webcals://'))).toEqual(
      feed('icloud'),
    )
    expect(recogniseCalendarLink(LINKS.icloud.replace('webcal://', 'WEBCAL://'))).toEqual(
      feed('icloud'),
    )
    expect(
      recogniseCalendarLink(LINKS.google.replace('calendar.google.com', 'CALENDAR.Google.COM')),
    ).toEqual(feed('google'))
    expect(recogniseCalendarLink(`  ${LINKS.outlook}\n`)).toEqual(feed('outlook'))
    expect(recogniseCalendarLink(LINKS.outlook.replace('.ics', '.ICS'))).toEqual(feed('outlook'))
    // The explicit standard port is the same link.
    expect(
      recogniseCalendarLink(LINKS.yahoo.replace('calendar.yahoo.com', 'calendar.yahoo.com:443')),
    ).toEqual(feed('yahoo'))
  })

  it('ignores a trailing fragment', () => {
    expect(recogniseCalendarLink(`${LINKS.google}#settings`)).toEqual(feed('google'))
    expect(recogniseCalendarLink(`${LINKS.outlookHtml}#x.ics`)).toEqual(
      mistake('outlook', 'outlook-html'),
    )
  })

  it('compares hosts exactly, so look-alikes are not providers', () => {
    const lookAlikes = [
      LINKS.google.replace('calendar.google.com', 'calendar.google.com.example.net'),
      LINKS.google.replace('calendar.google.com', 'evilcalendar.google.com'),
      LINKS.google.replace('calendar.google.com', 'calendar-google.com'),
      LINKS.google.replace('calendar.google.com', 'calendar.google.co'),
      LINKS.icloud.replace('p63-caldav.icloud.com', 'p63-caldav.icloud.com.evil.org'),
      LINKS.icloud.replace('p63-caldav.icloud.com', 'xp63-caldav.icloud.com'),
      LINKS.icloud.replace('p63-caldav.icloud.com', 'p1234-caldav.icloud.com'),
      LINKS.icloud.replace('p63-caldav.icloud.com', 'p63-caldav.icloud.co'),
      LINKS.outlook.replace('outlook.live.com', 'outlook.live.com.evil.org'),
      LINKS.outlook.replace('outlook.live.com', 'outlook.live.co'),
      LINKS.yahoo.replace('calendar.yahoo.com', 'calendar.yahoo.com.evil.org'),
      'https://notyahoo.com/ycal.ics',
      'https://www.icloud.com.evil.org/calendar/',
      // A provider's name in the path or query is not its host.
      'https://evil.example/calendar.google.com/calendar/ical/a/private-b/basic.ics',
      'https://evil.example/?u=https://calendar.google.com/calendar/ical/a/private-b/basic.ics',
      // A Cyrillic "о" makes a different (punycode) host.
      LINKS.google.replace('calendar.google.com', 'calendar.gооgle.com'),
      // The URL parser reads a backslash as a slash: the host is evil.example.
      'https://evil.example\\@calendar.google.com/calendar/ical/a/private-b/basic.ics',
    ]
    for (const link of lookAlikes) expect(recogniseCalendarLink(link), link).toEqual(UNKNOWN)
  })

  it('reads the path after the URL parser has resolved it', () => {
    // Dot segments are resolved before matching, so this is the public address.
    expect(
      recogniseCalendarLink(
        'https://calendar.google.com/calendar/ical/a%40gmail.com/private-x/../public/basic.ics',
      ),
    ).toEqual(mistake('google', 'google-public'))
    // An encoded slash stays inside one segment, and the shape no longer matches.
    expect(
      recogniseCalendarLink(
        'https://calendar.google.com/calendar/ical/a%40gmail.com/private-x%2Fbasic.ics',
      ),
    ).toEqual(UNKNOWN)
  })

  it('knows a provider’s host but not every shape on it', () => {
    // Google: an unknown file, a token with odd characters, extra segments or no id.
    for (const path of [
      '/calendar/ical/a%40gmail.com/private-abc/full.ics',
      '/calendar/ical/a%40gmail.com/private-a.b/basic.ics',
      '/calendar/ical/a%40gmail.com/private-/basic.ics',
      '/calendar/ical/a%40gmail.com/private-abc/basic.ics/extra',
      '/calendar/ical//private-abc/basic.ics',
      '/calendar/ical/',
    ]) {
      expect(recogniseCalendarLink(`https://calendar.google.com${path}`), path).toEqual(UNKNOWN)
    }
    // iCloud: a CalDAV address, not a published one.
    expect(recogniseCalendarLink('https://p63-caldav.icloud.com/123/calendars/')).toEqual(UNKNOWN)
    // Outlook: a published path that is neither ICS nor HTML.
    expect(recogniseCalendarLink('https://outlook.live.com/owa/calendar/a/b/calendar')).toEqual(
      UNKNOWN,
    )
  })

  it('leaves any other working link to the server, with no name', () => {
    for (const link of [
      'https://www.meetup.com/la-trail-runners/events/ical/',
      'webcal://rides.example.org/club.ics',
      'https://ics.teamup.com/feed/ksabc123/0.ics',
    ]) {
      expect(recogniseCalendarLink(link), link).toEqual(UNKNOWN)
    }
  })

  it('says nothing about links the linked calendar rules refuse, and survives hostile input', () => {
    const hostile = [
      '',
      '   ',
      'not a link',
      'http://calendar.google.com/calendar/ical/a/private-b/basic.ics',
      'ftp://calendar.google.com/x.ics',
      'javascript:alert(1)//calendar.google.com',
      'data:text/calendar,BEGIN:VCALENDAR',
      'https://user:pass@calendar.google.com/calendar/ical/a/private-b/basic.ics',
      'https://calendar.google.com@evil.example/calendar/ical/a/private-b/basic.ics',
      'https://calendar.google.com:8443/calendar/ical/a/private-b/basic.ics',
      'https://calendar.google.com./calendar/ical/a/private-b/basic.ics',
      'https://[::1]/calendar.ics',
      'https://127.0.0.1/calendar.ics',
      `https://calendar.google.com/calendar/ical/${'a'.repeat(5000)}/private-b/basic.ics`,
      'https://calendar.google.com/\u0000/basic.ics',
      'https://‮calendar.google.com/basic.ics',
      '​https://calendar.google.com/calendar/ical/a/private-b/basic.ics',
      'webcal://',
      'webcal:///calendar/ical/a/private-b/basic.ics',
      '%68ttps://calendar.google.com/calendar/ical/a/private-b/basic.ics',
    ]
    for (const input of hostile) {
      const result = recogniseCalendarLink(input)
      expect(result.kind === 'calendar', JSON.stringify(input.slice(0, 80))).toBe(false)
    }
    for (const input of hostile.slice(0, 12)) {
      expect(recogniseCalendarLink(input), JSON.stringify(input)).toEqual(UNKNOWN)
    }
  })

  it('never returns or exposes any part of the link', () => {
    for (const link of Object.values(LINKS)) {
      const result = recogniseCalendarLink(link)
      const hint = calendarLinkHint(result)
      const said = JSON.stringify({ result, hint })
      expect(said).not.toContain(TOKEN)
      expect(said).not.toContain('0123456789abcdef')
      expect(said).not.toContain('ola')
      expect(said).not.toContain('club')
      expect(Object.keys(result).sort()).toEqual(['kind', 'problem', 'provider'])
    }
  })
})

describe('calendarLinkRefused', () => {
  it('refuses links that cannot be a calendar, and only warns about Google’s public address', () => {
    expect(calendarLinkRefused(recogniseCalendarLink(LINKS.googlePublic))).toBe(false)
    for (const link of [
      LINKS.icloudWebsite,
      LINKS.googleEmbed,
      LINKS.outlookHtml,
      LINKS.outlookWebsite,
      LINKS.yahooPage,
    ]) {
      expect(calendarLinkRefused(recogniseCalendarLink(link)), link).toBe(true)
    }
    for (const link of [LINKS.google, LINKS.icloud, LINKS.outlook, LINKS.yahoo, 'x']) {
      expect(calendarLinkRefused(recogniseCalendarLink(link)), link).toBe(false)
    }
  })
})

describe('calendarLinkHint', () => {
  it('names a recognised provider and explains a mistake', () => {
    expect(calendarLinkHint(recogniseCalendarLink(LINKS.google))).toEqual({
      text: 'Looks like a Google Calendar secret address.',
      tone: 'ok',
    })
    expect(calendarLinkHint(recogniseCalendarLink(LINKS.icloud))?.text).toBe(
      'Looks like a public iCloud calendar link.',
    )
    expect(calendarLinkHint(recogniseCalendarLink(LINKS.outlook))?.text).toBe(
      'Looks like a published Outlook calendar (ICS link).',
    )
    expect(calendarLinkHint(recogniseCalendarLink(LINKS.yahoo))?.text).toBe(
      'Looks like a Yahoo Calendar ICS link.',
    )
    expect(calendarLinkHint(recogniseCalendarLink(LINKS.outlookHtml))).toEqual({
      text: 'That is the HTML link. Copy the ICS link instead.',
      tone: 'warning',
    })
    expect(calendarLinkHint(recogniseCalendarLink('https://example.org/a.ics'))).toBeNull()
  })

  it('writes every message without an em dash', () => {
    for (const text of Object.values(CALENDAR_LINK_PROBLEMS)) {
      expect(text).not.toContain('—')
      expect(text).toMatch(/\.$/)
    }
  })
})

describe('calendarProviderForHost', () => {
  it('names the provider of a linked calendar’s host, exactly', () => {
    expect(calendarProviderForHost('p63-caldav.icloud.com')).toBe('icloud')
    expect(calendarProviderForHost('P12-Calendars.iCloud.com')).toBe('icloud')
    expect(calendarProviderForHost('calendar.google.com')).toBe('google')
    expect(calendarProviderForHost('outlook.office365.com')).toBe('outlook')
    expect(calendarProviderForHost('calendar.yahoo.com')).toBe('yahoo')
    for (const host of [
      'www.icloud.com',
      'google.com',
      'calendar.google.com.example.net',
      'mail.yahoo.com',
      'www.meetup.com',
      '',
    ]) {
      expect(calendarProviderForHost(host), host).toBeNull()
    }
  })

  it('has a name for every provider', () => {
    for (const provider of CALENDAR_PROVIDERS)
      expect(CALENDAR_PROVIDER_NAMES[provider]).toBeTruthy()
  })
})
