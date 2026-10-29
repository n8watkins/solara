import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SCHEDULED_RETENTION_DAYS } from '@solara/core'
import { IMPORTED_EVENT_RETENTION_DAYS } from '@solara/core/event-import'
import { LEGAL_DETAILS } from './legal'
import {
  PRODUCTION_DATA_STEPS,
  privacySwitches,
  recaptchaScope,
  retentionLines,
  type PrivacySwitches,
} from './privacy-retention'

const privacy = readFileSync(new URL('../app/privacy/page.tsx', import.meta.url), 'utf8')
const terms = readFileSync(new URL('../app/terms/page.tsx', import.meta.url), 'utf8')
const ttlScript = readFileSync(new URL('../infra/firestore-ttl.sh', import.meta.url), 'utf8')
const appSource = readFileSync(new URL('../components/App.tsx', import.meta.url), 'utf8')

const TODAY: PrivacySwitches = { firestoreTtl: false, backups: false, forecastProxy: false }
const PRO_LAUNCH: PrivacySwitches = { firestoreTtl: true, backups: true, forecastProxy: true }
/** Every retention line, in both states, as one text. */
const keptToday = Object.values(retentionLines(TODAY)).join(' ')
const keptAtProLaunch = Object.values(retentionLines(PRO_LAUNCH)).join(' ')

