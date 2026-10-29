import { describe, expect, it } from 'vitest'
import {
  ACCOUNT_EXPORT_FORMAT_VERSION,
  alertHistory,
  buildAccountExport,
  eventHeadsUpHistory,
  exportBillingSummary,
  safeAccountData,
  safeDeviceData,
  toMillis,
  type AccountExportSources,
} from './account-export'
import { parseFunctionResponse } from './functions-api'

const KEY = 'a'.repeat(32)

const event = {
  key: KEY,
  source: 'file',
  seriesId: KEY,
  title: 'Saturday 10K',
  start: '2026-11-20T15:00:00.000Z',
  end: '2026-11-20T16:30:00.000Z',
  timeZone: 'America/Los_Angeles',
  where: 'Griffith Park',
  lat: 34.14,
  lon: -118.29,
  placeLabel: 'Los Angeles, California',
  placeGuessed: false,
  activityId: 'run',
  url: '',
  createdAt: '2026-10-28T17:30:00.000Z',
  updatedAt: '2026-10-28T17:30:00.000Z',
  expireAt: { toMillis: () => Date.parse('2026-12-20T16:30:00.000Z') },
}

const scheduled = {
  eventId: 'evt1',
  calendarId: 'primary',
  activityId: 'run',
  title: 'Running',
  icon: '🏃',
  start: '2026-11-16T01:00:00.000Z',
  end: '2026-11-16T01:45:00.000Z',
  timeZone: 'America/Los_Angeles',
  htmlLink: 'https://www.google.com/calendar/event?eid=evt1',
  createdAt: '2026-10-28T17:30:00.000Z',
  updatedAt: '2026-10-28T17:30:00.000Z',
}

const empty: AccountExportSources = {
  account: null,
  alerts: null,
  eventAlerts: null,
  links: null,
  google: null,
  outlook: null,
  devices: [],
  scheduled: [],
  events: [],
  truncated: [],
}

describe('account export', () => {
  it('keeps only the preference fields of the account', () => {
    expect(
      safeAccountData({
        uid: 'u1',
        tier: 'free',
        skinType: 'fair',
        stripeCustomerId: 'cus_secret',
        calendarFeedToken: 'secret',
        fcmToken: 'secret',
      }),
    ).toEqual({ uid: 'u1', tier: 'free', skinType: 'fair' })
    expect(safeAccountData(null)).toEqual({})
  })

  it('reads timestamps from either Firestore SDK or a Date', () => {
    expect(toMillis(new Date(5))).toBe(5)
    expect(toMillis({ toMillis: () => 7 })).toBe(7)
    expect(toMillis('2026-01-01')).toBeNaN()
    expect(toMillis(null)).toBeNaN()
  })

  it('summarises billing without Stripe identifiers', () => {
    expect(exportBillingSummary(null)).toEqual({
      plan: 'free',
      provider: 'stripe',
      interval: null,
      status: null,
      proSince: null,
      trialEndsAt: null,
      currentPeriodEndsAt: null,
      cancelsAtPeriodEnd: false,
      paymentFailedSince: null,
      freeTrialUsed: false,
    })
    const paid = exportBillingSummary({
      tier: 'paid',
      subscriptionPlan: 'yearly',
      subscriptionStatus: 'active',
      proSince: new Date('2026-01-02T00:00:00.000Z'),
      stripeCustomerId: 'cus_secret',
    })
    expect(paid).toMatchObject({
      plan: 'pro',
      provider: 'stripe',
      interval: 'yearly',
      status: 'active',
    })
    // A store this build does not know is named as unknown, never as Stripe.
    expect(exportBillingSummary({ subscriptionProvider: 'app-store' }).provider).toBeNull()
    expect(paid.proSince).toBe('2026-01-02T00:00:00.000Z')
    expect(JSON.stringify(paid)).not.toContain('cus_')
  })

  it('drops push tokens, invalid records and records stored under another key', () => {
    expect(safeDeviceData([{ id: 'd1', data: { enabled: true, token: 'secret' } }])).toEqual([
      {
        id: 'd1',
        enabled: true,
        platform: 'unknown',
        createdAt: null,
        updatedAt: null,
        lastDeliveredAt: null,
        lastError: null,
      },
    ])
    const built = buildAccountExport(
      {
        ...empty,
        scheduled: [
          { id: 'evt1', data: scheduled },
          { id: 'other', data: scheduled },
          { id: 'bad', data: { eventId: 'bad' } },
        ],
        events: [
          { id: KEY, data: event },
          { id: 'b'.repeat(32), data: event },
        ],
      },
      new Date(0),
    )
    expect(built.scheduledActivities.map(item => item.eventId)).toEqual(['evt1'])
    expect(built.importedEvents.map(item => item.key)).toEqual([KEY])
  })

  it('reads the alert history and skips anything malformed', () => {
    expect(
      alertHistory({
        morning: { day: '2026-10-28', status: 'sent', devices: 2, attemptId: 'internal' },
        uv: 'junk',
      }),
    ).toEqual([
      {
        kind: 'morning',
        day: '2026-10-28',
        status: 'sent',
        attempts: null,
        devicesReached: 2,
        sentAt: null,
        finishedAt: null,
        error: null,
      },
    ])
    expect(eventHeadsUpHistory({ [KEY]: { status: 'sent' }, cursor: { status: 'x' } })).toEqual([
      {
        eventKey: KEY,
        status: 'sent',
        attempts: null,
        devicesReached: null,
        sentAt: null,
        finishedAt: null,
      },
    ])
  })

  it('has every section in a fixed order and meets the Function response contract', () => {
    const built = buildAccountExport(
      {
        ...empty,
        account: { uid: 'u1', tier: 'free', skinType: 'fair' },
        truncated: ['importedEvents'],
      },
      new Date('2026-10-28T12:00:00.000Z'),
    )
    expect(Object.keys(built)).toEqual([
      'formatVersion',
      'exportedAt',
      'account',
      'billing',
      'notificationDevices',
      'scheduledActivities',
      'alerts',
      'importedEvents',
      'eventHeadsUps',
      'reapplyReminder',
      'linkedCalendars',
      'googleCalendar',
      'outlookCalendar',
      'truncated',
    ])
    expect(built.formatVersion).toBe(ACCOUNT_EXPORT_FORMAT_VERSION)
    expect(built.exportedAt).toBe('2026-10-28T12:00:00.000Z')
    expect(built.truncated).toEqual(['importedEvents'])
    // The browser reads the Function's answer with this contract; the file it builds
    // itself must meet it too.
    expect(parseFunctionResponse('exportAccountData', JSON.parse(JSON.stringify(built)))).toEqual(
      JSON.parse(JSON.stringify(built)),
    )
    expect(buildAccountExport(empty, new Date(0)).account).toBeNull()
  })
})
