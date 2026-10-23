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
