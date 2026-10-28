import { describe, expect, it } from 'vitest'
import { accountInitial, headerUV } from './header-display'

describe('accountInitial', () => {
  it('uses the display name, then the email, then a question mark', () => {
    expect(accountInitial({ displayName: 'ada Lovelace', email: 'x@example.com' })).toBe('A')
    expect(accountInitial({ displayName: null, email: 'grace@example.com' })).toBe('G')
    expect(accountInitial({ displayName: null, email: null })).toBe('?')
  })

  it('ignores leading spaces', () => {
    expect(accountInitial({ displayName: '  zoe', email: null })).toBe('Z')
  })
})

describe('headerUV', () => {
  it('hides the chip when the UV is unknown', () => {
    expect(headerUV(undefined)).toBeNull()
    expect(headerUV(null)).toBeNull()
    expect(headerUV(Number.NaN)).toBeNull()
  })

  it('shows one decimal with the band and label, edges in the lower band', () => {
    expect(headerUV(0)).toEqual({ band: 'none', value: '0.0', level: 'Low' })
    expect(headerUV(2)).toEqual({ band: 'low', value: '2.0', level: 'Low' })
    expect(headerUV(4.5)).toEqual({ band: 'moderate', value: '4.5', level: 'Moderate' })
    expect(headerUV(7)).toMatchObject({ band: 'high' })
    expect(headerUV(10)).toMatchObject({ band: 'very-high' })
    expect(headerUV(11.2)).toMatchObject({ band: 'extreme', value: '11.2' })
  })
})
