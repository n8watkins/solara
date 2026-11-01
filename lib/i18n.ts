// The page's language (ROADMAP item 46, docs/i18n/README.md).
//
// LANGUAGE_INIT_SCRIPT picks it before first paint and sets <html lang>: the language
// chosen in Settings (kept in this browser, and synced to a signed-in account), else the
// first supported language of the device (navigator.languages), else English. English is
// built into the code; another language downloads only its own translations: the opening
// screen's in one chunk (the app shows once they have arrived, so nothing changes
// language on screen), and every other namespace in a chunk of its own, fetched with the
// part that shows it (withMessages, components/deferred.tsx), so a guest never downloads
// the text of setup, the account, events or pricing until one of them opens (REVIEW10 QA
// M1). Changing the language reloads the page.
import {
  addTranslations,
  currentLocale,
  intlTagFor,
  isLocale,
  localeFromLanguages,
  setLocale,
  type Locale,
  type Overlay,
} from '@solara/core/i18n'
import appText from '@/messages/app'
import type { LanguagePreference } from '@solara/core/prefs'

export { currentLocale, type Locale }

/** Each language's name in itself, as language pickers show them. */
export const LANGUAGE_NAMES: Readonly<Record<Locale, string>> = { en: 'English', es: 'Español' }

/** Where this browser keeps the language chosen in Settings. */
export const LANGUAGE_STORAGE_KEY = 'solara_language'

/** The device's preferred languages, most preferred first. */
export function deviceLanguages(): readonly string[] {
  if (typeof navigator === 'undefined') return []
  return navigator.languages?.length ? navigator.languages : [navigator.language]
}

/** The language chosen in Settings in this browser, or null to follow the device. */
export function storedLanguage(): Locale | null {
  try {
    const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY)
    return isLocale(stored) ? stored : null
  } catch {
    return null
  }
}

/** Keeps (or with null, forgets) the chosen language in this browser. */
export function storeLanguage(locale: Locale | null) {
  try {
    if (locale) window.localStorage.setItem(LANGUAGE_STORAGE_KEY, locale)
    else window.localStorage.removeItem(LANGUAGE_STORAGE_KEY)
  } catch {
    // Storage blocked: the choice lasts until the page closes.
  }
}

/** The language a page opens in: the stored choice, else the device's. */
export function resolveLanguage(
  stored: unknown,
  languages: readonly string[] | null | undefined,
): Locale {
  return isLocale(stored) ? stored : localeFromLanguages(languages)
}

// Runs before first paint on the app's pages (app/layout.tsx), so <html lang> and the
// CSS that shows static text in the page's language (StaticText) are right from the first
// frame. Plain ES5, a fixed literal (its CSP hash never changes), wrapped in try/catch;
// i18n.test.ts checks it agrees with resolveLanguage and names LANGUAGE_STORAGE_KEY.
// The landing, legal and city pages are static pages in one language and keep theirs;
// every other page (the app, the account page, share links, the 404 page) follows it.
export const LANGUAGE_INIT_SCRIPT = `(function(){try{if(/^\\/(?:$|privacy\\/|terms\\/|uv\\/|es\\/)/.test(location.pathname))return;var l=null;try{l=localStorage.getItem("solara_language")}catch(e){}if(l!=="en"&&l!=="es"){l="en";var a=navigator.languages&&navigator.languages.length?navigator.languages:[navigator.language];for(var i=0;i<a.length;i++){var p=String(a[i]||"").toLowerCase().split(/[-_]/)[0];if(p==="en"||p==="es"){l=p;break}}}document.documentElement.lang=l}catch(e){}})()`

type Chunk = () => Promise<{ default: Overlay }>
type Messages = Overlay[string]

/** Each language's opening screen translations (messages/es/initial.ts). */
const INITIAL: Record<Exclude<Locale, 'en'>, Chunk> = {
  es: () => import('@/messages/es/initial'),
}

/** Every namespace the opening screen does not read; each part loads the ones it shows. */
export type LazyNamespace =
  | 'account'
  | 'activities'
  | 'calendar'
  | 'connections'
  | 'editor'
  | 'events'
  | 'iconSearch'
  | 'linked'
  | 'linking'
  | 'pricing'
  | 'profiles'
  | 'settings'
  | 'setup'
  | 'share'
  | 'skinQuiz'
  | 'sunscreen'

/** How a language fetches each of those namespaces, a chunk of its own. */
export type LazyTranslations = Record<LazyNamespace, () => Promise<{ default: Messages }>>

/**
 * Each language's loaders for those namespaces (messages/es/lazy.ts), fetched with the
 * first one a part asks for, so an English page never downloads them. A part names the
 * namespaces its code reads (withMessages); messages/i18n.test.ts checks that every part
 * names exactly those.
 */
const LAZY: Record<Exclude<Locale, 'en'>, () => Promise<{ default: LazyTranslations }>> = {
  es: () => import('@/messages/es/lazy'),
}
const lazyLoads = new Map<string, Promise<void>>()

