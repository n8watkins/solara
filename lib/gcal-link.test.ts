import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { gcalLink } from '@/lib/weather'

/** Google Calendar's compact UTC form, e.g. 20260615T173000Z. */
const utc = (d: Date) => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'

function dates(url: string): string {
  return new URL(url).searchParams.get('dates') ?? ''
}

describe('gcalLink', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 5, 15, 9, 0))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps a fractional start instead of truncating it to the hour', () => {
    const url = gcalLink('Run', { from: 10.5, to: 12 }, 45)
    expect(dates(url)).toBe(
      `${utc(new Date(2026, 5, 15, 10, 30))}/${utc(new Date(2026, 5, 15, 11, 15))}`,
    )
  })

  it('handles whole hours, quarter hours and later days', () => {
    expect(dates(gcalLink('Run', { from: 18, to: 20 }, 60))).toBe(
      `${utc(new Date(2026, 5, 15, 18, 0))}/${utc(new Date(2026, 5, 15, 19, 0))}`,
    )
    expect(dates(gcalLink('Hike', { from: 6.75, to: 9 }, 120, 2))).toBe(
      `${utc(new Date(2026, 5, 17, 6, 45))}/${utc(new Date(2026, 5, 17, 8, 45))}`,
    )
  })
})
