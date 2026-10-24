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

const ALL: AppScreen[] = ['loading', 'welcome', 'onboarding', 'dashboard']

function table(transition: (prev: AppScreen) => AppScreen) {
  return Object.fromEntries(ALL.map(prev => [prev, transition(prev)]))
}

describe('account screen transitions', () => {
  it('signing out shows welcome but never interrupts setup', () => {
    expect(table(screenWhenSignedOut)).toEqual({
      loading: 'welcome',
      welcome: 'welcome',
      onboarding: 'onboarding',
      dashboard: 'welcome',
    })
  })

  it('an account without saved data keeps setup or a finished dashboard on screen', () => {
    expect(table(screenWhenNeedsOnboarding)).toEqual({
      loading: 'welcome',
      welcome: 'welcome',
      onboarding: 'onboarding',
      dashboard: 'dashboard',
    })
  })

  it('finishing setup loads the saved account unless the dashboard already shows it', () => {
    expect(table(screenAfterOnboarding)).toEqual({
      loading: 'loading',
      welcome: 'loading',
      onboarding: 'loading',
      dashboard: 'dashboard',
    })
  })

  it('says whether loading or creating the account failed', () => {
    expect(accountErrorMessage('load')).toBe(ACCOUNT_LOAD_ERROR)
    expect(accountErrorMessage('create')).toBe(ACCOUNT_CREATE_ERROR)
  })
})
