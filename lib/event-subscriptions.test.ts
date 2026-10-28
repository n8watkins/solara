import { describe, expect, it } from 'vitest'
import { linkProblem, subscriptionView, updatedText } from './event-subscriptions'

const NOW = Date.parse('2026-06-15T17:30:00.000Z')
const base = {
  id: 'a'.repeat(32),
  host: 'www.meetup.com',
  label: 'LA Trail Runners',
  status: 'active' as const,
  createdAt: '2026-05-15T00:00:00.000Z',
  lastAttemptAt: '2026-06-15T15:30:00.000Z',
  lastSuccessAt: '2026-06-15T15:30:00.000Z',
  nextRefreshAt: '2026-06-15T21:30:00.000Z',
  error: '',
  eventCount: 12,
  refused: 0,
}

describe('linkProblem', () => {
  it('explains a link that cannot be linked before asking the server', () => {
    expect(linkProblem('https://www.meetup.com/x/events/ical/')).toBeNull()
    expect(linkProblem('webcal://example.org/a.ics')).toBeNull()
    expect(linkProblem('http://example.org/a.ics')).toMatch(/Only https/)
    expect(linkProblem('nonsense')).toMatch(/not a calendar link/)
  })
})

describe('updatedText', () => {
  it('says how long ago, in words', () => {
    expect(updatedText('', NOW)).toBe('Not updated yet')
    expect(updatedText(new Date(NOW - 20_000).toISOString(), NOW)).toBe('Updated just now')
    expect(updatedText(new Date(NOW - 60_000).toISOString(), NOW)).toBe('Updated 1 minute ago')
    expect(updatedText(new Date(NOW - 2 * 3_600_000).toISOString(), NOW)).toBe(
      'Updated 2 hours ago',
    )
    expect(updatedText('2026-06-10T12:00:00.000Z', NOW)).toMatch(/^Updated Jun 1[01]$/)
  })
})

describe('subscriptionView', () => {
  it('shows the label, host, freshness and event count of a working link', () => {
    expect(subscriptionView(base, NOW)).toEqual({
      title: 'LA Trail Runners',
      meta: 'www.meetup.com · Updated 2 hours ago · 12 upcoming events',
      problem: null,
      refused: null,
    })
  })

  it('explains a failing and a paused link, and events over the cap', () => {
    expect(subscriptionView({ ...base, status: 'failing', error: 'timeout' }, NOW).problem).toBe(
      'The last check failed. The calendar site took too long to answer. Solara will try again automatically.',
    )
    const paused = subscriptionView(
      { ...base, label: '', status: 'paused', error: 'http-status', lastSuccessAt: '' },
      NOW,
    )
    expect(paused.title).toBe('www.meetup.com')
    expect(paused.meta).toBe('Not updated yet')
    expect(paused.problem).toMatch(
      /^Paused after a week of failed checks\..*Refresh to try again\.$/,
    )
    expect(subscriptionView({ ...base, refused: 3 }, NOW).refused).toMatch(/^3 events did not fit/)
  })
})
