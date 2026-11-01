import { describe, expect, it } from 'vitest'
import {
  languageAlternates,
  localePath,
  otherLocale,
  pageMetadata,
  pathLocale,
} from './page-language'

describe('the static pages in every language (ROADMAP item 46)', () => {
  it('gives each page an address per language', () => {
    expect(localePath('/', 'en')).toBe('/')
    expect(localePath('/', 'es')).toBe('/es/')
    expect(localePath('/uv/tokyo/', 'es')).toBe('/es/uv/tokyo/')
    expect(pathLocale('/es/privacy/')).toBe('es')
    expect(pathLocale('/estimate/')).toBe('en')
    expect(otherLocale('en')).toBe('es')
    expect(otherLocale('es')).toBe('en')
  })

  it('links both languages both ways, English as x-default, each canonical to itself', () => {
    const languages = { en: '/privacy/', es: '/es/privacy/', 'x-default': '/privacy/' }
    expect(languageAlternates('/privacy/', 'en')).toEqual({ canonical: '/privacy/', languages })
    expect(languageAlternates('/privacy/', 'es')).toEqual({
      canonical: '/es/privacy/',
      languages,
    })
  })

  it('describes a Spanish page for social cards in Spanish', () => {
    const meta = pageMetadata({
      title: 'Título',
      description: 'Descripción',
      path: '/',
      locale: 'es',
    })
    expect(meta.openGraph).toMatchObject({
      url: '/es/',
      locale: 'es_419',
      alternateLocale: ['en_US'],
    })
  })
})