let initial: Promise<void> | null = null
let initialDone = false
/** The language this page was opened in (before any fallback to English). */
let requested: Locale | null = null
const listeners = new Set<() => void>()

/** The language this page shows, chosen once per page load. */
function pageLanguage(): Locale {
  const fromScript = document.documentElement.lang
  return isLocale(fromScript) ? fromScript : resolveLanguage(storedLanguage(), deviceLanguages())
}

/**
 * Starts the page's language: English at once, another language once its opening
 * screen's translations have arrived. Resolves when the opening screen can render.
 */
export function loadInitialMessages(): Promise<void> {
  if (initial) return initial
  const locale = pageLanguage()
  requested = locale
  document.documentElement.lang = locale
  setLocale(locale, {}, intlTagFor(locale, deviceLanguages()))
  if (locale === 'en') {
    initial = Promise.resolve()
    initialDone = true
  } else {
    const done = () => {
      initialDone = true
      localizeTitle()
      for (const listener of listeners) listener()
    }
    initial = INITIAL[locale]()
      .then(module => addTranslations(module.default))
      .catch(error => {
        // Never stuck on the loading screen: without its translations (offline before
        // they were ever fetched), the page opens in English.
        console.error('Could not load the translations; showing English:', error)
        setLocale('en')
        document.documentElement.lang = 'en'
      })
      .then(done)
  }
  return initial
}

let titleWatch: MutationObserver | null = null

/**
 * The page's title in its language (the static HTML carries the English one). Next.js
 * renders the title from the page's metadata and may write it again after hydration, so
 * the translated title is kept: a change to <head> that brings another title back is
 * answered with this one.
 */
export function localizeTitle() {
  if (currentLocale() === 'en') return
  const path = window.location.pathname
  const title = path.startsWith('/app/')
    ? appText.documentTitle
    : path.startsWith('/account/')
      ? appText.titleAccount
      : path.startsWith('/share/')
        ? appText.titleShare
        : null
  if (!title) return
  if (document.title !== title) document.title = title
  if (titleWatch || typeof MutationObserver === 'undefined') return
  titleWatch = new MutationObserver(() => {
    if (document.title !== title) document.title = title
  })
  titleWatch.observe(document.head, { childList: true, subtree: true, characterData: true })
}

/**
 * Resolves once the page's language has the translations of `namespaces` (at once in
 * English), after the opening screen's: should those fail to load, the page shows in
 * English and so does every part. Rejects when a chunk cannot be fetched (offline, or a
 * deploy in between); the next call tries again.
 */
export function loadMessages(namespaces: readonly LazyNamespace[]): Promise<void> {
  const opened = initial ?? Promise.resolve()
  return opened.then(() => {
    const locale = currentLocale()
    if (locale === 'en') return
    return Promise.all(
      namespaces.map(namespace => {
        const key = `${locale}:${namespace}`
        let pending = lazyLoads.get(key)
        if (!pending) {
          pending = LAZY[locale]()
            .then(loaders => loaders.default[namespace]())
            .then(
              module => addTranslations({ [namespace]: module.default }),
              error => {
                lazyLoads.delete(key)
                throw error
              },
            )
          lazyLoads.set(key, pending)
        }
        return pending
      }),
    ).then(() => {})
  })
}

/**
 * Loads a module that shows text, with the translations of the namespaces its code reads
 * (`namespaces`, which messages/i18n.test.ts checks against the module's imports), so it
 * never shows in English on a page in another language. Write it as
 * `withMessages([...], () => import('...'))`, the form the test reads.
 */
export function withMessages<T>(
  namespaces: readonly LazyNamespace[],
  load: () => Promise<T>,
): Promise<T> {
  return Promise.all([load(), loadMessages(namespaces)]).then(([module]) => module)
}

/** Resolves once every translation of the page's language has arrived. */
export function loadAllMessages(): Promise<void> {
  const locale = currentLocale()
  if (locale === 'en') return loadMessages([])
  return LAZY[locale]().then(loaders =>
    loadMessages(Object.keys(loaders.default) as LazyNamespace[]),
  )
}

/** Whether the opening screen's text is ready (always, in English). */
export function initialMessagesReady(): boolean {
  return initialDone
}

/** Calls `listener` once the opening screen's text is ready. */
export function subscribeMessages(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * Follows the language preference of the plan on screen (Settings, synced with a
 * signed-in account; 'auto' or unset follows the device): keeps it in this browser for
 * the next page load and, when it changes this page's language, reloads the page in it.
 * Returns whether it reloads.
 */
export function followLanguagePreference(preference: LanguagePreference | undefined): boolean {
  const chosen = preference && preference !== 'auto' ? preference : null
  if (storedLanguage() !== chosen) storeLanguage(chosen)
  // Never reload when this browser cannot keep the choice: the reloaded page would not
  // know it either, and would reload again.
  if (storedLanguage() !== chosen) return false
  if (resolveLanguage(chosen, deviceLanguages()) === (requested ?? currentLocale())) return false
  window.location.reload()
  return true
}
