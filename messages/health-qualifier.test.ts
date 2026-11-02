// The "not medical advice" qualifier (owner 2026-11-01, docs/LEGAL_REVIEW.md): one
// sentence on who should ask a health professional, the same in the app and on the static
// pages, in every language, naming every case the owner listed.
import { describe, expect, it } from 'vitest'
import app from './app'
import site from './site'
import esApp from './es/app'
import esSite from './es/site'

const languages = {
  en: { qualifier: app.healthQualifier, siteDisclaimer: site.disclaimer },
  es: { qualifier: esApp.healthQualifier, siteDisclaimer: esSite.disclaimer },
}

describe('the health qualifier', () => {
  it("ends the static pages' disclaimer word for word", () => {
    for (const { qualifier, siteDisclaimer } of Object.values(languages)) {
      expect(siteDisclaimer.endsWith(` ${qualifier}`)).toBe(true)
    }
  })

  it('names a medical condition, sun-sensitizing medicine, pregnancy, skin and vitamin D', () => {
    expect(app.healthQualifier).toMatch(/medical condition/)
    expect(app.healthQualifier).toMatch(/medicine that makes you more sensitive to the sun/)
    expect(app.healthQualifier).toMatch(/pregnant/)
    expect(app.healthQualifier).toMatch(/your skin or vitamin D/)
    expect(app.healthQualifier).toMatch(/ask a health professional\.$/)
    expect(esApp.healthQualifier).toMatch(/problema de salud/)
    expect(esApp.healthQualifier).toMatch(/medicamento que te hace más sensible al sol/)
    expect(esApp.healthQualifier).toMatch(/embarazada/)
    expect(esApp.healthQualifier).toMatch(/tu piel o tu vitamina D/)
    expect(esApp.healthQualifier).toMatch(/consulta a un profesional de la salud\.$/)
  })
})
