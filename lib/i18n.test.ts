// The page's language in the browser (lib/i18n.ts): the blocking script, the stored choice,
// loading the translations and following the plan's preference.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setLocale } from '@solara/core/i18n'

interface FakePage {
  root: { lang: string }
  store: Map<string, string>
  reload: ReturnType<typeof vi.fn>
}

function fakePage({
  path = '/app/',
  languages = ['en-US'],
  stored = null as string | null,
  storage = true,
} = {}): FakePage {
  const store = new Map<string, string>()
  if (stored) store.set('solara_language', stored)
  const root = { lang: 'en' }
  const reload = vi.fn()
  const localStorage = {
    getItem: (k: string) => {
      if (!storage) throw new Error('blocked')
      return store.get(k) ?? null
    },
    setItem: (k: string, v: string) => {
      if (!storage) throw new Error('blocked')
      store.set(k, v)
    },
    removeItem: (k: string) => {
      if (!storage) throw new Error('blocked')
      store.delete(k)
    },
  }
  vi.stubGlobal('localStorage', localStorage)
  vi.stubGlobal('window', { localStorage, location: { pathname: path, reload } })
  vi.stubGlobal('location', { pathname: path, reload })
  vi.stubGlobal('document', { documentElement: root, title: 'Solara: Plan around UV' })
  vi.stubGlobal('navigator', { languages, language: languages[0] })
  return { root, store, reload }
}

async function freshModule() {
  vi.resetModules()
  return import('./i18n')
}

beforeEach(() => setLocale('en'))
afterEach(() => {
  vi.unstubAllGlobals()
  setLocale('en')
})

describe('LANGUAGE_INIT_SCRIPT', () => {
  const cases: { languages: string[]; stored: string | null; expected: string }[] = [
    { languages: ['es-MX', 'en'], stored: null, expected: 'es' },
    { languages: ['fr-FR', 'es-ES'], stored: null, expected: 'es' },
    { languages: ['de-DE'], stored: null, expected: 'en' },
    { languages: ['es-MX'], stored: 'en', expected: 'en' },
    { languages: ['en-US'], stored: 'es', expected: 'es' },
    { languages: ['en-US'], stored: 'klingon', expected: 'en' },
  ]

  it.each(cases)('agrees with resolveLanguage for $languages and $stored', async c => {
    const page = fakePage({ languages: c.languages, stored: c.stored })
    const { LANGUAGE_INIT_SCRIPT, resolveLanguage } = await freshModule()
    new Function(LANGUAGE_INIT_SCRIPT)()
    expect(page.root.lang).toBe(c.expected)
    expect(resolveLanguage(c.stored, c.languages)).toBe(c.expected)
  })

  it('leaves the static English pages alone', async () => {
    for (const path of ['/', '/privacy/', '/terms/', '/uv/', '/uv/phoenix/']) {
      const page = fakePage({ path, languages: ['es-MX'] })
      const { LANGUAGE_INIT_SCRIPT } = await freshModule()
      new Function(LANGUAGE_INIT_SCRIPT)()
      expect(page.root.lang, path).toBe('en')
    }
  })

  it('names the storage key the module uses', async () => {
    fakePage()
    const { LANGUAGE_INIT_SCRIPT, LANGUAGE_STORAGE_KEY } = await freshModule()
    expect(LANGUAGE_INIT_SCRIPT).toContain(`"${LANGUAGE_STORAGE_KEY}"`)
  })

  it('never throws, even with storage blocked', async () => {
    const page = fakePage({ languages: ['es'], storage: false })
    const { LANGUAGE_INIT_SCRIPT } = await freshModule()
    expect(() => new Function(LANGUAGE_INIT_SCRIPT)()).not.toThrow()
    expect(page.root.lang).toBe('es')
  })
})

