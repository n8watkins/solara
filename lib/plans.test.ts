import { PRO_TRIAL_DAYS } from '@solara/core'
import { describe, expect, it, vi } from 'vitest'
import { calendarFeatureLabel, FAMILY_PROFILES_LABEL, PRO_FEATURES, PRO_PLAN } from './plans'

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

  it('names calendar sync only when something syncs (REVIEW8 QA L7)', () => {
    // This build has neither Google Calendar nor the feed: downloads only.
    expect(calendarFeatureLabel()).toBe('Calendar export')
    expect(calendarFeatureLabel({})).toBe('Calendar export')
    expect(calendarFeatureLabel({ googleClientId: 'id.apps.googleusercontent.com' })).toBe(
      'Calendar sync',
    )
    expect(calendarFeatureLabel({ functionsUrl: 'https://fn.example', appCheck: 'key' })).toBe(
      'Calendar sync',
    )
    expect(calendarFeatureLabel({ functionsUrl: 'https://fn.example', emulators: '1' })).toBe(
      'Calendar sync',
    )
    // Functions without App Check cannot serve the feed.
    expect(calendarFeatureLabel({ functionsUrl: 'https://fn.example' })).toBe('Calendar export')
  })

  it('keeps the calendar feature on Free for now, and family profiles and alerts for Pro', () => {
    expect(row('Calendar export')).toMatchObject({ guest: false, free: true, pro: true })
    expect(row('UV at your events (.ics)')).toMatchObject({ guest: false, free: true, pro: true })
    for (const label of [FAMILY_PROFILES_LABEL, 'Morning and UV alerts']) {
      expect(row(label)).toMatchObject({ guest: false, free: false })
      expect(row(label)?.pro).toBeTruthy()
    }
    // Family profiles come with planning by the most sensitive person, and say so.
    expect(FAMILY_PROFILES_LABEL).toMatch(/most sensitive/)
    // Alerts relaunch with Pro (D6), so they are listed as coming soon until switched on.
    expect(row('Morning and UV alerts')?.pro).toBe('Coming soon')
  })

  it('lets only a UI harness build switch the alerts on per screen', async () => {
    vi.stubGlobal('window', { location: { search: '?screen=settings&alerts=on' } })
    try {
      vi.resetModules()
      expect((await import('./plans')).alertsLaunched()).toBe(false)
      vi.stubEnv('NEXT_PUBLIC_UI_HARNESS', '1')
      vi.resetModules()
      expect((await import('./plans')).alertsLaunched()).toBe(true)
    } finally {
      vi.unstubAllEnvs()
      vi.unstubAllGlobals()
    }
  })

  it('lists the alerts as included once they are switched on', async () => {
    vi.stubEnv('NEXT_PUBLIC_ALERTS_ENABLED', '1')
    try {
      vi.resetModules()
      const fresh = await import('./plans')
      expect(fresh.alertsLaunched()).toBe(true)
      expect(fresh.PRO_FEATURES.find(f => f.label === 'Morning and UV alerts')?.pro).toBe(true)
    } finally {
      vi.unstubAllEnvs()
    }
  })
})

describe('googleCalendarEventsLaunched', () => {
  async function launched(env: Record<string, string>, search = '') {
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value)
    vi.stubGlobal('window', { location: { search } })
    try {
      vi.resetModules()
      return (await import('./plans')).googleCalendarEventsLaunched()
    } finally {
      vi.unstubAllEnvs()
      vi.unstubAllGlobals()
    }
  }

  it('needs both the switch and the OAuth client ID', async () => {
    expect(await launched({})).toBe(false)
    expect(await launched({ NEXT_PUBLIC_GOOGLE_CALENDAR_EVENTS_ENABLED: '1' })).toBe(false)
    expect(await launched({ NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID: 'id' })).toBe(false)
    expect(
      await launched({
        NEXT_PUBLIC_GOOGLE_CALENDAR_EVENTS_ENABLED: '1',
        NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID: 'id',
      }),
    ).toBe(true)
  })

  it('opens per screen with ?gcal=on only in a harness build', async () => {
    expect(await launched({}, '?gcal=on')).toBe(false)
    expect(await launched({ NEXT_PUBLIC_UI_HARNESS: '1' }, '?gcal=on')).toBe(true)
  })
})

describe('outlookCalendarEventsLaunched', () => {
  async function launched(env: Record<string, string>, search = '') {
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value)
    vi.stubGlobal('window', { location: { search } })
    try {
      vi.resetModules()
      return (await import('./plans')).outlookCalendarEventsLaunched()
    } finally {
      vi.unstubAllEnvs()
      vi.unstubAllGlobals()
    }
  }

  it('needs both the switch and the Microsoft client ID', async () => {
    const id = '6731de76-14a6-49ae-97bc-6eba6914391e'
    expect(await launched({})).toBe(false)
    expect(await launched({ NEXT_PUBLIC_OUTLOOK_CALENDAR_EVENTS_ENABLED: '1' })).toBe(false)
    expect(await launched({ NEXT_PUBLIC_MICROSOFT_CLIENT_ID: id })).toBe(false)
    expect(
      await launched({
        NEXT_PUBLIC_OUTLOOK_CALENDAR_EVENTS_ENABLED: '1',
        NEXT_PUBLIC_MICROSOFT_CLIENT_ID: id,
      }),
    ).toBe(true)
  })

  it('opts in per screen only in a UI harness build', async () => {
    expect(await launched({}, '?outlook=on')).toBe(false)
    expect(await launched({ NEXT_PUBLIC_UI_HARNESS: '1' }, '?outlook=on')).toBe(true)
    expect(await launched({ NEXT_PUBLIC_UI_HARNESS: '1' }, '?gcal=on')).toBe(false)
  })
})

describe('eventHeadsUpsLaunched (REVIEW6 L1)', () => {
  async function launched(search: string) {
    vi.stubEnv('NEXT_PUBLIC_UI_HARNESS', '1')
    vi.stubGlobal('window', { location: { search } })
    try {
      vi.resetModules()
      return (await import('./plans')).eventHeadsUpsLaunched()
    } finally {
      vi.unstubAllEnvs()
      vi.unstubAllGlobals()
    }
  }

  it('offers heads-ups with the alerts on and either outside source of events', async () => {
    expect(await launched('?alerts=on')).toBe(false)
    expect(await launched('?subscriptions=on&gcal=on')).toBe(false)
    expect(await launched('?alerts=on&subscriptions=on')).toBe(true)
    expect(await launched('?alerts=on&gcal=on')).toBe(true)
    expect(await launched('?outlook=on')).toBe(false)
    expect(await launched('?alerts=on&outlook=on')).toBe(true)
  })
})
