import { afterEach, describe, expect, it, vi } from 'vitest'
import { LANDING_REDIRECT_SCRIPT } from './app-routes'
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
function page(referrer: string, search: string, storage = memoryStorage()) {
  vi.stubGlobal('window', {})
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
  it('knows a Trusted Web Activity by its referrer or start URL', () => {
    expect(openedFromStoreApp('android-app://dev.n8builds.solara/', '')).toBe(true)
    expect(openedFromStoreApp('', '?source=twa')).toBe(true)
    expect(openedFromStoreApp('', '?signin&source=twa')).toBe(true)
  })

  it('leaves the web alone', () => {
    expect(openedFromStoreApp('', '')).toBe(false)
    expect(openedFromStoreApp('https://www.google.com/', '?source=web')).toBe(false)
    expect(openedFromStoreApp('https://solara-uv.web.app/android-app://', '')).toBe(false)
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
  function runLanding(referrer: string, search: string, storage = memoryStorage()) {
    const replace = vi.fn()
    const run = new Function(
      'document',
      'location',
      'localStorage',
      'sessionStorage',
      LANDING_REDIRECT_SCRIPT,
    )
    run({ referrer }, { search, hash: '', replace }, memoryStorage(), storage)
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

  it('stays for a web visitor', () => {
    expect(runLanding('https://www.google.com/', '').replace).not.toHaveBeenCalled()
  })
})
