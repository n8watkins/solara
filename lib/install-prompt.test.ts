import { afterEach, describe, expect, it, vi } from 'vitest'
import { installPromptKind, pushNeedsHomeScreen, type InstallEnvironment } from './install-prompt'

const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
const IPHONE_CHROME =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1'
const MAC_SAFARI =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'
const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36'

function env(overrides: Partial<InstallEnvironment>): InstallEnvironment {
  return {
    standalone: false,
    dismissed: false,
    userAgent: ANDROID_CHROME,
    platform: 'Linux armv8l',
    maxTouchPoints: 5,
    ...overrides,
  }
}

describe('pushNeedsHomeScreen', () => {
  it('asks iPhone and iPad visitors to add Solara to the Home Screen first', () => {
    expect(pushNeedsHomeScreen(env({ userAgent: IPHONE_SAFARI, platform: 'iPhone' }))).toBe(true)
    // Every iOS browser shares Safari's engine and its push rules.
    expect(pushNeedsHomeScreen(env({ userAgent: IPHONE_CHROME, platform: 'iPhone' }))).toBe(true)
    // iPadOS reports a Mac with a touch screen.
    expect(pushNeedsHomeScreen(env({ userAgent: MAC_SAFARI, platform: 'MacIntel' }))).toBe(true)
  })

  it('is satisfied once Solara runs from the Home Screen, and elsewhere', () => {
    expect(
      pushNeedsHomeScreen(env({ userAgent: IPHONE_SAFARI, platform: 'iPhone', standalone: true })),
    ).toBe(false)
    expect(pushNeedsHomeScreen(env({}))).toBe(false)
    expect(
      pushNeedsHomeScreen(env({ userAgent: MAC_SAFARI, platform: 'MacIntel', maxTouchPoints: 0 })),
    ).toBe(false)
  })
})

describe('installPromptKind', () => {
  it('never prompts an installed app or after a dismissal', () => {
    expect(installPromptKind(env({ standalone: true }))).toBeNull()
    expect(installPromptKind(env({ dismissed: true }))).toBeNull()
    expect(installPromptKind(env({ userAgent: IPHONE_SAFARI, dismissed: true }))).toBeNull()
  })

  it('shows manual instructions in iOS Safari, including iPadOS posing as a Mac', () => {
    expect(installPromptKind(env({ userAgent: IPHONE_SAFARI, platform: 'iPhone' }))).toBe('ios')
    expect(installPromptKind(env({ userAgent: MAC_SAFARI, platform: 'MacIntel' }))).toBe('ios')
  })

  it('skips other iOS browsers, which cannot add to the Home Screen', () => {
    expect(installPromptKind(env({ userAgent: IPHONE_CHROME, platform: 'iPhone' }))).toBeNull()
  })

  it('waits for the install event everywhere else, including a desktop Mac', () => {
    expect(installPromptKind(env({}))).toBe('chromium')
    expect(
      installPromptKind(env({ userAgent: MAC_SAFARI, platform: 'MacIntel', maxTouchPoints: 0 })),
    ).toBe('chromium')
  })
})

describe('watchInstallPrompt', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  async function watchIn({ dismissed = false } = {}) {
    vi.resetModules()
    const target = new EventTarget()
    const navigator = { userAgent: 'Chrome', platform: 'Linux', maxTouchPoints: 0 }
    vi.stubGlobal(
      'window',
      Object.assign(target, { matchMedia: () => ({ matches: false }), navigator }),
    )
    vi.stubGlobal('navigator', navigator)
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => (dismissed && key === 'solara_install_dismissed' ? '1' : null),
    })
    const prompt = await import('./install-prompt')
    prompt.watchInstallPrompt()
    return { target, prompt }
  }

  it('keeps the install event from start-up until it is used or the app is installed', async () => {
    const { target, prompt } = await watchIn()
    const listener = vi.fn()
    prompt.onInstallPromptChange(listener)
    const event = new Event('beforeinstallprompt', { cancelable: true })
    target.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(prompt.pendingInstallPrompt()).toBe(event)
    expect(listener).toHaveBeenCalledTimes(1)
    target.dispatchEvent(new Event('appinstalled'))
    expect(prompt.pendingInstallPrompt()).toBeNull()
  })

  it('leaves the browser its own install UI after a dismissal', async () => {
    const { target, prompt } = await watchIn({ dismissed: true })
    const event = new Event('beforeinstallprompt', { cancelable: true })
    target.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    expect(prompt.pendingInstallPrompt()).toBeNull()
  })
})
