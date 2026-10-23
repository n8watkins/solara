import { describe, it, expect } from 'vitest'
import { getSafeWindows, getSafeWindowsForActivity } from '@/lib/calendar'
import type { Activity } from '@/lib/types'

type Hourly = { hour: number; uv: number; tempF: number }[]

// Safe morning (6–9 @ uv1), unsafe midday (10–16 @ uv8), safe evening (17–20 @ uv2)
function buildDay(): Hourly {
  const hours: Hourly = []
  for (let h = 6; h <= 20; h++) {
    const uv = h <= 9 ? 1 : h <= 16 ? 8 : 2
    hours.push({ hour: h, uv, tempF: 70 })
  }
  return hours
}

describe('getSafeWindows', () => {
  it('returns each contiguous safe block when no duration filter applies', () => {
    const w = getSafeWindows(buildDay(), 4)
    expect(w).toHaveLength(2)
    expect(w[0]).toMatchObject({ from: 6, to: 10, peakUV: 1 })
    expect(w[1]).toMatchObject({ from: 17, to: 21, peakUV: 2 })
  })

  it('returns no windows when nothing meets the threshold', () => {
    expect(getSafeWindows(buildDay(), 0)).toHaveLength(0)
  })

  it('returns a single all-day window when everything is under threshold', () => {
    const w = getSafeWindows(buildDay(), 11)
    expect(w).toHaveLength(1)
    expect(w[0]).toMatchObject({ from: 6, to: 21 })
  })

  it('drops blocks shorter than the requested duration', () => {
    // evening block is 17–21 (4h); morning is 6–10 (4h). Require 5h → both dropped.
    expect(getSafeWindows(buildDay(), 4, 300)).toHaveLength(0)
  })

  it('keeps blocks that meet the duration exactly', () => {
    // 4h block, require 240 min → kept
    const w = getSafeWindows(buildDay(), 4, 240)
    expect(w).toHaveLength(2)
  })
})

describe('getSafeWindowsForActivity', () => {
  const run: Activity = { id: 'run', name: 'Running', icon: '🏃', durationMins: 60, maxUV: 4, sunscreen: false }

  it('uses the activity duration and effective threshold', () => {
    const w = getSafeWindowsForActivity(buildDay(), run)
    expect(w).toHaveLength(2)
  })

  it('honors preferredHours', () => {
    const morningOnly: Activity = { ...run, preferredHours: { from: 6, to: 10 } }
    const w = getSafeWindowsForActivity(buildDay(), morningOnly)
    expect(w).toHaveLength(1)
    expect(w[0]).toMatchObject({ from: 6, to: 10 })
  })

  it('unlocks midday with sunscreen (effective threshold rises)', () => {
    const spf: Activity = { ...run, sunscreen: true }
    const w = getSafeWindowsForActivity(buildDay(), spf)
    expect(w).toHaveLength(1)
    expect(w[0]).toMatchObject({ from: 6, to: 21 })
  })
})
