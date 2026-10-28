import { describe, expect, it } from 'vitest'
import {
  EVENT_SUBSCRIPTION_LIMITS,
  nextRefreshDelayMs,
  normalizeSubscriptionUrl,
  parseSubscriptionSummaries,
  subscriptionErrorMessage,
  subscriptionLabel,
} from './event-subscriptions'

const HOUR = 3_600_000

describe('normalizeSubscriptionUrl', () => {
  it('accepts https and rewrites webcal to https', () => {
    expect(normalizeSubscriptionUrl(' https://www.meetup.com/bostonpython/events/ical/ ')).toEqual({
      ok: true,
      url: 'https://www.meetup.com/bostonpython/events/ical/',
      host: 'www.meetup.com',
    })
    expect(normalizeSubscriptionUrl('webcal://calendar.example.org/club.ics')).toMatchObject({
      ok: true,
      url: 'https://calendar.example.org/club.ics',
    })
    expect(normalizeSubscriptionUrl('WEBCALS://calendar.example.org/a.ics')).toMatchObject({
      ok: true,
      url: 'https://calendar.example.org/a.ics',
    })
  })

  it('drops the fragment and keeps the query (it may hold the feed token)', () => {
    expect(normalizeSubscriptionUrl('https://x.example.com/a.ics?token=abc#top')).toMatchObject({
      ok: true,
      url: 'https://x.example.com/a.ics?token=abc',
    })
  })

  it('refuses anything but https on the standard port without credentials', () => {
    expect(normalizeSubscriptionUrl('http://x.example.com/a.ics')).toEqual({
      ok: false,
      error: 'not-https',
    })
    expect(normalizeSubscriptionUrl('ftp://x.example.com/a.ics')).toMatchObject({
      error: 'not-https',
    })
    expect(normalizeSubscriptionUrl('file:///etc/passwd')).toMatchObject({ error: 'not-https' })
    expect(normalizeSubscriptionUrl('https://user:pw@x.example.com/a.ics')).toMatchObject({
      error: 'credentials',
    })
    expect(normalizeSubscriptionUrl('https://x.example.com:8443/a.ics')).toMatchObject({
      error: 'port',
    })
    expect(normalizeSubscriptionUrl('https://x.example.com:443/a.ics')).toMatchObject({ ok: true })
    expect(normalizeSubscriptionUrl('https://localhost/a.ics')).toMatchObject({
      error: 'invalid-url',
    })
    expect(normalizeSubscriptionUrl('not a link')).toMatchObject({ error: 'invalid-url' })
    expect(normalizeSubscriptionUrl('')).toMatchObject({ error: 'invalid-url' })
    expect(
      normalizeSubscriptionUrl(
        `https://x.example.com/${'a'.repeat(EVENT_SUBSCRIPTION_LIMITS.urlLength)}`,
      ),
    ).toMatchObject({ error: 'invalid-url' })
  })
})

describe('subscriptionLabel', () => {
  it('takes the first usable candidate, cleaned and capped', () => {
    expect(subscriptionLabel('', null, 'host.example')).toBe('host.example')
    expect(subscriptionLabel('  Club‮ runs \n')).toBe('Club runs')
    expect(subscriptionLabel('x'.repeat(100))).toHaveLength(EVENT_SUBSCRIPTION_LIMITS.labelLength)
  })
})

describe('nextRefreshDelayMs', () => {
  it('waits the refresh interval while working and backs off to the cap while failing', () => {
    expect(nextRefreshDelayMs(0)).toBe(6 * HOUR)
    expect(nextRefreshDelayMs(1)).toBe(6 * HOUR)
    expect(nextRefreshDelayMs(2)).toBe(12 * HOUR)
    expect(nextRefreshDelayMs(3)).toBe(24 * HOUR)
    expect(nextRefreshDelayMs(4)).toBe(48 * HOUR)
    expect(nextRefreshDelayMs(40)).toBe(48 * HOUR)
  })
})

describe('parseSubscriptionSummaries', () => {
  const good = {
    id: 'a'.repeat(32),
    host: 'www.meetup.com',
    label: 'Club',
    status: 'active',
    createdAt: '2026-06-01T00:00:00.000Z',
    lastAttemptAt: '',
    lastSuccessAt: '',
    nextRefreshAt: '',
    error: '',
    eventCount: 0,
    refused: 0,
  }

  it('keeps valid entries whose id matches, oldest first', () => {
    const older = { ...good, id: 'b'.repeat(32), createdAt: '2026-05-01T00:00:00.000Z' }
    const items = { [good.id]: good, [older.id]: older, ['c'.repeat(32)]: good, bad: { id: 'bad' } }
    expect(parseSubscriptionSummaries({ items }).map(item => item.id)).toEqual([older.id, good.id])
  })

  it('never carries a link, even if one were stored', () => {
    const [item] = parseSubscriptionSummaries({
      items: { [good.id]: { ...good, url: 'https://secret' } },
    })
    expect(item).not.toHaveProperty('url')
  })

  it('reads nothing from a missing or malformed document', () => {
    expect(parseSubscriptionSummaries(undefined)).toEqual([])
    expect(parseSubscriptionSummaries({ items: [] })).toEqual([])
  })
})

describe('subscriptionErrorMessage', () => {
  it('words known codes and falls back for unknown ones', () => {
    expect(subscriptionErrorMessage('timeout')).toMatch(/too long/)
    expect(subscriptionErrorMessage('something-new')).toBe('The calendar could not be read.')
    expect(subscriptionErrorMessage('')).toBe('')
  })
})
