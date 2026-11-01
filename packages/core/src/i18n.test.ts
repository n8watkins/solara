import { afterEach, describe, expect, it } from 'vitest'
import {
  addTranslations,
  currentLocale,
  defineMessages,
  formatNumber,
  intlTag,
  intlTagFor,
  isLocale,
  localeFromLanguages,
  plural,
  setLocale,
  withLocale,
} from './i18n'
import core from './messages/core'
import es from './messages/es/core'
import { formatDuration } from './duration'
import { uvLabel, formatUV } from './uv-scale'
import { formatClock12 } from './clock'
import { las, punto } from './messages/es/grammar'

afterEach(() => setLocale('en'))

describe('choosing a language', () => {
  it('takes the first language Solara speaks from the device list', () => {
    expect(localeFromLanguages(['fr-FR', 'es-MX', 'en'])).toBe('es')
    expect(localeFromLanguages(['en-GB', 'es'])).toBe('en')
    expect(localeFromLanguages(['de-DE'])).toBe('en')
    expect(localeFromLanguages([])).toBe('en')
    expect(localeFromLanguages(null)).toBe('en')
    expect(localeFromLanguages(['ES_us'])).toBe('es')
  })

  it("formats with the device's own tag for the language, else the language's default", () => {
    expect(intlTagFor('es', ['es-AR', 'en'])).toBe('es-AR')
    expect(intlTagFor('es', ['en-US'])).toBe('es-419')
    expect(intlTagFor('en', ['es-MX', 'en-GB'])).toBe('en-GB')
    expect(intlTagFor('en', ['not a tag'])).toBe('en-US')
  })

  it('knows its languages', () => {
    expect(isLocale('es')).toBe(true)
    expect(isLocale('fr')).toBe(false)
    expect(isLocale(undefined)).toBe(false)
  })
})

describe('the live catalogue', () => {
  it('reads English until a translation is applied, and English again after', () => {
    expect(core.uvVeryHigh).toBe('Very high')
    setLocale('es', { core: es })
    expect(currentLocale()).toBe('es')
    expect(core.uvVeryHigh).toBe('Muy alto')
    expect(uvLabel(9)).toBe('Muy alto')
    setLocale('en')
    expect(core.uvVeryHigh).toBe('Very high')
  })

  it('translates a namespace registered after its translation arrived', () => {
    setLocale('es', {})
    addTranslations({ late: { hello: 'Hola' } })
    const late = defineMessages('late', { hello: 'Hello' })
    expect(late.hello).toBe('Hola')
    setLocale('en')
    expect(late.hello).toBe('Hello')
  })

  it('switches for one synchronous piece of work and restores the language after', () => {
    const text = withLocale('es', { core: es }, () => `${uvLabel(3)} · ${formatDuration(167)}`)
    expect(text).toBe('Moderado · 2 h 47 min')
    expect(currentLocale()).toBe('en')
    expect(uvLabel(3)).toBe('Moderate')
  })

  it('restores the language when the work throws', () => {
    expect(() =>
      withLocale('es', { core: es }, () => {
        throw new Error('boom')
      }),
    ).toThrow('boom')
    expect(currentLocale()).toBe('en')
  })
})

describe('plurals and numbers', () => {
  it("uses the active language's plural rules", () => {
    expect(plural(1, { one: 'one', other: 'other' })).toBe('one')
    expect(plural(0, { one: 'one', other: 'other' })).toBe('other')
    setLocale('es', {})
    expect(plural(1, { one: 'uno', other: 'otros' })).toBe('uno')
    // Spanish names round millions "many"; without that form, "other" reads right.
    expect(plural(1_000_000, { one: 'uno', other: 'otros' })).toBe('otros')
  })

  it('writes numbers, the clock and UV values in the language', () => {
    setLocale('es', { core: es }, 'es-419')
    expect(intlTag()).toBe('es-419')
    expect(formatUV(10.34)).toBe('10.3')
    expect(formatClock12(13)).toBe('1\u00a0p.m.')
    expect(formatClock12(9.75)).toBe('9:45\u00a0a.m.')
    setLocale('es', { core: es }, 'es-AR')
    expect(formatUV(10.34)).toBe('10,3')
    expect(formatNumber(5000)).toBe('5.000')
    setLocale('en')
    expect(formatUV(10.34)).toBe('10.3')
    expect(formatClock12(13)).toBe('1pm')
    expect(formatNumber(5000)).toBe('5,000')
  })
})

describe('Spanish grammar helpers', () => {
  it('closes a sentence once after a time that ends in an abbreviation', () => {
    expect(punto('Alto o más a las 3\u00a0p.m.')).toBe('Alto o más a las 3\u00a0p.m.')
    expect(punto('Alto o más a las 15:00')).toBe('Alto o más a las 15:00.')
  })

  it('uses "la" for one o\'clock and "las" for every other hour', () => {
    expect(las('1\u00a0p.m.')).toBe('la 1\u00a0p.m.')
    expect(las('1:30\u00a0p.m.')).toBe('la 1:30\u00a0p.m.')
    expect(las('11\u00a0a.m.')).toBe('las 11\u00a0a.m.')
    expect(las('13:00')).toBe('las 13:00')
  })
})
