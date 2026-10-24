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
