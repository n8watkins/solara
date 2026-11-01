import type { Locale } from '@solara/core/i18n'

/**
 * Operator details shown in the privacy policy and terms (owner decision D8 in
 * docs/status.md). A null value renders a clearly marked
 * placeholder instead.
 */
export const LEGAL_DETAILS: Readonly<{
  /** Legal name of the person or company that runs Solara. */
  operatorName: string | null
  /** Address for privacy requests and questions. */
  contactEmail: string | null
  /** Country or state whose law governs the terms, e.g. "California, United States". */
  jurisdiction: string | null
  /** License for Solara's own source code, e.g. "MIT" or "All rights reserved". */
  codeLicense: string | null
}> = {
  operatorName: 'Nathan Watkins',
  contactEmail: 'contact@n8builds.dev',
  jurisdiction: 'California, United States',
  codeLicense: 'All rights reserved',
}

/**
 * When each document's text last changed. They are dated separately, so a change
 * to one never re-dates the other; update the date in the same change as the text.
 */
export const PRIVACY_LAST_UPDATED = 'November 1, 2026'
export const TERMS_LAST_UPDATED = 'October 25, 2026'

/**
 * The English version each translation translates (ROADMAP item 46): a change to the
 * English text changes its date above, and lib/privacy-policy.test.ts then fails until the
 * translation (app/es/privacy/page.tsx, app/es/terms/page.tsx) says the same again and its
 * date here is moved to match. The English version prevails, as each translation states.
 */
export const TRANSLATED_FROM: Readonly<
  Partial<Record<Locale, { privacy: string; terms: string }>>
> = {
  es: { privacy: 'November 1, 2026', terms: 'October 25, 2026' },
}

/** A document date ("October 29, 2026") as the language writes it ("29 de octubre de 2026"). */
export function legalDate(date: string, locale: Locale): string {
  const parsed = new Date(`${date} 12:00 UTC`)
  if (Number.isNaN(parsed.getTime())) throw new Error(`Not a document date: ${date}`)
  if (locale === 'en') return date
  return parsed.toLocaleDateString(locale === 'es' ? 'es-419' : locale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

export type LegalDetail = keyof typeof LEGAL_DETAILS

export const LEGAL_PLACEHOLDER_LABELS: Readonly<Record<LegalDetail, string>> = {
  operatorName: 'operator name',
  contactEmail: 'contact email',
  jurisdiction: 'governing jurisdiction',
  codeLicense: 'source code license',
}

/** The details that read differently in another language (names and the address stay). */
export const LEGAL_DETAILS_TRANSLATED: Readonly<
  Partial<Record<Locale, Partial<Record<LegalDetail, string>>>>
> = {
  es: {
    jurisdiction: 'California, Estados Unidos',
    codeLicense: 'Todos los derechos reservados',
  },
}
