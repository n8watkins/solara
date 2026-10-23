// Theme preference: 'system' follows the OS setting and is the default; 'light'
// and 'dark' are explicit overrides. The effective theme is applied as the `dark`
// class on <html> (the class the tokens in globals.css and Tailwind key off).
//
// The same logic runs twice: once as THEME_INIT_SCRIPT, a blocking inline script
// in <head> so the first paint already has the right theme (no flash), and again
// from React for changes after load. Keep the two in sync; theme.test.ts checks
// that the script behaves like resolveTheme().

export type ThemePreference = 'system' | 'light' | 'dark'
export type Theme = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'solara_theme'
export const THEME_CHANGE_EVENT = 'solara-theme-change'
const DARK_QUERY = '(prefers-color-scheme: dark)'

export const THEME_PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark']

function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark'
}

export function getThemePreference(): ThemePreference {
  if (typeof window === 'undefined') return 'system'
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
    return isThemePreference(stored) ? stored : 'system'
  } catch {
    return 'system'
  }
}

export function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia(DARK_QUERY).matches
}

export function resolveTheme(preference: ThemePreference, prefersDark: boolean): Theme {
  if (preference === 'system') return prefersDark ? 'dark' : 'light'
  return preference
}

/** The theme currently in effect for this browser. */
export function getStoredTheme(): Theme {
  return resolveTheme(getThemePreference(), systemPrefersDark())
}

function applyResolvedTheme(theme: Theme) {
  const root = document.documentElement
  root.classList.toggle('dark', theme === 'dark')
  root.style.colorScheme = theme
}

/** Re-applies the stored preference, for example after the OS theme changes. */
export function syncTheme(): Theme {
  const theme = getStoredTheme()
  if (typeof window !== 'undefined') applyResolvedTheme(theme)
  return theme
}

export function setThemePreference(preference: ThemePreference): Theme {
  if (typeof window === 'undefined') return resolveTheme(preference, false)
  try {
    if (preference === 'system') window.localStorage.removeItem(THEME_STORAGE_KEY)
    else window.localStorage.setItem(THEME_STORAGE_KEY, preference)
  } catch {
    // Storage can be unavailable (private mode, blocked site data); the choice
    // still applies for this page view.
  }
  const theme = resolveTheme(preference, systemPrefersDark())
  applyResolvedTheme(theme)
  window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, { detail: preference }))
  return theme
}

/** Flips the effective theme and stores it as an explicit preference. */
export function toggleTheme(): Theme {
  const current = document.documentElement.classList.contains('dark') ? 'dark' : 'light'
  return setThemePreference(current === 'dark' ? 'light' : 'dark')
}

/**
 * Calls `onChange` whenever the effective theme may have changed: the OS theme
 * flips, another tab changes the preference, or this tab calls
 * setThemePreference(). Returns an unsubscribe function.
 */
export function subscribeToTheme(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const media = typeof window.matchMedia === 'function' ? window.matchMedia(DARK_QUERY) : null
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === THEME_STORAGE_KEY) onChange()
  }
  media?.addEventListener('change', onChange)
  window.addEventListener('storage', onStorage)
  window.addEventListener(THEME_CHANGE_EVENT, onChange)
  return () => {
    media?.removeEventListener('change', onChange)
    window.removeEventListener('storage', onStorage)
    window.removeEventListener(THEME_CHANGE_EVENT, onChange)
  }
}

// Runs before first paint. Plain ES5 with no dependencies, wrapped in try/catch
// so a storage error can never block rendering.
export const THEME_INIT_SCRIPT = `(function(){try{var p=null;try{p=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)})}catch(e){}var d=p==='dark'||(p!=='light'&&window.matchMedia&&window.matchMedia(${JSON.stringify(
  DARK_QUERY,
)}).matches);var r=document.documentElement;if(d)r.classList.add('dark');else r.classList.remove('dark');r.style.colorScheme=d?'dark':'light'}catch(e){}})()`
