import { describe, expect, it } from 'vitest'
import { buildActivityShareText } from '@/lib/share'
import { gcalWindowLink } from '@/lib/calendar'
import type { Activity, Location, SafeActivityWindow } from '@/lib/types'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { buildSunEvents } = require('../functions/lib/feed/sun')

const activity: Activity = {
  id: 'run',
  name: 'Running',
  icon: '🏃',
  durationMins: 60,
  maxUV: 4,
  sunscreen: false,
}
const location: Location = { city: 'Portland', region: 'OR', lat: 45.5, lon: -122.7 }
const window: SafeActivityWindow = {
  from: 7,
  to: 9,
  label: 'Morning',
  peakUV: 2.1,
  avgUV: 1.5,
}

describe('health-adjacent recommendation copy', () => {
  it('qualifies shared recommendations and includes protection context', () => {
    const text = buildActivityShareText(
      {
        activity,
        window,
        location,
        dateLabel: 'Today',
      },
      '12h',
    )
    expect(text).toContain('estimates this as a lower-UV')
    expect(text).toContain('Recheck current conditions and use sun protection.')
    expect(text).not.toMatch(/exactly|\bsafe(?:st)?\b/i)
  })

  it('qualifies Google Calendar links and includes a medical disclaimer', () => {
    const link = new URL(gcalWindowLink(activity, window, '2026-05-29', 'America/Los_Angeles'))
    expect(link.searchParams.get('text')).toBe('Running: lower-UV window')
    const details = link.searchParams.get('details') || ''
    expect(details).toContain('Estimated lower-UV window')
    expect(details).toContain('this is not medical advice')
  })

  it('qualifies live calendar-feed events and includes protection context', () => {
    const [event] = buildSunEvents({ activities: [activity] }, [
      {
        dateStr: '2026-05-29',
        hourly: [
          { hour: 7, uv: 1 },
          { hour: 8, uv: 2 },
          { hour: 9, uv: 8 },
        ],
      },
    ])
    expect(event.summary).toBe('🏃 Running: lower-UV window')
    expect(event.description).toContain('Estimated lower-UV window')
    expect(event.description).toContain('Recheck current UV and use sun protection.')
  })
})
