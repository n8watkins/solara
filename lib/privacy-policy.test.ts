import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { LEGAL_DETAILS } from './legal'

const privacy = readFileSync(new URL('../app/privacy/page.tsx', import.meta.url), 'utf8')
const terms = readFileSync(new URL('../app/terms/page.tsx', import.meta.url), 'utf8')

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
    expect(privacy).toContain('Scheduled activities: until you remove the event')
    expect(privacy).toContain('scheduled activities, imported')
  })

  it('says what Solara keeps about imported events, and for how long', () => {
    expect(privacy).toContain('<strong>Imported events</strong>')
    expect(privacy).toContain('The file is read in your')
    expect(privacy).toContain('Imported events: until you remove them')
  })

  it('says what Solara keeps about events from Google Calendar, and for how long', () => {
    expect(privacy).toContain('<strong>Events from your Google Calendar</strong>')
    expect(privacy.replace(/\s+/g, ' ')).toContain('no Google access token is stored anywhere')
    expect(privacy).toContain('Events from your Google Calendar: until they are gone')
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
    expect(text).toContain('Solara never learns which Microsoft account you signed in with')
    expect(privacy).toContain('Events from your Outlook calendar: until they are gone')
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
