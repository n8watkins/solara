import { describe, expect, it } from 'vitest'
import {
  ACCOUNT_CREATE_ERROR,
  ACCOUNT_LOAD_ERROR,
  accountErrorMessage,
  screenAfterOnboarding,
  screenWhenNeedsOnboarding,
  screenWhenSignedOut,
  type AppScreen,
} from './account-screen'

const ALL: AppScreen[] = ['loading', 'signin', 'onboarding', 'dashboard']

function table(transition: (prev: AppScreen) => AppScreen) {
  return Object.fromEntries(ALL.map(prev => [prev, transition(prev)]))
}

describe('account screen transitions', () => {
  it('signed out without a guest plan starts setup, never interrupting setup or sign-in', () => {
    expect(
      table(prev => screenWhenSignedOut(prev, { hasGuestPlan: false, signInRequested: false })),
    ).toEqual({
      loading: 'onboarding',
      signin: 'signin',
      onboarding: 'onboarding',
      dashboard: 'onboarding',
    })
  })

  it('signed out with a guest plan opens the guest dashboard', () => {
    expect(
      table(prev => screenWhenSignedOut(prev, { hasGuestPlan: true, signInRequested: false })),
    ).toEqual({
      loading: 'dashboard',
      signin: 'signin',
      onboarding: 'onboarding',
      dashboard: 'dashboard',
    })
  })

  it('coming to sign in shows the sign-in screen first', () => {
    for (const hasGuestPlan of [false, true]) {
      expect(screenWhenSignedOut('loading', { hasGuestPlan, signInRequested: true })).toBe('signin')
    }
  })

  it('an account without saved data goes through setup unless the dashboard is up', () => {
    expect(table(screenWhenNeedsOnboarding)).toEqual({
      loading: 'onboarding',
      signin: 'onboarding',
      onboarding: 'onboarding',
      dashboard: 'dashboard',
    })
  })

  it('finishing sign-in or setup loads the saved account unless the dashboard shows it', () => {
    expect(table(screenAfterOnboarding)).toEqual({
      loading: 'loading',
      signin: 'loading',
      onboarding: 'loading',
      dashboard: 'dashboard',
    })
  })

  it('says whether loading or creating the account failed', () => {
    expect(accountErrorMessage('load')).toBe(ACCOUNT_LOAD_ERROR)
    expect(accountErrorMessage('create')).toBe(ACCOUNT_CREATE_ERROR)
  })
})
