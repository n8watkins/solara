import { describe, expect, it } from 'vitest'
import { installPromptKind, type InstallEnvironment } from './install-prompt'

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
