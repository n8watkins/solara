// The language the Functions write an account's text in (ROADMAP item 46): its pushes
// (the Pro morning and UV alerts, the daily UV push, the reapply reminder, event
// heads-ups) and its calendar feed. The account's `language` field (Settings, Display)
// picks it; 'auto' follows a device the server never sees, so it reads as English, the
// default, like a missing or unknown value.
//
// The Functions write for many accounts in one process, so each piece of text is built
// inside `inAccountLanguage`, which switches the shared catalogues for that synchronous
// piece of work only (i18n.ts withLocale). Every @solara/core namespace has its
// translation here, so nothing the server writes is left in English.
import { DEFAULT_LOCALE, isLocale, withLocale, type Locale, type Overlay } from './i18n'
import briefing from './messages/es/briefing'
import core from './messages/es/core'
import linking from './messages/es/linking'
import plans from './messages/es/plans'
import server from './messages/es/server'
import skinQuiz from './messages/es/skin-quiz'
import sunscreen from './messages/es/sunscreen'

/** Each language's translations of every @solara/core namespace (English is the source). */
export const SERVER_TRANSLATIONS: Readonly<Record<Locale, Overlay>> = {
  en: {},
  es: { briefing, core, linking, plans, server, skinQuiz, sunscreen },
}

/** The language an account's stored `language` writes in: a supported one, else English. */
export function accountLocale(language: unknown): Locale {
  return isLocale(language) ? language : DEFAULT_LOCALE
}

type NotAPromise<T> = T extends PromiseLike<unknown> ? never : T

/**
 * Builds text in the account's language (`language` as stored on users/{uid}). `work`
 * must be synchronous, as for withLocale: it builds the words, never sends them.
 */
export function inAccountLanguage<T>(
  language: unknown,
  work: () => NotAPromise<T>,
): NotAPromise<T> {
  const locale = accountLocale(language)
  return withLocale(locale, SERVER_TRANSLATIONS[locale], work)
}
