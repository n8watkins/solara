// The static pages in every language (ROADMAP item 46, decision "Language pages"): the
// landing page, the privacy policy, the terms and the city pages each have an address
// per language (`/privacy/`, `/es/privacy/`), built as static HTML with hreflang links
// between them, so search engines index each language and the pages ship no framework
// JavaScript. The app keeps one address and switches at runtime (lib/i18n.ts).
//
// Server code only: it holds every Spanish translation, which must never reach the app's
// chunks. The export gives each page under /es/ `<html lang="es">` (scripts/static-pages.mjs,
// lib/static-pages.mts), since the one root layout writes English.
import type { Metadata } from 'next'
import { LOCALES, withLocale, type Locale, type Overlay } from '@solara/core/i18n'
import { SERVER_TRANSLATIONS } from '@solara/core/server-language'
import cityPages from '@/messages/city-pages'
import landing from '@/messages/landing'
import site from '@/messages/site'
import initial from '@/messages/es/initial'
import appLazy from '@/messages/es/app-lazy'
import pages from '@/messages/es/pages'

/** Every translation a static page may read: the app's, the shared ones and its own. */
const PAGE_TRANSLATIONS: Readonly<Record<Locale, Overlay>> = {
  en: {},
  es: { ...SERVER_TRANSLATIONS.es, ...initial, ...appLazy, ...pages },
}

/** The language each address prefix serves; English has none. */
const PREFIX: Readonly<Record<Locale, string>> = { en: '', es: '/es' }

/** The Open Graph locale of each language. */
const OG_LOCALE: Readonly<Record<Locale, string>> = { en: 'en_US', es: 'es_419' }

/**
 * Runs `work` with the page's language active, for the words computed from the shared
 * catalogues (UV categories, the clock, plan features, city facts). `work` must be
 * synchronous (withLocale): build the words, then render them.
 */
export function inPageLanguage<T>(locale: Locale, work: () => T): T {
  return withLocale(locale, PAGE_TRANSLATIONS[locale], work as () => never) as T
}

/** The static pages' own namespaces, in English. */
const PAGE_NAMESPACES = { cityPages, landing, site }

/** A static page's own words in its language (Spanish typed against English). */
export function pageText(locale: Locale): typeof PAGE_NAMESPACES {
  return locale === 'es' ? pages : PAGE_NAMESPACES
}

/** A page's address in a language: `/privacy/` is `/es/privacy/` in Spanish. */
export function localePath(path: string, locale: Locale): string {
  return `${PREFIX[locale]}${path}`
}

/** The language a page's path is in (`/es/...` is Spanish). */
export function pathLocale(path: string): Locale {
  return LOCALES.find(locale => PREFIX[locale] && path.startsWith(`${PREFIX[locale]}/`)) ?? 'en'
}

/** The other language of a page pair, which its language link offers. */
export function otherLocale(locale: Locale): Locale {
  return locale === 'en' ? 'es' : 'en'
}

/**
 * A page's canonical address and its `hreflang` alternates: every language, and English
 * as x-default (for searchers in other languages). `path` is the English address.
 */
export function languageAlternates(path: string, locale: Locale): Metadata['alternates'] {
  return {
    canonical: localePath(path, locale),
    languages: {
      ...Object.fromEntries(LOCALES.map(l => [l, localePath(path, l)])),
      'x-default': path,
    },
  }
}

/**
 * Each language's social card (drawn by scripts/og-images.mjs), so a Spanish link shared
 * in a chat shows a Spanish card (REVIEW10 VERIFY10 N3).
 */
export const OG_IMAGES: Readonly<Record<Locale, { url: string; width: number; height: number }>> = {
  en: { url: '/og-image.png', width: 1200, height: 630 },
  es: { url: '/og-image-es.png', width: 1200, height: 630 },
}

/**
 * Title, description, canonical address, hreflang alternates and social cards for a
 * static page in a language. Next.js replaces the layout's `openGraph` and `twitter`
 * objects rather than merging them, so the image is repeated here.
 */
export function pageMetadata({
  title,
  description,
  socialTitle = title,
  socialDescription = description,
  path,
  locale,
}: {
  title: string
  description: string
  socialTitle?: string
  socialDescription?: string
  /** The English address ("/privacy/"). */
  path: string
  locale: Locale
}): Metadata {
  const alt = pageText(locale).site.ogImageAlt
  const image = OG_IMAGES[locale]
  return {
    title,
    description,
    alternates: languageAlternates(path, locale),
    openGraph: {
      title: socialTitle,
      description: socialDescription,
      url: localePath(path, locale),
      type: 'website',
      siteName: 'Solara',
      locale: OG_LOCALE[locale],
      alternateLocale: LOCALES.filter(l => l !== locale).map(l => OG_LOCALE[l]),
      images: [{ ...image, alt }],
    },
    twitter: {
      card: 'summary_large_image',
      title: socialTitle,
      description: socialDescription,
      images: [image.url],
    },
  }
}
