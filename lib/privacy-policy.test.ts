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
    for (const scope of ['calendar.freebusy', 'calendar.events.owned', 'openid']) {
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
    expect(privacy).toContain('scheduled activities, calendar')
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
