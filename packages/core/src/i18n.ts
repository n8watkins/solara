// Languages: Solara's typed message catalogues (ROADMAP item 46, docs/i18n/README.md).
//
// Every user-visible string lives in a message namespace: an English module that calls
// `defineMessages` (the source of truth, imported by the code that shows the text, so its
// strings travel in the same chunk as before) and one translation module per other
// language, typed against it so a missing or extra key, or a message with other
// parameters, fails the typecheck. A message is a string or a function of its parameters;
// plurals go through `plural`, which uses the language's CLDR rules (Intl.PluralRules).
//
// The English objects are the live catalogue: switching the language copies a
// translation's strings into them (`setLocale`), so code reads `m.title` without knowing
// the language, and English needs no lookup and no extra download. The browser applies
// one language for the whole page; the Functions, which write for many accounts in one
// process, switch for one synchronous piece of work at a time (`withLocale`).

export const LOCALES = ['en', 'es'] as const
export type Locale = (typeof LOCALES)[number]
export const DEFAULT_LOCALE: Locale = 'en'

/** The BCP 47 tag each language formats with when the device speaks another language. */
const DEFAULT_TAGS: Record<Locale, string> = { en: 'en-US', es: 'es-419' }

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value)
}

/** The language a primary subtag names ("es-MX" and "es" are Spanish), if supported. */
function localeOfTag(tag: string): Locale | null {
  const primary = String(tag).toLowerCase().split(/[-_]/)[0]
  return isLocale(primary) ? primary : null
}

/**
 * The first supported language in the device's preference list (navigator.languages),
 * else English: ["fr-FR", "es-MX", "en"] is Spanish.
 */
export function localeFromLanguages(languages: readonly string[] | null | undefined): Locale {
  for (const tag of languages ?? []) {
    const locale = tag ? localeOfTag(tag) : null
    if (locale) return locale
  }
  return DEFAULT_LOCALE
}

/**
 * The tag dates and numbers are formatted with: the device's own tag for the chosen
 * language, so a Spanish speaker in Argentina keeps "10,3" and a Mexican one "10.3", else
 * the language's default (en-US, es-419 for Latin American Spanish).
 */
export function intlTagFor(
  locale: Locale,
  languages: readonly string[] | null | undefined,
): string {
  for (const tag of languages ?? []) {
    if (!tag || localeOfTag(tag) !== locale) continue
    try {
      const canonical = Intl.getCanonicalLocales(tag)[0]
      if (canonical) return canonical
    } catch {
      // A malformed tag: try the next one.
    }
  }
  return DEFAULT_TAGS[locale]
}

/** One message: plain text, or text built from its parameters. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- each message types its own
export type Message = string | ((...args: any[]) => string)
export type Messages = Record<string, Message>

/** A translation of a namespace: the same keys, each message with the same parameters. */
export type Translation<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => string ? (...args: A) => string : string
}

/** Translations of several namespaces, by namespace name. */
export type Overlay = Readonly<Record<string, Messages>>

interface Entry {
  target: Messages
  source: Readonly<Messages>
}

const registry = new Map<string, Entry>()
let locale: Locale = DEFAULT_LOCALE
let tag = DEFAULT_TAGS[DEFAULT_LOCALE]
let overlay: Record<string, Messages> = {}

function apply(entry: Entry, translation: Messages | undefined) {
  Object.assign(entry.target, translation ?? entry.source)
}

/**
 * Registers an English namespace and returns it as the live catalogue. Translations of the
 * active language that arrived earlier apply at once. Each name is used once.
 */
export function defineMessages<T extends Messages>(namespace: string, messages: T): T {
  const entry = { target: messages, source: Object.freeze({ ...messages }) }
  registry.set(namespace, entry)
  if (overlay[namespace]) apply(entry, overlay[namespace])
  return messages
}

/** The active language. */
export function currentLocale(): Locale {
  return locale
}

/** The BCP 47 tag dates and numbers are formatted with. */
export function intlTag(): string {
  return tag
}

/**
 * Makes `next` the active language, with its translations (an empty overlay for English).
 * Namespaces without a translation yet read English until `addTranslations` brings it.
 */
export function setLocale(next: Locale, translations: Overlay = {}, nextTag = DEFAULT_TAGS[next]) {
  locale = next
  tag = nextTag
  overlay = { ...translations }
  for (const [namespace, entry] of registry) apply(entry, overlay[namespace])
}

/** Adds translations of the active language (one chunk of them) to the live catalogue. */
export function addTranslations(translations: Overlay) {
  overlay = { ...overlay, ...translations }
  for (const [namespace, translation] of Object.entries(translations)) {
    const entry = registry.get(namespace)
    if (entry) apply(entry, translation)
  }
}

type NotAPromise<T> = T extends PromiseLike<unknown> ? never : T

/**
 * Runs `work` with `next` as the active language and restores the previous one after.
 * `work` must be synchronous: the Functions write for many accounts in one process, and
 * an await inside would let another account's text read this language.
 */
export function withLocale<T>(
  next: Locale,
  translations: Overlay,
  work: () => NotAPromise<T>,
): NotAPromise<T> {
  const saved = { locale, tag, overlay }
  setLocale(next, translations)
  try {
    return work()
  } finally {
    setLocale(saved.locale, saved.overlay, saved.tag)
  }
}

/** The registered namespaces and their English source (for tests and the review sheet). */
export function registeredNamespaces(): ReadonlyMap<string, Readonly<Messages>> {
  return new Map([...registry].map(([namespace, entry]) => [namespace, entry.source]))
}

const pluralRules = new Map<string, Intl.PluralRules>()

/**
 * The form for `count` under the active language's plural rules: English and Spanish
 * use `one` for exactly 1 and `other` otherwise (Spanish `many`, for round millions,
 * falls back to `other`).
 */
export function plural(
  count: number,
  forms: { one: string; other: string; few?: string; many?: string; two?: string; zero?: string },
): string {
  // Hermes (a future React Native client) may lack Intl.PluralRules; English and Spanish
  // then still read right with "exactly 1 is one".
  if (typeof Intl.PluralRules !== 'function') return count === 1 ? forms.one : forms.other
  let rules = pluralRules.get(locale)
  if (!rules) {
    rules = new Intl.PluralRules(locale)
    pluralRules.set(locale, rules)
  }
  const category = rules.select(count) as keyof typeof forms
  return forms[category] ?? forms.other
}

/** A whole or decimal number in the active language ("1,000" in English, "1000" in Spanish). */
export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return value.toLocaleString(tag, options)
}
