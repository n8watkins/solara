import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DARK_QUERY,
  THEME_INIT_SCRIPT,
  THEME_STORAGE_KEY,
  getStoredTheme,
  getThemePreference,
  resolveTheme,
  setThemePreference,
  subscribeToTheme,
  toggleTheme,
  type ThemePreference,
} from './theme'

// Minimal browser stand-ins: the vitest environment is node.
class FakeClassList {
  private set = new Set<string>()
  add(c: string) {
    this.set.add(c)
  }
  remove(c: string) {
    this.set.delete(c)
  }
  toggle(c: string, force?: boolean) {
    const on = force ?? !this.set.has(c)
    if (on) this.set.add(c)
    else this.set.delete(c)
    return on
  }
  contains(c: string) {
    return this.set.has(c)
  }
}

function installBrowser({ stored, prefersDark }: { stored?: string; prefersDark: boolean }) {
  const store = new Map<string, string>()
  if (stored !== undefined) store.set(THEME_STORAGE_KEY, stored)
  const mediaListeners = new Set<() => void>()
  const media = {
    get matches() {
      return state.prefersDark
    },
    addEventListener: (_: string, fn: () => void) => mediaListeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => mediaListeners.delete(fn),
  }
  const state = { prefersDark }
  const root = { classList: new FakeClassList(), style: { colorScheme: '' } }
  const target = new EventTarget()
  const win = {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
    matchMedia: () => media,
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    dispatchEvent: target.dispatchEvent.bind(target),
  }
  vi.stubGlobal('window', win)
  vi.stubGlobal('localStorage', win.localStorage)
  vi.stubGlobal('document', { documentElement: root })
  return {
    root,
    store,
    setSystemDark(dark: boolean) {
      state.prefersDark = dark
      mediaListeners.forEach(fn => fn())
    },
  }
}

function runInitScript() {
  new Function(THEME_INIT_SCRIPT)()
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('resolveTheme', () => {
  it.each<[ThemePreference, boolean, string]>([
    ['system', false, 'light'],
    ['system', true, 'dark'],
    ['light', true, 'light'],
    ['dark', false, 'dark'],
  ])('%s with system dark=%s resolves to %s', (pref, dark, expected) => {
    expect(resolveTheme(pref, dark)).toBe(expected)
  })
})

describe('theme preference', () => {
  it('defaults to system and follows the OS when nothing is stored', () => {
    installBrowser({ prefersDark: true })
    expect(getThemePreference()).toBe('system')
    expect(getStoredTheme()).toBe('dark')
  })

  it('ignores unknown stored values', () => {
    installBrowser({ stored: 'sepia', prefersDark: false })
    expect(getThemePreference()).toBe('system')
  })

  it('is safe on the server', () => {
    expect(getThemePreference()).toBe('system')
    expect(getStoredTheme()).toBe('light')
  })

  it('stores explicit choices, clears the key for system, and applies the class', () => {
    const browser = installBrowser({ prefersDark: true })
    setThemePreference('light')
    expect(browser.store.get(THEME_STORAGE_KEY)).toBe('light')
    expect(browser.root.classList.contains('dark')).toBe(false)
    expect(browser.root.style.colorScheme).toBe('light')

    setThemePreference('system')
    expect(browser.store.has(THEME_STORAGE_KEY)).toBe(false)
    expect(browser.root.classList.contains('dark')).toBe(true)
  })

  it('toggleTheme flips the effective theme', () => {
    const browser = installBrowser({ prefersDark: false })
    expect(toggleTheme()).toBe('dark')
    expect(browser.root.classList.contains('dark')).toBe(true)
    expect(toggleTheme()).toBe('light')
    expect(browser.store.get(THEME_STORAGE_KEY)).toBe('light')
  })

  it('notifies subscribers on OS changes and on preference changes', () => {
    const browser = installBrowser({ prefersDark: false })
    const onChange = vi.fn()
    const unsubscribe = subscribeToTheme(onChange)
    browser.setSystemDark(true)
    setThemePreference('dark')
    expect(onChange).toHaveBeenCalledTimes(2)
    unsubscribe()
    browser.setSystemDark(false)
    expect(onChange).toHaveBeenCalledTimes(2)
  })
})

describe('THEME_INIT_SCRIPT (blocking head script)', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it.each<[string | undefined, boolean]>([
    [undefined, false],
    [undefined, true],
    ['light', true],
    ['dark', false],
    ['garbage', true],
  ])('stored=%s, system dark=%s matches resolveTheme', (stored, prefersDark) => {
    const browser = installBrowser({ stored, prefersDark })
    runInitScript()
    const expected = getStoredTheme()
    expect(browser.root.classList.contains('dark')).toBe(expected === 'dark')
    expect(browser.root.style.colorScheme).toBe(expected)
  })

  it('reads the same storage key and media query as the React side', () => {
    // The script is a fixed literal; these keep it in step with the constants.
    expect(THEME_INIT_SCRIPT).toContain(
      `localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)})`,
    )
    expect(THEME_INIT_SCRIPT).toContain(`window.matchMedia(${JSON.stringify(DARK_QUERY)})`)
    // Inlined into HTML: nothing in it may end the <script> element early.
    expect(THEME_INIT_SCRIPT).not.toMatch(/<\/|<!--/)
  })

  it('follows an OS theme change while the preference is system (pages without React)', () => {
    const browser = installBrowser({ prefersDark: false })
    runInitScript()
    expect(browser.root.classList.contains('dark')).toBe(false)
    browser.setSystemDark(true)
    expect(browser.root.classList.contains('dark')).toBe(true)
    expect(browser.root.style.colorScheme).toBe('dark')
    browser.setSystemDark(false)
    expect(browser.root.classList.contains('dark')).toBe(false)
  })

  it('keeps an explicit choice when the OS theme changes, and follows other tabs', () => {
    const browser = installBrowser({ stored: 'light', prefersDark: false })
    runInitScript()
    browser.setSystemDark(true)
    expect(browser.root.classList.contains('dark')).toBe(false)
    // Another tab picks dark.
    browser.store.set(THEME_STORAGE_KEY, 'dark')
    window.dispatchEvent(Object.assign(new Event('storage'), { key: THEME_STORAGE_KEY }))
    expect(browser.root.classList.contains('dark')).toBe(true)
  })

  it('never throws when storage is blocked', () => {
    const browser = installBrowser({ prefersDark: true })
    vi.stubGlobal('localStorage', {
      getItem() {
        throw new Error('SecurityError')
      },
    })
    expect(runInitScript).not.toThrow()
    expect(browser.root.classList.contains('dark')).toBe(true)
  })
})
