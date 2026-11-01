// The page's language (ROADMAP item 46, docs/i18n/README.md).
//
// LANGUAGE_INIT_SCRIPT picks it before first paint and sets <html lang>: the language
// chosen in Settings (kept in this browser, and synced to a signed-in account), else the
// first supported language of the device (navigator.languages), else English. English is
// built into the code; another language downloads only its own translations, in two
// chunks: the opening screen's (the app shows once they have arrived, so nothing changes
// language on screen) and the rest's (each part that loads on demand waits for them,
// components/deferred.tsx). Changing the language reloads the page.
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

/** Each language's translations: the opening screen's, then the rest. */
const TRANSLATIONS: Record<Exclude<Locale, 'en'>, { initial: Chunk; rest: Chunk }> = {
  es: {
    initial: () => import('@/messages/es/initial'),
    rest: () => import('@/messages/es/rest'),
  },
}

/**
 * Translations that only a rarely opened part reads, fetched when it opens, so neither the
 * first load nor the rest carries them: the icon picker's search words.
 */
const ON_DEMAND: Record<Exclude<Locale, 'en'>, Record<'iconSearch', Chunk>> = {
  es: {
    iconSearch: () =>
      import('@/messages/es/icon-search').then(module => ({
        default: { iconSearch: module.default },
      })),
  },
}
const onDemand = new Map<string, Promise<void>>()

let initial: Promise<void> | null = null
let rest: Promise<void> | null = null
let initialDone = false
/** The language this page was opened in (before any fallback to English). */
let requested: Locale | null = null
const listeners = new Set<() => void>()

/** The language this page shows, chosen once per page load. */
function pageLanguage(): Locale {
  const fromScript = document.documentElement.lang
  return isLocale(fromScript) ? fromScript : resolveLanguage(storedLanguage(), deviceLanguages())
}

function retryable(load: Chunk, reset: () => void): Promise<void> {
  return load().then(
    module => addTranslations(module.default),
    error => {
      // Offline or a deploy in between: tried again by the next caller.
      reset()
      throw error
    },
  )
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
    initial = TRANSLATIONS[locale]
      .initial()
      .then(module => addTranslations(module.default))
      .catch(error => {
        // Never stuck on the loading screen: without its translations (offline before
        // they were ever fetched), the page opens in English.
        console.error('Could not load the translations; showing English:', error)
        setLocale('en')
        document.documentElement.lang = 'en'
      })
      .then(done)
      // The rest follow once the opening screen's have arrived, so they never compete
      // with what the first paint needs; each part that loads on demand waits for them.
      .then(() => loadAllMessages())
      .catch(() => {})
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

/** Resolves once every translation of the page's language has arrived. */
export function loadAllMessages(): Promise<void> {
  if (rest) return rest
  const locale = currentLocale()
  rest =
    locale === 'en' ? Promise.resolve() : retryable(TRANSLATIONS[locale].rest, () => (rest = null))
  return rest
}

/**
 * Fetches the translations of one part that loads them when it opens (ON_DEMAND), in the
 * page's language; resolves at once in English. Until they arrive the part reads English.
 */
export function loadOnDemandMessages(part: keyof (typeof ON_DEMAND)['es']): Promise<void> {
  const locale = currentLocale()
  if (locale === 'en') return Promise.resolve()
  const key = `${locale}:${part}`
  let pending = onDemand.get(key)
  if (!pending) {
    pending = retryable(ON_DEMAND[locale][part], () => onDemand.delete(key))
    onDemand.set(key, pending)
  }
  return pending
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
 * The device's language to save to a signed-in account, or null when there is nothing to
 * write (ROADMAP item 46). While the account's choice is Automatic, the server writes its
 * pushes, alerts and calendar feed in `deviceLanguage` (packages/core/src/server-language.ts),
 * so the app keeps it to the language it resolves from this device: a language Solara
 * speaks, never the device's own list. It is written only when it changes, so with
 * devices in two languages the last one to open the app wins. A language chosen in
 * Settings leaves it alone, since the server then writes in that one.
 */
export function deviceLanguageToSave(
  prefs: { language?: LanguagePreference; deviceLanguage?: Locale },
  languages: readonly string[] | null | undefined,
): Locale | null {
  if (prefs.language && prefs.language !== 'auto') return null
  const device = localeFromLanguages(languages)
  return prefs.deviceLanguage === device ? null : device
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
