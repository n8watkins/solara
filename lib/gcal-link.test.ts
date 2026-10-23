import { describe, expect, it } from 'vitest'
import { gcalLink } from '@/lib/weather'
import { gcalWindowLink } from '@/lib/calendar'
import type { Activity } from '@/lib/types'

function dates(url: string): string {
  return new URL(url).searchParams.get('dates') ?? ''
}

// Links are built from the forecast location's date and zone, never the device's:
// 10:30 on 2026-06-15 in Los Angeles is 17:30 UTC wherever the browser runs.
describe('gcalLink', () => {
  it('keeps a fractional start instead of truncating it to the hour', () => {
    const url = gcalLink('Run', { from: 10.5, to: 12 }, 45, '2026-06-15', 'America/Los_Angeles')
    expect(dates(url)).toBe('20260615T173000Z/20260615T181500Z')
  })

  it('handles whole hours, quarter hours and other zones', () => {
    expect(
      dates(gcalLink('Run', { from: 18, to: 20 }, 60, '2026-06-15', 'America/Los_Angeles')),
    ).toBe('20260616T010000Z/20260616T020000Z')
    expect(dates(gcalLink('Hike', { from: 6.75, to: 9 }, 120, '2026-06-17', 'Asia/Tokyo'))).toBe(
      '20260616T214500Z/20260616T234500Z',
    )
  })
})

describe('gcalWindowLink', () => {
  const run: Activity = {
    id: 'run',
    name: 'Running',
    icon: '🏃',
    durationMins: 45,
    maxUV: 4,
    sunscreen: false,
  }

  it('spans the whole window in the location zone, minutes included', () => {
    const url = gcalWindowLink(
      run,
      { from: 10 + 35 / 60, to: 13, peakUV: 3 },
      '2026-06-15',
      'America/Los_Angeles',
    )
    expect(dates(url)).toBe('20260615T173500Z/20260615T200000Z')
    expect(new URL(url).searchParams.get('details')).toContain('from 10:35am–1pm')
  })
})
