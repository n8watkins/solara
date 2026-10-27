import { describe, expect, it } from 'vitest'
import { exposurePercent, exposureSummary } from '@/lib/activity-exposure'

describe('activity exposure words', () => {
  it('says nothing for an activity without a setting', () => {
    expect(exposureSummary({})).toBeNull()
  })

  it('names the setting and the share of forecast UV', () => {
    expect(exposureSummary({ surface: 'sand' })).toBe('Sand · 115% of forecast UV')
    expect(exposureSummary({ shade: 'partial' })).toBe('Some shade · 75% of forecast UV')
    expect(exposureSummary({ shade: 'full', surface: 'snow' })).toBe(
      'Snow, mostly shade · 135% of forecast UV',
    )
    expect(exposurePercent({ shade: 'partial', surface: 'grass' })).toBe('77%')
  })
})
