import { PRO_TRIAL_DAYS } from '@solara/core'
import { describe, expect, it } from 'vitest'
import { FAMILY_PROFILES_LABEL, PRO_FEATURES, PRO_PLAN } from './plans'

describe('PRO_PLAN', () => {
  it('prices Pro monthly or yearly with a 7-day free trial', () => {
    expect(PRO_PLAN).toMatchObject({ monthly: '$2.99', yearly: '$19.99', trialDays: 7 })
  })

  it('shows the trial checkout gives', () => {
    // functions/src/billing/checkout.ts grants PRO_TRIAL_DAYS; lib/plans.ts stays free of
    // @solara/core for the landing page, so the two are held equal here.
    expect(PRO_PLAN.trialDays).toBe(PRO_TRIAL_DAYS)
  })

  it('works out the yearly saving from the two prices', () => {
    // $19.99 against 12 x $2.99 = $35.88.
    expect(PRO_PLAN.yearlySavingPercent).toBe(44)
  })
})

describe('PRO_FEATURES', () => {
  const row = (label: string) => PRO_FEATURES.find(feature => feature.label === label)

  it('follows the tier rules for each plan', () => {
    expect(row('Forecast')).toMatchObject({
      guest: 'Today',
      free: 'Today and tomorrow',
      pro: '10 days',
    })
    expect(row('Activities')).toMatchObject({ guest: '1', free: '3', pro: '20' })
    expect(row('Your plan')).toMatchObject({
      guest: 'This device',
      free: 'Synced',
      pro: 'Synced',
    })
  })

  it('keeps calendar sync on Free for now, and family profiles and alerts for Pro', () => {
    expect(row('Calendar sync')).toMatchObject({ guest: false, free: true, pro: true })
    for (const label of [FAMILY_PROFILES_LABEL, 'Morning alerts']) {
      expect(row(label)).toMatchObject({ guest: false, free: false })
      expect(row(label)?.pro).toBeTruthy()
    }
    // Family profiles come with planning by the most sensitive person, and say so.
    expect(FAMILY_PROFILES_LABEL).toMatch(/most sensitive/)
    // Alerts relaunch with Pro (D6), so they are listed as coming soon.
    expect(row('Morning alerts')?.pro).toBe('Coming soon')
  })
})