describe('loading the translations', () => {
  it('is ready at once in English', async () => {
    fakePage({ languages: ['en-US'] })
    const i18n = await freshModule()
    await i18n.loadInitialMessages()
    expect(i18n.initialMessagesReady()).toBe(true)
    expect(i18n.currentLocale()).toBe('en')
  })

  it('applies Spanish, sets the title and loads each namespace on demand', async () => {
    const page = fakePage({ languages: ['es-MX'] })
    page.root.lang = 'es'
    const i18n = await freshModule()
    await i18n.loadInitialMessages()
    expect(i18n.currentLocale()).toBe('es')
    const app = (await import('@/messages/app')).default
    expect(app.settings).toBe('Configuración')
    expect(document.title).toBe('Solara: planifica según el UV')
    const settings = (await import('@/messages/settings')).default
    const setup = (await import('@/messages/setup')).default
    await i18n.loadMessages(['settings'])
    expect(settings.language).toBe('Idioma')
    // Only the namespaces asked for.
    expect(setup.go).toBe('Go')
    expect((await i18n.withMessages(['setup'], async () => setup)).go).toBe('Ir')
  })

  it('keeps every namespace in English when the opening screen cannot load', async () => {
    const page = fakePage({ languages: ['es-MX'] })
    page.root.lang = 'es'
    vi.doMock('@/messages/es/initial', () => {
      throw new Error('offline')
    })
    const i18n = await freshModule()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await i18n.loadInitialMessages()
    await i18n.loadMessages(['settings'])
    expect(i18n.currentLocale()).toBe('en')
    expect((await import('@/messages/settings')).default.language).toBe('Language')
    vi.doUnmock('@/messages/es/initial')
  })

  it("fetches a rarely opened part's words only when it opens", async () => {
    const page = fakePage({ languages: ['es-MX'] })
    page.root.lang = 'es'
    const i18n = await freshModule()
    await i18n.loadInitialMessages()
    await i18n.loadMessages(['settings', 'editor'])
    const keywords = (await import('@/messages/icon-search')).default
    expect(keywords['🏊']).toBe('swim swimming pool')
    await i18n.loadMessages(['iconSearch'])
    expect(keywords['🏊']).toBe('nadar natación alberca piscina')
  })

  it('needs nothing on demand in English', async () => {
    fakePage({ languages: ['en-US'] })
    const i18n = await freshModule()
    await i18n.loadInitialMessages()
    await i18n.loadMessages(['iconSearch'])
    const keywords = (await import('@/messages/icon-search')).default
    expect(keywords['🏊']).toBe('swim swimming pool')
  })
})

describe('followLanguagePreference', () => {
  it('reloads in a language chosen in Settings and remembers it', async () => {
    const page = fakePage({ languages: ['en-US'] })
    const i18n = await freshModule()
    await i18n.loadInitialMessages()
    expect(i18n.followLanguagePreference('es')).toBe(true)
    expect(page.store.get('solara_language')).toBe('es')
    expect(page.reload).toHaveBeenCalledOnce()
  })

  it('does nothing when the preference is the page language', async () => {
    const page = fakePage({ languages: ['en-US'] })
    const i18n = await freshModule()
    await i18n.loadInitialMessages()
    expect(i18n.followLanguagePreference(undefined)).toBe(false)
    expect(i18n.followLanguagePreference('auto')).toBe(false)
    expect(i18n.followLanguagePreference('en')).toBe(false)
    expect(page.reload).not.toHaveBeenCalled()
  })

  it('goes back to the device language for "auto"', async () => {
    const page = fakePage({ languages: ['es-MX'], stored: 'en' })
    const i18n = await freshModule()
    await i18n.loadInitialMessages()
    expect(i18n.currentLocale()).toBe('en')
    expect(i18n.followLanguagePreference('auto')).toBe(true)
    expect(page.store.has('solara_language')).toBe(false)
  })

  it('never reloads when this browser cannot keep the choice', async () => {
    const page = fakePage({ languages: ['en-US'], storage: false })
    const i18n = await freshModule()
    await i18n.loadInitialMessages()
    expect(i18n.followLanguagePreference('es')).toBe(false)
    expect(page.reload).not.toHaveBeenCalled()
  })
})