describe('privacy policy', () => {
  it('names every service that receives user data', () => {
    for (const processor of [
      'Google Firebase',
      'reCAPTCHA',
      'Google Calendar API',
      'Microsoft identity platform and Microsoft Graph',
      'Google Analytics',
      'Open-Meteo',
      'OpenStreetMap Nominatim',
      'Stripe',
      'Sentry',
    ]) {
      expect(privacy).toContain(processor)
    }
  })

  it('covers the operator, contact, legal basis, retention and rights', () => {
    for (const heading of [
      'Who runs Solara',
      'Why it is used, and the legal basis',
      'How long information is kept',
      'Your rights',
    ]) {
      expect(privacy).toContain(`<h2>${heading}</h2>`)
    }
    expect(privacy).toContain('<LegalDetail name="operatorName" />')
    expect(privacy).toContain('<LegalDetail name="contactEmail" />')
  })

  it('says the account page downloads and deletes, with email as the way out (REVIEW8 M4)', () => {
    const rights = privacy
      .slice(privacy.indexOf('<h2>Your rights</h2>'), privacy.indexOf('<h2>Security</h2>'))
      .replace(/\s+/g, ' ')
    expect(rights).toContain(
      'page downloads a copy of your data and deletes your account and its data right away',
    )
    expect(rights).toContain('removes what Solara keeps in that browser')
    expect(rights).toContain('<LegalDetail name="contactEmail" /> to ask for any of these')
    expect(rights).toContain('we answer within 30 days')
  })

  it('has a Google user data section naming every requested Google scope', () => {
    expect(privacy).toContain('<h2>How Solara uses Google user data</h2>')
    for (const scope of [
      'calendar.freebusy',
      'calendar.events.owned',
      'calendar.events.readonly',
      'calendar.calendarlist.readonly',
      'openid',
    ]) {
      expect(privacy).toContain(scope)
    }
    expect(privacy).toContain('does not use it for advertising')
    expect(privacy).toContain('train artificial intelligence')
  })

  it('says what Solara keeps about events it creates, and that it reads only those', () => {
    expect(privacy).toContain('Solara stores the event&apos;s')
    expect(privacy).toContain('identifier, time, title and link of events it created')
    expect(privacy).toContain('looks up only')
    expect(privacy).toContain(
      'events it created; it does not read, change or delete any other event',
    )
    expect(privacy).not.toContain('does not keep a')
    expect(keptToday).toContain('Scheduled activities: until you remove the event')
    expect(privacy).toContain('scheduled activities, imported')
  })

  it('says what Solara keeps about imported events, and for how long', () => {
    expect(privacy).toContain('<strong>Imported events</strong>')
    expect(privacy).toContain('The file is read in your')
    expect(keptToday).toContain('Imported events: until you remove them')
  })

  it('says what Solara keeps about events from Google Calendar, and for how long', () => {
    expect(privacy).toContain('<strong>Events from your Google Calendar</strong>')
    expect(privacy.replace(/\s+/g, ' ')).toContain('no Google access token is stored anywhere')
    expect(keptToday).toContain('Events from your Google Calendar: until they are gone')
    expect(privacy.replace(/\s+/g, ' ')).toContain(
      'events from your Google Calendar and Outlook and the calendars you chose',
    )
  })

  it('has a Microsoft user data section: the one permission, what is kept, no tokens, how to remove it', () => {
    const text = privacy.replace(/\s+/g, ' ')
    expect(privacy).toContain('<h2>How Solara uses Microsoft user data</h2>')
    expect(text).toContain('<strong>Read basic details of user calendars</strong>')
    expect(privacy).toContain('<code>Calendars.ReadBasic</code>')
    expect(privacy).toContain('<strong>Events from your Outlook calendar</strong>')
    expect(text).toContain('no Microsoft access or refresh token is stored anywhere')
    // Exactly true (REVIEW7 L3): the browser reads each calendar's owner address in memory.
    expect(text).toContain('the Microsoft account you signed in with is never stored')
    expect(text).not.toContain('never learns which Microsoft account')
    expect(text).toContain('office rooms and homes that Outlook marks as such')
    expect(text).toContain('keeps no refresh token')
    expect(text).not.toContain('Microsoft gives it no refresh token')
    expect(text).toContain('for up to an hour')
    expect(keptToday).toContain('Events from your Outlook calendar: until they are gone')
    expect(privacy).toContain('https://account.live.com/consent/Manage')
    expect(privacy).toContain('https://myapplications.microsoft.com/')
    expect(text).toContain('Events already in your Google Calendar or Outlook stay there')
  })

  it('names where data from every event source is sent (REVIEW6 M2)', () => {
    const text = privacy.replace(/\s+/g, ' ')
    // Open-Meteo's place search, for each source, and only addresses from Google Calendar.
    expect(text).toContain(
      'from your browser for a calendar (.ics) file you import; from Solara&apos;s servers for a linked calendar; and from your browser for events from your Google Calendar or Outlook, only when the location is written as an address',
    )
    expect(text).toContain(
      'Other location text, such as a person&apos;s name, a room, an office or a meeting link, is never searched or sent anywhere',
    )
    // Forecasts at event places, the heads-up push, and the proxy.
    expect(text).toContain('for your place and for the place of each event')
    expect(text).toContain('through Firebase Cloud Messaging')
    expect(text).toContain(
      'pass through Solara&apos;s servers (Google Cloud) on their way to Open-Meteo',
    )
    expect(text).toContain('dial-in numbers and passcodes')
  })

  it('says what error reports contain, that they are scrubbed, and how long they are kept', () => {
    expect(privacy).toContain('<strong>Error reports</strong>')
    expect(privacy).toContain('removed in your browser before a report')
    expect(privacy).toContain('no IP address is stored')
    expect(privacy).toContain('Error reports: 30 days in Sentry.')
    expect(privacy).toContain('do not depend on')
  })

  it('describes calendar access as availability only, matching the requested scope', () => {
    expect(privacy).toContain('Solara never sees')
    expect(privacy).toContain('Limited Use')
  })
})

