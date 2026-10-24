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

  it('shows one decimal with the band icon and label, edges in the lower band', () => {
    expect(headerUV(0)).toEqual({ icon: '⚪', value: '0.0', level: 'None' })
    expect(headerUV(2)).toEqual({ icon: '🟢', value: '2.0', level: 'Low' })
    expect(headerUV(4.5)).toEqual({ icon: '🟡', value: '4.5', level: 'Moderate' })
    expect(headerUV(7)).toMatchObject({ icon: '🟠' })
    expect(headerUV(10)).toMatchObject({ icon: '🔴' })
    expect(headerUV(11.2)).toMatchObject({ icon: '🟣', value: '11.2' })
  })
})
