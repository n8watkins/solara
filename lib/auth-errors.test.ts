import { describe, expect, it } from 'vitest'
import { isSignInCancelled } from '@/lib/auth-errors'

describe('isSignInCancelled', () => {
  it.each(['auth/popup-closed-by-user', 'auth/cancelled-popup-request'])(
    'treats %s as cancelled',
    code => {
      expect(isSignInCancelled(Object.assign(new Error('x'), { code }))).toBe(true)
    },
  )

  it.each([
    ['a blocked popup', { code: 'auth/popup-blocked' }],
    ['a network failure', { code: 'auth/network-request-failed' }],
    ['an error without a code', new Error('boom')],
    ['a non-error', 'auth/popup-closed-by-user'],
    ['null', null],
  ])('reports %s as a real failure', (_, error) => {
    expect(isSignInCancelled(error)).toBe(false)
  })
})