describe('retention promises match what production does (REVIEW8 SEC M3, QA M2)', () => {
  it('renders every switch-dependent line from lib/privacy-retention.ts, never as fixed text', () => {
    for (const line of ['scheduled', 'imported', 'google', 'outlook', 'waitlist', 'backups']) {
      expect(privacy).toContain(`{kept.${line}}`)
    }
    expect(privacy).toContain('{recaptchaScope(switches)}')
    expect(privacy).toContain('const switches = privacySwitches()')
    // The old promise, true only once the TTL policies are on, is gone from the page.
    expect(privacy).not.toMatch(/Firestore\s+deletes/)
    expect(privacy).not.toContain('reCAPTCHA runs only')
  })

  it('reads the production steps, which are both still to do on the free plan', () => {
    expect(PRODUCTION_DATA_STEPS).toEqual({ firestoreTtl: false, backups: false })
    expect(privacySwitches()).toMatchObject(PRODUCTION_DATA_STEPS)
  })

  it('without TTL, promises only what the app does: deletion on the next signed-in visit', () => {
    const lines = retentionLines(TODAY)
    for (const line of [lines.imported, lines.google, lines.outlook]) {
      expect(line).toContain(
        `once an event ended more than ${IMPORTED_EVENT_RETENTION_DAYS} days ago, Solara deletes it the next time you open the app while signed in;`,
      )
    }
    expect(lines.scheduled).toContain(
      `once an event ended more than ${SCHEDULED_RETENTION_DAYS} days ago, Solara deletes its record the next time you open the app while signed in;`,
    )
    expect(keptToday).not.toContain('Firestore')
    expect(keptToday).not.toContain('never come back')
  })

  it('with TTL, adds that Firestore deletes them for people who never come back', () => {
    const lines = retentionLines(PRO_LAUNCH)
    for (const line of [lines.scheduled, lines.imported, lines.google, lines.outlook]) {
      expect(line).toContain(
        'the next time you open the app while signed in, and Firestore deletes it automatically even if you never come back;',
      )
    }
  })

  it('the TTL script covers the collections the promise is about, at the promised age', () => {
    expect(ttlScript).toMatch(/\|\s*events\s*\|\s*30 days after the imported event ends/)
    expect(ttlScript).toMatch(/\|\s*scheduled\s*\|\s*30 days after the scheduled event ends/)
    expect(ttlScript).toMatch(/\bevents\b[^\n]*forecastCache/)
    expect(IMPORTED_EVENT_RETENTION_DAYS).toBe(30)
    expect(SCHEDULED_RETENTION_DAYS).toBe(30)
  })

  it('the app prunes ended records on every signed-in visit, not only when Events shows', () => {
    expect(appSource).toContain("import('@/lib/retention')")
    expect(appSource).toContain('pruneEndedRecords(uid, Date.now())')
  })

  it('names backups only once they exist, with their real lengths', () => {
    expect(retentionLines(TODAY).backups).toBe(
      'Backups: Solara keeps no backups of its database yet, so deleted data is gone at once.',
    )
    expect(retentionLines(PRO_LAUNCH).backups).toContain('up to 14 days')
    expect(keptAtProLaunch).toContain('point-in-time recovery for 7 days')
  })

  it('names the Pro waitlist email, what it is for and how to leave', () => {
    const text = privacy.replace(/\s+/g, ' ')
    expect(text).toContain('<strong>The Pro waitlist</strong>, only if you join it')
    expect(text).toContain('so Solara can tell you when Pro opens')
    expect(text).toContain(
      'To be taken off the waitlist, email <LegalDetail name="contactEmail" />',
    )
    expect(keptToday).toContain('The Pro waitlist email: while your account exists')
  })

  it('says reCAPTCHA reaches guests once the forecast proxy is on (REVIEW8 SEC L7, PLAN L4)', () => {
    expect(recaptchaScope(TODAY)).toBe('reCAPTCHA runs only after you sign in')
    expect(recaptchaScope(PRO_LAUNCH)).toContain('also without an account')
    expect(recaptchaScope(PRO_LAUNCH)).toContain('a forecast or a place search')
  })
})

describe('terms of use', () => {
  it('states the governing law and data licenses', () => {
    expect(terms).toContain('<LegalDetail name="jurisdiction" />')
    expect(terms).toContain('CC BY 4.0')
    expect(terms).toContain('Open Database License')
    expect(terms).toContain('https://www.geonames.org/')
  })
})

describe('last updated dates', () => {
  it('dates each document on its own, so a change to one never re-dates the other', () => {
    expect(privacy).toContain('updated={PRIVACY_LAST_UPDATED}')
    expect(terms).toContain('updated={TERMS_LAST_UPDATED}')
  })
})

describe('legal details', () => {
  it('lists every owner decision D8 needs', () => {
    expect(Object.keys(LEGAL_DETAILS).sort()).toEqual([
      'codeLicense',
      'contactEmail',
      'jurisdiction',
      'operatorName',
    ])
  })
})
