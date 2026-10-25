// Which "add to home screen" prompt a browser gets (components/InstallPrompt.tsx).

export const INSTALL_DISMISS_KEY = 'solara_install_dismissed'

export interface InstallEnvironment {
  /** Running as an installed app (display-mode: standalone, or iOS navigator.standalone). */
  standalone: boolean
  /** The visitor dismissed the prompt before. */
  dismissed: boolean
  userAgent: string
  platform: string
  maxTouchPoints: number
}

/**
 * - `null`: never prompt (installed already, dismissed, or the browser cannot install).
 * - `'ios'`: iOS Safari, which cannot install from script; show the Share, then Add
 *   to Home Screen instructions.
 * - `'chromium'`: wait for `beforeinstallprompt`, then offer a one-tap Install button.
 */
export function installPromptKind(env: InstallEnvironment): 'ios' | 'chromium' | null {
  if (env.standalone || env.dismissed) return null
  // iPadOS 13+ reports itself as MacIntel with a touch screen.
  const isIOS =
    /iPad|iPhone|iPod/.test(env.userAgent) ||
    (env.platform === 'MacIntel' && env.maxTouchPoints > 1)
  if (!isIOS) return 'chromium'
  // Only Safari can add to the Home Screen; other iOS browsers never get a prompt.
  return /CriOS|FxiOS|EdgiOS|OPiOS|mercury/i.test(env.userAgent) ? null : 'ios'
}

/** Chromium's install event (not in TypeScript's DOM types). */
export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

/** This browser's install environment, read from the page. */
export function installEnvironment(): InstallEnvironment {
  let dismissed = false
  try {
    dismissed = Boolean(localStorage.getItem(INSTALL_DISMISS_KEY))
  } catch {}
  return {
    standalone:
      window.matchMedia?.('(display-mode: standalone)').matches ||
      Boolean((window.navigator as { standalone?: boolean }).standalone),
    dismissed,
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints,
  }
}

let installEvent: BeforeInstallPromptEvent | null = null
const installListeners = new Set<() => void>()
let watching = false

/**
 * Starts listening for Chromium's install events as the app starts, so the event is
 * kept even when it fires before the prompt (components/InstallPrompt.tsx, loaded on
 * demand) is on screen. Does nothing where the prompt never shows.
 */
export function watchInstallPrompt(): void {
  if (watching || typeof window === 'undefined') return
  watching = true
  if (installPromptKind(installEnvironment()) !== 'chromium') return
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault()
    installEvent = event as BeforeInstallPromptEvent
    for (const listener of installListeners) listener()
  })
  window.addEventListener('appinstalled', () => {
    installEvent = null
    for (const listener of installListeners) listener()
  })
}

/** The install event Chromium offered, or null (none yet, used, or installed). */
export function pendingInstallPrompt(): BeforeInstallPromptEvent | null {
  return installEvent
}

/** Forgets the install event once it has been used. */
export function clearInstallPrompt(): void {
  installEvent = null
  for (const listener of installListeners) listener()
}

/** Calls `listener` whenever the install event changes. Returns the unsubscribe. */
export function onInstallPromptChange(listener: () => void): () => void {
  installListeners.add(listener)
  return () => installListeners.delete(listener)
}
