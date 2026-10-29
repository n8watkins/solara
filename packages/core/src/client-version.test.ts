import { describe, expect, it } from 'vitest'
import { clientVersionHeader, parseClientVersion } from './client-version'

describe('the client version header', () => {
  it('names a platform and a build', () => {
    expect(clientVersionHeader('web', '1a2b3c4d5e6f')).toBe('web/1a2b3c4d5e6f')
    expect(clientVersionHeader('android', '1.4.0+12')).toBe('android/1.4.0+12')
    expect(parseClientVersion('android/1.4.0+12')).toEqual({
      platform: 'android',
      version: '1.4.0+12',
    })
  })

  it('refuses anything else, so a log never carries arbitrary text', () => {
    expect(clientVersionHeader('web', '')).toBeNull()
    expect(clientVersionHeader('web', 'a b')).toBeNull()
    expect(clientVersionHeader('web', 'x'.repeat(41))).toBeNull()
    for (const value of [
      undefined,
      '',
      'web',
      'web/',
      'desktop/1.0',
      'web/1\nforged',
      42,
      ['web/1'],
    ]) {
      expect(parseClientVersion(value)).toBeNull()
    }
  })
})
