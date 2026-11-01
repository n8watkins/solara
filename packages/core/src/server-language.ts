// The language the Functions write an account's text in (ROADMAP item 46): its pushes
// (the Pro morning and UV alerts, the daily UV push, the reapply reminder, event
// heads-ups) and its calendar feed. The account's `language` (Settings, Display) picks
// it when it is a language; set to 'auto' (or never set), the account's `deviceLanguage`
// does, the language the app last resolved from a device (the last device to open the
// app wins, lib/i18n.ts); without either, English, the default.
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

/** The fields of users/{uid} that decide the language its text is written in. */
export interface AccountLanguageFields {
  /** The choice in Settings: a language, or 'auto' to follow the device. */
  readonly language?: unknown
  /** The language the app last resolved from a device while the choice was 'auto'. */
  readonly deviceLanguage?: unknown
}

/**
 * The language an account's text is written in: its chosen `language` when that is a
 * supported language, else its `deviceLanguage` when supported, else English. Takes the
 * stored document (or nothing, for a missing one); unknown values read as unset.
 */
export function accountLocale(account: AccountLanguageFields | null | undefined): Locale {
  if (isLocale(account?.language)) return account.language
  if (isLocale(account?.deviceLanguage)) return account.deviceLanguage
  return DEFAULT_LOCALE
}

type NotAPromise<T> = T extends PromiseLike<unknown> ? never : T

/**
 * Builds text in the account's language (see accountLocale; `account` is users/{uid} as
 * stored). `work` must be synchronous, as for withLocale: it builds the words, never
 * sends them.
 */
export function inAccountLanguage<T>(
  account: AccountLanguageFields | null | undefined,
  work: () => NotAPromise<T>,
): NotAPromise<T> {
  const locale = accountLocale(account)
  return withLocale(locale, SERVER_TRANSLATIONS[locale], work)
}
