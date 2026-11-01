import { afterEach, describe, expect, it, vi } from 'vitest'
import { LANDING_REDIRECT_SCRIPT } from './landing-redirect'
import {
  STORE_SESSION_KEY,
  isStoreBuild,
  openedFromStoreApp,
  resetStoreBuildForTests,
} from './store-build'

function memoryStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial))
  return {
    store,
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  }
}

/** A page opened with this referrer and query, with this session storage. */
function page(referrer: string, search: string, storage = memoryStorage(), appWindow = true) {
  vi.stubGlobal('window', { matchMedia: () => ({ matches: appWindow }) })
  vi.stubGlobal('document', { referrer })
  vi.stubGlobal('location', { search })
  vi.stubGlobal('sessionStorage', storage)
  resetStoreBuildForTests()
  return storage
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  resetStoreBuildForTests()
})

describe('openedFromStoreApp', () => {
  it('knows a Trusted Web Activity by its referrer, or its start URL in an app window', () => {
    expect(openedFromStoreApp('android-app://dev.n8builds.solara/', '', false)).toBe(true)
    expect(openedFromStoreApp('', '?source=twa', true)).toBe(true)
    expect(openedFromStoreApp('', '?signin&source=twa', true)).toBe(true)
  })

  it('leaves the web alone, even for a link with ?source=twa in a browser tab (REVIEW9 SEC9 L8)', () => {
    expect(openedFromStoreApp('', '', true)).toBe(false)
    expect(openedFromStoreApp('https://www.google.com/', '?source=web', true)).toBe(false)
    expect(openedFromStoreApp('https://solara-uv.web.app/android-app://', '', true)).toBe(false)
    expect(openedFromStoreApp('', '?source=twa', false)).toBe(false)
    expect(openedFromStoreApp('https://mail.example/', '?source=twa', false)).toBe(false)
  })
})

describe('isStoreBuild', () => {
  it('is off on the web and outside a browser', () => {
    expect(isStoreBuild()).toBe(false)
    page('https://www.google.com/', '')
    expect(isStoreBuild()).toBe(false)
  })

  it('is on for the store build variable', () => {
    vi.stubEnv('NEXT_PUBLIC_STORE_BUILD', '1')
    expect(isStoreBuild()).toBe(true)
  })

  it('turns on for a session an Android app opened, and remembers it', () => {
    const storage = page('android-app://dev.n8builds.solara/', '')
    expect(isStoreBuild()).toBe(true)
    expect(storage.store.get(STORE_SESSION_KEY)).toBe('1')
    // A later page of the session: its referrer is the site itself.
    page('https://solara-uv.web.app/app/', '', storage)
    expect(isStoreBuild()).toBe(true)
  })

  it('stays off in a browser tab opened from a ?source=twa link, and remembers nothing', () => {
    const storage = page('https://mail.example/', '?source=twa', memoryStorage(), false)
    expect(isStoreBuild()).toBe(false)
    expect(storage.store.has(STORE_SESSION_KEY)).toBe(false)
  })

  it('still works for the page itself when session storage is off', () => {
    page('', '?source=twa', {
      ...memoryStorage(),
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
    })
    expect(isStoreBuild()).toBe(true)
  })
})

describe('the landing page in a store session', () => {
  function runLanding(
    referrer: string,
    search: string,
    storage = memoryStorage(),
    appWindow = true,
  ) {
    const replace = vi.fn()
    const run = new Function(
      'document',
      'location',
      'localStorage',
      'sessionStorage',
      'matchMedia',
      LANDING_REDIRECT_SCRIPT,
    )
    run({ referrer }, { search, hash: '', replace }, memoryStorage(), storage, () => ({
      matches: appWindow,
    }))
    return { replace, storage }
  }

  it('goes to the app instead of showing prices', () => {
    expect(runLanding('android-app://dev.n8builds.solara/', '').replace).toHaveBeenCalledWith(
      '/app/',
    )
    expect(runLanding('', '?source=twa').replace).toHaveBeenCalledWith('/app/?source=twa')
    const storage = memoryStorage({ [STORE_SESSION_KEY]: '1' })
    expect(runLanding('https://solara-uv.web.app/app/', '', storage).replace).toHaveBeenCalled()
  })

  it('stays for a web visitor, also one sent a ?source=twa link', () => {
    expect(runLanding('https://www.google.com/', '').replace).not.toHaveBeenCalled()
    const link = runLanding('https://mail.example/', '?source=twa', memoryStorage(), false)
    expect(link.replace).not.toHaveBeenCalled()
    expect(link.storage.store.has(STORE_SESSION_KEY)).toBe(false)
  })
})
